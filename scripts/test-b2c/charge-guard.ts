/**
 * B2B の課金の入口（lib/charge.ts の chargeShipmentIfDue）が B2C の区間を課金しないことの試験。
 * インメモリの Supabase（scripts/test-lead-time/fakes/supabase.ts）を使い、Stripe には到達しない。
 *   実行: npx tsx --tsconfig scripts/test-b2c/tsconfig.json scripts/test-b2c/charge-guard.ts
 */
import assert from "node:assert/strict"
import { resetTables } from "../test-lead-time/fakes/supabase"

async function main() {
  process.env.STRIPE_CHARGE_LIVE = "true"
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy_never_called"
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://fake"
  const { chargeShipmentIfDue } = await import("@/lib/charge")

  resetTables({
    shipments: [
      { id: "b2c-1", channel: "b2c", b2c_order_id: "o1", agency: "BondEx Direct", amount_yen: 4980, charged_at: null, is_addition: false },
      { id: "b2c-legacy", agency: "BondEx Direct", amount_yen: 4980, charged_at: null, is_addition: false },
      { id: "b2b-1", channel: "b2b", b2c_order_id: null, agency: "Test Agency", amount_yen: 4980, charged_at: null, is_addition: false },
    ],
    agencies: [],
  })
  const r1 = await chargeShipmentIfDue("b2c-1")
  assert.equal(r1.charged, false)
  assert.equal(r1.reason, "b2c_channel")
  const r2 = await chargeShipmentIfDue("b2c-legacy")
  assert.equal(r2.reason, "b2c_channel")
  // B2B の行は今までどおり代理店の確認に進む（この試験では代理店が無いので agency_not_found）
  const r3 = await chargeShipmentIfDue("b2b-1")
  assert.equal(r3.reason, "agency_not_found")
  console.log("  ok  B2B の課金の入口は B2C の区間を課金せず、B2B の区間は従来どおり処理に進む")
}
main().catch((e) => { console.error(e); process.exit(1) })
