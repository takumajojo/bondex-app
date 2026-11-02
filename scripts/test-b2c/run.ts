/**
 * B2C MVP の料金と予約可否の判定の回帰テスト。純粋関数だけを試し、DB・佐川・Stripe・本番には触れない。
 *   実行: npx tsx --tsconfig scripts/test-b2c/tsconfig.json scripts/test-b2c/run.ts
 */
import assert from "node:assert/strict"
import { quoteB2c, b2cRouteClass, B2C_MAX_PIECES } from "@/lib/b2c/pricing"
import { judgeB2cBookability, b2cCutoffAt, type B2cBookabilityInput } from "@/lib/b2c/bookability"

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
t("30日を超える先の集荷は不可", () => {
  const r = judgeB2cBookability(
    base({ pickupDate: "2026-12-11", origin: { checkIn: "2026-12-10", checkOut: "2026-12-11" }, dest: { checkIn: "2026-12-12", checkOut: "2026-12-13" }, deliveryDate: "2026-12-12" }),
  )
  assert.ok(r.errors.includes("too_far_ahead"))
  const ok = judgeB2cBookability(
    base({ pickupDate: "2026-12-10", origin: { checkIn: "2026-12-09", checkOut: "2026-12-10" }, dest: { checkIn: "2026-12-11", checkOut: "2026-12-12" }, deliveryDate: "2026-12-11" }),
  )
  assert.ok(!ok.errors.includes("too_far_ahead"))
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

console.log(`\n${passed} passed`)
