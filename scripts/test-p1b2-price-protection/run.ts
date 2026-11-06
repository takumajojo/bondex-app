/**
 * P1-B2 v3.2 Track C｜代理店への予期しない増額防止・料金保護 A/B/C のシミュレーション (2026-11-06)。
 *   実行: npx tsx --tsconfig scripts/test-p1b2-price-protection/tsconfig.json scripts/test-p1b2-price-protection/run.ts
 *
 * これは **シミュレーション専用** であり、本番の料金ロジック (lib/pricing.ts など) には一切手を入れない。
 * 純関数の単価・割引定数のみを read-only で参照し、7 ケース × 2 レジーム (割引 OFF/ON) で
 * 3 方式 (A: 実個数再計算・増額時のみ代理店承認 / B: 予約時提示額を上限 / C: 予約時の割引率のみ保護) を比較する。
 * 本番環境変数 (GROUP_DISCOUNT_ENABLED 等) は変更しない。割引 ON は本スクリプト内の純計算で模す。
 *
 * ねらい: 料金保護ルールの「正式採用」は経営判断に委ね、ここでは各方式の金額影響を数値で可視化する。
 */
import assert from "node:assert/strict"
import { GROUP_DISCOUNT, resolveUnitPriceYen } from "@/lib/pricing"
import { grossOf } from "@/lib/tax"

const UNIT = resolveUnitPriceYen(null) // 契約単価なし = 既定 4,980 (税抜/個)
const DISC = GROUP_DISCOUNT.percent // 8
const MIN = GROUP_DISCOUNT.minPieces // 25

/** 税抜小計。discountOn かつ pieces>=25 のとき 8% 引き (lib/pricing.ts と同じ切り捨て)。 */
function net(pieces: number, discountOn: boolean): number {
  const base = pieces * UNIT
  return discountOn && pieces >= MIN ? Math.floor((base * (100 - DISC)) / 100) : base
}

interface Row {
  booked: number
  actual: number
  note: string
}
const CASES: Row[] = [
  { booked: 26, actual: 24, note: "割引消失による増額" },
  { booked: 24, actual: 26, note: "割引適用による金額変動" },
  { booked: 50, actual: 45, note: "個数減少による減額" },
  { booked: 50, actual: 55, note: "個数増加による増額" },
  { booked: 25, actual: 25, note: "金額一致" },
  { booked: 19, actual: 20, note: "大口保留対象への変更" },
  { booked: 20, actual: 19, note: "大口保留対象からの変更" },
]

interface Outcome {
  quote: number // 予約時提示 (税抜)
  recalc: number // 実個数で再計算 (税抜)
  a: number
  aApproval: boolean
  b: number
  c: number
}

function evaluate(r: Row, discountOn: boolean): Outcome {
  const bookedDiscounted = discountOn && r.booked >= MIN
  const quote = net(r.booked, discountOn)
  const recalc = net(r.actual, discountOn)
  // A: 実個数の再計算額。増額 (recalc>quote) のときだけ代理店承認が必須。
  const a = recalc
  const aApproval = recalc > quote
  // B: 予約時提示額を上限 (超える場合は提示額に抑える。減額はそのまま通す)。
  const b = Math.min(recalc, quote)
  // C: 予約時に適用された割引率のみ保護し、実個数で再計算 (予約時非割引なら割引なしのまま)。
  const cRate = bookedDiscounted ? DISC : 0
  const c = Math.floor((r.actual * UNIT * (100 - cRate)) / 100)
  return { quote, recalc, a, aApproval, b, c }
}

