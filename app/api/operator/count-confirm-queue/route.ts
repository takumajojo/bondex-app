import { NextRequest, NextResponse } from "next/server"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"

export const runtime = "nodejs"

/**
 * GET /api/operator/count-confirm-queue  (P1-B2 v3.5 Track D)
 * 実個数確認・料金承認待ちの通常配送 leg を返す読み取り専用エンドポイント。
 * middleware で operator 認証必須 (他 operator ルートと同じ=cookie/Bearer)。書き込みはしない。
 */
export async function GET(_req: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: false, reason: "not_configured", items: [] })
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ ok: false, reason: "unavailable", items: [] }, { status: 500 })

  const { data, error } = await sb.rpc("operator_count_queue", { p_limit: 200 })
  if (error) {
    // 列/関数が未適用 (sql/066-071 未適用) の環境では空扱い (既存画面を壊さない)。
    return NextResponse.json({ ok: true, items: [], note: "queue_unavailable" })
  }
  type Row = {
    shipment_id: string; booking_id: string; leg_index: number; agency: string | null
    from_hotel: string | null; to_hotel: string | null; shipment_date: string | null
    declared: number; actual: number | null; discrepancy: boolean
    amount_yen: number | null; recalc_amount_yen: number | null; approved_amount_yen: number | null
    count_status: string; price_status: string; charge_hold_state: string
    has_open_pickup_issue: boolean; approval_state: string | null; updated_at: string | null
  }
  const items = ((data ?? []) as Row[]).map((r) => ({
    shipmentId: r.shipment_id,
    bookingRef: `${r.booking_id}-L${(r.leg_index ?? 0) + 1}`,
    agency: r.agency,
    fromHotel: r.from_hotel,
    toHotel: r.to_hotel,
    shipmentDate: r.shipment_date,
    declared: r.declared,
    actual: r.actual,
    discrepancy: r.discrepancy,
    amountYen: r.amount_yen,
    recalcAmountYen: r.recalc_amount_yen,
    approvedAmountYen: r.approved_amount_yen,
    countStatus: r.count_status,
    priceStatus: r.price_status,
    holdState: r.charge_hold_state,
    hasOpenIssue: r.has_open_pickup_issue,
    approvalState: r.approval_state,
    updatedAt: r.updated_at,
  }))
  return NextResponse.json({ ok: true, items })
}
