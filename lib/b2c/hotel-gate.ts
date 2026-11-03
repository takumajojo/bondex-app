/**
 * B2C のホテルの受付の可否（事前確認・16.18）。純粋関数。
 *
 * - verified（フロントに人がいて荷物を預かれると確認済み）: 通常の締切（前日 18:30・lib/pickup-cutoff.ts）まで即時に予約できる。
 * - unsupported（受けない）: 予約できない。
 * - unknown（未確認）: 運営がホテルを確認する時間を確保できる集荷日だけ予約できる（16.20）。
 *   確認の期限 = min(予約の翌営業日 17:00 JST, 集荷の 2営業日前 17:00 JST)。
 *   2営業日前は「ホテルへの連絡の期限」（lib/hotel-notification.ts の HOTEL_CONTACT_LEAD_BUSINESS_DAYS）。
 *   予約の時刻から期限まで、最低 UNKNOWN_HOTEL_MIN_CHECK_WINDOW_MS（2時間）が無い集荷日は、最初から選ばせない。
 *   → 予約を受けた後に「最初から確認できなかった」状態を作らない。
 */
import { businessDaysBefore, isBusinessDay, toYmd } from "@/lib/business-days"
import { HOTEL_CONTACT_LEAD_BUSINESS_DAYS } from "@/lib/hotel-notification"
import { jstYmd } from "./bookability"

export type B2cHotelStatus = "verified" | "unknown" | "unsupported"
export type B2cHotelGateError = "hotel_unsupported" | "hotel_check_window_too_short"

/** 確認と連絡の時刻（JST 17:00 = 08:00Z）。 */
const CHECK_HOUR_UTC = "T08:00:00.000Z"

/** 未確認のホテルの確認に最低限確保する時間（2時間）。 */
export const UNKNOWN_HOTEL_MIN_CHECK_WINDOW_MS = 2 * 3600 * 1000

/** 予約の時刻から、ホテル確認の期限の上限（翌営業日 17:00 JST）を返す。 */
export function hotelCheckDueAt(now: Date): string {
  const d = new Date(`${jstYmd(now)}T12:00:00Z`)
  do {
    d.setUTCDate(d.getUTCDate() + 1)
  } while (!isBusinessDay(d))
  return `${toYmd(d)}${CHECK_HOUR_UTC}`
}

/** 未確認のホテルの確認を終えていなければならない時刻（集荷の 2営業日前 17:00 JST）。 */
export function hotelCheckLatestAt(pickupDate: string): string | null {
  const ymd = businessDaysBefore(pickupDate, HOTEL_CONTACT_LEAD_BUSINESS_DAYS)
  return ymd ? `${ymd}${CHECK_HOUR_UTC}` : null
}

export interface B2cHotelGateResult {
  errors: B2cHotelGateError[]
  /** 未確認のホテルを含む時の確認の期限。両方確認済みなら null（即時に確定） */
  hotelCheckDueAt: string | null
}

export function judgeB2cHotels(input: {
  now: Date
  pickupDate: string
  origin: B2cHotelStatus
  dest: B2cHotelStatus
}): B2cHotelGateResult {
  const errors: B2cHotelGateError[] = []
  if (input.origin === "unsupported" || input.dest === "unsupported") errors.push("hotel_unsupported")
  const needsCheck = input.origin === "unknown" || input.dest === "unknown"
  if (!needsCheck) return { errors, hotelCheckDueAt: null }
  const due = unknownHotelCheckDueAt(input.now, input.pickupDate)
  if (!due) errors.push("hotel_check_window_too_short")
  return { errors, hotelCheckDueAt: due }
}

/**
 * 未確認のホテルの確認の期限 = min(翌営業日 17:00, 集荷の 2営業日前 17:00)。
 * 予約の時刻から期限まで 2時間未満なら null（その集荷日は選べない）。
 */
export function unknownHotelCheckDueAt(now: Date, pickupDate: string): string | null {
  const next = hotelCheckDueAt(now)
  const latest = hotelCheckLatestAt(pickupDate)
  if (!latest) return null
  const due = next < latest ? next : latest
  if (Date.parse(due) - now.getTime() < UNKNOWN_HOTEL_MIN_CHECK_WINDOW_MS) return null
  return due
}

