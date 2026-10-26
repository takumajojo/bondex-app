// 追跡照会の配分ポリシー（Ship&co 15回/番号 を使い切らないための「今 照会すべきか」判定）。
//
// 方針（谷口さん 2026-10-26）:
//   - 集荷日の照会は抑える（発送予定日より前は佐川に荷物データが無いので照会しない）。
//   - 配達予定日は原則 2時間ごとに確認する。
//   - 1番号あたり 15回以内に収める（超過すると 429 TRACKING_LIMIT_EXCEEDED）。
//   - 残枠が僅少（遅延などで収まらない兆候）になったら担当者へ通知する（呼び出し側が判定）。
//
// cron 自体は 15分毎に起動するが、各区間を「最後の照会からの経過時間 × フェーズ別間隔」で
// ゲートすることで、実効的な照会頻度をフェーズに応じて変える。

import type { ShipmentStatus } from "@/lib/shipments-db"

/** Ship&co の追跡番号あたり照会上限。これに達したら以降その番号は照会しない。 */
export const TRACKING_MAX_QUERIES = 15
/** 残枠がこれ以下になったら「上限接近」。遅延等で 15回に収まらない兆候として担当者へ通知する。 */
export const TRACKING_LOW_BUDGET = 2

const HOUR_MS = 3_600_000

// フェーズ別の照会間隔（時間）。Infinity = 照会しない。
const INTERVAL_H = {
  collect: 8, // 集荷フェーズ（発送予定日以降・issued）: 8時間ごと（1日2〜3回で集荷を検知）
  transit: 12, // 配送中（配達予定日より前）: 12時間ごと（抑制）
  deliveryDay: 2, // 配達予定日（前日以降）: 2時間ごと（配達を取りこぼさない）
} as const

const TERMINAL = new Set<ShipmentStatus>(["delivered", "cancelled", "failed"])

/** 照会判定に必要な区間の最小情報。 */
export interface PollRow {
  status: ShipmentStatus
  shipment_date: string | null // 発送(集荷)予定日 YYYY-MM-DD
  expected_arrival: string | null // 配達予定日 YYYY-MM-DD
  tracking_limit_reached?: boolean | null // 既存便の上限到達フラグ（別一覧・手動対象）
}

/** 追跡番号ごとの照会メタ（tracking_detail から取り出す）。 */
export interface NumberMeta {
  lastCheckedAt?: string | null
  queryCount?: number | null
  limitReached?: boolean | null
}

function jstYmd(now: Date): string {
  return new Date(now.getTime() + 9 * HOUR_MS).toISOString().slice(0, 10)
}
/** JST の時 (0-23)。夜間ガード用。 */
function jstHour(now: Date): number {
  return new Date(now.getTime() + 9 * HOUR_MS).getUTCHours()
}

/**
 * 現在のフェーズに応じた照会間隔（時間）。Infinity = いま照会しない。
 */
export function currentIntervalHours(row: PollRow, now: Date): number {
  const today = jstYmd(now)
  if (row.status === "issued") {
    // 集荷前。発送予定日より前は照会しない（佐川に荷物データが無く exception を返すだけ）。
    if (row.shipment_date && today < row.shipment_date) return Infinity
    return INTERVAL_H.collect
  }
  // 配送中（picked_up / in_transit）
  const arr = row.expected_arrival
  if (arr) {
    // 配達予定日(当日)以降は 2時間ごと。それより前は 12時間ごとに抑制する。
    if (today >= arr) return INTERVAL_H.deliveryDay
    return INTERVAL_H.transit
  }
  // 配達予定日が不明なら配送中は 12時間ごと。
  return INTERVAL_H.transit
}

/** この番号はまだ照会に使えるか（上限未達）。 */
export function numberHasBudget(m: NumberMeta): boolean {
  if (m.limitReached) return false
  return (m.queryCount ?? 0) < TRACKING_MAX_QUERIES
}

/**
 * この区間を「いま」照会すべきか。
 *  - 終端 / 既存上限到達(tracking_limit_reached) は照会しない。
 *  - 残枠のある番号が1つも無ければ照会しない。
 *  - フェーズ別間隔（集荷8h / 配送12h / 配達予定日2h）を、残枠のある番号の最終照会時刻で満たすかで判定。
 */
export function shouldQueryLeg(row: PollRow, numbersMeta: NumberMeta[], now: Date): boolean {
  if (row.tracking_limit_reached) return false
  if (TERMINAL.has(row.status)) return false
  // 夜間(JST 21時〜翌8時)は集荷も配達も発生しないので照会しない — 15回の節約。
  const h = jstHour(now)
  if (h < 8 || h >= 21) return false
  const active = numbersMeta.filter(numberHasBudget)
  if (active.length === 0) return false
  const intervalH = currentIntervalHours(row, now)
  if (!isFinite(intervalH)) return false
  return active.some((m) => {
    if (!m.lastCheckedAt) return true
    return now.getTime() - new Date(m.lastCheckedAt).getTime() >= intervalH * HOUR_MS
  })
}

/** 区間の残枠（全番号の最小残枠）。遅延等で収まらない兆候の判定に使う。 */
export function remainingBudget(numbersMeta: NumberMeta[]): number {
  if (numbersMeta.length === 0) return TRACKING_MAX_QUERIES
  return Math.min(
    ...numbersMeta.map((m) => (m.limitReached ? 0 : Math.max(0, TRACKING_MAX_QUERIES - (m.queryCount ?? 0)))),
  )
}

// leg の進捗ステータス = 全追跡番号の最も遅れた確定ステータス。
// 1番号でも未確定(noData/429/exception=status無し)なら、その番号は最劣(-1)扱いにして leg を前進
// させない → 「一部だけ取得できた時に delivered と誤判定する」確認漏れ・完了メール誤送信を防ぐ。
const PROGRESSION_FULL: ShipmentStatus[] = ["issued", "picked_up", "in_transit", "delivered"]
export function legProgressStatus(
  detail: Array<{ number?: string; status?: ShipmentStatus | null }>,
  trackingNumbers: string[],
): ShipmentStatus | null {
  if (trackingNumbers.length === 0) return null
  let minRank = Infinity
  for (const num of trackingNumbers) {
    const d = detail.find((x) => x.number === num)
    const st = d?.status ?? null
    const r = st ? PROGRESSION_FULL.indexOf(st) : -1 // 未確定(noData/429/exception)は -1 = 最劣
    if (r < minRank) minRank = r
  }
  return minRank >= 0 ? PROGRESSION_FULL[minRank] : null
}
