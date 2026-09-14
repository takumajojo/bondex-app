/**
 * 配送依頼の「変更受付締切」(change_deadline_at) の算出。
 *
 * 谷口さん決定 (2026-09-14): 既存のホテル連絡締切と同じ算出関数を再利用し、
 * 締切系は営業日関数1本に統一する。
 *   change_deadline_at = businessDaysBefore(shipment_date, HOTEL_CONTACT_LEAD_BUSINESS_DAYS) の日付 + 18:00 JST
 * ここで HOTEL_CONTACT_LEAD_BUSINESS_DAYS = 2 (発送日の2営業日前・土日祝を除外)。
 * 18:00 JST = 09:00 UTC なので、返り値 (timestamptz) は「その日付 T09:00:00Z」。
 *
 * 発送日が変わらなければ不変。発送日が変わったときのみ再計算する。
 */

import { businessDaysBefore } from "./business-days"
import { HOTEL_CONTACT_LEAD_BUSINESS_DAYS } from "./hotel-notification"

/** 締切の時刻 (JST 18:00) を UTC で表したもの。JST = UTC+9 → 09:00Z。 */
const DEADLINE_UTC_TIME = "T09:00:00.000Z"

/**
 * 発送日 (YYYY-MM-DD) から変更受付締切を ISO(UTC) 文字列で返す。
 * shipment_date が空/不正なら null。
 */
export function changeDeadlineAt(shipmentDate: string | null | undefined): string | null {
  const date = businessDaysBefore((shipmentDate || "").trim(), HOTEL_CONTACT_LEAD_BUSINESS_DAYS)
  if (!date) return null
  return `${date}${DEADLINE_UTC_TIME}`
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
