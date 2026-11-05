/**
 * B2B の団体割引（#100）と B2C の料金・課金の分離の試験。純粋関数とファイルの中身だけ。DB・Stripe・本番には触れない。
 *   実行: npx tsx --tsconfig scripts/test-b2c/tsconfig.json scripts/test-b2c/b2b_isolation.ts
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { quoteB2c, B2C_MAX_PIECES } from "@/lib/b2c/pricing"
import { lineSubtotalYen } from "@/lib/pricing"

let passed = 0
const t = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`) }
const TOKYO = "1000005", KYOTO = "6008216", NAHA = "9000014"
const all = () => [1, 2, 5, B2C_MAX_PIECES].flatMap((n) => [quoteB2c(TOKYO, KYOTO, n), quoteB2c(TOKYO, NAHA, n)])

const before = JSON.stringify(all())
const saved = { e: process.env.GROUP_DISCOUNT_ENABLED, a: process.env.GROUP_DISCOUNT_ENABLED_AT }
try {
  process.env.GROUP_DISCOUNT_ENABLED = "true"
  process.env.GROUP_DISCOUNT_ENABLED_AT = "2020-01-01T00:00:00Z"
  t("団体割引を ON にしても B2C の料金（標準・沖縄・1〜10個）は 1円も変わらない", () => assert.equal(JSON.stringify(all()), before))
  t("（対照）B2B の団体 25個以上は ON の時だけ割引が付く", () => {
    const g = lineSubtotalYen({ bookingType: "group", pieces: 30, agencyUnitPriceYen: null, bookingCreatedAt: "2026-11-05T00:00:00Z" })
    assert.ok(g < 30 * 4980, String(g))
  })
} finally {
  if (saved.e === undefined) delete process.env.GROUP_DISCOUNT_ENABLED; else process.env.GROUP_DISCOUNT_ENABLED = saved.e
  if (saved.a === undefined) delete process.env.GROUP_DISCOUNT_ENABLED_AT; else process.env.GROUP_DISCOUNT_ENABLED_AT = saved.a
}
t("（対照）割引が OFF なら B2B の団体 30個は割引なし（今の請求と同じ）", () =>
  assert.equal(lineSubtotalYen({ bookingType: "group", pieces: 30, agencyUnitPriceYen: null, bookingCreatedAt: "2026-11-05T00:00:00Z" }), 30 * 4980))
t("B2C の料金の計算は B2B の料金の部品（lib/pricing）を使わない", () => {
  for (const f of ["lib/b2c/pricing.ts", "lib/b2c/booking-service.ts", "lib/b2c/charge-service.ts", "lib/b2c/card-service.ts"]) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /from "@\/lib\/pricing"|from "\.\.\/pricing"/, f)
  }
})
t("B2B の課金・発行・個数の是正の入口は B2C の区間を止める", () => {
  assert.match(readFileSync("lib/charge.ts", "utf8"), /isB2cShipmentRow\(shipment\)/)
  assert.match(readFileSync("app/api/shipandco/create/route.ts", "utf8"), /isB2cShipmentRow/)
  assert.match(readFileSync("lib/pickup-request/apply-effects.ts", "utf8"), /isB2cShipmentRow/)
})
console.log(`\n${passed} passed`)
