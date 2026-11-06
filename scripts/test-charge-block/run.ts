/**
 * 手動回収中の区間 (CHARGE_BLOCKED_SHIPMENT_IDS) が自動課金されないことの回帰テスト (2026-11-06 BDX-9K4NGJ-L1)。
 * Stripe・DB・通知はすべて偽物。本番には触れない。
 *   実行: npx tsx --tsconfig scripts/test-charge-block/tsconfig.json scripts/test-charge-block/run.ts
 *
 * A. 判定関数 isChargeBlocked
 * B. 課金関数 chargeShipmentIfDue を最後 (Stripe の PaymentIntent 作成) まで通す
 * C. 課金経路の棚卸し: Stripe の課金呼び出しが lib/charge.ts の1か所だけで、そこへ入る経路がすべて
 *    chargeShipmentIfDue を通ること。未知の経路が増えたら失敗する (見直すまで CI を通さない)
 * D. 経路の実行: 再試行 API (POST /api/operator/charge-retry) を実際に呼んでも止まること
 *    + デプロイ後の確認用 API (GET /api/operator/charge-block-status) が課金せずに状態だけ返すこと
 */
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { NextRequest } from "next/server"
import { calls, db, reset } from "./fakes/state"
import { chargeShipmentIfDue, isChargeBlocked } from "@/lib/charge"
import { POST as chargeRetry } from "@/app/api/operator/charge-retry/route"
import { GET as blockStatus } from "@/app/api/operator/charge-block-status/route"

const ODADUU = "e4c98c9a-0801-4375-90f9-7a64eff906f7" // 本番 shipments.id (BDX-9K4NGJ, leg_index 0 = L1) と照合済み
const OTHER = "11111111-2222-3333-4444-555555555555"
const NEAR = "e4c98c9a-0801-4375-90f9-7a64eff906f8" // 末尾1文字だけ違う

const ROOT = join(__dirname, "..", "..")

