// 集荷依頼の締め時刻。SGシステム回答 (2026-09-11 回答票 No.14):
// 「土日祝問わず、前日20時までのリクエストを締め時間としてご認識いただければと思います。」
// 当日集荷の依頼は API ではできない (仕様書の集荷依頼指定日は送信日の翌日以降)。

const JST_OFFSET_MS = 9 * 3600 * 1000

/** 集荷日 (yyyy-MM-dd) に対する締め時刻 = 前日 20:00 JST (UTC の Date で返す)。不正な日付は null。 */
export function pickupRequestCutoff(pickupDate: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((pickupDate || "").trim())
  if (!m) return null
  const startOfDayJst = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - JST_OFFSET_MS
  if (Number.isNaN(startOfDayJst)) return null
  // 前日 20:00 JST = 当日 0:00 JST の 4時間前
  return new Date(startOfDayJst - 4 * 3600 * 1000)
}

/** 締めを過ぎていれば true (= API ではもう依頼できない。世田谷営業所へ相談)。 */
export function pickupRequestClosed(pickupDate: string, now: Date = new Date()): boolean {
  const cutoff = pickupRequestCutoff(pickupDate)
  return !cutoff || now.getTime() >= cutoff.getTime()
}
