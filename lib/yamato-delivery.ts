/**
 * ヤマト宅急便 配達日指定ルール ユーティリティ
 *
 * 公式FAQ準拠 (2026 時点):
 *   - 宅急便 (常温): 発送日の翌日から 7 日以内 (発送翌日を含む)
 *       例: 発送 6/1 → 指定可能 6/2 〜 6/8
 *   - クール宅急便: 営業所到着日から 3 日以内
 *
 * 全関数は **JST (Asia/Tokyo)** 基準で日付境界を判定する。
 * Vercel は UTC 稼働のため、UTC 0:00 起点で計算してタイムゾーンずれを起こさない。
 *
 * 配達日 (deliveryDate) と発送日 (shipDate) は YYYY-MM-DD 文字列で扱う。
 * 内部では UTC 0:00 ミリ秒に変換してカレンダー日差を取り、レンジ判定する。
 *
 * 共通設計:
 *   - マジックナンバー (1, 7, 3) は YAMATO_RULES 定数として集約。ルール改定時に1箇所で済む。
 *   - フロント (operator UI) / バック (Ship&co create) 双方から import される単一実装。
 *   - 関数は **純粋関数** (Date.now() などのグローバル参照なし)。テスト容易性 + キャッシュ互換のため。
 */

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000

export const YAMATO_RULES = {
  /** 宅急便 (常温). 発送日翌日 〜 +7日. */
  standard: { minOffsetDays: 1, maxOffsetDays: 7 },
  /** クール宅急便. 営業所到着 〜 +3日 (将来対応). */
  cool: { minOffsetDays: 0, maxOffsetDays: 3 },
} as const

export type ServiceType = keyof typeof YAMATO_RULES

/**
 * ヤマト宅急便の配達時間帯指定 (Ship&co `setup.time` の許容値)。
 * operator UI のセレクトと app/api/shipandco/create の許可リストで共用する。
 */
export const DELIVERY_TIME_SLOTS = [
  "not-specified",
  "before-noon",
  "before-ten",
  "before-five",
  "14-16",
  "16-18",
  "18-20",
  "19-21",
] as const

export type DeliveryTimeSlot = (typeof DELIVERY_TIME_SLOTS)[number]

/** 発送日の翌日 (最短) 到着で、午前系スロットを選んでいるかどうか。
 *  ヤマトのシステム上は選択自体は可能だが、翌日到着では午前中の到着を
 *  確約できないことが実運用で多いため、operator UI で警告を出す判定に使う。 */
export function isNextDayEarlySlotRisky(
  shipmentDate: string,
  deliveryDate: string,
  timeSlot: string,
): boolean {
  if (!isValidYmd(shipmentDate) || !isValidYmd(deliveryDate)) return false
  const offset = dayDiff(shipmentDate, deliveryDate)
  return offset === YAMATO_RULES.standard.minOffsetDays && (timeSlot === "before-noon" || timeSlot === "before-ten")
}

export type DeliveryDateErrorCode =
  | "SHIPMENT_INVALID"      // shipmentDate が不正/未指定
  | "DELIVERY_INVALID"      // deliveryDate がフォーマット不正
  | "DELIVERY_BEFORE_MIN"   // deliveryDate < shipmentDate + minOffsetDays
  | "DELIVERY_AFTER_MAX"    // deliveryDate > shipmentDate + maxOffsetDays

// ---------------------------------------------------------------------------
// 基本ユーティリティ (内部)
// ---------------------------------------------------------------------------

/**
 * YYYY-MM-DD のフォーマット + 実在日チェック (例: 2026-02-31 を弾く).
 *
 * @example
 *   isValidYmd("2026-06-30")  // true
 *   isValidYmd("2026-02-31")  // false (2月に31日は存在しない)
 *   isValidYmd("2026/06/30")  // false (スラッシュ不可)
 */
export function isValidYmd(s: string): boolean {
  if (typeof s !== "string") return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const t = Date.parse(`${s}T00:00:00Z`)
  if (Number.isNaN(t)) return false
  return new Date(t).toISOString().slice(0, 10) === s
}

/**
 * 2つの YYYY-MM-DD のカレンダー日差 (to - from).
 * UTC 0:00 基準で計算するため夏時間/タイムゾーンの影響を受けない.
 *
 * @example
 *   dayDiff("2026-06-30", "2026-07-01")  // 1
 *   dayDiff("2026-06-30", "2026-07-07")  // 7
 *   dayDiff("2026-07-01", "2026-06-30")  // -1
 */
