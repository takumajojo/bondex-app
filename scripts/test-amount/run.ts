/**
 * 個数変更で請求額 (amount_yen) も更新されることの回帰テスト (2026-10-22 S8DBZW / C7CCW6 の再発防止)。
 * DB は偽物。本番には触れない。
 *   実行: npx tsx --tsconfig scripts/test-amount/tsconfig.json scripts/test-amount/run.ts
 */
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { DB, reset } from "./fakes/db"
import { getSupabase } from "./fakes/supabase"
import { amountForNewCount } from "@/lib/amount-recalc"
import { POST as correct } from "@/app/api/operator/shipment/[id]/correct/route"
import type { SupabaseClient } from "@supabase/supabase-js"

const sb = getSupabase() as unknown as SupabaseClient
const base = {
  id: "s1", booking_id: "BDX-TEST01", leg_index: 0, agency: "RN Group Japan合同会社", status: "issued",
  carrier: "sagawa", suitcase_count: 4, amount_yen: 19920, charged_at: null,
  shipment_date: "2099-12-01", expected_arrival: "2099-12-03", representative: "R", recipient: "R",
}
const req = (body: unknown) =>
  new NextRequest("https://bondex.express/api/operator/shipment/s1/correct", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  })
const ctx = { params: Promise.resolve({ id: "s1" }) }

const tests: Array<[string, () => Promise<void>]> = [
  ["確定済み・未課金: 新個数 × 既定単価 4,980", async () => {
    reset(base)
    assert.equal(await amountForNewCount(sb, base, 2), 9960)
  }],
  ["代理店別単価があればそれを使う", async () => {
    reset(base, 4500)
    assert.equal(await amountForNewCount(sb, base, 3), 13500)
  }],
  ["未確定 (amount_yen=0) は据え置き", async () => {
    reset(base)
    assert.equal(await amountForNewCount(sb, { ...base, amount_yen: 0 }, 2), undefined)
  }],
  ["課金済みは据え置き", async () => {
    reset(base)
    assert.equal(await amountForNewCount(sb, { ...base, charged_at: "2026-10-01T00:00:00Z" }, 2), undefined)
  }],
  ["単価の取得に失敗したら例外 (既定単価で上書きしない)", async () => {
    reset(base, 4500); DB.agencyError = true
    await assert.rejects(() => amountForNewCount(sb, base, 2))
  }],

  ["予約訂正 4→2個: 金額も 19,920 → 9,960 に (S8DBZW の再現)", async () => {
    reset(base)
    const res = await correct(req({ suitcaseCount: 2 }), ctx)
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()))
    assert.equal(DB.shipment.suitcase_count, 2)
    assert.equal(DB.shipment.amount_yen, 9960)
    const a = DB.audits[0] as { fields: Record<string, unknown>; before: Record<string, unknown> }
    assert.equal(a.fields.amount_yen, 9960, "監査行に新金額")
    assert.equal(a.before.amount_yen, 19920, "監査行に旧金額")
  }],
  ["予約訂正 4→5個: 金額も 19,920 → 24,900 に (C7CCW6 の再現)", async () => {
    reset(base)
    await correct(req({ suitcaseCount: 5 }), ctx)
    assert.equal(DB.shipment.amount_yen, 24900)
  }],
  ["予約訂正で個数以外だけ変えたら金額は触らない", async () => {
    reset(base)
    await correct(req({ representative: "New Name" }), ctx)
    assert.equal(DB.shipment.amount_yen, 19920)
    assert.ok(DB.updates.every((u) => !("amount_yen" in u)))
  }],
  ["予約訂正: 依頼段階 (amount_yen=0) は 0 のまま", async () => {
    reset({ ...base, status: "requested", amount_yen: 0 })
    await correct(req({ suitcaseCount: 2 }), ctx)
    assert.equal(DB.shipment.suitcase_count, 2)
    assert.equal(DB.shipment.amount_yen, 0)
  }],
  ["予約訂正: 単価取得に失敗したら個数も変えずにエラー", async () => {
    reset(base); DB.agencyError = true
    const res = await correct(req({ suitcaseCount: 2 }), ctx)
    assert.equal(res.status, 500)
    assert.equal(DB.updates.length, 0)
    assert.equal(DB.shipment.suitcase_count, 4)
  }],
]

;(async () => {
  let failed = 0
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok   ${name}`) }
    catch (e) { failed++; console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : e}`) }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`)
  process.exit(failed ? 1 : 0)
})()
