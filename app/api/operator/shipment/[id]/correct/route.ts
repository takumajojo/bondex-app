import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { getShipment } from "@/lib/shipments-db"
import { changeDeadlineAt, isChangeDeadlinePassed } from "@/lib/change-deadline"
import { notifyBondEx } from "@/lib/notify"
import {
  normalizeCorrection,
  snapshotBefore,
  postCorrectionAction,
  postCorrectionLabel,
  type CorrectionInput,
} from "@/lib/shipment-change"

export const runtime = "nodejs"
export const maxDuration = 20

/**
 * POST /api/operator/shipment/[id]/correct
 *   運営専用: 予約の訂正 (発送日・到着予定・個数・代表者・受取人) と代理店変更。
 *   middleware で operator 認証必須 (default-deny)。運営=承認主体のため即時反映する。
 *
 *   body: {
 *     shipmentDate?, expectedArrival?, suitcaseCount?, representative?, recipient?,  // この区間(id)
 *     agency?,        // 代理店マスタに存在する名前のみ。予約(booking_id)の全区間に反映。
 *     reason?,        // 締切超過時などの補足 (監査に残す)
 *   }
 *
 * 反映後、承認済み監査行を shipment_change_requests に残し、キャリア別の下流処理
 * (佐川=集荷依頼Excel再送 / ヤマト=送り状再発行) を downstream で返す。
 * 集荷済み以降 (picked_up/in_transit/delivered) は発送日・個数を変更できない (物理ゲート)。
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limit = rateLimit(req, "shipment-correct")
  if (!limit.ok) return limit.response

  const { id } = await ctx.params
  const shipmentId = (id || "").trim()
  if (!shipmentId) return NextResponse.json({ error: "shipment id required" }, { status: 400 })

  let body: CorrectionInput & { agency?: unknown; reason?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })

  const shipment = await getShipment(shipmentId)
  if (!shipment) return NextResponse.json({ error: "shipment not found" }, { status: 404 })
  if (shipment.status === "cancelled") {
    return NextResponse.json({ error: "取り消し済みの予約は訂正できません。" }, { status: 409 })
  }

  // ── フィールド訂正の検証 (この区間)
  const norm = normalizeCorrection(
    {
      shipmentDate: typeof body.shipmentDate === "string" ? body.shipmentDate : undefined,
      expectedArrival: typeof body.expectedArrival === "string" ? body.expectedArrival : undefined,
      suitcaseCount: body.suitcaseCount === undefined ? undefined : Number(body.suitcaseCount),
      representative: typeof body.representative === "string" ? body.representative : undefined,
      recipient: typeof body.recipient === "string" ? body.recipient : undefined,
    },
    shipment,
  )
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 })
  const { patch, changes } = norm

  // 物理ゲート: 集荷済み以降は発送日・個数を変更させない (実物と食い違うため)。
  const shipped = ["picked_up", "in_transit", "delivered"].includes(shipment.status)
  if (shipped && (patch.shipment_date !== undefined || patch.suitcase_count !== undefined)) {
    return NextResponse.json(
      { error: "集荷済み以降は発送日・個数を変更できません。取り消して作り直すか、佐川/ヤマトへ直接ご連絡ください。", code: "SHIPPED" },
      { status: 409 },
    )
  }

  // ── 代理店変更 (任意・全区間・マスタ照合)
  const hasAgency = typeof body.agency === "string" && (body.agency as string).trim() !== ""
  const newAgency = hasAgency ? (body.agency as string).trim() : ""
  const agencyChanged = hasAgency && newAgency !== shipment.agency
  if (agencyChanged) {
    const { data: ag, error: agErr } = await sb
      .from("agencies")
      .select("name")
      .eq("name", newAgency)
      .maybeSingle()
    if (agErr) return NextResponse.json({ error: agErr.message }, { status: 500 })
    if (!ag) {
      return NextResponse.json(
        { error: `代理店「${newAgency}」は登録されていません。代理店マスタに存在する名前を選択してください。` },
        { status: 400 },
      )
    }
  }

  const patchKeys = Object.keys(patch)
  if (patchKeys.length === 0 && !agencyChanged) {
    return NextResponse.json({ error: "変更点がありません。" }, { status: 400 })
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : null
  const legRef = `${shipment.booking_id}-L${shipment.leg_index + 1}`

  // ── フィールド反映 (この区間)。発送日が変われば締切を再計算。
  if (patchKeys.length > 0) {
    const legPatch: Record<string, unknown> = { ...patch }
    if (patch.shipment_date !== undefined) {
      legPatch.change_deadline_at = changeDeadlineAt(String(patch.shipment_date))
    }
    const { error: upErr } = await sb.from("shipments").update(legPatch).eq("id", shipmentId)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  // ── 代理店反映 (全区間・請求突合のため booking 単位)
  if (agencyChanged) {
    const { error: upErr } = await sb
      .from("shipments")
      .update({ agency: newAgency })
      .eq("booking_id", shipment.booking_id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
    changes.push(`代理店: ${shipment.agency || "—"} → ${newAgency}（全区間）`)
  }

  // ── 監査行 (承認済み・operator 直接訂正)
  const before = snapshotBefore(patch, shipment)
  if (agencyChanged) before.agency = shipment.agency
  const fields: Record<string, unknown> = { ...patch }
  if (agencyChanged) fields.agency = newAgency
  const nowIso = new Date().toISOString()
  await sb
    .from("shipment_change_requests")
    .insert({
      shipment_id: shipmentId,
      booking_id: shipment.booking_id,
      leg_index: shipment.leg_index,
      requested_by: "operator",
      requester: "operator",
      agency: shipment.agency,
      fields,
      before,
      over_deadline: isChangeDeadlinePassed(shipment.change_deadline_at),
      reason,
      status: "approved",
      decided_by: "operator",
      decided_at: nowIso,
    })
    .then(
      () => {},
      () => {}, // 監査記録の失敗で訂正本体を巻き戻さない (best-effort)
    )

  // ── 下流処理 (佐川=集荷依頼再送 / ヤマト=送り状再発行)
  const downstream = postCorrectionAction(shipment.carrier, shipment.status, patchKeys)
  const downstreamLabel = postCorrectionLabel(downstream)

  await notifyBondEx({
    kind: "change",
    title: `${legRef} 予約を訂正（運営）`,
    lines: [
      `区間: ${shipment.from_hotel} → ${shipment.to_hotel}`,
      ...changes,
      ...(downstreamLabel ? [`⚠️ ${downstreamLabel}`] : []),
      ...(reason ? [`メモ: ${reason}`] : []),
    ],
    link: `/operator/bookings/${shipment.booking_id}`,
    linkLabel: "予約詳細で確認",
  }).catch(() => {})

  return NextResponse.json({ ok: true, changed: changes, downstream, downstreamLabel })
}
