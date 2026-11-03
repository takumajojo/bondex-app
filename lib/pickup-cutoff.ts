/**
 * 受付の締切 = 集荷前日 18:30 (JST) (2026-11-04 谷口さん決定)。BondEx の締切はこの1か所で決める。
 *   - 通常の新規予約 (代理店ポータル・予約 API・公開ページの案内)
 *   - 代理店の直接変更 (日程・個数・代表者名・ホテル)。過ぎたら変更申請になる (Operator の個別対応)
 *   - ホテル変更の締切 (shipments.change_deadline_at の値もこの時刻)
 * その後の流れ: 19:00 に Biz-Logi で佐川へ集荷依頼 (目標) / 20:00 が佐川の受付の締め (lib/bizlogi/deadline.ts)。
 *
 * 判定は「18:30:00 ちょうど以降は締切後」。18:29:59 までは締切前。
 * サーバは UTC で動くため、日付・時刻はすべて JST に直して比べる (18:30 JST = 09:30Z)。
 */

const JST_OFFSET_MS = 9 * 3600 * 1000
export const PICKUP_CUTOFF_HOUR_JST = 18
export const PICKUP_CUTOFF_MINUTE_JST = 30

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** 集荷日 (YYYY-MM-DD) の締切 = 前日 18:30 JST を ISO(UTC) で返す。不正な日付は null。 */
export function pickupCutoffAt(shipmentDate: string | null | undefined): string | null {
  const m = YMD_RE.exec((shipmentDate || "").trim())
  if (!m) return null
  const midnightJst = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - JST_OFFSET_MS
  if (Number.isNaN(midnightJst)) return null
  // 前日 18:30 JST = 当日 0:00 JST の 5時間30分前
  return new Date(midnightJst - (24 - PICKUP_CUTOFF_HOUR_JST) * 3600_000 + PICKUP_CUTOFF_MINUTE_JST * 60_000).toISOString()
}

/** 締切を過ぎているか (18:30:00 ちょうど以降は true)。集荷日が不明なら false (既存の判定に委ねる)。 */
export function isPastPickupCutoff(shipmentDate: string | null | undefined, now: Date = new Date()): boolean {
  const at = pickupCutoffAt(shipmentDate)
  if (!at) return false
  return now.getTime() >= Date.parse(at)
}

/** JST の今日 (YYYY-MM-DD)。 */
export function jstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10)
}

/** 今から通常予約できる最も早い集荷日 (今日 18:30 前なら明日、以降なら明後日)。 */
export function earliestBookableShipDate(now: Date = new Date()): string {
  const today = jstToday(now)
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  if (!isPastPickupCutoff(tomorrow, now)) return tomorrow
  return new Date(Date.parse(`${today}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10)
}

/** 表示用「11/6 18:30」(JST)。 */
export function formatPickupCutoff(shipmentDate: string | null | undefined): string {
  const at = pickupCutoffAt(shipmentDate)
  if (!at) return "—"
  const j = new Date(Date.parse(at) + JST_OFFSET_MS)
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`
}

/** 利用者向けの締切の言い方 (画面・メール・案内ページで共通)。 */
export const PICKUP_CUTOFF_TEXT = {
  ja: "集荷前日の18:30（日本時間）",
  en: "18:30 JST on the day before pickup",
} as const
