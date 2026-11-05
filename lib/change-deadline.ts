/**
 * 配送依頼の「変更受付締切」(change_deadline_at) の算出。
 *
 * 谷口さん決定 (2026-11-03): B2B・B2C とも「発送日の前日 17:00 JST」に統一する。
 * 日程・個数・代表者名の変更 (lib/agency-self-service.ts の selfServiceCutoffAt) と同じ時刻で、
 * ホテル変更もこの時刻で締める。(旧: 発送日の2営業日前 18:00。2026-09-14 決定)
 * 17:00 JST = 08:00 UTC なので、返り値 (timestamptz) は「前日の日付 T08:00:00Z」。
 *
 * ホテルへの連絡期限 (lib/hotel-notification.ts の発送2営業日前) は別の基準で、変えない。
 * 締切の直前にホテルが変わった区間は、ホテル連絡のアラートで「至急」として扱われる。
 *
 * 発送日が変わらなければ不変。発送日が変わったときのみ再計算する。
 */

import { selfServiceCutoffAt } from "./agency-self-service"

/**
 * 発送日 (YYYY-MM-DD) から変更受付締切を ISO(UTC) 文字列で返す。
 * shipment_date が空/不正なら null。
 */
export function changeDeadlineAt(shipmentDate: string | null | undefined): string | null {
  return selfServiceCutoffAt(shipmentDate)
}

/** 残り48時間を切っているか (警告色の判定に使う)。now は既定で現在時刻。 */
export function isChangeDeadlineNear(
  changeDeadline: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!changeDeadline) return false
  const dl = Date.parse(changeDeadline)
  if (Number.isNaN(dl)) return false
  const diffMs = dl - now.getTime()
  return diffMs <= 48 * 3600 * 1000 // 締切超過(負)も「近い」に含める(警告色)
}

/** 締切を過ぎているか。 */
export function isChangeDeadlinePassed(
  changeDeadline: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!changeDeadline) return false
  const dl = Date.parse(changeDeadline)
  if (Number.isNaN(dl)) return false
  return now.getTime() > dl
}

/** 表示用: 「2026/10/13 18:00」形式 (JST・絶対値)。 */
export function formatChangeDeadlineJst(changeDeadline: string | null | undefined): string {
  if (!changeDeadline) return "—"
  const t = Date.parse(changeDeadline)
  if (Number.isNaN(t)) return "—"
  const jst = new Date(t + 9 * 3600 * 1000)
  const y = jst.getUTCFullYear()
  const mo = String(jst.getUTCMonth() + 1).padStart(2, "0")
  const da = String(jst.getUTCDate()).padStart(2, "0")
  const h = String(jst.getUTCHours()).padStart(2, "0")
  const mi = String(jst.getUTCMinutes()).padStart(2, "0")
  return `${y}/${mo}/${da} ${h}:${mi}`
}
