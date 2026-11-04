import type { SupabaseClient } from "@supabase/supabase-js"
import { groupDiscountEnabled, type BookingType } from "./pricing"

/**
 * 発行時 (shipandco/create) の団体割引 (Phase 1) 判定材料。
 * 既存予約 (予約依頼時に作成 = requested) の旅行形態 (booking_type) と作成日時 (created_at) を正本にする。
 *   - ok:true  … 発行を続行してよい。bookingType/createdAt を lineSubtotalYen に渡す。
 *   - ok:false … **DB 取得エラー**。呼び出し側は料金を確定せず発行を中止する (不正確なデータで課金/発行しない)。
 */
export type DiscountBasis =
  | { ok: true; bookingType: BookingType; createdAt: string | null }
  | { ok: false; reason: "lookup_failed" }

/**
 * 既存予約から割引判定材料を解決する。
 *
 * - **割引 OFF (既定)**: DB を一切引かず { ok:true, fit, null } を返す。
 *   → 追加クエリも新たな失敗要因も発生しないため、FIT の発行動作は P1-A 導入前と完全に同一。
 * - **割引 ON**:
 *     - DB 取得エラー → { ok:false }。呼び出し側で発行中止 (Ship&co 送信・保存の前)。
 *     - 既存予約あり   → 保存済みの booking_type / created_at を正本にする。
 *     - 既存予約なし (運営の直接新規発行) → { ok:true, fit, null } = 現行 FIT 動作を維持。
 */
export async function resolveLegDiscountBasis(
  sb: SupabaseClient | null,
  bookingId: string,
  legIndex: number,
): Promise<DiscountBasis> {
  // OFF のときは判定材料が料金に影響しない。DB を引かず即 fit を返す (FIT 経路を一切変えない)。
  if (!groupDiscountEnabled() || !sb) {
    return { ok: true, bookingType: "fit", createdAt: null }
  }
  const { data, error } = await sb
    .from("shipments")
    .select("booking_type, created_at")
    .eq("booking_id", bookingId)
    .eq("leg_index", legIndex)
    .maybeSingle()
  // DB 取得エラーと「予約不存在 (data=null, error=null)」を区別する。
  if (error) return { ok: false, reason: "lookup_failed" }
  if (!data) return { ok: true, bookingType: "fit", createdAt: null } // 既存なし = 直接新規発行
  const row = data as { booking_type?: string | null; created_at?: string | null }
  return {
    ok: true,
    bookingType: row.booking_type === "group" ? "group" : "fit",
    createdAt: row.created_at ?? null,
  }
}
