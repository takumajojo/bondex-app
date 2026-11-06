/**
 * B2C の試験の日付を、実際の今日から見て有効な日に動かす（2026-11-06 監査）。
 *
 * 試験は 2026-11-04〜11-20 の暦（集荷 11-10 火曜など）で書いてある。実際の時刻が進むと、
 * 未確認のホテルの確認の期限（集荷の 2営業日前 17:00）や受付の締切（前日 18:30）を過ぎて予約が断られる。
 * 業務の決まりはそのままにして、試験の日付だけを「7日の倍数」ずらす:
 * - 曜日が変わらない。
 * - 11-04〜11-20 と同じ並びの営業日（土日・祝日）になる週まで進める（祝日が入る週は飛ばす）。
 * - ずらした 11-04 の 0:00 JST が今より後（試験の暦がすべて未来）。
 * 時計はずらさない（アプリ・PostgreSQL・試験が同じ実時刻を使う）。
 *
 * 使い方: D("2026-11-10") → ずらした YYYY-MM-DD、T("2026-11-11T03:00:00Z") → ずらした ISO。
 * B2C_TEST_DATE_SHIFT_DAYS で固定もできる（7の倍数で、上の条件を満たす値だけ）。
 * Python と .mjs の試験は `npx tsx scripts/test-b2c/dates/test-dates.ts` の出力（ずらす日数）を使う。
 */
import { isBusinessDay, toYmd } from "../../../lib/business-days"

const DAY = 86_400_000
export const ANCHOR_FROM = "2026-11-04"
export const ANCHOR_TO = "2026-11-20"

const utcNoon = (ymd: string) => Date.parse(`${ymd}T12:00:00Z`)
const addDays = (ymd: string, n: number) => toYmd(new Date(utcNoon(ymd) + n * DAY))

export function shiftIsValid(shift: number, now: Date = new Date()): boolean {
  return shiftIsValidFor(shift, ANCHOR_FROM, ANCHOR_TO, now)
}

export function computeShiftDays(now: Date = new Date()): number {
  const fixed = process.env.B2C_TEST_DATE_SHIFT_DAYS
  if (fixed !== undefined && fixed !== "") {
    const n = Number(fixed)
    if (!shiftIsValid(n, now)) throw new Error(`B2C_TEST_DATE_SHIFT_DAYS=${fixed} は使えません（7の倍数・暦が未来・営業日の並びが同じ）`)
    return n
  }
  for (let s = 0; s <= 7 * 26; s += 7) if (shiftIsValid(s, now)) return s
  throw new Error("試験の日付をずらせる週が見つかりません")
}

export function shiftIsValidFor(shift: number, from: string, to: string, now: Date = new Date()): boolean {
  if (!Number.isInteger(shift) || shift < 0 || shift % 7 !== 0) return false
  if (Date.parse(`${addDays(from, shift)}T00:00:00+09:00`) <= now.getTime()) return false
  for (let ymd = from; ymd <= to; ymd = addDays(ymd, 1)) {
    if (isBusinessDay(new Date(utcNoon(ymd))) !== isBusinessDay(new Date(utcNoon(addDays(ymd, shift))))) return false
  }
  return true
}

/**
 * 試験が使う暦の範囲を指定してずらす（できるだけ小さく）。相手の決まりで先の日付に上限がある試験に使う
 * （例: Biz-Logi は 30日を超える先の発送日を断る → scripts/test-integ/b2c-bizlogi-flow.ts）。
 */
export function datesFor(from: string, to: string, now: Date = new Date()) {
  let shift = -1
  for (let s = 0; s <= 7 * 26; s += 7) if (shiftIsValidFor(s, from, to, now)) { shift = s; break }
  if (shift < 0) throw new Error("試験の日付をずらせる週が見つかりません")
  return {
    SHIFT_DAYS: shift,
    D: (ymd: string): string => addDays(ymd, shift),
    T: (iso: string): string => new Date(Date.parse(iso) + shift * DAY).toISOString().replace(".000Z", "Z"),
  }
}

export const SHIFT_DAYS = computeShiftDays()
export const D = (ymd: string): string => addDays(ymd, SHIFT_DAYS)
export const T = (iso: string): string => new Date(Date.parse(iso) + SHIFT_DAYS * DAY).toISOString().replace(".000Z", "Z")

if (process.argv[1] && /test-dates\.ts$/.test(process.argv[1])) console.log(String(SHIFT_DAYS))
