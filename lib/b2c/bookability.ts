/**
 * B2C の予約可否の判定（MVP・T1）。docs/b2c/B2C_PLATFORM_AUDIT_v1.md 16章、設計書 6.3。
 *
 * 純粋関数。DB・佐川・時計には触れない（呼び出し側が「今」と佐川の日数を渡す）。
 * 予約 API・カード登録の直前・運営の承認で、同じ関数を使う。
 *
 * 決まっていること:
 * - 受付締切は集荷の前日 17:00 JST（D03 確定 2026-11-02）。当日の集荷は不可。
 *   Biz-Logi も集荷依頼の指定日は「翌日以降」（E1-0090）。
 * - 日数は佐川「配達日数検索」の値（lib/sagawa-lead-time.ts）。佐川の側に日数の無い区間は無く、
 *   取れないのは当社の照会の失敗だけ（16.8）。失敗時は安全側の 3日で受ける（M04 確定 2026-11-02）。
 * - Biz-Logi への送り状・集荷依頼は、集荷の前日（または前々日）にまとめて送る（M03 方針 2026-11-02）。
 *   予約の受付は Biz-Logi の 30日の上限（E1-0091）に縛られない。
 * - 集荷元: チェックイン日 ≤ 集荷日 ≤ チェックアウト日。
 * - 配送先: お届け日 ≤ チェックアウト日の前日。チェックイン日より前のお届けは、
 *   チェックイン前の荷物の受け取りを確認したホテルだけ（設計書 6.3 の 6）。
 */
import { earliestArrivalYmd } from "@/lib/sagawa-lead-time"

/** 受付締切: 集荷の何日前の何時（JST）まで。 */
export const B2C_CUTOFF_DAYS_BEFORE = 1
export const B2C_CUTOFF_HOUR_JST = 17
/**
 * 何日先の集荷まで受けるか。仮置き 30日のまま（日数は未確定・16.9 の M03）。
 * Biz-Logi は前日にまとめて送るので上限の理由にはならない。残る制約は Stripe の与信の期限（P-06）だけ。
 */
export const B2C_MAX_DAYS_AHEAD = 30
/**
 * 佐川の日数が取れなかった時の安全側の日数（M04 確定 2026-11-02）。
 * 本番の表の最大は 3日（2026-11-02 の読み取り）。
 */
export const B2C_FALLBACK_TRANSIT_DAYS = 3
/** Biz-Logi: 配達指定日は発送日から 30日以内（E1-0037）。前日に送っても、集荷日からの日数として効く。 */
export const SAGAWA_MAX_DELIVERY_AFTER_PICKUP_DAYS = 30

export interface B2cStay {
  checkIn: string // YYYY-MM-DD
  checkOut: string // YYYY-MM-DD
}

export interface B2cBookabilityInput {
  /** 判定の時刻（呼び出し側が渡す。テストで固定できるように） */
  now: Date
  originFacilityId: string
  destFacilityId: string
  origin: B2cStay
  dest: B2cStay
  pickupDate: string
  deliveryDate: string
  /** 佐川の日数（発送日 + days 日でお届け）。照会に失敗したら null */
  transitDays: number | null
  /** 配送先がチェックイン前の荷物の受け取りを確認済みか */
  destAcceptsBeforeCheckIn: boolean
}

export type B2cBookabilityError =
  | "invalid_date"
  | "same_facility"
  | "pickup_in_past_or_today"
  | "past_cutoff"
  | "too_far_ahead"
  | "pickup_outside_origin_stay"
  | "invalid_stay"
  | "delivery_before_earliest"
  | "delivery_after_dest_checkout_eve"
  | "delivery_before_dest_checkin"
  | "delivery_too_far_after_pickup"

export interface B2cBookabilityResult {
  ok: boolean
  errors: B2cBookabilityError[]
  /** 最短お届け日（目安） */
  earliestDelivery: string | null
  transitDaysUsed: number
  /** 佐川の日数が取れず安全側の日数を使った（運営に警告を出す） */
  usedFallbackTransit: boolean
  /** 受付締切（ISO・UTC） */
  cutoffAt: string | null
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

function isYmd(s: string): boolean {
  const m = YMD.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === s
}

function addDays(ymd: string, days: number): string {
  return earliestArrivalYmd(ymd, days) as string
}

/** JST の日付（YYYY-MM-DD）。 */
export function jstYmd(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(at)
}

/** 集荷日の受付締切（集荷の前日 17:00 JST）を UTC の Date で返す。 */
export function b2cCutoffAt(pickupDate: string): Date {
  const eve = addDays(pickupDate, -B2C_CUTOFF_DAYS_BEFORE)
  const [y, m, d] = eve.split("-").map(Number)
  // JST = UTC+9（夏時間なし）
  return new Date(Date.UTC(y, m - 1, d, B2C_CUTOFF_HOUR_JST - 9, 0, 0))
}

export function judgeB2cBookability(input: B2cBookabilityInput): B2cBookabilityResult {
  const errors: B2cBookabilityError[] = []
  const dates = [input.origin.checkIn, input.origin.checkOut, input.dest.checkIn, input.dest.checkOut, input.pickupDate, input.deliveryDate]
  const transitDaysUsed = input.transitDays ?? B2C_FALLBACK_TRANSIT_DAYS
  const usedFallbackTransit = input.transitDays === null

  if (!dates.every(isYmd)) {
    return { ok: false, errors: ["invalid_date"], earliestDelivery: null, transitDaysUsed, usedFallbackTransit, cutoffAt: null }
  }

  if (input.originFacilityId === input.destFacilityId) errors.push("same_facility")
  if (input.origin.checkIn > input.origin.checkOut || input.dest.checkIn >= input.dest.checkOut) errors.push("invalid_stay")

  const today = jstYmd(input.now)
  const cutoff = b2cCutoffAt(input.pickupDate)
  if (input.pickupDate <= today) errors.push("pickup_in_past_or_today")
  else if (input.now.getTime() >= cutoff.getTime()) errors.push("past_cutoff")
  if (input.pickupDate > addDays(today, B2C_MAX_DAYS_AHEAD)) errors.push("too_far_ahead")

  if (input.pickupDate < input.origin.checkIn || input.pickupDate > input.origin.checkOut) errors.push("pickup_outside_origin_stay")

  const earliestDelivery = addDays(input.pickupDate, transitDaysUsed)
  if (input.deliveryDate < earliestDelivery) errors.push("delivery_before_earliest")
  if (input.deliveryDate > addDays(input.dest.checkOut, -1)) errors.push("delivery_after_dest_checkout_eve")
  if (input.deliveryDate < input.dest.checkIn && !input.destAcceptsBeforeCheckIn) errors.push("delivery_before_dest_checkin")
  if (input.deliveryDate > addDays(input.pickupDate, SAGAWA_MAX_DELIVERY_AFTER_PICKUP_DAYS)) errors.push("delivery_too_far_after_pickup")

  return {
    ok: errors.length === 0,
    errors,
    earliestDelivery,
    transitDaysUsed,
    usedFallbackTransit,
    cutoffAt: cutoff.toISOString(),
  }
}
