// Biz-Logi で送ってよい区間かの判定 (サーバ・画面の両方で使う純粋関数)。
/**
 * Biz-Logi で送ってよい区間か。BondEx の当面の運用ルール (2026-11-04 谷口さん): Biz-Logi で送るのは 1〜19個の通常配送だけ。
 * これは佐川 API の上限ではない (佐川の個口数の項目は2桁 = 99個まで・100個で E1-0004。仕様書 Ver2.82 とテスト環境で確認)。
 * 20個以上は佐川へ事前連絡が必要なため、当面 BondEx が確認して手動 (Excel) で手配する。団体も手動 (大口・団体は別の仕組みで扱う)。
 * DB 関数 claim_pickup_request でも同じ条件で拒否する (sql/067)。手動 (Excel) の記録には影響しない。
 */
export const BIZLOGI_MAX_PIECES = 19

const isYmd = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v.slice(0, 10)))

export function bizlogiEligibility(row: {
  suitcase_count: number | null
  booking_type?: string | null
  /** 'b2b' | 'b2c' (sql/061)。B2C だけ集荷元のチェックアウト日を必須にする */
  channel?: string | null
  from_prefecture?: string | null
  to_prefecture?: string | null
  from_residence?: unknown
  to_residence?: unknown
  origin_check_out?: string | null
}): { ok: true } | { ok: false; reason: string } {
  if ((row.suitcase_count ?? 0) > BIZLOGI_MAX_PIECES) {
    return { ok: false, reason: `${row.suitcase_count}個のため Biz-Logi では送りません (BondEx の当面の運用ルール: Biz-Logi は19個まで。佐川 API の上限ではありません)。佐川へ事前連絡のうえ手動 (Excel) で手配してください` }
  }
  if ((row.booking_type ?? "fit") === "group") {
    return { ok: false, reason: "団体の予約は Biz-Logi では送りません。佐川へ連絡のうえ手動 (Excel) で手配してください" }
  }
  // 送信前に Google の住所の都道府県と照合するため、ホテルの区間は予約の都道府県が必須 (2026-11-06)。
  // ここで判定すると、運営のやること (集荷依頼の一覧) と送信パネルに理由つきで出る (押すまで分からない状態にしない)
  const missing: string[] = []
  if (!row.from_residence && !(row.from_prefecture ?? "").trim()) missing.push("発送元ホテルの都道府県")
  if (!row.to_residence && !(row.to_prefecture ?? "").trim()) missing.push("到着ホテルの都道府県")
  // B2C は予約の控えに集荷元のチェックアウト日がある (sql/081 で区間へ写す)。無い・壊れている区間は送らない。
  // 予約の確定を通すことと、集荷依頼を通すことは別 (2026-11-06 谷口さん)
  if (row.channel === "b2c" && !isYmd(row.origin_check_out)) missing.push("集荷元ホテルのチェックアウト日")
  if (missing.length) {
    return { ok: false, reason: `予約の${missing.join("・")}が空 (または正しくない) ため Biz-Logi では送れません。予約を確認して直すか、手動 (Excel) で手配してください` }
  }
  return { ok: true }
}
