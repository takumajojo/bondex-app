import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { getShipment } from "@/lib/shipments-db"
import { amountForNewCount } from "@/lib/amount-recalc"
import { resolveUnitPriceYen } from "@/lib/pricing"
import { enqueuePriceNotification } from "@/lib/price-notify"
import { grossOf } from "@/lib/tax"
import type { SupabaseClient } from "@supabase/supabase-js"

const PRICE_CALC_VERSION = "p1b2-v3.1"

export const runtime = "nodejs"
export const maxDuration = 30

/**
 * POST /api/operator/confirm-pickup-count  (P1-B2-2 実個数確認・料金確認・保留解除)
 * middleware で operator 認証必須 (他の operator ルートと同じ=ハンドラ内認証は持たない)。
 *
 * 個数確認・料金確認・保留解除を**別操作**に分離 (v3.0 §3)。実個数を入れただけでは解除しない。
 *   action="record"       : 実個数を記録 (count_status=confirmed/disputed)。料金を再計算し price_status を
 *                           calculated / (増額は) requires_customer_approval に。held は動かさない。
 *   action="approve_price": 料金を承認 (price_status=approved)。
 *   action="release"       : 保留解除 (held→released)。count=confirmed かつ price=approved かつ
 *                           未解決の集荷問題なし のときだけ成功 (DB の release_charge_hold が検証)。
 *   action="auto"          : 個数一致・料金一致・問題なし・内訳確定 のとき 1 Tx で記録→承認→解除 (§2A)。
 *                           条件未達なら記録のみ+needs_operator。
 *
 * 料金再計算は lineSubtotalYen 正本 (amountForNewCount)。amount_yen / suitcase_count は書き換えない
 * (請求本体の反映・差額処理・課金は P1-B2-3 以降で承認後)。課金済みは recalc=null で据え置き (差額は運用)。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "confirm-pickup-count")
  if (!limit.ok) return limit.response

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const id = typeof body.id === "string" ? body.id.trim() : ""
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
  const action =
    body.action === "approve_price" || body.action === "release" || body.action === "auto"
      ? body.action
      : "record"
  const confirmedBy =
    typeof body.confirmedBy === "string" && body.confirmedBy.trim()
      ? body.confirmedBy.trim().slice(0, 120)
      : "operator"

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase unavailable" }, { status: 500 })

  const shipment = await getShipment(id)
  if (!shipment) return NextResponse.json({ error: "shipment not found" }, { status: 404 })

  // 料金来歴 (適用単価・割引条件) を1回だけ解決する。承認時に監査列へ保存する。
  const { data: agRow } = await sb
    .from("agencies")
    .select("unit_price_yen")
    .eq("name", shipment.agency ?? "")
    .maybeSingle()
  const hasContractUnit = typeof agRow?.unit_price_yen === "number" && (agRow.unit_price_yen as number) > 0
  const unitPriceYen = resolveUnitPriceYen(agRow?.unit_price_yen as number | null | undefined)
  // 割引条件: 契約単価優先 → 団体割引 (net < 個数×単価) → なし。
  const discountBasis = (count: number, net: number | null | undefined): string => {
    if (hasContractUnit) return "contract_unit"
    if (net != null && net < count * unitPriceYen) return "group8"
    return "none"
  }

  // ── 料金承認のみ ──
  if (action === "approve_price") {
    const decision =
      body.decision === "requires_customer_approval" || body.decision === "calculated"
        ? body.decision
        : "approved"
    const approveCount = shipment.actual_count ?? shipment.suitcase_count ?? 0
    const approveNet = shipment.recalc_amount_yen ?? shipment.amount_yen ?? 0
    const { data, error } = await sb.rpc("apply_price_decision", {
      p_shipment_id: id,
      p_recalc_amount: null,
      p_decision: decision,
      p_by: confirmedBy,
      p_unit_price: unitPriceYen,
      p_discount_basis: discountBasis(approveCount, approveNet),
      p_calc_version: PRICE_CALC_VERSION,
      p_calc_count: approveCount,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const row = (Array.isArray(data) ? data[0] : data) as { ok: boolean; reason: string; price_status: string } | undefined
    if (!row?.ok) return NextResponse.json({ error: `料金承認に失敗: ${row?.reason ?? "unknown"}` }, { status: 400 })
    return NextResponse.json({ ok: true, action, priceStatus: row.price_status, unit: await unitSummary(sb, id) })
  }

  // ── 保留解除のみ (全前提は DB が検証) ──
  if (action === "release") {
    const { data, error } = await sb.rpc("release_charge_hold", { p_shipment_id: id, p_by: confirmedBy })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const row = (Array.isArray(data) ? data[0] : data) as { ok: boolean; reason: string; hold_state: string } | undefined
    if (!row?.ok) {
      return NextResponse.json({ ok: false, action, released: false, reason: row?.reason ?? "unknown", holdState: row?.hold_state }, { status: 409 })
    }
    return NextResponse.json({ ok: true, action, released: true, holdState: row.hold_state, unit: await unitSummary(sb, id) })
  }

  // ── 以降 (record / auto) は実個数が必要 ──
  const actualCount = Math.floor(Number(body.actualCount))
  if (!Number.isFinite(actualCount) || actualCount < 0 || actualCount > 999) {
    return NextResponse.json({ error: "実個数は 0〜999 で入力してください" }, { status: 400 })
  }
  const source = body.source === "sagawa_api" || body.source === "operator_manual" ? body.source : "operator_manual"
  const sagawaReply = typeof body.sagawaReply === "string" ? body.sagawaReply.trim().slice(0, 1000) : null
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : null

  // 料金再計算 (lineSubtotalYen 正本)。amount_yen は書き換えない。
  const recalcNet = await amountForNewCount(
    sb,
    {
      agency: shipment.agency,
      amount_yen: shipment.amount_yen,
      charged_at: shipment.charged_at,
      booking_type: shipment.booking_type,
      created_at: shipment.created_at,
    },
    actualCount,
  )
  const currentNet = shipment.amount_yen ?? 0
  const priceMatches = recalcNet !== undefined && recalcNet === currentNet
  const isIncrease = recalcNet !== undefined && recalcNet > currentNet
  const recalcPreview = buildRecalcPreview(recalcNet, currentNet, !!shipment.charged_at)

  if (action === "auto") {
    // §2A: 個数一致・料金一致・問題なし・内訳確定 のときだけ自動確定。
    const noOpenIssue = body.openIssue === false
    const breakdownConfirmed = body.breakdownConfirmed === true
    const { data, error } = await sb.rpc("auto_finalize_pickup", {
      p_shipment_id: id,
      p_actual_count: actualCount,
      p_recalc_amount: recalcNet ?? null,
      p_price_matches: priceMatches,
      p_no_open_issue: noOpenIssue,
      p_breakdown_confirmed: breakdownConfirmed,
      p_source: source,
      p_sagawa_reply: sagawaReply,
      p_by: confirmedBy,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const row = (Array.isArray(data) ? data[0] : data) as AutoRow | undefined
    if (!row?.ok) return NextResponse.json({ error: `確認に失敗: ${row?.reason ?? "unknown"}` }, { status: 400 })
    return NextResponse.json({
      ok: true,
      action,
      finalized: row.finalized,
      needsOperator: !row.finalized,
      declared: row.declared,
      actual: row.actual,
      countStatus: row.count_status,
      priceStatus: row.price_status,
      holdState: row.hold_state,
      recalcPreview,
      unit: await unitSummary(sb, id),
    })
  }

  // ── action="record": 実個数記録 → 料金状態を calculated / (増額は) requires_customer_approval ──
  const { data: recData, error: recErr } = await sb.rpc("record_pickup_count", {
    p_shipment_id: id,
    p_actual_count: actualCount,
    p_source: source,
    p_sagawa_reply: sagawaReply,
    p_note: note,
    p_disputed: body.disputed === true,
    p_open_issue: typeof body.openIssue === "boolean" ? body.openIssue : null,
    p_confirmed_by: confirmedBy,
  })
  if (recErr) return NextResponse.json({ error: recErr.message }, { status: 500 })
  const rec = (Array.isArray(recData) ? recData[0] : recData) as RecordRow | undefined
  if (!rec?.ok) return NextResponse.json({ error: `個数確認に失敗: ${rec?.reason ?? "unknown"}` }, { status: 400 })

  // 料金状態を進める (増額は要顧客承認・それ以外は計算済)。課金済みで recalc=null のときは触らない。
  let priceStatus = "pending"
  if (recalcNet !== undefined) {
    const decision = isIncrease ? "requires_customer_approval" : "calculated"
    const { data: pData } = await sb.rpc("apply_price_decision", {
      p_shipment_id: id,
      p_recalc_amount: recalcNet,
      p_decision: decision,
      p_by: confirmedBy,
      p_unit_price: unitPriceYen,
      p_discount_basis: discountBasis(actualCount, recalcNet),
      p_calc_version: PRICE_CALC_VERSION,
      p_calc_count: actualCount,
    })
    const prow = (Array.isArray(pData) ? pData[0] : pData) as { price_status?: string } | undefined
    priceStatus = prow?.price_status ?? decision

    // 増額 (予約時提示額超) は代理店の承認が必須 (料金保護A)。承認要求レコードを作る。
    // Operator 承認では解錠できず、代理店本人が承認するまで課金・請求しない。配送は止めない。
    if (isIncrease) {
      const { data: apData } = await sb.rpc("request_price_approval", {
        p_shipment_id: id,
        p_quoted_net: currentNet,
        p_recalc_net: recalcNet,
        p_actual_count: actualCount,
        p_quote_version: 1,
        p_expires_at: null, // 承認期限は運用カレンダー確定後に設定 (null=無期限)
      })
      const apRow = (Array.isArray(apData) ? apData[0] : apData) as { state?: string; approval_id?: string } | undefined
      // 増額承認のお願いを通知キューへ (冪等・本番メールは送らない)。失敗しても確認処理は止めない。
      if (apRow?.state === "approval_pending") {
        await enqueuePriceNotification(sb, id, apRow.approval_id ?? null, 1, null)
      }
    }
  }

  return NextResponse.json({
    ok: true,
    action,
    declared: rec.declared,
    actual: rec.actual,
    discrepancy: rec.discrepancy,
    countStatus: rec.count_status,
    priceStatus,
    holdState: rec.hold_state,
    requiresCustomerApproval: isIncrease,
    recalcPreview,
    unit: await unitSummary(sb, id),
  })
}

function buildRecalcPreview(recalcNet: number | undefined, currentNet: number, alreadyCharged: boolean) {
  if (recalcNet === undefined) return null
  return {
    currentNetYen: currentNet,
    newNetYen: recalcNet,
    currentGrossYen: grossOf(currentNet),
    newGrossYen: grossOf(recalcNet),
    diffGrossYen: grossOf(recalcNet) - grossOf(currentNet),
    alreadyCharged,
    applied: false, // この API では適用しない (P1-B2-3 以降で承認後)
  }
}

async function unitSummary(sb: SupabaseClient, id: string) {
  const { data, error } = await sb.rpc("pickup_unit_summary", { p_shipment_id: id })
  if (error) return { legs: [], stillHeld: 0 }
  const legs = ((data ?? []) as UnitRow[]).map((r) => ({
    shipmentId: r.shipment_id,
    bookingRef: `${r.booking_id}-L${(r.leg_index ?? 0) + 1}`,
    agency: r.agency,
    declared: r.declared,
    actual: r.actual,
    holdState: r.charge_hold_state,
    countStatus: r.count_status,
    priceStatus: r.price_status,
    discrepancy: r.discrepancy,
  }))
  return { legs, stillHeld: legs.filter((l) => l.holdState === "held").length }
}

interface RecordRow {
  ok: boolean
  reason: string
  declared: number
  actual: number
  discrepancy: boolean
  count_status: string
  hold_state: string
}
interface AutoRow {
  ok: boolean
  finalized: boolean
  reason: string
  declared: number
  actual: number
  count_status: string
  price_status: string
  hold_state: string
}
interface UnitRow {
  shipment_id: string
  booking_id: string
  leg_index: number
  agency: string | null
  declared: number
  actual: number | null
  charge_hold_state: string
  count_status: string
  price_status: string
  discrepancy: boolean
}
