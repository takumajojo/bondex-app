import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"

export const runtime = "nodejs"
export const maxDuration = 30

/**
 * 代理店による「増額承認」API (料金保護A・P1-B2 v3.4 Track B)。
 * 代理店本人のみが操作できる (resolveAgencyFromRequest = 既存の Supabase JWT → user_agencies → agencies)。
 *
 * GET  ?shipmentId=<uuid>
 *      自社の shipment について、承認待ちの増額内容 (予約時/再計算後/増額分・税抜税込・見積バージョン・期限)
 *      を返す。所有権 (agency_id 一致) は RPC 側で判定。金額はすべてサーバー保存値から返す。
 *
 * POST { shipmentId, quoteVersion, decision: "approved" | "declined", expectedRecalcNet? }
 *      増額を承認/拒否する。金額・条件はサーバー保存値を正本とし、クライアント送信額は照合にのみ使う。
 *      承認で price_status=approved となり課金・請求が解錠される。拒否は保留を維持する。
 *      ※ 本番公開・本番通知・本番課金は行わない (段階導入は Flag/Allowlist 配下)。
 */

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "agency-price-approval")
  if (!limit.ok) return limit.response

  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const shipmentId = req.nextUrl.searchParams.get("shipmentId")?.trim() || ""

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase unavailable" }, { status: 500 })

  const cols =
    "shipment_id, booking_id, leg_index, state, declared_count, actual_count, quoted_net_yen, quoted_gross_yen, recalc_net_yen, recalc_gross_yen, increase_net_yen, increase_gross_yen, quote_version, expires_at, created_at"

  // 一覧モード (shipmentId なし): 自社の承認待ち/承認済みを新しい順に返す。
  let query = sb
    .from("shipment_price_approvals")
    .select(cols)
    .eq("agency_id", auth.agency.id) // 他社案件は見えない
    .in("state", ["approval_pending", "approved"])
    .order("created_at", { ascending: false })
  if (shipmentId) query = query.eq("shipment_id", shipmentId)

  const { data, error } = await query.limit(shipmentId ? 1 : 100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type Row = {
    shipment_id: string; booking_id: string; leg_index: number; state: string
    declared_count: number | null; actual_count: number | null
    quoted_net_yen: number | null; quoted_gross_yen: number | null
    recalc_net_yen: number | null; recalc_gross_yen: number | null
    increase_net_yen: number | null; increase_gross_yen: number | null
    quote_version: number; expires_at: string | null
  }
  const rows = (data ?? []) as Row[]

  // 配送元/先/集荷日は shipments から補完 (表示用)。
  const ids = Array.from(new Set(rows.map((r) => r.shipment_id)))
  const ship = new Map<string, { from_hotel: string | null; to_hotel: string | null; shipment_date: string | null }>()
  if (ids.length > 0) {
    const { data: sdata } = await sb.from("shipments").select("id, from_hotel, to_hotel, shipment_date").in("id", ids)
    for (const s of (sdata ?? []) as Array<{ id: string; from_hotel: string | null; to_hotel: string | null; shipment_date: string | null }>) {
      ship.set(s.id, { from_hotel: s.from_hotel, to_hotel: s.to_hotel, shipment_date: s.shipment_date })
    }
  }

  const toView = (r: Row) => ({
    shipmentId: r.shipment_id,
    bookingRef: `${r.booking_id}-L${(r.leg_index ?? 0) + 1}`,
    state: r.state,
    declaredCount: r.declared_count,
    actualCount: r.actual_count,
    quotedNetYen: r.quoted_net_yen,
    quotedGrossYen: r.quoted_gross_yen,
    recalcNetYen: r.recalc_net_yen,
    recalcGrossYen: r.recalc_gross_yen,
    increaseNetYen: r.increase_net_yen,
    increaseGrossYen: r.increase_gross_yen,
    quoteVersion: r.quote_version,
    expiresAt: r.expires_at,
    fromHotel: ship.get(r.shipment_id)?.from_hotel ?? null,
    toHotel: ship.get(r.shipment_id)?.to_hotel ?? null,
    shipmentDate: ship.get(r.shipment_id)?.shipment_date ?? null,
  })

  if (shipmentId) {
    return NextResponse.json({ ok: true, approval: rows[0] ? toView(rows[0]) : null })
  }
  return NextResponse.json({ ok: true, approvals: rows.map(toView) })
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "agency-price-approval")
  if (!limit.ok) return limit.response

  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  let body: { shipmentId?: unknown; quoteVersion?: unknown; decision?: unknown; expectedRecalcNet?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const shipmentId = typeof body.shipmentId === "string" ? body.shipmentId.trim() : ""
  const quoteVersion = Math.floor(Number(body.quoteVersion))
  const decision = body.decision === "approved" || body.decision === "declined" ? body.decision : ""
  const expectedRecalcNet =
    typeof body.expectedRecalcNet === "number" && Number.isFinite(body.expectedRecalcNet)
      ? Math.floor(body.expectedRecalcNet)
      : null
  if (!shipmentId || !Number.isFinite(quoteVersion) || !decision) {
    return NextResponse.json({ error: "shipmentId, quoteVersion, decision are required" }, { status: 400 })
  }

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase unavailable" }, { status: 500 })

  // 所有権・バージョン・期限・金額(サーバー保存値)・二重承認を RPC がまとめて検証する。
  // クライアント送信の expectedRecalcNet は「照合」用。確定額は常にサーバー保存の recalc_net を使う。
  const { data, error } = await sb.rpc("agency_decide_price", {
    p_shipment_id: shipmentId,
    p_agency_id: auth.agency.id,
    p_quote_version: quoteVersion,
    p_decision: decision,
    p_expected_recalc_net: expectedRecalcNet,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; reason?: string; state?: string } | undefined
  if (!row?.ok) {
    const status =
      row?.reason === "not_owner" ? 403 : row?.reason === "no_active_approval" ? 404 : 409
    return NextResponse.json({ ok: false, reason: row?.reason ?? "unknown", state: row?.state }, { status })
  }
  return NextResponse.json({ ok: true, decision, state: row.state })
}
