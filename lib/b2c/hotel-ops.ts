/**
 * ホテルの確認の結果の入力（運営の手作業・Stage 4）。docs/b2c/B2C_PHASE1A_BETA_PLAN.md 4章。
 *
 * - 施設の確認（未確認のホテル）: verified → そのホテルで確認待ちの予約を確定（b2c_confirm_order）。
 *   unsupported → そのホテルで確認待ちの予約を取り消して旅行者に通知（請求なし）。
 * - 予約ごとの受入（直前予約）: 両方 accepted → 確定。refused / no_answer → 取り消して通知。
 * 確定・取消・通知の積み込みは DB の関数の中の 1つのトランザクション。記録には操作した運営者（個人のパスキー）と理由を残す。
 */
import { getSupabase } from "@/lib/supabase"
import type { B2cOperator } from "./operator-identity"
import { scheduleBulkRecount } from "./bulk-recount"

export interface HotelOpsResult {
  ok: boolean
  error?: string
  confirmed: number[]
  cancelled: number[]
  stillWaiting: number[]
}

async function confirmOrCancel(orderIds: string[], cancelReason: "hotel_refused" | "hotel_unsupported" | null, op: B2cOperator, note: string): Promise<HotelOpsResult> {
  const sb = getSupabase()!
  const out: HotelOpsResult = { ok: true, confirmed: [], cancelled: [], stillWaiting: [] }
  for (const id of orderIds) {
    const { data: o } = await sb.from("b2c_orders").select("order_number").eq("id", id).maybeSingle()
    const n = (o?.order_number as number) ?? 0
    if (cancelReason) {
      const { data } = await sb.rpc("b2c_cancel_order", {
        p_order_id: id, p_reason: cancelReason, p_actor_type: "operator", p_operator_email: op.operatorEmail, p_credential_id: op.credentialId, p_note: note,
      })
      if (data === "cancelled") out.cancelled.push(n)
    } else {
      const { data } = await sb.rpc("b2c_confirm_order", { p_order_id: id })
      if (data === true) out.confirmed.push(n)
      else out.stillWaiting.push(n)
    }
  }
  // 確定・取消で区間が増減した時だけ、大口集荷を集計し直す（スイッチ OFF なら何もしない）
  if (out.confirmed.length || out.cancelled.length) scheduleBulkRecount(sb, `hotel-ops confirmed=${out.confirmed.length} cancelled=${out.cancelled.length}`)
  return out
}

export async function setFacilityStatus(op: B2cOperator, placeId: string, status: "verified" | "unsupported", note: string): Promise<HotelOpsResult> {
  const sb = getSupabase()
  if (!sb) return { ok: false, error: "server_error", confirmed: [], cancelled: [], stillWaiting: [] }
  const { data: fac, error } = await sb
    .from("b2c_facilities")
    .update({ status, checked_by: op.operatorEmail, checked_at: new Date().toISOString(), last_verified_at: new Date().toISOString(), check_note: note })
    .eq("place_id", placeId)
    .select("place_id")
  if (error || !fac?.length) return { ok: false, error: error ? "server_error" : "facility_not_found", confirmed: [], cancelled: [], stillWaiting: [] }
  const { data: orders } = await sb
    .from("b2c_orders")
    .select("id")
    .eq("status", "awaiting_hotel_confirmation")
    .eq("confirmation_mode", "awaiting_hotel_verification")
    .or(`origin_place_id.eq.${placeId},dest_place_id.eq.${placeId}`)
  const ids = (orders ?? []).map((o) => o.id as string)
  for (const id of ids) {
    await sb.from("b2c_order_events").insert({
      order_id: id, event: `facility_${status}`, actor_type: "operator", operator_email: op.operatorEmail, credential_id: op.credentialId, reason: note,
      after_state: { place_id: placeId, facility_status: status },
    })
  }
  return confirmOrCancel(ids, status === "unsupported" ? "hotel_unsupported" : null, op, note)
}

export async function setHotelAcceptance(op: B2cOperator, orderNumber: number, side: "origin" | "dest", status: "accepted" | "refused" | "no_answer", note: string): Promise<HotelOpsResult> {
  const sb = getSupabase()
  if (!sb) return { ok: false, error: "server_error", confirmed: [], cancelled: [], stillWaiting: [] }
  const { data: o } = await sb.from("b2c_orders").select("id, status, confirmation_mode").eq("order_number", orderNumber).maybeSingle()
  if (!o) return { ok: false, error: "order_not_found", confirmed: [], cancelled: [], stillWaiting: [] }
  if (o.confirmation_mode !== "awaiting_hotel_acceptance") return { ok: false, error: "not_late_booking", confirmed: [], cancelled: [], stillWaiting: [] }
  const { error } = await sb.from("b2c_hotel_acceptances").upsert(
    { order_id: o.id, side, status, contact_note: note, decided_by: op.operatorEmail, decided_at: new Date().toISOString() },
    { onConflict: "order_id,side" },
  )
  if (error) return { ok: false, error: "server_error", confirmed: [], cancelled: [], stillWaiting: [] }
  await sb.from("b2c_order_events").insert({
    order_id: o.id, event: `hotel_${side}_${status}`, actor_type: "operator", operator_email: op.operatorEmail, credential_id: op.credentialId, reason: note,
    after_state: { side, acceptance: status },
  })
  if (o.status !== "awaiting_hotel_confirmation") return { ok: true, confirmed: [], cancelled: [], stillWaiting: [] }
  return confirmOrCancel([o.id as string], status === "accepted" ? null : "hotel_refused", op, note)
}
