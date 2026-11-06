/**
 * B2C の支払のページの画面の試験（Stage 5）。画面なしの Chrome で、本物の Stripe のカード入力欄と 3D セキュアの画面を操作する。
 * 集荷の後の請求が失敗した予約を作り（Stripe のテストモードのカード）、旅行者が支払のリンクで本人認証・別のカードで払う。
 * 接続先はローカルの開発サーバーとローカルの DB だけ。カード番号は Stripe が公開しているテスト用の番号だけ。
 *
 * 実行: set -a; . ./.env.local; set +a; BASE=http://localhost:3210 SHOTS=<保存先> node scripts/test-b2c/ui/pay_ui.mjs [シナリオ名...]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { launch } from "./cdp.mjs"
import { D } from "../dates/test-dates.mjs" // 試験の日付を実際の今日から見て有効な週へ（7日の倍数・時計はずらさない）

const BASE = process.env.BASE ?? "http://localhost:3210"
const SK = process.env.STRIPE_SECRET_KEY ?? ""
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(BASE)) throw new Error("refusing: local only")
if (!SK.startsWith("sk_test_")) throw new Error("refusing: sk_test_ only")
const SHOTS = process.env.SHOTS ?? "/tmp/b2c-pay-ui"
mkdirSync(SHOTS, { recursive: true })
const TOK = "dev-hnk-local-token-0001"
let passed = 0
let failed = 0
let ipN = Math.floor(Math.random() * 60000)
const only = process.argv.slice(2)
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail ?? "") }
}
const sql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-qtA", "-F", "|", "-c", q], { encoding: "utf8" }).trim()
async function post(path, body, headers = {}) {
  ipN++
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": `10.8.${ipN >> 8}.${(ipN % 250) + 1}`, ...headers }, body: JSON.stringify(body) })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
/** Stripe のテストモードの API（鍵はテストの鍵だけ。上で確かめた） */
async function stripeApi(path, form) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { method: form ? "POST" : "GET", headers: { Authorization: `Bearer ${SK}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form ? new URLSearchParams(form) : undefined })
  return r.json()
}
let TOKYO, KYOTO

/** 確定した予約 → カードを請求で失敗するカードに差し替え → 集荷の確認（31分前）→ 定期の処理で請求（失敗） */
async function failedCharge(lang, failPm) {
  const r = await post("/api/b2c/orders", {
    token: TOK, originPlaceId: TOKYO, destPlaceId: KYOTO, origin: { checkIn: D("2026-11-10"), checkOut: D("2026-11-12") }, dest: { checkIn: D("2026-11-12"), checkOut: D("2026-11-15") },
    pieces: 2, pickupDate: D("2026-11-10"), deliveryDate: D("2026-11-12"), name: lang === "ja" ? "支払 花子" : "Pay Smith", email: "pay-ui@example.invalid", whatsapp: "+81 90 0000 0000", language: lang, consent: true,
  })
  if (r.status !== 200) throw new Error(JSON.stringify(r.data))
  const n = r.data.orderNumber
  const s = await post("/api/b2c/card/start", { token: TOK, orderNumber: n, accessToken: r.data.accessToken, cardConsent: true })
  await stripeApi(`setup_intents/${s.data.clientSecret.split("_secret_")[0]}/confirm`, { payment_method: "pm_card_visa" })
  await post("/api/b2c/card/status", { token: TOK, orderNumber: n, accessToken: r.data.accessToken })
  const id = sql(`select id from b2c_orders where order_number=${n}`)
  const customer = sql(`select stripe_customer_id from b2c_orders where id='${id}'`)
  const pm = await stripeApi(`payment_methods/${failPm}/attach`, { customer })
  sql(`update b2c_orders set stripe_payment_method_id='${pm.id}' where id='${id}'`)
  sql(`select b2c_confirm_pickup('${id}', 'ops-ui@example.invalid', 'e2e-cred-ui', 'sagawa_tracking', 'ui-0001', 2, '画面の試験', now() - interval '31 minutes')`)
  const t = await post("/api/b2c/cron/tick", {}, { authorization: `Bearer ${process.env.CRON_SECRET}` })
  const st = sql(`select status from b2c_payments where order_id='${id}'`)
  if (!["failed", "requires_action"].includes(st)) throw new Error(`charge not failed: ${st} ${JSON.stringify(t.data?.charges)}`)
  return { n, id, token: r.data.accessToken, customer }
}
const payRow = (id) => sql(`select status || '|' || coalesce(stripe_payment_intent_id,'') from b2c_payments where order_id='${id}'`)
const paidCount = async (customer) => (await stripeApi(`charges?customer=${customer}&limit=100`)).data.filter((c) => c.paid && c.status === "succeeded").length
const piCount = async (customer) => (await stripeApi(`payment_intents?customer=${customer}&limit=100`)).data.length
/** Cookie の案内を閉じる（スマホの画面では支払のボタンに重なる。予約の画面の試験と同じ） */
async function declineCookies(b) {
  const want = `[...document.querySelectorAll('button')].find(e => ['拒否する', 'Decline'].includes(e.textContent.trim()))`
  await b.waitFor(`!!${want}`, { timeout: 8000 }).catch(() => null)
  if (await b.evaluate(`!!${want}`)) await b.clickSelector(want)
}
const state = (b) => b.evaluate(`document.querySelector('main')?.dataset.payState ?? ''`)

const scenarios = {
  async "P01 本人認証が必要（日本語・スマホ）→ 3D セキュアを完了 → 支払完了"(b) {
    const o = await failedCharge("ja", "pm_card_authenticationRequired")
    const pi0 = payRow(o.id).split("|")[1]
    await b.navigate(`${BASE}/my/${o.token}?lang=ja`)
    await b.waitFor(`!!document.querySelector('[data-my-pay-link]')`)
    await b.screenshot(`${SHOTS}/p01a_mybooking_pay_needed_ja.png`)
    ok("My Booking: 「お支払いのページへ」のボタン", true)
    await b.clickSelector(`document.querySelector('[data-my-pay-link]')`)
    await b.waitFor(`document.querySelector('main')?.dataset.payState === 'pay'`, { timeout: 20000 })
    await declineCookies(b)
    await b.sleep(1500)
    const amt = await b.evaluate(`document.querySelector('[data-testid=pay-amount]')?.textContent`)
    ok("支払のページ: 額（税込）・理由（本人認証が必要）", amt === "¥10,956" && (await b.evaluate(`document.body.innerText.includes('本人認証が必要です')`)), amt)
    await b.screenshot(`${SHOTS}/p01b_pay_page_ja.png`)
    await b.typeStripe({ number: "4000002760003184", expiry: "1230", cvc: "123" })
    await b.clickSelector(`document.querySelector('[data-testid=pay-submit]')`)
    await b.sleep(3000)
    await b.screenshot(`${SHOTS}/p01c_3ds_challenge.png`)
    await b.threeDs("complete")
    await b.waitFor(`document.querySelector('main')?.dataset.payState === 'paid'`, { timeout: 40000 })
    await b.screenshot(`${SHOTS}/p01d_paid_ja.png`)
    ok("画面: お支払いを受け付けました", await b.evaluate(`!!document.querySelector('[data-testid=pay-paid]')`))
    ok("DB: succeeded・同じ PaymentIntent", payRow(o.id) === `succeeded|${pi0}`, payRow(o.id))
    ok("Stripe: PaymentIntent 1・成功の Charge 1（二重請求なし）", (await piCount(o.customer)) === 1 && (await paidCount(o.customer)) === 1)
    await b.navigate(`${BASE}/my/${o.token}/pay?lang=ja`)
    await b.waitFor(`document.querySelector('main')?.dataset.payState === 'paid'`, { timeout: 20000 })
    ok("支払の後にリンクを開き直しても「受付済み」（もう一度払わせない）", true)
  },
  async "P02 カードの拒否（英語）→ 残高不足のカードでも断られる → 別のカードで支払"(b) {
    const o = await failedCharge("en", "pm_card_chargeCustomerFail")
    const pi0 = payRow(o.id).split("|")[1]
    await b.navigate(`${BASE}/my/${o.token}/pay`)
    await b.waitFor(`document.querySelector('main')?.dataset.payState === 'pay'`, { timeout: 20000 })
    await declineCookies(b)
    await b.sleep(1500)
    ok("英語の画面: 理由（カード会社が断った）・UnionPay は使えない", await b.evaluate(`document.body.innerText.includes('declined the payment') && document.body.innerText.includes('UnionPay is not accepted')`))
    await b.screenshot(`${SHOTS}/p02a_pay_page_en.png`)
    await b.typeStripe({ number: "4000000000009995", expiry: "1230", cvc: "123" })
    await b.clickSelector(`document.querySelector('[data-testid=pay-submit]')`)
    await b.waitFor(`[...document.querySelectorAll('[role=alert]')].length > 0 || document.querySelector('main')?.dataset.payState === 'paid'`, { timeout: 30000 })
    await b.sleep(2000)
    await b.screenshot(`${SHOTS}/p02b_declined_again_en.png`)
    ok("同じ残高不足のカード → 断られる（支払完了にならない）", payRow(o.id).startsWith("failed"), payRow(o.id))
    await b.waitFor(`document.querySelector('main')?.dataset.payState === 'pay'`, { timeout: 20000 })
    await b.sleep(2000)
    await b.typeStripe({ number: "5555555555554444", expiry: "1230", cvc: "123" })
    await b.clickSelector(`document.querySelector('[data-testid=pay-submit]')`)
    await b.waitFor(`document.querySelector('main')?.dataset.payState === 'paid'`, { timeout: 40000 })
    await b.screenshot(`${SHOTS}/p02c_paid_en.png`)
    ok("Mastercard で支払 → succeeded・同じ PaymentIntent・成功の Charge 1", payRow(o.id) === `succeeded|${pi0}` && (await paidCount(o.customer)) === 1, payRow(o.id))
    const saved = sql(`select stripe_payment_method_id from b2c_orders where id='${o.id}'`)
    const pm = await stripeApi(`payment_methods/${saved}`)
    ok("新しいカード（Mastercard）を以後の請求用に保存", pm.card?.brand === "mastercard" && pm.customer === o.customer, pm.card?.brand)
  },
  async "P03 本人認証に失敗 → 支払完了にならない → やり直して完了"(b) {
    const o = await failedCharge("ja", "pm_card_authenticationRequired")
    await b.navigate(`${BASE}/my/${o.token}/pay?lang=ja`)
    await b.waitFor(`document.querySelector('main')?.dataset.payState === 'pay'`, { timeout: 20000 })
    await declineCookies(b)
    await b.sleep(1500)
    await b.typeStripe({ number: "4000002760003184", expiry: "1230", cvc: "123" })
    await b.clickSelector(`document.querySelector('[data-testid=pay-submit]')`)
    await b.sleep(3000)
    await b.threeDs("fail")
    await b.waitFor(`[...document.querySelectorAll('[role=alert]')].length > 0`, { timeout: 30000 }).catch(() => null)
    await b.sleep(2000)
    await b.screenshot(`${SHOTS}/p03a_3ds_failed_ja.png`)
    ok("認証の失敗: 支払完了にならない（成功の Charge 0）", !payRow(o.id).startsWith("succeeded") && (await paidCount(o.customer)) === 0, payRow(o.id))
    await b.waitFor(`document.querySelector('main')?.dataset.payState === 'pay'`, { timeout: 20000 })
    await b.sleep(2000)
    await b.typeStripe({ number: "4242424242424242", expiry: "1230", cvc: "123" })
    await b.clickSelector(`document.querySelector('[data-testid=pay-submit]')`)
    await b.waitFor(`document.querySelector('main')?.dataset.payState === 'paid'`, { timeout: 40000 })
    ok("Visa でやり直し → 支払完了・成功の Charge 1", payRow(o.id).startsWith("succeeded") && (await paidCount(o.customer)) === 1)
  },
  async "P04 PC の画面・支払うものが無い予約"(b) {
    await b.setViewport(false)
    const r = await post("/api/b2c/orders", {
      token: TOK, originPlaceId: TOKYO, destPlaceId: KYOTO, origin: { checkIn: D("2026-11-10"), checkOut: D("2026-11-12") }, dest: { checkIn: D("2026-11-12"), checkOut: D("2026-11-15") },
      pieces: 1, pickupDate: D("2026-11-10"), deliveryDate: D("2026-11-12"), name: "Nothing Due", email: "pay-ui@example.invalid", whatsapp: "+81 90 0000 0000", language: "en", consent: true,
    })
    const s = await post("/api/b2c/card/start", { token: TOK, orderNumber: r.data.orderNumber, accessToken: r.data.accessToken, cardConsent: true })
    await stripeApi(`setup_intents/${s.data.clientSecret.split("_secret_")[0]}/confirm`, { payment_method: "pm_card_visa" })
    await post("/api/b2c/card/status", { token: TOK, orderNumber: r.data.orderNumber, accessToken: r.data.accessToken })
    await b.navigate(`${BASE}/my/${r.data.accessToken}/pay`)
    await b.waitFor(`document.querySelector('main')?.dataset.payState === 'nothing_due'`, { timeout: 20000 })
    await b.screenshot(`${SHOTS}/p04_nothing_due_pc_en.png`)
    ok("集荷の前: 「いま支払うものはありません」（カードの入力欄を出さない）", await b.evaluate(`document.body.innerText.includes('nothing to pay')`))
    await b.navigate(`${BASE}/my/${"x".repeat(32)}/pay`)
    await b.waitFor(`document.querySelector('main')?.dataset.payState !== 'loading'`, { timeout: 20000 })
    ok("無効なリンク: 「無効です」", await b.evaluate(`document.body.innerText.includes('not valid')`))
    await b.setViewport(true)
  },
}

async function main() {
  const place = async (q) => (await post("/api/b2c/places", { token: TOK, query: q, lang: "en" })).data.candidates[0].placeId
  TOKYO = await place("Keio Plaza Hotel Tokyo")
  KYOTO = await place("Hotel Granvia Kyoto")
  for (const [pid, name] of [[TOKYO, "Keio Plaza Hotel Tokyo"], [KYOTO, "Hotel Granvia Kyoto"]]) {
    sql(`insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('${pid}', '${name}', 'verified', 'e2e@example.invalid', now()) on conflict (place_id) do update set status='verified', checked_by='e2e@example.invalid', last_verified_at=now()`)
  }
  sql(`insert into b2c_ops_days(date, max_new_bookings, max_pieces) values ('${D("2026-11-10")}', 500, 2000) on conflict (date) do update set max_new_bookings=500, max_pieces=2000, closed=false`)
  for (const [name, fn] of Object.entries(scenarios)) {
    if (only.length && !only.some((k) => name.startsWith(k))) continue
    console.log(name)
    const b = await launch({ port: 9383 + (passed + failed) % 50 })
    try {
      await fn(b)
    } catch (e) {
      failed++
      console.log(`  NG  例外: ${e.message}`)
      await b.screenshot(`${SHOTS}/error_${name.slice(0, 3)}.png`).catch(() => {})
    } finally {
      if (b.consoleErrors.length) console.log("  (画面の JS の例外)", b.consoleErrors.slice(0, 3))
      await b.close()
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main()