function seed(ids: string[]): void {
  reset()
  process.env.STRIPE_CHARGE_LIVE = "true"
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy_not_used"
  for (const id of ids) {
    db.shipments[id] = {
      id, booking_id: "BDX-TEST", leg_index: 0, agency: "Test Agency", amount_yen: 35820,
      suitcase_count: 9, charged_at: null, is_addition: false,
    }
  }
  db.agency = {
    id: "ag", name: "Test Agency", contact_email: null, payment_method: "card", card_on_file: true,
    stripe_customer_id: "cus_test", billing_exempt: false, locale: "en", is_domestic: false,
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

/** `export async function name(` から、行頭の `}` までを関数本体として返す。 */
function functionBody(src: string, name: string): string | null {
  const start = src.indexOf(`export async function ${name}(`)
  if (start < 0) return null
  const end = src.indexOf("\n}\n", start)
  return src.slice(start, end < 0 ? undefined : end + 2)
}

const STRIPE_CHARGE = /\.paymentIntents\.(create|confirm|capture)\s*\(|\.charges\.create\s*\(|\.invoices\.pay\s*\(/
// chargeShipmentIfDue を呼んでよい場所 (= 課金経路)。ここに無い呼び出しが現れたらテストを失敗させる。
const KNOWN_CALLERS: Record<string, string> = {
  "app/api/cron/sync-tracking/route.ts": "経路1 追跡同期 cron (区間ごと)",
  "lib/tracking/reconcile.ts": "経路2 追跡リコンサイル",
  "app/api/shipments/route.ts": "経路3 運営の手動ステータス変更",
  "app/api/operator/charge-retry/route.ts": "経路4 再試行ボタン / 手動課金",
  "lib/charge.ts": "経路5・6 課金漏れ sweep (PR #96。sync-tracking の2か所から呼ばれる)",
}
const REQUIRED_ON_MAIN = [
  "app/api/cron/sync-tracking/route.ts",
  "lib/tracking/reconcile.ts",
  "app/api/shipments/route.ts",
  "app/api/operator/charge-retry/route.ts",
]

const tests: Array<[string, () => Promise<void>]> = [
  // ── A. 判定関数 ──
  ["A1 未設定・空文字なら誰も止めない", async () => {
    assert.equal(isChargeBlocked(ODADUU, undefined), false)
    assert.equal(isChargeBlocked(ODADUU, ""), false)
    assert.equal(isChargeBlocked(ODADUU, " , ,"), false)
  }],
  ["A2 完全一致だけ止める (前後空白・改行・大文字小文字は無視、1文字違い・前方一致は止めない)", async () => {
    const raw = ` ${ODADUU.toUpperCase()}\n , ${OTHER.slice(0, 8)}`
    assert.equal(isChargeBlocked(ODADUU, raw), true)
    assert.equal(isChargeBlocked(NEAR, raw), false)
    assert.equal(isChargeBlocked(OTHER, raw), false)
    assert.equal(isChargeBlocked(ODADUU.slice(0, 8), ODADUU), false)
  }],
  ["A3 空の ID は止めない", async () => {
    assert.equal(isChargeBlocked("", ",,"), false)
    assert.equal(isChargeBlocked("  ", ODADUU), false)
  }],

  // ── B. 課金関数を最後まで通す ──
  ["B1 環境変数が未設定なら、従来どおり Stripe で課金して記録する (既存の課金に影響なし)", async () => {
    seed([ODADUU, OTHER])
    delete process.env.CHARGE_BLOCKED_SHIPMENT_IDS
    const a = await chargeShipmentIfDue(ODADUU)
    const b = await chargeShipmentIfDue(OTHER)
    assert.equal(a.charged, true)
    assert.equal(b.charged, true)
    assert.equal(a.amountYen, 39402) // 35,820 + 消費税 3,582
    assert.equal(calls.piCreate, 2)
    assert.equal(calls.recordCharge, 2)
  }],
  ["B2 対象の区間は、本番フラグ ON でも Stripe・DB に一切触れずにスキップ", async () => {
    seed([ODADUU])
    process.env.CHARGE_BLOCKED_SHIPMENT_IDS = ODADUU
    const r = await chargeShipmentIfDue(ODADUU)
    assert.deepEqual(r, { charged: false, skipped: true, reason: "blocked_manual_recovery" })
    assert.deepEqual(
      [calls.getShipment, calls.customerRetrieve, calls.piCreate, calls.recordCharge, calls.recordError, calls.opsAlert, calls.mail],
      [0, 0, 0, 0, 0, 0, 0],
    )
  }],
  ["B3 対象以外の区間 (1文字違いを含む) は、設定中でも従来どおり課金される", async () => {
    seed([OTHER, NEAR])
    process.env.CHARGE_BLOCKED_SHIPMENT_IDS = ODADUU
    assert.equal((await chargeShipmentIfDue(OTHER)).charged, true)
    assert.equal((await chargeShipmentIfDue(NEAR)).charged, true)
    assert.equal(calls.piCreate, 2)
  }],
  ["B4 カードを差し替えても対象の区間は止まったまま", async () => {
    seed([ODADUU])
    process.env.CHARGE_BLOCKED_SHIPMENT_IDS = ODADUU
    db.defaultPm = "pm_card_b_after_change"
    const r = await chargeShipmentIfDue(ODADUU)
    assert.equal(r.reason, "blocked_manual_recovery")
    assert.equal(calls.piCreate, 0)
  }],
  ["B5 本番フラグ OFF でも止める理由は blocked が優先 (解除漏れの判別用)", async () => {
    seed([ODADUU])
    process.env.CHARGE_BLOCKED_SHIPMENT_IDS = ODADUU
    process.env.STRIPE_CHARGE_LIVE = "false"
    assert.equal((await chargeShipmentIfDue(ODADUU)).reason, "blocked_manual_recovery")
  }],
  ["B6 環境変数を消せば、対象だった区間も従来の処理に戻る (解除)", async () => {
    seed([ODADUU])
    delete process.env.CHARGE_BLOCKED_SHIPMENT_IDS
    assert.equal((await chargeShipmentIfDue(ODADUU)).charged, true)
    assert.equal(calls.piCreate, 1)
  }],

  // ── C. 課金経路の棚卸し ──
  ["C1 Stripe の課金呼び出しは BtoB では lib/charge.ts の chargeShipmentIfDue の中だけ", async () => {
    const hits: string[] = []
    for (const f of [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))]) {
      const rel = relative(ROOT, f)
      if (rel.startsWith("lib/b2c/")) continue // BtoC は別台帳 (integ のみ)。BtoB の区間 ID を受け取らない
      if (STRIPE_CHARGE.test(readFileSync(f, "utf8"))) hits.push(rel)
    }
    assert.deepEqual(hits, ["lib/charge.ts"])
    const src = readFileSync(join(ROOT, "lib/charge.ts"), "utf8")
    const body = functionBody(src, "chargeShipmentIfDue")
    assert.ok(body, "chargeShipmentIfDue が見つからない")
    assert.ok(STRIPE_CHARGE.test(body), "Stripe 呼び出しが chargeShipmentIfDue の外にある")
    assert.equal(src.split(STRIPE_CHARGE).length - 1, body.split(STRIPE_CHARGE).length - 1, "関数の外にも Stripe 呼び出しがある")
  }],
  ["C2 停止判定は chargeShipmentIfDue の最初の処理 (どの await よりも前)", async () => {
    const body = functionBody(readFileSync(join(ROOT, "lib/charge.ts"), "utf8"), "chargeShipmentIfDue")!
    const block = body.indexOf("isChargeBlocked(shipmentId)")
    assert.ok(block > 0, "停止判定が無い")
    assert.ok(block < body.indexOf("await "), "停止判定より前に await がある")
    assert.ok(block < body.indexOf("STRIPE_CHARGE_LIVE"), "停止判定が安全ゲートより後ろ")
  }],
  ["C3 課金経路はすべて chargeShipmentIfDue を通り、未知の経路は無い", async () => {
    const found = new Map<string, number>()
    for (const f of [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))]) {
      const rel = relative(ROOT, f)
      const n = readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => /\bchargeShipmentIfDue\s*\(/.test(l) && !/function chargeShipmentIfDue/.test(l) && !/^\s*(\/\/|\*)/.test(l))
        .length
      if (n > 0) found.set(rel, n)
    }
    for (const rel of found.keys()) assert.ok(rel in KNOWN_CALLERS, `未知の課金経路: ${rel} (停止判定を通るか確認してから KNOWN_CALLERS に追加)`)
    for (const rel of REQUIRED_ON_MAIN) assert.ok(found.has(rel), `既知の経路が見つからない: ${rel}`)
    // sweep (#96) があるなら、chargeShipmentIfDue を通っていること
    const src = readFileSync(join(ROOT, "lib/charge.ts"), "utf8")
    const sweep = functionBody(src, "sweepUnchargedCardShipments")
    if (sweep) assert.ok(/chargeShipmentIfDue\(/.test(sweep), "sweep が chargeShipmentIfDue を通らずに課金している")
    for (const [rel, n] of found) console.log(`     ${KNOWN_CALLERS[rel]}: ${rel} (${n}か所)`)
  }],

  // ── D. 経路の実行 ──
  ["D1 再試行 API を対象の区間で呼んでも、Stripe に届かず blocked を返す", async () => {
    seed([ODADUU])
    process.env.CHARGE_BLOCKED_SHIPMENT_IDS = ODADUU
    const req = new NextRequest("http://localhost/api/operator/charge-retry", {
      method: "POST",
      body: JSON.stringify({ id: ` ${ODADUU} ` }),
      headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
    })
    const res = await chargeRetry(req)
    const json = (await res.json()) as { result: { reason?: string } }
    assert.equal(json.result.reason, "blocked_manual_recovery")
    assert.equal(calls.piCreate, 0)
  }],
  ["D2 確認用 API は課金せず、対象だけ blocked:true を返す (設定値は返さない)", async () => {
    seed([ODADUU, OTHER])
    process.env.CHARGE_BLOCKED_SHIPMENT_IDS = `${ODADUU},${NEAR}`
    const ask = async (id: string) =>
      (await (await blockStatus(new NextRequest(`http://localhost/api/operator/charge-block-status?id=${id}`))).json()) as Record<string, unknown>
    assert.deepEqual(await ask(ODADUU), { id: ODADUU, blocked: true })
    assert.deepEqual(await ask(OTHER), { id: OTHER, blocked: false })
    delete process.env.CHARGE_BLOCKED_SHIPMENT_IDS
    assert.deepEqual(await ask(ODADUU), { id: ODADUU, blocked: false })
    assert.equal(calls.getShipment + calls.piCreate + calls.customerRetrieve, 0)
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