/** 未確認のホテルを含む予約で選べる、いちばん早い集荷日（画面の日付の選択肢の下限に使う）。 */
export function earliestPickupWithUnknownHotel(now: Date): string {
  const d = new Date(`${jstYmd(now)}T12:00:00Z`)
  for (let i = 0; i < 60; i++) {
    d.setUTCDate(d.getUTCDate() + 1)
    const ymd = toYmd(d)
    if (unknownHotelCheckDueAt(now, ymd)) return ymd
  }
  throw new Error("earliestPickupWithUnknownHotel: not found within 60 days")
}

/**
 * 直前予約（ホテルへの通常の連絡の期限＝集荷の 2営業日前 17:00 JST を過ぎた予約）の受入確認の期限。
 * 集荷の前日 18:00 JST（16.20）。Phase 1A の集荷依頼は B2B と同じく運営が世田谷営業所へ手で連絡する。
 * 世田谷営業所のカスタマーサービスは 9:00〜19:00、緊急の変更の依頼は 18:30 まで（docs/sagawa マスター 181・182）。
 * 前日 20:00 の締め（マスター 78）は Biz-Logi の API の締めで、Phase 1A は使わない。
 * → 18:00 までに受入を確認し、18:30 までに佐川へ連絡する。
 */
export const LATE_ACCEPTANCE_DUE_HOUR_JST = 18

export function lateAcceptanceDueAt(pickupDate: string): string {
  const d = new Date(`${pickupDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return `${toYmd(d)}T${String(LATE_ACCEPTANCE_DUE_HOUR_JST - 9).padStart(2, "0")}:00:00.000Z`
}

/**
 * 予約をいつ確定できるか（16.19）。
 * - `instant`: 両ホテルとも施設として確認済みで、通常の連絡の期限より前。予約の時点で確定する
 *   （その予約の受入の連絡は、B2B と同じく通常の期限までに運営が行う）。
 * - `awaiting_hotel_verification`: 未確認のホテルを含む。施設の確認（min(翌営業日 17:00, 集荷の 2営業日前 17:00)）の後に確定。
 * - `awaiting_hotel_acceptance`: 直前予約。集荷元・配送先それぞれの受入の確認がそろってから確定。
 *   期限は集荷の前日 18:00。期限までにそろわない・断られた時は取消（請求しない）。
 * 直前予約は、その日に至急の対応の担当者がいる時だけ受ける（いなければ `late_booking_unstaffed`）。
 */
export type B2cConfirmationMode = "instant" | "awaiting_hotel_verification" | "awaiting_hotel_acceptance"

export interface B2cConfirmationPlan {
  errors: Array<B2cHotelGateError | "late_booking_unstaffed">
  mode: B2cConfirmationMode
  /** 確定の条件がそろわなければ取消になる時刻（instant は null） */
  confirmationDueAt: string | null
}

export function planB2cConfirmation(input: {
  now: Date
  pickupDate: string
  origin: B2cHotelStatus
  dest: B2cHotelStatus
  /**
   * 直前予約を受けられる日か。呼び出し側で「b2cLateBookingEnabled()（佐川の確認まで OFF）かつ
   * その集荷日に至急の対応の担当者がいる（b2c_ops_days.late_duty_staff）」を渡す。
   */
  lateDutyStaffed: boolean
}): B2cConfirmationPlan {
  const gate = judgeB2cHotels(input)
  const errors: B2cConfirmationPlan["errors"] = [...gate.errors]
  if (gate.hotelCheckDueAt) {
    return { errors, mode: "awaiting_hotel_verification", confirmationDueAt: gate.hotelCheckDueAt }
  }
  const latest = hotelCheckLatestAt(input.pickupDate)
  const isLate = !latest || input.now.toISOString() > latest
  if (!isLate) return { errors, mode: "instant", confirmationDueAt: null }
  if (!input.lateDutyStaffed) errors.push("late_booking_unstaffed")
  return { errors, mode: "awaiting_hotel_acceptance", confirmationDueAt: lateAcceptanceDueAt(input.pickupDate) }
}
