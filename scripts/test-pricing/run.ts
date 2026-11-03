/**
 * 料金計算の単一ソース化 (Phase 0・2026-11-04) の回帰テスト。DB は偽物。本番には触れない。
 *   実行: npx tsx --tsconfig scripts/test-pricing/tsconfig.json scripts/test-pricing/run.ts
 *
 * ねらい:
 *  - 単価は resolveUnitPriceYen に一本化 (発行・受付概算・個数是正で同じ値になる)。
 *  - 税は tax.ts (税抜小計→+10%) を唯一の計算元にする。
 *  - 個数是正 (adjust-count) が代理店別単価を使うこと (旧: 4,980 固定のズレ) を再発防止。
 *  - 団体割引 (GROUP_DISCOUNT) は Phase 0 では未適用 (dormant) であることを固定する。
 * 併せて scripts/test-amount (予約訂正→再計算) も CI で実行する。
 */
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { DB, reset } from "../test-amount/fakes/db"
import { getSupabase } from "../test-amount/fakes/supabase"
import {
  resolveUnitPriceYen,
  estimateTotals,
  lineSubtotalYen,
  isGroupVolumeDiscountApplicable,
  GROUP_DISCOUNT,
  PRICING,
} from "@/lib/pricing"
import { taxOf, grossOf } from "@/lib/tax"
import { POST as adjustCount } from "@/app/api/operator/adjust-count/route"

void getSupabase // 偽 supabase を経路に注入するための副作用 import (tsconfig paths 経由)

const base = {
  id: "s1", booking_id: "BDX-TEST01", leg_index: 0, agency: "RN Group Japan合同会社", status: "issued",
  carrier: "sagawa", suitcase_count: 4, amount_yen: 19920, charged_at: null as string | null,
  from_hotel: "A", to_hotel: "B",
  shipment_date: "2099-12-01", expected_arrival: "2099-12-03", representative: "R", recipient: "R",
}
const adjReq = (body: unknown) =>
  new NextRequest("https://bondex.express/api/operator/adjust-count", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  })

