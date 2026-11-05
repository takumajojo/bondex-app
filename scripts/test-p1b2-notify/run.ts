/**
 * P1-B2 v3.5 Track C｜増額通知の本文生成テスト (ja/en・純関数)。本番メールは送らない。
 *   実行: npx tsx --tsconfig scripts/test-p1b2-notify/tsconfig.json scripts/test-p1b2-notify/run.ts
 */
import assert from "node:assert/strict"
import { buildPriceChangeMessage, type PriceChangeData } from "@/lib/price-notify"

let pass = 0
let fail = 0
function chk(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  PASS: ${name}`) }
  else { fail++; console.log(`  FAIL: ${name}`) }
}

const d: PriceChangeData = {
  bookingRef: "BDX-26-L1",
  fromHotel: "Palace Hotel Tokyo",
  toHotel: "Hotel Kyoto",
  shipmentDate: "2026-12-01",
  declaredCount: 26,
  actualCount: 24,
  quotedGrossYen: 131033,
  recalcGrossYen: 131472,
  increaseGrossYen: 439,
}

const ja = buildPriceChangeMessage(d, "ja")
const en = buildPriceChangeMessage(d, "en")

chk("ja 件名に予約番号", ja.subject.includes("BDX-26-L1"))
chk("ja 本文に増額(税込)を明示", ja.body.includes("131,472") && ja.body.includes("131,033"))
chk("ja 本文に『止まりません』(配送は止めない) を明記", ja.body.includes("止まりません"))
chk("ja 本文に承認導線と問い合わせ先", ja.body.includes("承認") && ja.body.includes("support@bondex.express"))
chk("en 件名は英語", en.subject.toLowerCase().includes("approval") && en.subject.includes("BDX-26-L1"))
chk("en 本文に金額と not held up", en.body.includes("131,472") && en.body.toLowerCase().includes("not held up"))
chk("ja と en は別本文", ja.body !== en.body && ja.subject !== en.subject)

// 期限ありは期限行が出る / なしは出ない
const withExp = buildPriceChangeMessage({ ...d, expiresAt: "2026-12-05" }, "ja")
chk("期限ありは期限行を含む", withExp.body.includes("2026-12-05"))
chk("期限なしは期限行を含まない", !ja.body.includes("ご承認期限"))

console.log(`\n============================================================`)
console.log(`  増額通知 本文生成テスト: PASS=${pass}  FAIL=${fail}`)
console.log(`============================================================`)
assert.equal(fail, 0, "通知本文生成に不一致")
