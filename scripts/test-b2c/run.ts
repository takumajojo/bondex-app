/**
 * B2C MVP の料金と予約可否の判定の回帰テスト。純粋関数だけを試し、DB・佐川・Stripe・本番には触れない。
 *   実行: npx tsx --tsconfig scripts/test-b2c/tsconfig.json scripts/test-b2c/run.ts
 */
import assert from "node:assert/strict"
import { quoteB2c, b2cRouteClass, B2C_MAX_PIECES } from "@/lib/b2c/pricing"
import { judgeB2cBookability, b2cCutoffAt, type B2cBookabilityInput } from "@/lib/b2c/bookability"
import { changeDeadlineAt } from "@/lib/change-deadline"
import { b2cChangeBlockedReason } from "@/lib/b2c/change-gate"
import { judgeB2cHotels, hotelCheckDueAt, earliestPickupWithUnknownHotel, planB2cConfirmation } from "@/lib/b2c/hotel-gate"

let passed = 0
function t(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

const TOKYO = "1000005"
const KYOTO = "6008216"
const NAHA = "9000014"
const ISHIGAKI = "9070004"

console.log("料金")
t("標準: 1個 4,980円（税抜）→ 税込 5,478円", () => {
  const q = quoteB2c(TOKYO, KYOTO, 1)
  assert.equal(q.routeClass, "standard")
  assert.equal(q.subtotalNetYen, 4980)
  assert.equal(q.taxYen, 498)
  assert.equal(q.totalGrossYen, 5478)
})
t("本土→沖縄・沖縄→本土: 1個 13,000円（税抜）", () => {
  assert.equal(b2cRouteClass(NAHA, TOKYO), "okinawa")
  const q = quoteB2c(TOKYO, NAHA, 2)
  assert.equal(q.routeClass, "okinawa")
  assert.equal(q.subtotalNetYen, 26000)
  assert.equal(q.totalGrossYen, 28600)
})
t("沖縄県内どうし（本島→石垣を含む）は標準", () => {
  assert.equal(b2cRouteClass(NAHA, ISHIGAKI), "standard")
  assert.equal(quoteB2c(NAHA, ISHIGAKI, 1).unitNetYen, 4980)
})
t("個数の範囲外・郵便番号の不正は例外", () => {
  assert.throws(() => quoteB2c(TOKYO, KYOTO, 0))
  assert.throws(() => quoteB2c(TOKYO, KYOTO, B2C_MAX_PIECES + 1))
  assert.equal(B2C_MAX_PIECES, 50)
  assert.equal(quoteB2c(TOKYO, KYOTO, 50).subtotalNetYen, 249000)
  assert.throws(() => quoteB2c(TOKYO, KYOTO, 1.5))
  assert.throws(() => quoteB2c("123", KYOTO, 1))
})

console.log("予約可否")
// 2026-11-10 10:00 JST
const NOW = new Date("2026-11-10T01:00:00Z")
function base(over: Partial<B2cBookabilityInput> = {}): B2cBookabilityInput {
  return {
    now: NOW,
    originFacilityId: "hotel-a",
    destFacilityId: "hotel-b",
    origin: { checkIn: "2026-11-12", checkOut: "2026-11-14" },
    dest: { checkIn: "2026-11-15", checkOut: "2026-11-17" },
    pickupDate: "2026-11-14",
    deliveryDate: "2026-11-15",
    transitDays: 1,
    destAcceptsBeforeCheckIn: false,
    ...over,
  }
}

t("通常のケースは受け付ける", () => {
  const r = judgeB2cBookability(base())
  assert.deepEqual(r.errors, [])
  assert.equal(r.earliestDelivery, "2026-11-15")
  assert.equal(r.usedFallbackTransit, false)
})
t("締切は集荷の前日 17:00 JST", () => {
  assert.equal(b2cCutoffAt("2026-11-14").toISOString(), "2026-11-13T08:00:00.000Z")
  const before = judgeB2cBookability(base({ now: new Date("2026-11-13T07:59:59Z") }))
  assert.ok(!before.errors.includes("past_cutoff"))
  const at = judgeB2cBookability(base({ now: new Date("2026-11-13T08:00:00Z") }))
  assert.ok(at.errors.includes("past_cutoff"))
})
t("当日・過去の集荷は不可", () => {
  const r = judgeB2cBookability(base({ pickupDate: "2026-11-10", origin: { checkIn: "2026-11-09", checkOut: "2026-11-10" } }))
  assert.ok(r.errors.includes("pickup_in_past_or_today"))
})
t("JST の日付で判定する（UTC では前日でも JST で当日なら不可）", () => {
  // 2026-11-13 23:30 UTC = 2026-11-14 08:30 JST
  const r = judgeB2cBookability(base({ now: new Date("2026-11-13T23:30:00Z") }))
  assert.ok(r.errors.includes("pickup_in_past_or_today"))
})
t("180日を超える先の集荷は不可（2026-11-10 から数えて 181日目は不可・180日目は可）", () => {
  const far = (pickup: string, dest: string, out: string) =>
    judgeB2cBookability(base({ pickupDate: pickup, origin: { checkIn: pickup, checkOut: pickup }, dest: { checkIn: dest, checkOut: out }, deliveryDate: dest }))
  assert.ok(far("2027-05-10", "2027-05-11", "2027-05-12").errors.includes("too_far_ahead"))
  assert.deepEqual(far("2027-05-09", "2027-05-10", "2027-05-11").errors, [])
})
t("集荷日は集荷元の滞在期間内", () => {
  const r = judgeB2cBookability(base({ pickupDate: "2026-11-15", deliveryDate: "2026-11-16" }))
  assert.ok(r.errors.includes("pickup_outside_origin_stay"))
})
t("佐川の最短より前のお届けは不可", () => {
  const r = judgeB2cBookability(base({ transitDays: 2 }))
  assert.ok(r.errors.includes("delivery_before_earliest"))
  assert.equal(r.earliestDelivery, "2026-11-16")
})
t("佐川の日数が取れない時は安全側の 3日で判定し、印を付ける", () => {
  const r = judgeB2cBookability(base({ transitDays: null, deliveryDate: "2026-11-16" }))
  assert.equal(r.usedFallbackTransit, true)
  assert.equal(r.transitDaysUsed, 3)
  assert.ok(r.errors.includes("delivery_before_earliest"))
  const ok = judgeB2cBookability(base({ transitDays: null, deliveryDate: "2026-11-17", dest: { checkIn: "2026-11-15", checkOut: "2026-11-18" } }))
  assert.ok(!ok.errors.includes("delivery_before_earliest"))
})
t("お届けは配送先のチェックアウトの前日まで", () => {
  const r = judgeB2cBookability(base({ deliveryDate: "2026-11-17" }))
  assert.ok(r.errors.includes("delivery_after_dest_checkout_eve"))
})
t("チェックイン前のお届けは、受け取りを確認したホテルだけ", () => {
  const input = base({ transitDays: 0, deliveryDate: "2026-11-14" })
  assert.ok(judgeB2cBookability(input).errors.includes("delivery_before_dest_checkin"))
  assert.ok(!judgeB2cBookability({ ...input, destAcceptsBeforeCheckIn: true }).errors.includes("delivery_before_dest_checkin"))
})
t("同じホテルどうしは不可", () => {
  assert.ok(judgeB2cBookability(base({ destFacilityId: "hotel-a" })).errors.includes("same_facility"))
})
t("滞在の日付の前後が逆なら不可", () => {
  assert.ok(judgeB2cBookability(base({ dest: { checkIn: "2026-11-17", checkOut: "2026-11-15" } })).errors.includes("invalid_stay"))
})
t("存在しない日付は invalid_date だけを返す", () => {
  assert.deepEqual(judgeB2cBookability(base({ pickupDate: "2026-02-30" })).errors, ["invalid_date"])
})

console.log("B2B と共通の変更締切")
t("B2B の変更締切も発送の前日 17:00 JST（B2C の締切と同じ・月末・年末をまたいでも前日）", () => {
  for (const d of ["2026-11-14", "2027-01-01", "2026-03-01"]) {
    assert.equal(changeDeadlineAt(d), b2cCutoffAt(d).toISOString())
  }
  assert.equal(changeDeadlineAt("2027-01-01"), "2026-12-31T08:00:00.000Z")
  assert.equal(changeDeadlineAt(""), null)
  assert.equal(changeDeadlineAt("bad"), null)
})

console.log("予約後の変更（B2B と同じ規則）")
// 基準: 2026-11-10 10:00 JST
t("個数の変更は集荷の 14日前まで（13日前は不可）", () => {
  assert.equal(b2cChangeBlockedReason("count", { pickupDate: "2026-11-24", pieces: 2 }, NOW), null)
  assert.equal(b2cChangeBlockedReason("count", { pickupDate: "2026-11-23", pieces: 2 }, NOW), "count_lead")
})
t("日付・ホテルの変更と取消は前日 17:00 まで", () => {
  assert.equal(b2cChangeBlockedReason("dates", { pickupDate: "2026-11-12", pieces: 2 }, NOW), null)
  assert.equal(b2cChangeBlockedReason("hotel", { pickupDate: "2026-11-12", pieces: 2 }, NOW), null)
  const after = new Date("2026-11-11T08:00:00Z") // 11/11 17:00 JST
  assert.equal(b2cChangeBlockedReason("hotel", { pickupDate: "2026-11-12", pieces: 2 }, after), "past_cutoff")
  assert.equal(b2cChangeBlockedReason("cancel", { pickupDate: "2026-11-12", pieces: 2 }, after), "past_cutoff")
  assert.equal(b2cChangeBlockedReason("cancel", { pickupDate: "2026-11-12", pieces: 2 }, NOW), null)
})
t("30個以上は集荷の 7日前を切ったら、取消以外の変更は不可", () => {
  assert.equal(b2cChangeBlockedReason("dates", { pickupDate: "2026-11-17", pieces: 30 }, NOW), "group_large_lock")
  assert.equal(b2cChangeBlockedReason("dates", { pickupDate: "2026-11-18", pieces: 30 }, NOW), null)
  assert.equal(b2cChangeBlockedReason("dates", { pickupDate: "2026-11-17", pieces: 29 }, NOW), null)
})

console.log("ホテルの事前確認（未確認のホテルの受付）")
// NOW = 2026-11-10（火）10:00 JST
t("確認済みのホテルどうしは、通常の締切まで即時に確定（確認の期限なし）", () => {
  const r = judgeB2cHotels({ now: NOW, pickupDate: "2026-11-11", origin: "verified", dest: "verified" })
  assert.deepEqual(r.errors, [])
  assert.equal(r.hotelCheckDueAt, null)
})
t("受けないホテルは不可", () => {
  assert.ok(judgeB2cHotels({ now: NOW, pickupDate: "2026-11-20", origin: "verified", dest: "unsupported" }).errors.includes("hotel_unsupported"))
})
t("確認の期限は翌営業日 17:00（金曜の予約は月曜、祝日は飛ばす）", () => {
  assert.equal(hotelCheckDueAt(NOW), "2026-11-11T08:00:00.000Z")
  assert.equal(hotelCheckDueAt(new Date("2026-11-13T01:00:00Z")), "2026-11-16T08:00:00.000Z") // 金→月
  assert.equal(hotelCheckDueAt(new Date("2026-11-20T01:00:00Z")), "2026-11-24T08:00:00.000Z") // 金→(月 11/23 祝)→火
})
t("未確認のホテルは、確認の期限が集荷の 2営業日前 17:00 までに収まる日だけ（前日 16:50 の予約は最初から不可）", () => {
  // 火 10:00 の予約: 確認の期限 = 水 17:00。集荷 金(11/13) の 2営業日前 = 水 → 可。集荷 木(11/12) → 不可
  assert.deepEqual(judgeB2cHotels({ now: NOW, pickupDate: "2026-11-13", origin: "unknown", dest: "verified" }).errors, [])
  assert.ok(judgeB2cHotels({ now: NOW, pickupDate: "2026-11-12", origin: "verified", dest: "unknown" }).errors.includes("hotel_check_window_too_short"))
  // 集荷前日 16:50 の予約（確認済みなら通常の締切内）
  const eve = new Date("2026-11-12T07:50:00Z") // 木 16:50 JST、集荷 金 11/13
  assert.deepEqual(judgeB2cHotels({ now: eve, pickupDate: "2026-11-13", origin: "verified", dest: "verified" }).errors, [])
  assert.ok(judgeB2cHotels({ now: eve, pickupDate: "2026-11-13", origin: "unknown", dest: "verified" }).errors.includes("hotel_check_window_too_short"))
  assert.equal(earliestPickupWithUnknownHotel(NOW), "2026-11-13")
  assert.equal(earliestPickupWithUnknownHotel(eve), "2026-11-17") // 確認の期限 金 17:00 → 集荷 火(2営業日前=金)
})

console.log("予約の確定の条件（直前予約は受入確認待ち）")
const plan = (now: Date, pickupDate: string, o: "verified" | "unknown", d: "verified" | "unknown", staffed = true) =>
  planB2cConfirmation({ now, pickupDate, origin: o, dest: d, lateDutyStaffed: staffed })
t("確認済みどうしで通常の連絡の期限より前は即時に確定", () => {
  const r = plan(NOW, "2026-11-13", "verified", "verified") // 2営業日前 = 水 11/11 17:00 > 火 10:00
  assert.equal(r.mode, "instant")
  assert.equal(r.confirmationDueAt, null)
  assert.deepEqual(r.errors, [])
})
t("通常の連絡の期限を過ぎた予約は、確認済みのホテルでも受入確認待ち（期限は前日 19:00）", () => {
  const r = plan(NOW, "2026-11-12", "verified", "verified") // 2営業日前 = 火 11/10 17:00、今は火 10:00 → まだ前
  assert.equal(r.mode, "instant")
  const late = plan(new Date("2026-11-10T08:30:00Z"), "2026-11-12", "verified", "verified") // 火 17:30
  assert.equal(late.mode, "awaiting_hotel_acceptance")
  assert.equal(late.confirmationDueAt, "2026-11-11T10:00:00.000Z") // 水 19:00 JST
  assert.deepEqual(late.errors, [])
  const eve = plan(new Date("2026-11-12T07:50:00Z"), "2026-11-13", "verified", "verified") // 前日 16:50
  assert.equal(eve.mode, "awaiting_hotel_acceptance")
  assert.equal(eve.confirmationDueAt, "2026-11-12T10:00:00.000Z")
})
t("至急の担当者がいない日は直前予約を受けない", () => {
  const r = plan(new Date("2026-11-12T07:50:00Z"), "2026-11-13", "verified", "verified", false)
  assert.ok(r.errors.includes("late_booking_unstaffed"))
})
t("未確認のホテルは施設の確認待ち（直前の日付は従来どおり選べない）", () => {
  const r = plan(NOW, "2026-11-13", "unknown", "verified")
  assert.equal(r.mode, "awaiting_hotel_verification")
  assert.equal(r.confirmationDueAt, "2026-11-11T08:00:00.000Z")
  assert.ok(plan(new Date("2026-11-12T07:50:00Z"), "2026-11-13", "unknown", "verified").errors.includes("hotel_check_window_too_short"))
})

console.log(`\n${passed} passed`)