let pass = 0
let fail = 0
function chk(name: string, cond: boolean) {
  if (cond) {
    pass++
    console.log(`  PASS: ${name}`)
  } else {
    fail++
    console.log(`  FAIL: ${name}`)
  }
}

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`

for (const discountOn of [false, true]) {
  console.log(`\n=== レジーム: 団体割引 ${discountOn ? "ON (≥25個 -8%)" : "OFF (現行既定)"} ===`)
  console.log(
    `  予約→実  | 提示(税抜) | 再計算(税抜) | A=再計算(税込) 承認 | B=上限(税込) | C=割引率保護(税込) | 備考`,
  )
  for (const r of CASES) {
    const o = evaluate(r, discountOn)
    console.log(
      `  ${String(r.booked).padStart(2)}→${String(r.actual).padStart(2)}  | ` +
        `${yen(o.quote).padStart(9)} | ${yen(o.recalc).padStart(10)} | ` +
        `${yen(grossOf(o.a)).padStart(11)} ${o.aApproval ? "要承認" : "  —  "} | ` +
        `${yen(grossOf(o.b)).padStart(10)} | ${yen(grossOf(o.c)).padStart(12)} | ${r.note}`,
    )
    // 不変条件の検証 (シミュレーションの健全性)。
    chk(`B は予約時提示額を超えない (${r.booked}→${r.actual}/${discountOn ? "ON" : "OFF"})`, o.b <= o.quote)
    chk(`C は実個数に比例 (${r.booked}→${r.actual}/${discountOn ? "ON" : "OFF"})`, o.c <= r.actual * UNIT)
  }
}

// ── 代表ケースの意味づけ (経営判断の材料) ──
console.log("\n=== 代表ケースの含意 ===")
{
  // 割引 ON・26→24: 個数は減ったのに割引消失で A は増額 (代理店が驚く典型)。
  const o = evaluate({ booked: 26, actual: 24, note: "" }, true)
  chk("ON 26→24: A は増額 (割引消失) で要承認", o.aApproval && o.a > o.quote)
  chk("ON 26→24: B は提示額に抑える (代理店保護)", o.b === o.quote && o.b < o.a)
  chk("ON 26→24: C は割引率維持で最も安い", o.c < o.b)
  console.log(
    `  ON 26→24: 提示 ${yen(grossOf(o.quote))} / A ${yen(grossOf(o.a))}(要承認) / B ${yen(grossOf(o.b))} / C ${yen(grossOf(o.c))}`,
  )
}
{
  // 割引 ON・24→26: 予約時は非割引、実個数で割引対象に。C は「非割引率」を維持し最も高い。
  const o = evaluate({ booked: 24, actual: 26, note: "" }, true)
  chk("ON 24→26: A/B は割引適用で提示額以下", o.a <= o.quote && o.b <= o.quote)
  chk("ON 24→26: C は予約時非割引を維持し最も高い", o.c > o.a)
  console.log(
    `  ON 24→26: 提示 ${yen(grossOf(o.quote))} / A ${yen(grossOf(o.a))} / B ${yen(grossOf(o.b))} / C ${yen(grossOf(o.c))}`,
  )
}
{
  // 50→45 減額はどの方式でも提示額未満。
  const o = evaluate({ booked: 50, actual: 45, note: "" }, false)
  chk("OFF 50→45: 全方式が減額 (提示額未満)", o.a < o.quote && o.b < o.quote && o.c < o.quote)
}
{
  // 25→25 一致はどの方式でも提示額と同じ。
  const o = evaluate({ booked: 25, actual: 25, note: "" }, false)
  chk("OFF 25→25: 全方式が提示額と一致", o.a === o.quote && o.b === o.quote && o.c === o.quote)
}

// ── 定性比較 (経営判断用サマリ) ──
console.log("\n=== A/B/C 定性比較 (◎>○>△>×) ===")
const COMPARE = [
  ["観点", "A: 実個数再計算", "B: 提示額を上限", "C: 割引率のみ保護"],
  ["代理店の納得感", "△ 増額に驚く余地", "◎ 上限が明確で安心", "○ 割引は守られる"],
  ["BondExの粗利", "◎ 実コストを反映", "△ 上限で取り逃し", "○ ほぼ実額"],
  ["過少申告リスク", "◎ 実個数で是正", "× 多め予約→減額のみ得", "○ 実個数ベース"],
  ["運用負荷", "△ 増額ごとに承認", "◎ 承認不要が多い", "△ 割引条件の追跡要"],
  ["既存契約との整合", "◎ 実個数課金の原則通り", "△ 上限の契約明記要", "○ 割引条項と整合"],
  ["実装の複雑さ", "◎ v3.1 の延長で容易", "○ 上限比較のみ", "△ 予約時割引率の保存要"],
]
for (const row of COMPARE) {
  console.log("  " + row.map((c, i) => (i === 0 ? c.padEnd(16) : c.padEnd(20))).join("| "))
}
console.log(
  "\n  ※ 正式採用は経営判断。推奨の初期線 = 『A を基本とし、増額時は代理店承認を必須(v3.2 の承認フロー)』。\n" +
    "    B/C は契約面の明記・割引率保存が前提のため、採用する場合は料金ルール確定時に併せて実装する。",
)

console.log(`\n============================================================`)
console.log(`  Track C 料金保護シミュレーション: PASS=${pass}  FAIL=${fail}`)
console.log(`============================================================`)
assert.equal(fail, 0, "料金保護シミュレーションの不変条件に違反")
