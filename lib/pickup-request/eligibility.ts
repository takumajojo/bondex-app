// Biz-Logi で送ってよい区間かの判定 (サーバ・画面の両方で使う純粋関数)。
/**
 * Biz-Logi で送ってよい区間か (2026-11-04 谷口さん: 当面 1〜19個の通常配送だけ)。
 * 20個以上は佐川へ事前連絡が必要なため BondEx で確認して手動手配する。団体も手動 (大口・団体は別の仕組みで扱う)。
 * DB 関数 claim_pickup_request でも同じ条件で拒否する (sql/062)。手動 (Excel) の記録には影響しない。
 */
export const BIZLOGI_MAX_PIECES = 19

export function bizlogiEligibility(row: { suitcase_count: number | null; booking_type?: string | null }): { ok: true } | { ok: false; reason: string } {
  if ((row.suitcase_count ?? 0) > BIZLOGI_MAX_PIECES) {
    return { ok: false, reason: `${row.suitcase_count}個のため Biz-Logi では送りません (19個まで)。佐川へ事前連絡のうえ手動 (Excel) で手配してください` }
  }
  if ((row.booking_type ?? "fit") === "group") {
    return { ok: false, reason: "団体の予約は Biz-Logi では送りません。佐川へ連絡のうえ手動 (Excel) で手配してください" }
  }
  return { ok: true }
}
