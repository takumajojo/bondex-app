/**
 * 料金計算の回帰テスト (P1-A 団体25個以上8%割引・2026-11-04)。DB は偽物。本番には触れない。
 *   実行: npx tsx --tsconfig scripts/test-pricing/tsconfig.json scripts/test-pricing/run.ts
 *
 * ねらい:
 *  - 単価は resolveUnitPriceYen に一本化 (発行・受付概算・個数是正で同じ値)。
 *  - 税は tax.ts (税抜小計→+10% 切り捨て) を唯一の計算元にする。
 *  - 団体25個以上8%割引 (lineSubtotalYen) を単一入口にし、FIT・契約単価・往復非合算・チャーター除外を固定。
 *  - **既定 OFF (env 未設定) では現行料金と1円も変わらない**ことを固定。
 *  - **既存予約への遡及適用なし**: 割引レジームの境界 (GROUP_DISCOUNT_ENABLED_AT) より前に作成された予約は、
 *    有効化後に個数を変えても割引が付かないことを固定。
 *  - 個数是正 (adjust-count) が代理店別単価・団体割引・遡及防止を正しく通すことを再発防止。
 * 併せて scripts/test-amount (予約訂正→再計算) も CI で実行する。
 */
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { DB, reset } from "../test-amount/fakes/db"
import { getSupabase } from "../test-amount/fakes/supabase"
import {
  resolveUnitPriceYen,
  estimateTotals,
  estimateBookingTotals,
  lineSubtotalYen,
  isGroupVolumeDiscountApplicable,
  groupDiscountEnabled,
  groupDiscountRegimeActive,
  GROUP_DISCOUNT,
  PRICING,
} from "@/lib/pricing"
import { taxOf, grossOf } from "@/lib/tax"
import { resolveLegDiscountBasis } from "@/lib/discount-basis"
import type { SupabaseClient } from "@supabase/supabase-js"
import { POST as adjustCount } from "@/app/api/operator/adjust-count/route"

// 発行時の割引判定材料クエリを模す最小 fake。from→select→eq→eq→maybeSingle の鎖だけ満たす。
const fakeSb = (result: { data: unknown; error: unknown }) =>
  ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
    }),
  }) as unknown as SupabaseClient

void getSupabase // 偽 supabase を経路に注入するための副作用 import (tsconfig paths 経由)

// 割引レジームを一時的に有効化して fn を実行し、必ず元の env に戻す (async 対応)。
const AT = "2026-01-01T00:00:00Z" // 境界時刻 (この時刻以降に作成された予約だけ割引対象)
const AFTER = "2026-06-01T00:00:00Z" // 境界より後に作成 (割引対象)
const BEFORE = "2025-06-01T00:00:00Z" // 境界より前に作成 (遡及防止 = 対象外)
async function withRegime(enabledAt: string, fn: () => void | Promise<void>): Promise<void> {
  const pe = process.env.GROUP_DISCOUNT_ENABLED
  const pa = process.env.GROUP_DISCOUNT_ENABLED_AT
  process.env.GROUP_DISCOUNT_ENABLED = "true"
  process.env.GROUP_DISCOUNT_ENABLED_AT = enabledAt
  try {
    await fn()
  } finally {
    if (pe === undefined) delete process.env.GROUP_DISCOUNT_ENABLED
    else process.env.GROUP_DISCOUNT_ENABLED = pe
    if (pa === undefined) delete process.env.GROUP_DISCOUNT_ENABLED_AT
    else process.env.GROUP_DISCOUNT_ENABLED_AT = pa
  }
}

const base = {
  id: "s1", booking_id: "BDX-TEST01", leg_index: 0, agency: "RN Group Japan合同会社", status: "issued",
  carrier: "sagawa", suitcase_count: 4, amount_yen: 19920, charged_at: null as string | null,
  from_hotel: "A", to_hotel: "B", booking_type: "fit", created_at: AFTER,
  shipment_date: "2099-12-01", expected_arrival: "2099-12-03", representative: "R", recipient: "R",
}
const adjReq = (body: unknown) =>
  new NextRequest("https://bondex.express/api/operator/adjust-count", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  })