const tests: Array<[string, () => Promise<void> | void]> = [
  // ── 1. FIT・通常料金 / 9. 個別価格設定: 単価解決の単一ソース ──
  ["resolveUnitPriceYen: 未設定(null/undefined/0/負)は既定 4,980", () => {
    assert.equal(resolveUnitPriceYen(null), PRICING.regularPrice)
    assert.equal(resolveUnitPriceYen(undefined), 4980)
    assert.equal(resolveUnitPriceYen(0), 4980)
    assert.equal(resolveUnitPriceYen(-5), 4980)
  }],
  ["resolveUnitPriceYen: 代理店別契約単価があればそれを優先", () => {
    assert.equal(resolveUnitPriceYen(4500), 4500)
    assert.equal(resolveUnitPriceYen(6000), 6000)
  }],

  // ── 4. 税抜・税込 / 8. 集荷後の課金金額 (= grossOf(amount_yen)) ──
  ["tax: taxOf=floor(net×10%), grossOf=net+tax", () => {
    assert.equal(taxOf(19920), 1992)
    assert.equal(grossOf(19920), 21912)
    assert.equal(taxOf(9961), 996) // 端数は切り捨て (996.1→996)
  }],

  // ── 7 受付概算 / 2 代理店別単価: 受付概算が実課金と同じ単価になる ──
  ["estimateTotals: 既定単価 (null) 3個 = 14,940 税抜 / 税込 16,434", () => {
    assert.deepEqual(estimateTotals(3, null), { pieces: 3, unit: 4980, net: 14940, tax: 1494, gross: 16434 })
  }],
  ["estimateTotals: 契約単価 4,500 4個 = 18,000 税抜 / 税込 19,800", () => {
    assert.deepEqual(estimateTotals(4, 4500), { pieces: 4, unit: 4500, net: 18000, tax: 1800, gross: 19800 })
  }],

  // ── 団体割引: Phase 0 は dormant (現行料金を1円も変えない) ──
  ["GROUP_DISCOUNT.enabled は Phase 0 では false (未適用)", () => {
    assert.equal(GROUP_DISCOUNT.enabled, false)
    assert.equal(GROUP_DISCOUNT.minPieces, 25)
    assert.equal(GROUP_DISCOUNT.percent, 8)
  }],
  ["lineSubtotalYen: enabled=false のため割引はかからない (団体30個=30×4,980)", () => {
    assert.equal(lineSubtotalYen({ bookingType: "group", pieces: 30, agencyUnitPriceYen: null }), 149400)
    assert.equal(lineSubtotalYen({ bookingType: "fit", pieces: 30, agencyUnitPriceYen: null }), 149400)
    assert.equal(lineSubtotalYen({ bookingType: "group", pieces: 30, agencyUnitPriceYen: 4500 }), 135000)
  }],
  ["isGroupVolumeDiscountApplicable: 将来ルールの判定 (団体25個以上・契約単価なし・非チャーター)", () => {
    const a = (o: Parameters<typeof isGroupVolumeDiscountApplicable>[0]) => isGroupVolumeDiscountApplicable(o)
    assert.equal(a({ bookingType: "group", pieces: 25, agencyUnitPriceYen: null }), true)
    assert.equal(a({ bookingType: "group", pieces: 24, agencyUnitPriceYen: null }), false)
    assert.equal(a({ bookingType: "group", pieces: 30, agencyUnitPriceYen: 4500 }), false) // 契約単価と併用しない
    assert.equal(a({ bookingType: "fit", pieces: 30, agencyUnitPriceYen: null }), false)
    assert.equal(a({ bookingType: "group", pieces: 30, agencyUnitPriceYen: null, discountable: false }), false) // チャーター
  }],
  ["判定は配送区間(leg)ごと: 往復13個ずつ(各leg13個)は合算26個にせず、各区間が対象外", () => {
    // pieces は当該 leg の個数。往路13 / 復路13 の2区間は、それぞれ13個<25個で割引対象にならない
    // (予約合計26個として判定してはいけない・2026-11-04 決定)。
    assert.equal(isGroupVolumeDiscountApplicable({ bookingType: "group", pieces: 13, agencyUnitPriceYen: null }), false)
    // 1区間だけで25個以上なら、その区間は対象 (区間単位の判定)。
    assert.equal(isGroupVolumeDiscountApplicable({ bookingType: "group", pieces: 25, agencyUnitPriceYen: null }), true)
  }],
  ["将来の割引率/丸め規約を固定: 団体30個は 8%引・切り捨てで 137,448", () => {
    // enabled=true になった際 lineSubtotalYen が返すべき値 (Math.floor(149400×0.92))。
    assert.equal(Math.floor((30 * 4980 * (100 - GROUP_DISCOUNT.percent)) / 100), 137448)
  }],

  // ── 3. 個数変更後の再計算 (adjust-count が代理店別単価を使う) ──
  ["adjust-count: 契約単価 4,500 で 4→3個 → 金額 13,500 (旧: 4,980固定=14,940 ではない)", async () => {
    reset(base, 4500)
    const res = await adjustCount(adjReq({ id: "s1", newCount: 3, reasonCode: "mismatch" }))
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()))
    assert.equal(DB.shipment.suitcase_count, 3)
    assert.equal(DB.shipment.amount_yen, 13500)
  }],
  ["adjust-count: 契約単価なし → 既定 4,980 で 4→3個 = 14,940", async () => {
    reset(base, null)
    await adjustCount(adjReq({ id: "s1", newCount: 3, reasonCode: "mismatch" }))
    assert.equal(DB.shipment.amount_yen, 14940)
  }],
  ["adjust-count: 課金済みは金額据え置き (差額は運用で返金/追加請求)", async () => {
    reset({ ...base, charged_at: "2026-10-01T00:00:00Z" }, 4500)
    await adjustCount(adjReq({ id: "s1", newCount: 3, reasonCode: "mismatch" }))
    assert.equal(DB.shipment.suitcase_count, 3)
    assert.equal(DB.shipment.amount_yen, 19920) // 据え置き
  }],
  ["adjust-count: 単価取得に失敗したら 500・個数も金額も変えない", async () => {
    reset(base, 4500); DB.agencyError = true
    const res = await adjustCount(adjReq({ id: "s1", newCount: 3, reasonCode: "mismatch" }))
    assert.equal(res.status, 500)
    assert.equal(DB.updates.length, 0)
    assert.equal(DB.shipment.suitcase_count, 4)
    assert.equal(DB.shipment.amount_yen, 19920)
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
