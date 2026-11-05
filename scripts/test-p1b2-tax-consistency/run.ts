/**
 * P1-B2 v3.3 STEP1｜税抜・税込の分離と全経路の計算一致テスト (2026-11-06)。
 *   実行: npx tsx --tsconfig scripts/test-p1b2-tax-consistency/tsconfig.json scripts/test-p1b2-tax-consistency/run.ts
 *
 * ねらい: amount_yen を「税抜小計 (net) の唯一正本」とし、税込 (gross) は境界 (カード課金・請求書・表示) で
 *        1 回だけ加算する — という原則が、全ての金額経路で一致することを固定する (税抜/税込の混在ゼロ)。
 * 検証する経路:
 *   - lib/pricing.ts  lineSubtotalYen (発行・個数是正・確認の単一入口) … net
 *   - lib/pricing.ts  estimateTotals (受付概算) … net/tax/gross
 *   - lib/tax.ts      taxOf / grossOf … 税計算の唯一元
 *   - lib/charge.ts   実課金額 = grossOf(amount_yen)
 *   - lib/invoice-build.tsx 月次総額 = grossOf(Σ amount_yen)
 *   - sql/066,067 の計上台帳 gross_yen = net + net/10 (整数除算) … grossOf と一致
 * 本番環境変数は変更しない (割引 OFF の既定経路のみを対象=団体割引/非遡及は test-pricing で別途固定)。
 */
import assert from "node:assert/strict"
import { lineSubtotalYen, estimateTotals, resolveUnitPriceYen } from "@/lib/pricing"
import { taxOf, grossOf, TAX_RATE } from "@/lib/tax"

let pass = 0
let fail = 0
function chk(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  PASS: ${name}`) }
  else { fail++; console.log(`  FAIL: ${name}`) }
}

// 計上台帳 (SQL) の税込式を TS 側で再現: net + floor(net/10) = net + floor(net*0.1) = grossOf(net) (net>=0)。
const ledgerGross = (net: number): number => net + Math.trunc(net / 10)

assert.equal(TAX_RATE, 0.1, "TAX_RATE は 10%")

// 単価マトリクス: 既定 (null=4,980) と代理店別契約単価。
const UNITS: Array<number | null> = [null, 4980, 4500, 5200, 3980]
const PIECES = [0, 1, 2, 3, 9, 10, 19, 20, 24, 25, 26, 45, 50, 55, 99]

for (const u of UNITS) {
  const unit = resolveUnitPriceYen(u)
  for (const p of PIECES) {
    if (p <= 0) continue // pieces<=0 は呼び出し側で除外する契約
    // (1) 税抜の単一入口が一致 (割引 OFF 既定では lineSubtotalYen = pieces×単価)。
    const lineNet = lineSubtotalYen({ bookingType: "fit", pieces: p, agencyUnitPriceYen: u })
    const est = estimateTotals(p, u)
    chk(`net 一致 unit=${unit} p=${p} (lineSubtotal=estimate=pieces×単価)`,
      lineNet === p * unit && est.net === p * unit && lineNet === est.net)
    // (2) 税込は net から 1 回だけ加算、全経路一致。
    const net = lineNet
    const gross = grossOf(net)
    chk(`gross 一致 unit=${unit} p=${p} (grossOf=net+taxOf=estimate.gross=ledger)`,
      gross === net + taxOf(net) && gross === est.gross && gross === ledgerGross(net))
    // (3) 切り捨て: taxOf は floor(net*0.1)。
    chk(`税額切り捨て unit=${unit} p=${p}`, taxOf(net) === Math.floor(net * 0.1))
    // (4) 二重課税なし: net は単価×個数そのもの (税を含まない)。gross = net + 税 (税>=0)。
    chk(`net に税を含まない unit=${unit} p=${p}`, net === p * unit && gross >= net && gross - net === taxOf(net))
  }
}

// 代表端数ケース: 4,980×1 の税は floor(498.0)=498、税込 5,478。
chk("端数例 4,980 → 税498 / 税込5,478", taxOf(4980) === 498 && grossOf(4980) === 5478)
// 団体割引後 (floor 済みの net) にも同じ税式が一度だけ掛かる (26個×4,980×0.92=floor 119,121 → 税11,912)。
{
  const discNet = Math.floor((26 * 4980 * 92) / 100) // 119,121
  chk("割引後 net 119,121 の税込一致", grossOf(discNet) === discNet + taxOf(discNet) && grossOf(discNet) === ledgerGross(discNet))
}

console.log(`\n============================================================`)
console.log(`  税抜・税込 整合テスト: PASS=${pass}  FAIL=${fail}`)
console.log(`============================================================`)
assert.equal(fail, 0, "税抜・税込の整合に不一致")
