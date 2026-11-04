// Biz-Logi で送ってよい区間かの判定 (サーバ・画面の両方で使う純粋関数)。
/**
 * Biz-Logi で送ってよい区間か。BondEx の当面の運用ルール (2026-11-04 谷口さん): Biz-Logi で送るのは 1〜19個の通常配送だけ。
 * これは佐川 API の上限ではない (佐川の個口数の項目は2桁 = 99個まで・100個で E1-0004。仕様書 Ver2.82 とテスト環境で確認)。
 * 20個以上は佐川へ事前連絡が必要なため、当面 BondEx が確認して手動 (Excel) で手配する。団体も手動 (大口・団体は別の仕組みで扱う)。
 * DB 関数 claim_pickup_request でも同じ条件で拒否する (sql/067)。手動 (Excel) の記録には影響しない。
 */
export const BIZLOGI_MAX_PIECES = 19

export function bizlogiEligibility(row: { suitcase_count: number | null; booking_type?: string | null }): { ok: true } | { ok: false; reason: string } {
  if ((row.suitcase_count ?? 0) > BIZLOGI_MAX_PIECES) {
    return { ok: false, reason: `${row.suitcase_count}個のため Biz-Logi では送りません (BondEx の当面の運用ルール: Biz-Logi は19個まで。佐川 API の上限ではありません)。佐川へ事前連絡のうえ手動 (Excel) で手配してください` }
  }
  if ((row.booking_type ?? "fit") === "group") {
    return { ok: false, reason: "団体の予約は Biz-Logi では送りません。佐川へ連絡のうえ手動 (Excel) で手配してください" }
  }
  return { ok: true }
}
