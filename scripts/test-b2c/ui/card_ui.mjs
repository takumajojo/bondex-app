/**
 * B2C のカード登録の画面の試験（Stage 3・B/E）。画面なしの Chrome で、本物の Stripe のカード入力欄と 3D セキュアの画面を操作する。
 * カード番号は Stripe が公開しているテスト用の番号だけ。接続先はローカルの開発サーバーとローカルの DB だけ。
 *
 * 実行: set -a; . ./.env.local; set +a; BASE=http://localhost:3210 SHOTS=<保存先> node scripts/test-b2c/ui/card_ui.mjs [シナリオ名...]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { launch } from "./cdp.mjs"
import { D } from "../dates/test-dates.mjs" // 試験の日付を実際の今日から見て有効な週へ（7日の倍数・時計はずらさない）

const BASE = process.env.BASE ?? "http://localhost:3210"
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(BASE)) throw new Error("refusing: local only")
if (!(process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_")) throw new Error("refusing: sk_test_ only")
const SHOTS = process.env.SHOTS ?? "/tmp/b2c-ui"
mkdirSync(SHOTS, { recursive: true })
const TOK = "dev-hnk-local-token-0001"
let passed = 0
let failed = 0
let ipN = Math.floor(Math.random() * 60000) // 実行ごとに別の試験用 IP（回数の制限に当たらないように）
const only = process.argv.slice(2)

const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail ?? "") }
}
const sql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-qtA", "-F", "|", "-c", q], { encoding: "utf8" }).trim()
async function post(path, body) {
  ipN++
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": `10.3.${ipN >> 8}.${(ipN % 250) + 1}` }, body: JSON.stringify(body) })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
let TOKYO, KYOTO
async function draft(lang = "ja", name = "UI Test") {
  const r = await post("/api/b2c/orders", {
    token: TOK, originPlaceId: TOKYO, destPlaceId: KYOTO, origin: { checkIn: D("2026-11-10"), checkOut: D("2026-11-12") }, dest: { checkIn: D("2026-11-12"), checkOut: D("2026-11-15") },
    pieces: 2, pickupDate: D("2026-11-10"), deliveryDate: D("2026-11-12"), name, email: "ui@example.invalid", whatsapp: "+81 90 0000 0000", language: lang, consent: true,
  })
  if (r.status !== 200) throw new Error(JSON.stringify(r.data))
  return { orderNumber: r.data.orderNumber, accessToken: r.data.accessToken, totalGrossYen: r.data.totalGrossYen }
}
const dbRow = (n) => sql(`select status, card_status, coalesce(card_3ds_result,'-'), (select count(*) from shipments s where s.b2c_order_id=o.id) from b2c_orders o where order_number=${n}`)

/** 下書きの予約をこのタブに入れて、カード登録の画面を開く（下書きまでの画面は Stage 2 で試験済み）。 */
async function openCardStep(b, order, lang = "ja") {
  const url = `${BASE}/book/${TOK}?lang=${lang}`
  await b.navigate(url)
  await b.evaluate(`sessionStorage.setItem('b2c-pending:${TOK}', JSON.stringify(${JSON.stringify(order)})), true`)
  await b.navigate(url)
  await b.waitFor(`!!document.querySelector('input[type=checkbox]')`)
  // Cookie の案内は画面の言語で出る（英語の画面で日本語の案内が出たら不合格）
  const want = lang === "ja" ? "拒否する" : "Decline"
  const other = lang === "ja" ? "Decline" : "拒否する"
  await b.waitFor(`!!${b.byText(want)} || !!${b.byText(other)}`, { timeout: 8000 }).catch(() => null)
  if (await b.evaluate(`!!${b.byText(other)}`)) throw new Error(`Cookie の案内が画面の言語（${lang}）ではない`)
  if (await b.evaluate(`!!${b.byText(want)}`)) await b.clickSelector(b.byText(want))
}
async function startCard(b, lang = "ja") {
  await b.clickSelector(`document.querySelector('input[type=checkbox]')`)
  await b.clickSelector(b.byText(lang === "ja" ? "カードを入力する" : "Enter card"))
}
const registerBtn = (b, lang = "ja") => b.byText(lang === "ja" ? "カードを登録する" : "Register card")
const resultText = (b) => b.evaluate(`document.querySelector('[data-b2c-result]')?.textContent ?? ''`)
const alertText = (b) => b.evaluate(`[...document.querySelectorAll('[role=alert]')].map(e => e.textContent).join(' / ')`)
const stripeErrorText = async (b) => {
  const sid = await b.frameSession("elements-inner-payment")
  // Stripe の部品がエラーの文を出すまで最大 5秒待つ（早く読みすぎると空になる）
  const expr = `[...document.querySelectorAll('.p-FieldError, [role=alert]')].map(e => e.textContent).join(' / ')`
  return (await b.waitFor(expr, { timeout: 5000, sessionId: sid }).catch(() => "")) || ""
}