const tests: Array<[string, () => Promise<void> | void]> = [
  // ── 1. 単価解決の単一ソース (FIT・通常料金 / 個別価格設定) ──
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

  // ── 税抜・税込 / 集荷後の課金金額 (= grossOf(amount_yen)) ──
  ["tax: taxOf=floor(net×10%), grossOf=net+tax", () => {
    assert.equal(taxOf(19920), 1992)
    assert.equal(grossOf(19920), 21912)
    assert.equal(taxOf(9961), 996) // 端数は切り捨て (996.1→996)
  }],

  // ── 受付概算が実課金と同じ単価になる (estimateTotals は FIT/単純用) ──
  ["estimateTotals: 既定単価 (null) 3個 = 14,940 税抜 / 税込 16,434", () => {
    assert.deepEqual(estimateTotals(3, null), { pieces: 3, unit: 4980, net: 14940, tax: 1494, gross: 16434 })
  }],
  ["estimateTotals: 契約単価 4,500 4個 = 18,000 税抜 / 税込 19,800", () => {
    assert.deepEqual(estimateTotals(4, 4500), { pieces: 4, unit: 4500, net: 18000, tax: 1800, gross: 19800 })
  }],

  // ── feature flag / レジーム: 既定 OFF ──
  ["groupDiscountEnabled: env 未設定なら false (既定 OFF)", () => {
    assert.equal(groupDiscountEnabled(), false)
  }],
  ["GROUP_DISCOUNT の定数 (25個・8%)", () => {
    assert.equal(GROUP_DISCOUNT.minPieces, 25)
    assert.equal(GROUP_DISCOUNT.percent, 8)
  }],
  ["groupDiscountRegimeActive: OFF/境界未設定/予約時刻不明はすべて false", () => {
    assert.equal(groupDiscountRegimeActive(AFTER), false) // env OFF
  }],
  ["groupDiscountRegimeActive: 有効化しても境界以前の作成は false / 以降は true / 不明は false", async () => {
    await withRegime(AT, () => {
      assert.equal(groupDiscountRegimeActive(AFTER), true)
      assert.equal(groupDiscountRegimeActive(BEFORE), false)
      assert.equal(groupDiscountRegimeActive(null), false)
      assert.equal(groupDiscountRegimeActive(undefined), false)
    })
    await withRegime("", () => {
      // 境界 (GROUP_DISCOUNT_ENABLED_AT) 未設定なら enabled でも常に false (安全側)
      process.env.GROUP_DISCOUNT_ENABLED_AT = ""
      assert.equal(groupDiscountRegimeActive(AFTER), false)
    })
  }],

  // ── OFF 時 (既定): lineSubtotalYen は pieces × 単価 のまま = 現行と1円も変わらない ──
  ["lineSubtotalYen OFF: 団体30個=30×4,980 (割引なし)・FIT・契約単価とも現行どおり", () => {
    assert.equal(lineSubtotalYen({ bookingType: "group", pieces: 30, agencyUnitPriceYen: null, bookingCreatedAt: AFTER }), 149400)
    assert.equal(lineSubtotalYen({ bookingType: "fit", pieces: 30, agencyUnitPriceYen: null, bookingCreatedAt: AFTER }), 149400)
    assert.equal(lineSubtotalYen({ bookingType: "group", pieces: 30, agencyUnitPriceYen: 4500, bookingCreatedAt: AFTER }), 135000)
  }],

  // ── 適用可否の純粋ルール (レジームとは独立) ──
  ["isGroupVolumeDiscountApplicable: 団体25個以上・契約単価なし・非チャーター", () => {
    const a = (o: Parameters<typeof isGroupVolumeDiscountApplicable>[0]) => isGroupVolumeDiscountApplicable(o)
    assert.equal(a({ bookingType: "group", pieces: 25, agencyUnitPriceYen: null }), true)
    assert.equal(a({ bookingType: "group", pieces: 24, agencyUnitPriceYen: null }), false)
    assert.equal(a({ bookingType: "group", pieces: 30, agencyUnitPriceYen: 4500 }), false) // 契約単価と併用しない
    assert.equal(a({ bookingType: "fit", pieces: 30, agencyUnitPriceYen: null }), false)
    assert.equal(a({ bookingType: "group", pieces: 30, agencyUnitPriceYen: null, discountable: false }), false) // チャーター
  }],

  // ── ON (レジーム有効・予約が境界以降): 団体25個以上8%割引 ──
  ["lineSubtotalYen ON: 団体24=割引なし / 25=割引 / 50=割引、FIT25=割引なし、契約単価団体25=割引なし", async () => {
    await withRegime(AT, () => {
      const g = (pieces: number, unit: number | null) =>
        lineSubtotalYen({ bookingType: "group", pieces, agencyUnitPriceYen: unit, bookingCreatedAt: AFTER })
      assert.equal(g(24, null), 24 * 4980)           // 119,520 (<25 で対象外)
      assert.equal(g(25, null), 114540)               // 25×4980=124,500 → ×0.92=114,540
      assert.equal(g(50, null), 229080)               // 50×4980=249,000 → ×0.92=229,080
      assert.equal(lineSubtotalYen({ bookingType: "fit", pieces: 25, agencyUnitPriceYen: null, bookingCreatedAt: AFTER }), 124500) // FIT は割引なし
      assert.equal(g(25, 4500), 112500)               // 契約単価優先=25×4,500 (割引なし)
    })
  }],
  ["lineSubtotalYen 端数: 団体26個 ON = floor(129,480×0.92)=119,121", async () => {
    await withRegime(AT, () => {
      assert.equal(lineSubtotalYen({ bookingType: "group", pieces: 26, agencyUnitPriceYen: null, bookingCreatedAt: AFTER }), 119121)
    })
  }],
  ["遡及防止: 境界より前に作成された団体25個は ON でも割引なし (124,500)", async () => {
    await withRegime(AT, () => {
      assert.equal(lineSubtotalYen({ bookingType: "group", pieces: 25, agencyUnitPriceYen: null, bookingCreatedAt: BEFORE }), 124500)
    })
  }],

  // ── 発行時の判定材料解決 (resolveLegDiscountBasis): DB取得エラーと不存在を区別・OFFは引かない ──
  ["resolveLegDiscountBasis OFF: DB を引かず {ok,fit,null} (エラーを返す fake でも呼ばれない=FIT不変)", async () => {
    const b = await resolveLegDiscountBasis(fakeSb({ data: null, error: { message: "should-not-be-called" } }), "BDX-X", 0)
    assert.deepEqual(b, { ok: true, bookingType: "fit", createdAt: null })
  }],
  ["resolveLegDiscountBasis ON + DB取得エラー → ok:false (呼び出し側は発行中止)", async () => {
    await withRegime(AT, async () => {
      const b = await resolveLegDiscountBasis(fakeSb({ data: null, error: { message: "boom" } }), "BDX-X", 0)
      assert.equal(b.ok, false)
    })
  }],
  ["resolveLegDiscountBasis ON + 既存予約あり(団体) → 保存済みを正本 (group / created_at)", async () => {
    await withRegime(AT, async () => {
      const b = await resolveLegDiscountBasis(fakeSb({ data: { booking_type: "group", created_at: AFTER }, error: null }), "BDX-X", 0)
      assert.deepEqual(b, { ok: true, bookingType: "group", createdAt: AFTER })
    })
  }],
  ["resolveLegDiscountBasis ON + 既存予約なし(直接発行) → {ok,fit,null} (現行FIT動作)", async () => {
    await withRegime(AT, async () => {
      const b = await resolveLegDiscountBasis(fakeSb({ data: null, error: null }), "BDX-X", 0)
      assert.deepEqual(b, { ok: true, bookingType: "fit", createdAt: null })
    })
  }],
  ["resolveLegDiscountBasis ON + sb=null → {ok,fit,null} (DBなしは直接発行扱い)", async () => {
    await withRegime(AT, async () => {
      const b = await resolveLegDiscountBasis(null, "BDX-X", 0)
      assert.deepEqual(b, { ok: true, bookingType: "fit", createdAt: null })
    })
  }],

  // ── 判定は配送区間(leg)ごと: 往復13個ずつは合算26個にしない (estimateBookingTotals) ──
  ["estimateBookingTotals: 往復13個ずつ(2 leg) は ON でも各13<25 で割引なし (net 129,480)", async () => {
    await withRegime(AT, () => {
      const r = estimateBookingTotals({
        legs: [{ pieces: 13 }, { pieces: 13 }], bookingType: "group", agencyUnitPriceYen: null, bookingCreatedAt: AFTER,
      })
      assert.equal(r?.net, 129480) // 13×4980×2
      assert.equal(r?.discountApplied, false)
    })
  }],
  ["estimateBookingTotals: 団体25個(1 leg) ON = net 114,540 / 税 11,454 / 税込 125,994・discountApplied", async () => {
    await withRegime(AT, () => {
      const r = estimateBookingTotals({ legs: [{ pieces: 25 }], bookingType: "group", agencyUnitPriceYen: null, bookingCreatedAt: AFTER })
      assert.deepEqual(r, { pieces: 25, unit: 4980, net: 114540, tax: 11454, gross: 125994, discountApplied: true })
    })
  }],
  ["estimateBookingTotals: 団体25個×2 leg は leg ごとに割引し合算 (net 229,080)", async () => {
    await withRegime(AT, () => {
      const r = estimateBookingTotals({ legs: [{ pieces: 25 }, { pieces: 25 }], bookingType: "group", agencyUnitPriceYen: null, bookingCreatedAt: AFTER })
      assert.equal(r?.net, 229080)
      assert.equal(r?.discountApplied, true)
    })
  }],
  ["estimateBookingTotals: OFF (既定) は割引なし・現行と一致 (団体25個=124,500)", () => {
    const r = estimateBookingTotals({ legs: [{ pieces: 25 }], bookingType: "group", agencyUnitPriceYen: null, bookingCreatedAt: AFTER })
    assert.deepEqual(r, { pieces: 25, unit: 4980, net: 124500, tax: 12450, gross: 136950, discountApplied: false })
  }],

  // ── 個数是正 (adjust-count が代理店別単価・団体割引・遡及防止を正しく通す) ──
  ["adjust-count OFF: 契約単価 4,500 で 4→3個 → 金額 13,500 (旧: 4,980固定=14,940 ではない)", async () => {
    reset(base, 4500)
    const res = await adjustCount(adjReq({ id: "s1", newCount: 3, reasonCode: "mismatch" }))
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()))
    assert.equal(DB.shipment.suitcase_count, 3)
    assert.equal(DB.shipment.amount_yen, 13500)
  }],
  ["adjust-count OFF: 契約単価なし → 既定 4,980 で 4→3個 = 14,940", async () => {
    reset(base, null)
    await adjustCount(adjReq({ id: "s1", newCount: 3, reasonCode: "mismatch" }))
    assert.equal(DB.shipment.amount_yen, 14940)
  }],
  ["adjust-count OFF: 団体25個でも OFF なら割引なし = 124,500 (現行一致)", async () => {
    reset({ ...base, booking_type: "group", suitcase_count: 10, amount_yen: 49800 }, null)
    await adjustCount(adjReq({ id: "s1", newCount: 25, reasonCode: "mismatch" }))
    assert.equal(DB.shipment.amount_yen, 124500)
  }],
  ["adjust-count ON: 団体25個・予約が境界以降 → 8%割引後 114,540", async () => {
    await withRegime(AT, async () => {
      reset({ ...base, booking_type: "group", created_at: AFTER, suitcase_count: 10, amount_yen: 49800 }, null)
      await adjustCount(adjReq({ id: "s1", newCount: 25, reasonCode: "mismatch" }))
      assert.equal(DB.shipment.amount_yen, 114540)
    })
  }],
  ["adjust-count ON・遡及防止: 境界より前に作成された団体25個は割引なし = 124,500", async () => {
    await withRegime(AT, async () => {
      reset({ ...base, booking_type: "group", created_at: BEFORE, suitcase_count: 10, amount_yen: 49800 }, null)
      await adjustCount(adjReq({ id: "s1", newCount: 25, reasonCode: "mismatch" }))
      assert.equal(DB.shipment.amount_yen, 124500)
    })
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
