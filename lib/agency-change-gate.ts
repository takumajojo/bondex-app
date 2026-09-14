// 代理店セルフ変更の「リードタイム」ゲート (2026-09-14 谷口さん)。
// 既存の「未発行のみ」ゲート・ホテル変更締切(発送2営業日前)とは別の追加制約:
//   ルール1: 団体(group)かつ 30個以上 → 発送7日(暦日)以内は すべての変更(ホテル/日程/個数)を不可。
//   ルール2: 個数変更 → 発送14日(暦日)前まで(=14日未満は不可)。
// いずれもブロック時は「BondEx へご連絡ください」。日数は暦日(土日祝を含む)で数える。

export const GROUP_LARGE_PIECES = 30
export const GROUP_LOCK_MAX_DAYS = 7 // 発送まで 7日以内(<=7) は不可 (団体30個以上)
export const COUNT_MIN_LEAD_DAYS = 14 // 個数変更は発送 14日前まで(=14日未満<14 は不可)

export type ChangeKind = "hotel" | "dates" | "count"
export type BlockReason = "group_large_lock" | "count_lead"

export interface ChangeGateInput {
  bookingType: string | null | undefined
  suitcaseCount: number | null | undefined
  shipmentDate: string | null | undefined // 'YYYY-MM-DD' (JST の暦日)
}

/**
 * 発送日までの残り暦日数 (JST基準・当日=0)。過去なら負。shipment_date 不明なら null。
 * 例: 今日(JST) 09-14 で shipment_date=09-21 → 7。
 */
export function daysUntilShipment(
  shipmentDate: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!shipmentDate) return null
  const shipUtc = Date.parse(`${shipmentDate}T00:00:00+09:00`)
  if (Number.isNaN(shipUtc)) return null
  // now を JST の壁時計に直し、その日の JST 00:00 を UTC で得る
  const jst = new Date(now.getTime() + 9 * 3600 * 1000)
  const todayJstMidnightUtc = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * 3600 * 1000
  return Math.round((shipUtc - todayJstMidnightUtc) / 86_400_000)
}

/**
 * 変更がブロックされる理由を返す (null = 許可)。
 * ルール1(団体大口)を先に判定 → 続いてルール2(個数リード)。
 */
export function changeBlockedReason(
  kind: ChangeKind,
  input: ChangeGateInput,
  now: Date = new Date(),
): BlockReason | null {
  const days = daysUntilShipment(input.shipmentDate, now)
  if (days === null) return null // 発送日不明は追加制約なし(既存ゲートに委ねる)
  const isLargeGroup = input.bookingType === "group" && (input.suitcaseCount ?? 0) >= GROUP_LARGE_PIECES
  if (isLargeGroup && days <= GROUP_LOCK_MAX_DAYS) return "group_large_lock"
  if (kind === "count" && days < COUNT_MIN_LEAD_DAYS) return "count_lead"
  return null
}
