/**
 * 配送依頼の「変更受付締切」(change_deadline_at) の算出。
 *
 * 2026-11-04 谷口さん決定: ホテル変更も含め、締切は集荷前日 18:30 (JST) に統一する (lib/pickup-cutoff.ts)。
 * (旧: 発送の2営業日前 18:00。ホテルへの連絡のため。ホテルへの連絡期限は lib/hotel-notification のまま別に持つ。)
 * 発送日が変われば締切も変わるので、判定は保存値より発送日からの計算を優先する (isPastPickupCutoff)。
 */

import { pickupCutoffAt } from "./pickup-cutoff"

/** 発送日 (YYYY-MM-DD) から変更受付締切 (集荷前日 18:30 JST) を ISO(UTC) 文字列で返す。不正なら null。 */
export function changeDeadlineAt(shipmentDate: string | null | undefined): string | null {
  return pickupCutoffAt(shipmentDate)
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
  return now.getTime() >= dl
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