const scenarios = {
  async "U01 3Dセキュア 認証成功 → 予約が確定（スマホ・日本語）"(b) {
    const o = await draft()
    await openCardStep(b, o)
    await b.screenshot(`${SHOTS}/u01a_card_consent_ja.png`)
    await startCard(b)
    await b.typeStripe({ number: "4000002500003155", expiry: "1230", cvc: "123" })
    await b.screenshot(`${SHOTS}/u01b_card_entered_ja.png`)
    await b.clickSelector(registerBtn(b))
    await b.sleep(2500)
    await b.screenshot(`${SHOTS}/u01c_3ds_challenge.png`)
    await b.threeDs("complete")
    await b.waitFor(`document.querySelector('[data-b2c-result]')?.dataset.b2cResult === 'confirmed'`, { timeout: 40000 })
    await b.screenshot(`${SHOTS}/u01d_confirmed_ja.png`)
    const t = await resultText(b)
    ok("画面: 「予約が確定しました」・カードの末尾 3155", t.includes("予約が確定しました") && t.includes("3155"), t)
    ok("DB: confirmed・registered・3D セキュア authenticated・shipments 1行", dbRow(o.orderNumber) === "confirmed|registered|authenticated|1", dbRow(o.orderNumber))
    await b.navigate(`${BASE}/book/${TOK}?lang=ja`)
    await b.waitFor(`document.querySelector('[data-b2c-result]')?.dataset.b2cResult === 'confirmed'`)
    ok("確定の後に再読込・戻っても結果の画面（もう一度カードを入れさせない）", true)
  },
  async "U02 3Dセキュア 認証失敗 → 確定しない → 別のカードで確定"(b) {
    const o = await draft()
    await openCardStep(b, o)
    await startCard(b)
    await b.typeStripe({ number: "4000002500003155", expiry: "1230", cvc: "123" })
    await b.clickSelector(registerBtn(b))
    await b.sleep(2500)
    await b.threeDs("fail")
    await b.waitFor(`[...document.querySelectorAll('[role=alert]')].length > 0`, { timeout: 30000 })
    await b.sleep(2500)
    await b.screenshot(`${SHOTS}/u02a_3ds_failed_ja.png`)
    const a = await alertText(b)
    ok("画面: 認証の失敗の案内を表示", a.length > 0, a)
    ok("DB: card_pending・failed・shipments なし（確定しない）", dbRow(o.orderNumber).startsWith("card_pending|failed|") && dbRow(o.orderNumber).endsWith("|0"), dbRow(o.orderNumber))
    await b.clearStripe()
    await b.typeStripe({ number: "4242424242424242", expiry: "1230", cvc: "123" })
    await b.clickSelector(registerBtn(b))
    await b.waitFor(`document.querySelector('[data-b2c-result]')?.dataset.b2cResult === 'confirmed'`, { timeout: 40000 })
    ok("別のカード（Visa）で入れ直し → 確定", dbRow(o.orderNumber).startsWith("confirmed|registered"), dbRow(o.orderNumber))
  },
  async "U03 3Dセキュアの画面を閉じた・放置（再読込で途中から再開）"(b) {
    const o = await draft()
    await openCardStep(b, o)
    await startCard(b)
    await b.typeStripe({ number: "4000002760003184", expiry: "1230", cvc: "123" })
    await b.clickSelector(registerBtn(b))
    await b.sleep(3000)
    await b.frameSession("", "!!document.getElementById('test-source-authorize-3ds')", 30000)
    ok("認証の途中の DB: card_pending・registering（確定しない）", dbRow(o.orderNumber).startsWith("card_pending|registering"), dbRow(o.orderNumber))
    await b.navigate(`${BASE}/book/${TOK}?lang=ja`) // 認証の画面を閉じて開き直した想定
    await b.waitFor(`!!${b.byText("カードを入力する")}`)
    await b.screenshot(`${SHOTS}/u03a_resume_after_abandon_ja.png`)
    ok("開き直すとカード登録の画面から再開（最初の予約の画面に戻らない・二重の予約を作らない）", true)
    await startCard(b)
    await b.typeStripe({ number: "4242424242424242", expiry: "1230", cvc: "123" })
    await b.clickSelector(registerBtn(b))
    await b.waitFor(`document.querySelector('[data-b2c-result]')?.dataset.b2cResult === 'confirmed'`, { timeout: 40000 })
    ok("再開の後に Visa で確定・この予約の SetupIntent は 1つ", dbRow(o.orderNumber).startsWith("confirmed") && sql(`select count(*) from b2c_order_events e join b2c_orders o on o.id=e.order_id where o.order_number=${o.orderNumber} and e.event='card_started'`) === "1", dbRow(o.orderNumber))
  },
  async "U04 カードの拒否・残高不足（カード会社の理由を日本語で表示）"(b) {
    const o = await draft()
    await openCardStep(b, o)
    await startCard(b)
    for (const [num, label] of [["4000000000000002", "一般的な拒否"], ["4000000000009995", "残高不足"], ["4000000000009987", "紛失"], ["4000000000000069", "期限切れ（カード会社の判定）"], ["4000000000000127", "CVC の誤り"]]) {
      await b.clearStripe()
      await b.typeStripe({ number: num, expiry: "1230", cvc: "123" })
      await b.clickSelector(registerBtn(b))
      await b.waitFor(`[...document.querySelectorAll('[role=alert]')].length > 0`, { timeout: 30000 })
      await b.sleep(2000)
      const a = await alertText(b)
      ok(`${label}: 画面に理由（${a.slice(0, 40)}…）・確定しない`, a.length > 0 && !dbRow(o.orderNumber).startsWith("confirmed"), [a, dbRow(o.orderNumber)])
      if (label === "残高不足") await b.screenshot(`${SHOTS}/u04a_insufficient_funds_ja.png`)
    }
  },
  async "U05 入力の誤り（番号・有効期限・CVC）はサーバーに送らない"(b) {
    const o = await draft()
    await openCardStep(b, o)
    await startCard(b)
    await b.typeStripe({ number: "4242424242424241", expiry: "1230", cvc: "123" })
    await b.clickSelector(registerBtn(b))
    await b.sleep(1500)
    const e1 = await stripeErrorText(b)
    await b.screenshot(`${SHOTS}/u05a_invalid_number_ja.png`)
    ok(`番号の誤り: Stripe の欄が案内（${e1.slice(0, 30)}）`, e1.length > 0, e1)
    await b.clearStripe()
    await b.typeStripe({ number: "4242424242424242", expiry: "0120", cvc: "123" })
    await b.clickSelector(registerBtn(b))
    await b.sleep(1500)
    const e2 = await stripeErrorText(b)
    ok(`有効期限が過去: 案内（${e2.slice(0, 30)}）`, e2.length > 0, e2)
    await b.clearStripe()
    await b.typeStripe({ number: "4242424242424242", expiry: "1230", cvc: "1" })
    await b.clickSelector(registerBtn(b))
    await b.sleep(1500)
    const e3 = await stripeErrorText(b)
    ok(`CVC が短い: 案内（${e3.slice(0, 30)}）`, e3.length > 0, e3)
    ok("DB: card_pending・registering のまま（失敗の記録も作らない）", dbRow(o.orderNumber).startsWith("card_pending|registering"), dbRow(o.orderNumber))
  },
  async "U06 CVC の照合に失敗したカード → 受け付けず、別のカードで確定"(b) {
    const o = await draft()
    await openCardStep(b, o)
    await startCard(b)
    await b.typeStripe({ number: "4000000000000101", expiry: "1230", cvc: "123" })
    await b.clickSelector(registerBtn(b))
    await b.waitFor(`(document.body.textContent).includes('セキュリティコード（裏面の3桁など）を確認できなかった')`, { timeout: 40000 })
    await b.screenshot(`${SHOTS}/u06a_cvc_rejected_ja.png`)
    ok("画面: CVC を確認できなかったので受けられない・別のカードを案内", true)
    ok("DB: card_pending・failed（確定しない）", dbRow(o.orderNumber).startsWith("card_pending|failed"), dbRow(o.orderNumber))
    await b.clickSelector(b.byText("カードを入力する"))
    await b.typeStripe({ number: "4242424242424242", expiry: "1230", cvc: "123" })
    await b.clickSelector(registerBtn(b))
    await b.waitFor(`document.querySelector('[data-b2c-result]')?.dataset.b2cResult === 'confirmed'`, { timeout: 40000 })
    ok("新しい登録で Visa → 確定", dbRow(o.orderNumber).startsWith("confirmed|registered"), dbRow(o.orderNumber))
  },
  async "U07 登録ボタンの連打（1回だけ処理）"(b) {
    const o = await draft()
    await openCardStep(b, o)
    await startCard(b)
    await b.typeStripe({ number: "4242424242424242", expiry: "1230", cvc: "123" })
    const sel = registerBtn(b)
    await b.evaluate(`(() => { const e = ${sel}; for (let i = 0; i < 5; i++) e.click(); return true })()`)
    await b.waitFor(`document.querySelector('[data-b2c-result]')?.dataset.b2cResult === 'confirmed'`, { timeout: 40000 })
    ok("5回押しても確定は 1回・shipments 1行・カードの記録 1件",
      dbRow(o.orderNumber).endsWith("|1") && sql(`select count(*) from b2c_order_events e join b2c_orders o on o.id=e.order_id where o.order_number=${o.orderNumber} and e.event in ('card_registered','booking_confirmed')`) === "2", dbRow(o.orderNumber))
  },
  async "U08 未確認のホテル → カード登録後も「まだ確定していません」（英語・スマホ）"(b) {
    sql(`update b2c_facilities set status='unknown', checked_by=null, last_verified_at=null where place_id='${KYOTO}'`)
    try {
      const o = await draft("en", "Unverified Hotel")
      sql(`alter table b2c_orders disable trigger user; update b2c_orders set confirmation_mode='awaiting_hotel_verification', confirmation_due_at=now() + interval '1 day' where order_number=${o.orderNumber}; alter table b2c_orders enable trigger user;`)
      await openCardStep(b, o, "en")
      await b.screenshot(`${SHOTS}/u08a_card_consent_en.png`)
      await startCard(b, "en")
      await b.typeStripe({ number: "4242424242424242", expiry: "1230", cvc: "123" })
      await b.clickSelector(registerBtn(b, "en"))
      await b.waitFor(`document.querySelector('[data-b2c-result]')?.dataset.b2cResult === 'awaiting_hotel_confirmation'`, { timeout: 40000 })
      await b.screenshot(`${SHOTS}/u08b_awaiting_en.png`)
      const t = await resultText(b)
      ok("画面: Card registered — booking not yet confirmed・無料取消の案内", t.includes("not yet confirmed") && t.includes("no charge"), t)
      ok("DB: awaiting_hotel_confirmation・registered・shipments なし", dbRow(o.orderNumber).startsWith("awaiting_hotel_confirmation|registered") && dbRow(o.orderNumber).endsWith("|0"), dbRow(o.orderNumber))
    } finally {
      sql(`update b2c_facilities set status='verified', checked_by='e2e@example.invalid', last_verified_at=now() where place_id='${KYOTO}'`)
    }
  },
  async "U09 カードの入力中に 30分が過ぎた → 期限切れの案内（もう一度予約）"(b) {
    const o = await draft()
    await openCardStep(b, o)
    await startCard(b)
    await b.typeStripe({ number: "4242424242424242", expiry: "1230", cvc: "123" })
    sql(`alter table b2c_orders disable trigger user; update b2c_orders set updated_at = now() - interval '31 minutes' where order_number=${o.orderNumber}; alter table b2c_orders enable trigger user;`)
    await post("/api/b2c/card/start", { token: TOK, ...(await draft()), cardConsent: true }) // 別の予約の開始が片付けを動かす
    await b.clickSelector(registerBtn(b))
    await b.sleep(4000)
    await b.navigate(`${BASE}/book/${TOK}?lang=ja`)
    await b.waitFor(`document.querySelector('[data-b2c-result]')?.dataset.b2cResult === 'cancelled'`, { timeout: 30000 })
    await b.screenshot(`${SHOTS}/u09a_expired_ja.png`)
    ok("画面: 期限切れ・請求なし・もう一度予約のボタン", (await resultText(b)).includes("期限が切れました"))
    ok("DB: cancelled（card_timeout）・shipments なし", dbRow(o.orderNumber).startsWith("cancelled") && dbRow(o.orderNumber).endsWith("|0"), dbRow(o.orderNumber))
    await b.clickSelector(b.byText("最初から予約する"))
    await b.waitFor(`document.querySelector('h1')?.textContent.includes('お荷物を次のホテルへ')`)
    ok("「最初から予約する」で予約の画面に戻る", true)
  },
  async "U10 PC の画面（日本語）・Amex で確定"(b) {
    await b.setViewport(false)
    const o = await draft()
    await openCardStep(b, o)
    await startCard(b)
    await b.typeStripe({ number: "378282246310005", expiry: "1230", cvc: "1234" })
    await b.screenshot(`${SHOTS}/u10a_pc_card_ja.png`)
    await b.clickSelector(registerBtn(b))
    await b.waitFor(`document.querySelector('[data-b2c-result]')?.dataset.b2cResult === 'confirmed'`, { timeout: 40000 })
    await b.screenshot(`${SHOTS}/u10b_pc_confirmed_ja.png`)
    ok("PC: Amex で確定・画面に AMEX •••• 0005", (await resultText(b)).includes("0005"))
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
    const b = await launch({ port: 9333 + (passed + failed) % 50 })
    try {
      await fn(b)
    } catch (e) {
      failed++
      console.log(`  NG  例外: ${e.message}`)
      await b.screenshot(`${SHOTS}/error_${name.slice(0, 3)}.png`).catch(() => {})
    } finally {
      if (b.consoleErrors.length) console.log("  (画面の JS の例外)", b.consoleErrors.slice(0, 3))
      if (b.dialogs.length) console.log("  (確認のダイアログ)", b.dialogs.slice(0, 3))
      await b.close()
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main()