export function dayDiff(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`)
  const b = Date.parse(`${toYmd}T00:00:00Z`)
  return Math.round((b - a) / MS_PER_DAY)
}

/**
 * YYYY-MM-DD に日数を足した日付を返す.
 *
 * @example
 *   addDays("2026-06-30", 1)  // "2026-07-01"
 *   addDays("2026-06-30", 7)  // "2026-07-07"
 *   addDays("2026-12-31", 1)  // "2027-01-01"
 */
export function addDays(ymd: string, days: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`) + days * MS_PER_DAY
  return new Date(t).toISOString().slice(0, 10)
}

/**
 * JST (Asia/Tokyo) の今日を YYYY-MM-DD で返す.
 * Vercel は UTC 稼働なので、Intl.DateTimeFormat で確実に JST に変換する.
 *
 * @example
 *   jstTodayYmd()  // "2026-06-29" (JST の現在日付)
 */
export function jstTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 指定可能な配達日レンジ ([min, max] 両端含む) を返す.
 *
 * standard (宅急便): [shipDate + 1日, shipDate + 7日]
 * cool     (クール): [shipDate + 0日, shipDate + 3日] ※将来対応
 *
 * shipDate が不正な場合は null を返す (呼び出し側で UI を無効化する).
 *
 * @example
 *   getDeliverableRange("2026-06-30")            // { min: "2026-07-01", max: "2026-07-07" }
 *   getDeliverableRange("2026-06-30", "cool")    // { min: "2026-06-30", max: "2026-07-03" }
 *   getDeliverableRange("invalid")               // null
 */
export function getDeliverableRange(
  shipDate: string,
  serviceType: ServiceType = "standard",
): { min: string; max: string } | null {
  if (!isValidYmd(shipDate)) return null
  const rule = YAMATO_RULES[serviceType]
  return {
    min: addDays(shipDate, rule.minOffsetDays),
    max: addDays(shipDate, rule.maxOffsetDays),
  }
}

/**
 * 配達日 (deliveryDate) が指定可能レンジ内かを bool で判定.
 *
 * @example
 *   isValidDeliveryDate("2026-07-01", "2026-06-30")  // true (翌日 → OK)
 *   isValidDeliveryDate("2026-07-07", "2026-06-30")  // true (7日後 → 境界 OK)
 *   isValidDeliveryDate("2026-07-08", "2026-06-30")  // false (8日後 → NG)
 *   isValidDeliveryDate("2026-06-30", "2026-06-30")  // false (当日 → NG, 最短は翌日)
 *   isValidDeliveryDate("2026-06-29", "2026-06-30")  // false (前日 → NG)
 */
export function isValidDeliveryDate(
  deliveryDate: string,
  shipDate: string,
  serviceType: ServiceType = "standard",
): boolean {
  return deliveryDateErrorCode(deliveryDate, shipDate, serviceType) === null
}

/**
 * 配達日のエラーコードを返す. 問題がなければ null.
 * UI のメッセージ表示・API レスポンスで利用.
 *
 * @example
 *   deliveryDateErrorCode("2026-07-01", "2026-06-30")  // null
 *   deliveryDateErrorCode("2026-07-08", "2026-06-30")  // "DELIVERY_AFTER_MAX"
 *   deliveryDateErrorCode("2026-06-29", "2026-06-30")  // "DELIVERY_BEFORE_MIN"
 *   deliveryDateErrorCode("invalid",    "2026-06-30")  // "DELIVERY_INVALID"
 *   deliveryDateErrorCode("2026-07-01", "invalid")     // "SHIPMENT_INVALID"
 */
export function deliveryDateErrorCode(
  deliveryDate: string,
  shipDate: string,
  serviceType: ServiceType = "standard",
): DeliveryDateErrorCode | null {
  if (!isValidYmd(shipDate)) return "SHIPMENT_INVALID"
  if (!isValidYmd(deliveryDate)) return "DELIVERY_INVALID"
  const rule = YAMATO_RULES[serviceType]
  const offset = dayDiff(shipDate, deliveryDate)
  if (offset < rule.minOffsetDays) return "DELIVERY_BEFORE_MIN"
  if (offset > rule.maxOffsetDays) return "DELIVERY_AFTER_MAX"
  return null
}

/**
 * UI 表示用に「指定可能レンジ」を短く整形 (英語/日本語).
 *
 * @example
 *   formatRangeHint("2026-06-30", "ja")  // "07/01〜07/07 まで指定可能"
 *   formatRangeHint("2026-06-30", "en")  // "Available: 07/01–07/07"
 */
export function formatRangeHint(
  shipDate: string,
  locale: "ja" | "en" = "ja",
  serviceType: ServiceType = "standard",
): string {
  const range = getDeliverableRange(shipDate, serviceType)
  if (!range) return ""
  const fmt = (ymd: string) => ymd.slice(5).replace("-", "/")
  if (locale === "ja") return `${fmt(range.min)}〜${fmt(range.max)} まで指定可能`
  return `Available: ${fmt(range.min)}–${fmt(range.max)}`
}
