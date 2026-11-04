/**
 * B2C Stage 5 の通しの試験: 集荷の確認 → 30分の猶予 → 請求（Stripe のテストモード）・二重請求の防止・失敗と回収・
 * 個数の違い・追加の請求・返金・Webhook（B2C・B2B）・権限。設計: docs/b2c/B2C_STAGE5_PAYMENT_DESIGN.md。
 *
 * 本番には接続しない: 開発サーバー・DB はローカルだけ、Stripe は sk_test_ だけ（本番の鍵なら止まる）。
 * 請求の回数は DB だけでなく Stripe の側（旅行者の Customer の PaymentIntent・Charge・Refund の一覧）で数える。
 * DB の障害は、ローカルの DB で service_role の権限を一時的に外して起こす（必ず戻す）。
 *
 * 実行: set -a; . ./.env.local; set +a; BASE=http://localhost:3210 npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-b2c/charge_e2e.ts
 */
import Stripe from "stripe"
import { execFileSync } from "node:child_process"
import { issueOperatorSession, OPERATOR_SESSION_COOKIE } from "@/lib/operator-session"
import { enqueueCollectionReminders, runB2cCharges } from "@/lib/b2c/charge-service"
import { executeB2cRefund, reconcileB2cRefunds } from "@/lib/b2c/refund-service"
import { processB2cOutbox, sandboxTransport } from "@/lib/b2c/notify"

const BASE = process.env.BASE ?? "http://localhost:3210"
const SK = process.env.STRIPE_SECRET_KEY ?? ""
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(BASE) || !/^http:\/\/(localhost|127\.0\.0\.1):/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("refusing: local only")
if (!SK.startsWith("sk_test_")) throw new Error("refusing: sk_test_ only")
if (process.env.B2C_NOTIFY_LIVE === "true") throw new Error("refusing: B2C_NOTIFY_LIVE must be off")
process.env.B2C_CHARGE_LIVE = "true"
const stripe = new Stripe(SK, { maxNetworkRetries: 2 })
const TOK = "dev-hnk-local-token-0001"
let passed = 0
let failed = 0
let ipN = Math.floor(Math.random() * 60000)
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 700)) }
}
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "|", "-c", q], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
const sqlFails = (q: string) => { try { sql(q); return false } catch { return true } }
const restoreGrants = () => sql("grant select, insert, update, delete on public.b2c_payments, public.b2c_refunds, public.b2c_stripe_events to service_role")
async function http(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  ipN++
  const r = await fetch(BASE + path, {
    method, redirect: "manual",
    headers: { "Content-Type": "application/json", "x-real-ip": `10.7.${(ipN >> 8) % 250}.${(ipN % 250) + 1}`, ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  })
  const text = await r.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* html */ }
  return { status: r.status, json, text }
}

let TOKYO = "", KYOTO = ""
const STAY = { origin: { checkIn: "2026-11-10", checkOut: "2026-11-12" }, dest: { checkIn: "2026-11-12", checkOut: "2026-11-15" } }
interface Ord { n: number; token: string; id: string; customer: string }
async function order(lang: "ja" | "en" = "ja", pieces = 2): Promise<Ord> {
  const r = await http("POST", "/api/b2c/orders", { token: TOK, originPlaceId: TOKYO, destPlaceId: KYOTO, ...STAY, pieces, pickupDate: "2026-11-10", deliveryDate: "2026-11-12", name: lang === "ja" ? "請求 花子" : "Charge Smith", email: `${lang}-charge@example.invalid`, whatsapp: "+81 90 1234 5678", language: lang, consent: true })
  if (r.status !== 200) throw new Error(`draft ${r.status} ${r.text.slice(0, 200)}`)
  const n = r.json.orderNumber as number
  const id = sql(`select id from b2c_orders where order_number=${n}`)
  const s = await http("POST", "/api/b2c/card/start", { token: TOK, orderNumber: n, accessToken: r.json.accessToken, cardConsent: true })
  if (s.status !== 200) throw new Error(`start ${s.status}`)
  await stripe.setupIntents.confirm(s.json.clientSecret.split("_secret_")[0], { payment_method: "pm_card_visa" })
  await http("POST", "/api/b2c/card/status", { token: TOK, orderNumber: n, accessToken: r.json.accessToken })
  if (sql(`select status from b2c_orders where id='${id}'`) !== "confirmed") throw new Error("not confirmed")
  return { n, token: r.json.accessToken, id, customer: sql(`select stripe_customer_id from b2c_orders where id='${id}'`) }
}
/** 登録済みのカードを、請求の時に失敗する試験用のカードに差し替える（Stripe のテストモードの PaymentMethod） */
async function swapCard(o: Ord, pm: string) {
  const attached = await stripe.paymentMethods.attach(pm, { customer: o.customer })
  sql(`update b2c_orders set stripe_payment_method_id='${attached.id}' where id='${o.id}'`)
  return attached.id
}
const pis = async (o: Ord) => (await stripe.paymentIntents.list({ customer: o.customer, limit: 100 })).data
const charges = async (o: Ord) => (await stripe.charges.list({ customer: o.customer, limit: 100 })).data
const paidCharges = async (o: Ord) => (await charges(o)).filter((c) => c.paid && c.status === "succeeded")
const pay = (o: Ord, kind = "base") => sql(`select status || '|' || amount_yen || '|' || coalesce(stripe_payment_intent_id,'') || '|' || coalesce(hold_reason,'') from b2c_payments where order_id='${o.id}' and kind='${kind}' order by created_at desc limit 1`)
const payId = (o: Ord, kind = "base") => sql(`select id from b2c_payments where order_id='${o.id}' and kind='${kind}' order by created_at desc limit 1`)
const amountFor = (unit: number, n: number) => unit * n + Math.floor((unit * n) / 10)
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000)
let opCookie: Record<string, string> = {}
let v1Cookie: Record<string, string> = {}
const ops = (body: Record<string, unknown>, h = opCookie) => http("POST", "/api/b2c/ops/payments", body, h)
const confirmPickup = (o: Ord, accepted = 2, note = "佐川の追跡で集荷済みを確認（e2e）") => ops({ action: "confirm_pickup", orderNumber: o.n, evidenceType: "sagawa_tracking", evidenceRef: "e2e-tracking-0001", acceptedPieces: accepted, note })
/** 集荷の確認の時刻（DB の scheduled_at の 30分前） */
const confirmedAt = (o: Ord) => new Date(new Date(sql(`select to_char(scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from b2c_payments where order_id='${o.id}' and kind='base'`)).getTime() - 30 * 60_000)
/** Stripe の一部の呼び出しだけ差し替える（他は本物のテストモード） */
function faulty(over: Record<string, Record<string, (...a: any[]) => any>>): Stripe {
  return new Proxy(stripe, {
    get(target, prop: string) {
      const res = (target as any)[prop]
      if (!over[prop]) return res
      return new Proxy(res, { get: (t, m: string) => over[prop][m] ?? (typeof t[m] === "function" ? t[m].bind(t) : t[m]) })
    },
  }) as Stripe
}
const connErr = () => Object.assign(new Error("simulated network failure"), { type: "StripeConnectionError" })
/** 署名付きの Webhook を送る（中身は Stripe から取り直した本物の PaymentIntent） */
async function webhook(path: string, secret: string, type: string, object: unknown, id = `evt_e2e_${Math.random().toString(36).slice(2)}`) {
  const payload = JSON.stringify({ id, object: "event", type, api_version: "2026-04-22.dahlia", created: Math.floor(Date.now() / 1000), data: { object }, livemode: false, pending_webhooks: 1, request: { id: null, idempotency_key: null } })
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret })
  return { id, res: await http("POST", path, payload, { "stripe-signature": header }) }
}

async function main() {
  const place = async (q: string) => (await http("POST", "/api/b2c/places", { token: TOK, query: q, lang: "en" })).json.candidates[0].placeId as string
  TOKYO = await place("Keio Plaza Hotel Tokyo"); KYOTO = await place("Hotel Granvia Kyoto")
  for (const [pid, nm] of [[TOKYO, "Keio Plaza Hotel Tokyo"], [KYOTO, "Hotel Granvia Kyoto"]]) {
    sql(`insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('${pid}', '${nm}', 'verified', 'e2e@example.invalid', now()) on conflict (place_id) do update set status='verified', checked_by='e2e@example.invalid', last_verified_at=now()`)
  }
  sql("insert into b2c_ops_days(date, max_new_bookings, max_pieces) select d::date, 500, 2000 from generate_series('2026-11-04'::date, '2026-11-20'::date, '1 day') d on conflict (date) do update set max_new_bookings=500, max_pieces=2000, closed=false")
  sql("insert into operator_passkeys(credential_id, public_key, operator_email) values ('e2e-cred-0000000000000005', '\\x00', 'ops-charge@example.invalid') on conflict do nothing")
  opCookie = { cookie: `${OPERATOR_SESSION_COOKIE}=${await issueOperatorSession("e2e-cred-0000000000000005")}` }
  v1Cookie = { cookie: `${OPERATOR_SESSION_COOKIE}=${await issueOperatorSession()}` }
  const unit = Number(sql("select unit_net_yen from b2c_orders limit 1") || 4980)

  console.log("C01 集荷の確認の前は請求しない")
  const a = await order()
  for (let i = 0; i < 3; i++) await runB2cCharges(stripe, plus(new Date(), 60 * 24 * i))
  ok("定期の処理を何度動かしても、請求の行 0・Stripe の PaymentIntent 0", sql(`select count(*) from b2c_payments where order_id='${a.id}'`) === "0" && (await pis(a)).length === 0)

  console.log("C02 権限: 集荷の確認は個人のパスキーの運営者だけ")
  ok("ログインなし・共有パスワード（v1）は 403", (await ops({ action: "confirm_pickup", orderNumber: a.n, evidenceType: "sagawa_tracking", evidenceRef: "x", acceptedPieces: 2, note: "x" }, {})).status === 403 && (await ops({ action: "confirm_pickup", orderNumber: a.n, evidenceType: "sagawa_tracking", evidenceRef: "x", acceptedPieces: 2, note: "x" }, v1Cookie)).status === 403)
  ok("理由なし 422・根拠なし 422", (await ops({ action: "confirm_pickup", orderNumber: a.n, evidenceType: "sagawa_tracking", evidenceRef: "x", acceptedPieces: 2 })).status === 422 && (await ops({ action: "confirm_pickup", orderNumber: a.n, evidenceType: "sagawa_tracking", evidenceRef: "", acceptedPieces: 2, note: "x" })).status === 422)
  ok("一覧（GET）はログインなしで 401", (await http("GET", "/api/b2c/ops/payments")).status === 401)

  console.log("C03 集荷の確認 → 30分は請求しない → 30分の後に 1回だけ")
  const c1 = await confirmPickup(a)
  ok("集荷の確認: scheduled（30分後）・配送は picked_up・記録（運営者・根拠・個数・理由）", c1.status === 200 && pay(a).startsWith(`scheduled|${amountFor(unit, 2)}||`) && sql(`select status from shipments where b2c_order_id='${a.id}'`) === "picked_up" && sql(`select operator_email || '|' || evidence_type || '|' || accepted_pieces || '|' || reason from b2c_pickup_confirmations where order_id='${a.id}'`).startsWith("ops-charge@example.invalid|sagawa_tracking|2|佐川の追跡"), [c1.json, pay(a)])
  ok("同じ予約の 2回目の確認は already_confirmed（409）", (await confirmPickup(a)).json?.error === "already_confirmed")
  const t0 = confirmedAt(a)
  await runB2cCharges(stripe, plus(t0, 29))
  ok("29分の時点: 請求しない（PaymentIntent 0）", pay(a).startsWith("scheduled") && (await pis(a)).length === 0)
  const r31 = await runB2cCharges(stripe, plus(t0, 31))
  ok("31分の時点: 請求（succeeded・Charge 1・額は料金の控えどおり）", pay(a).startsWith(`succeeded|${amountFor(unit, 2)}|pi_`) && (await paidCharges(a)).length === 1 && (await paidCharges(a))[0].amount === amountFor(unit, 2), [r31, pay(a)])
  for (let i = 0; i < 3; i++) await runB2cCharges(stripe, plus(t0, 40 + i * 60))
  ok("その後も何度動かしても増えない（PaymentIntent 1・Charge 1）", (await pis(a)).length === 1 && (await charges(a)).length === 1)
  ok("Stripe の PaymentIntent の metadata（channel=b2c・charge_key=base:<予約>）・shipment_id は入れない", (await pis(a))[0].metadata.channel === "b2c" && (await pis(a))[0].metadata.charge_key === `base:${a.id}` && !("shipment_id" in (await pis(a))[0].metadata))
  ok("支払の受領の通知（日本語）を積んだ", sql(`select count(*) from b2c_outbox where order_id='${a.id}' and kind='payment_received'`) === "2")
  await processB2cOutbox(sandboxTransport, new Date())
  const rec = JSON.parse(sql(`select rendered::text from b2c_outbox where order_id='${a.id}' and kind='payment_received' and channel='email'`) || "{}")
  ok("受領の通知の文面: 額・受付番号", (rec.subject ?? "").startsWith("【BondEx】お支払いを受け付けました") && rec.text?.includes(`¥${amountFor(unit, 2).toLocaleString("ja-JP")}`), rec)
  const myA = await http("GET", `/my/${a.token}`)
  ok("My Booking: 請求済み", myA.text.includes('data-my-payment="charged"'))

  console.log("C04 30分の猶予の中の取消 → 請求しない・猶予の後は取り消せない")
  const b = await order("en")
  await confirmPickup(b)
  const tb = confirmedAt(b)
  const rv = await ops({ action: "revoke_pickup", orderNumber: b.n, note: "別の予約の荷物と取り違えた" })
  ok("取消: 請求は cancelled・配送は元の状態（issued）", rv.status === 200 && pay(b).startsWith("cancelled") && sql(`select status from shipments where b2c_order_id='${b.id}'`) === "issued", [rv.json, pay(b)])
  await runB2cCharges(stripe, plus(tb, 31)); await runB2cCharges(stripe, plus(tb, 600))
  ok("取消の後、何分たっても請求しない（PaymentIntent 0）", (await pis(b)).length === 0)
  await confirmPickup(b, 2, "改めて佐川の追跡で確認")
  ok("確認し直すと同じ請求の行を使う（1予約 1行）", sql(`select count(*) from b2c_payments where order_id='${b.id}' and kind='base'`) === "1" && pay(b).startsWith("scheduled"))
  sql(`update b2c_payments set scheduled_at = now() - interval '1 minute' where order_id='${b.id}'`)
  ok("猶予の後の取消は too_late（409）", (await ops({ action: "revoke_pickup", orderNumber: b.n, note: "遅い取消" })).json?.error === "too_late")
  await runB2cCharges(stripe, new Date())
  ok("（確認し直した分は 1回だけ請求）", (await paidCharges(b)).length === 1)

  console.log("C05 同時の実行（定期の処理 5つ＋運営の再試行）でも 1回だけ")
  const c = await order()
  await confirmPickup(c)
  const tc = plus(confirmedAt(c), 31)
  await Promise.all([0, 1, 2, 3, 4].map((i) => runB2cCharges(stripe, tc, `race-${i}`)).concat([ops({ action: "retry_charge", paymentId: payId(c), note: "同時に押す" }) as any]))
  ok("PaymentIntent 1・Charge 1・succeeded", (await pis(c)).length === 1 && (await paidCharges(c)).length === 1 && pay(c).startsWith("succeeded"), [(await pis(c)).length, pay(c)])

  console.log("C06 Stripe で成功・DB の記録に失敗（本題）")
  const d = await order()
  await confirmPickup(d)
  const td = plus(confirmedAt(d), 31)
  const breakAfterConfirm = faulty({ paymentIntents: { confirm: async (...args: any[]) => { const r = await stripe.paymentIntents.confirm(args[0], args[1], args[2]); sql("revoke update on public.b2c_payments from service_role"); return r } } })
  let r6
  try { r6 = await runB2cCharges(breakAfterConfirm, td) } finally { restoreGrants() }
  ok("Stripe で請求は成功（Charge 1）・DB は processing のまま（記録できなかった）", (await paidCharges(d)).length === 1 && pay(d).startsWith("processing"), [r6, pay(d)])
  await runB2cCharges(stripe, plus(td, 2))
  ok("10分たつまでは触らない（再び確定しない）", (await charges(d)).length === 1 && pay(d).startsWith("processing"))
  await runB2cCharges(stripe, plus(td, 11))
  ok("10分後の照合: Stripe から取り直して succeeded。二度目の請求なし（PaymentIntent 1・Charge 1）", pay(d).startsWith("succeeded") && (await pis(d)).length === 1 && (await charges(d)).length === 1, [pay(d), (await pis(d)).length, (await charges(d)).length])

  const e = await order()
  await confirmPickup(e)
  const te = plus(confirmedAt(e), 31)
  const breakAfterCreate = faulty({ paymentIntents: { create: async (...args: any[]) => { const r = await stripe.paymentIntents.create(args[0], args[1]); sql("revoke update on public.b2c_payments from service_role"); return r } } })
  try { await runB2cCharges(breakAfterCreate, te) } finally { restoreGrants() }
  ok("PaymentIntent を作った直後に ID の記録に失敗 → 確定していない（Charge 0）", (await charges(e)).length === 0 && pay(e) === `processing|${amountFor(unit, 2)}||`, pay(e))
  await runB2cCharges(stripe, plus(te, 11))
  ok("照合: 一覧で同じ PaymentIntent を見つけて使う → 1回だけ請求（PaymentIntent 1・Charge 1）", pay(e).startsWith("succeeded") && (await pis(e)).length === 1 && (await paidCharges(e)).length === 1, [pay(e), (await pis(e)).map((x) => x.status)])

  const f = await order()
  await confirmPickup(f)
  const tf = plus(confirmedAt(f), 31)
  try { await runB2cCharges(faulty({ paymentIntents: { create: async () => { throw connErr() } } }), tf) } finally { restoreGrants() }
  ok("作成の通信の障害 → unknown（新しい請求を作らない）", pay(f) === `unknown|${amountFor(unit, 2)}||` && (await pis(f)).length === 0, pay(f))
  await runB2cCharges(stripe, plus(tf, 3))
  ok("照合: 一覧に無いことを確かめてから作成 → 1回だけ請求", pay(f).startsWith("succeeded") && (await pis(f)).length === 1 && (await paidCharges(f)).length === 1, pay(f))

  const g = await order()
  await confirmPickup(g)
  const tg = plus(confirmedAt(g), 31)
  await runB2cCharges(faulty({ paymentIntents: { confirm: async (...args: any[]) => { await stripe.paymentIntents.confirm(args[0], args[1], args[2]); throw connErr() } } }), tg)
  ok("確定は届いたが応答が切れた → unknown（Stripe では成功・Charge 1）", pay(g).startsWith("unknown") && (await paidCharges(g)).length === 1, pay(g))
  await runB2cCharges(stripe, plus(tg, 3))
  ok("照合で succeeded・再び確定しない（Charge 1）", pay(g).startsWith("succeeded") && (await charges(g)).length === 1)

  console.log("C07 Webhook（B2C）: 成功・重複・順序の逆転・存在しない請求・DB 障害")
  const WH = process.env.STRIPE_B2C_WEBHOOK_SECRET ?? ""
  const piA = (await pis(a))[0]
  const w1 = await webhook("/api/b2c/stripe/webhook", WH, "payment_intent.succeeded", piA)
  const w1b = await webhook("/api/b2c/stripe/webhook", WH, "payment_intent.succeeded", piA, w1.id)
  ok("成功の通知 200・同じ通知の再送は duplicate", w1.res.status === 200 && w1b.res.json?.duplicate === true, [w1.res.json, w1b.res.json])
  const oldFail = { ...piA, status: "requires_payment_method", last_payment_error: { code: "card_declined", message: "old" } }
  const w2 = await webhook("/api/b2c/stripe/webhook", WH, "payment_intent.payment_failed", oldFail)
  ok("成功の後に古い「失敗」の通知が届いても成功のまま（中身ではなく Stripe から取り直す）", w2.res.status === 200 && pay(a).startsWith("succeeded"), [w2.res.json, pay(a)])
  const foreign = await stripe.paymentIntents.create({ amount: 1000, currency: "jpy", payment_method_types: ["card"], metadata: { channel: "b2c", charge_key: "base:00000000-0000-0000-0000-000000000000", payment_id: "00000000-0000-0000-0000-000000000000" } })
  const w3 = await webhook("/api/b2c/stripe/webhook", WH, "payment_intent.succeeded", foreign)
  ok("metadata が B2C を名乗っても、DB に請求の記録が無ければ何もしない", w3.res.status === 200 && w3.res.json?.ignored === "not_b2c_payment", w3.res.json)
  sql("revoke select on public.b2c_payments from service_role")
  let w4
  try { w4 = await webhook("/api/b2c/stripe/webhook", WH, "payment_intent.succeeded", piA) } finally { restoreGrants() }
  const w4b = await webhook("/api/b2c/stripe/webhook", WH, "payment_intent.succeeded", piA, w4.id)
  ok("DB に届かない → 500（Stripe が再送）→ 復旧後の再送は 200", w4.res.status === 500 && w4b.res.status === 200, [w4.res.status, w4b.res.status])
  ok("署名の無い通知は 400", (await http("POST", "/api/b2c/stripe/webhook", JSON.stringify({ id: "x" }))).status === 400)

  console.log("C08 Webhook（B2B）: B2C の請求の通知は B2B で処理しない・B2B の通知は今までどおり")
  const WB = process.env.STRIPE_WEBHOOK_SECRET ?? ""
  const b1 = await webhook("/api/stripe/webhook", WB, "payment_intent.payment_failed", piA)
  ok("B2C の PaymentIntent の失敗の通知 → 200 ignored b2c（B2B の区間を探さない・500 にしない）", b1.res.status === 200 && b1.res.json?.ignored === "b2c", b1.res.json)
  const chA = (await charges(a))[0]
  const b2 = await webhook("/api/stripe/webhook", WB, "charge.refunded", chA)
  ok("B2C の返金の通知 → 200 ignored b2c", b2.res.status === 200 && b2.res.json?.ignored === "b2c", b2.res.json)
  const b3 = await webhook("/api/stripe/webhook", WB, "payment_intent.payment_failed", foreign)
  ok("metadata だけ B2C の PaymentIntent（DB に B2C の記録なし）は除かない → B2B の処理（区間が無い → 500 で再送・従来どおり）", b3.res.status === 500, [b3.res.status, b3.res.json])
  const b2bPi = await stripe.paymentIntents.create({ amount: 5500, currency: "jpy", payment_method_types: ["card"], metadata: { shipment_id: "11111111-1111-1111-1111-111111111111" } })
  const b4 = await webhook("/api/stripe/webhook", WB, "payment_intent.payment_failed", b2bPi)
  ok("B2B の PaymentIntent の通知は B2B の処理に進む（ignored にならない）", b4.res.json?.ignored !== "b2c", [b4.res.status, b4.res.json])

  console.log("C09 決済の失敗（残高不足・カード停止・期限切れ・本人認証）→ 支払のリンク → 同じ PaymentIntent で回収")
  // Stripe のテストモードでは、残高不足・紛失・期限切れのテスト用カードは保存（attach）の時点で断られる。
  // そのため、保存できて請求で断られるカード（4000000000000341）と本人認証が必要なカードは本物で、
  // 残高不足・紛失・期限切れは Stripe の拒否の応答（decline_code）を差し込んで扱いを確かめる（画面の試験では本物のカードで拒否を確かめる）。
  const declined = (code: string) => async (id: string) => {
    const pi = await stripe.paymentIntents.retrieve(id)
    throw Object.assign(new Error(`declined: ${code}`), { type: "StripeCardError", code: "card_declined", decline_code: code, payment_intent: { ...pi, status: "requires_payment_method", last_payment_error: { code: "card_declined", decline_code: code, message: `Your card was declined (${code}).` } } })
  }
  const cases: Array<[string, string, string, ((id: string) => Promise<never>) | null]> = [
    ["カードの拒否（本物の Stripe）", "pm_card_chargeCustomerFail", "failed|", null],
    ["本人認証が必要（本物の Stripe）", "pm_card_authenticationRequired", "failed|", null],
    ["残高不足（拒否の応答を差し込む）", "pm_card_visa", "failed|", declined("insufficient_funds")],
    ["カード停止・紛失（同）", "pm_card_visa", "failed|", declined("lost_card")],
    ["期限切れ（同）", "pm_card_visa", "failed|", declined("expired_card")],
  ]
  for (const [label, pm, want, inject] of cases) {
    const o = await order("en")
    if (pm !== "pm_card_visa") await swapCard(o, pm)
    await confirmPickup(o)
    await runB2cCharges(inject ? faulty({ paymentIntents: { confirm: inject } }) : stripe, plus(confirmedAt(o), 31))
    if (pm === "pm_card_authenticationRequired") ok(`${label}: 理由 authentication_required`, sql(`select last_error_code from b2c_payments where order_id='${o.id}'`) === "authentication_required")
    if (inject) ok(`${label}: 理由を記録`, sql(`select last_error_code from b2c_payments where order_id='${o.id}'`) === (inject === null ? "" : label.includes("残高") ? "insufficient_funds" : label.includes("紛失") ? "lost_card" : "expired_card"))
    ok(`${label}: ${want.slice(0, -1)}・成功の Charge 0`, pay(o).startsWith(want) && (await paidCharges(o)).length === 0, [pay(o), sql(`select last_error_code from b2c_payments where order_id='${o.id}'`)])
    ok(`${label}: 支払の案内（英語・メール）を積んだ`, sql(`select count(*) from b2c_outbox where order_id='${o.id}' and kind='payment_action_required' and channel='email'`) === "1")
    const my = await http("GET", `/my/${o.token}`)
    ok(`${label}: My Booking に支払のボタン`, my.text.includes("data-my-pay-link") && my.text.includes(`/my/${o.token}/pay`))
    const st = await http("POST", "/api/b2c/pay/start", { token: o.token })
    ok(`${label}: 支払のページ: 額はサーバーの値・client_secret は同じ PaymentIntent のもの`, st.status === 200 && st.json.state === "pay" && st.json.amountYen === amountFor(unit, 2) && String(st.json.clientSecret).startsWith(pay(o).split("|")[2]), st.json)
    // 旅行者が別のカードで払う（ブラウザの Stripe の部品の代わりに、同じ PaymentIntent を確定する）
    await stripe.paymentIntents.confirm(pay(o).split("|")[2], { payment_method: "pm_card_visa" })
    const after = await http("POST", "/api/b2c/pay/status", { token: o.token })
    ok(`${label}: 別のカードで支払 → paid・succeeded・同じ PaymentIntent（PaymentIntent 1・成功の Charge 1）`, after.json?.state === "paid" && pay(o).startsWith("succeeded") && (await pis(o)).length === 1 && (await paidCharges(o)).length === 1, [after.json, pay(o)])
    ok(`${label}: 以後の請求用に新しいカードを保存`, sql(`select stripe_payment_method_id from b2c_orders where id='${o.id}'`) === (await stripe.paymentIntents.retrieve(pay(o).split("|")[2])).payment_method)
  }
  const nf = await http("POST", "/api/b2c/pay/start", { token: "z".repeat(32) })
  ok("支払のページ: 不正な token は 404", nf.status === 404)

  console.log("C10 回収の案内（1日後・3日後・7日後）・支払の後は送らない・回収不能（14日・運営だけ）")
  const h = await order("ja")
  await swapCard(h, "pm_card_chargeCustomerFail")
  await confirmPickup(h)
  await runB2cCharges(stripe, plus(confirmedAt(h), 31))
  const hid = payId(h)
  await processB2cOutbox(sandboxTransport, new Date()) // 失敗の時の案内を送る（sandbox）
  for (const days of [1, 3, 7]) {
    sql(`update b2c_payments set first_failed_at = now() - interval '${days} days 1 minute' where id='${hid}'`)
    await enqueueCollectionReminders(new Date())
  }
  ok("案内は 4回（失敗の時・1日後・3日後・7日後）× メール", sql(`select count(*) from b2c_outbox where ref_id='${hid}' and kind='payment_action_required' and channel='email'`) === "4", sql(`select string_agg(dedupe_key, ',') from b2c_outbox where ref_id='${hid}'`))
  await enqueueCollectionReminders(new Date())
  ok("同じ案内は二度積まない", sql(`select count(*) from b2c_outbox where ref_id='${hid}' and kind='payment_action_required' and channel='email'`) === "4")
  ok("14日前は回収不能にできない（too_early）", (await ops({ action: "mark_uncollectible", paymentId: hid, note: "連絡がつかない" })).json?.error === "too_early")
  sql(`update b2c_payments set first_failed_at = now() - interval '15 days' where id='${hid}'`)
  ok("共有パスワード（v1）では回収不能にできない（403）", (await ops({ action: "mark_uncollectible", paymentId: hid, note: "x" }, v1Cookie)).status === 403)
  const mu = await ops({ action: "mark_uncollectible", paymentId: hid, note: "14日たっても支払がなく、メール・WhatsApp に返事が無い" })
  ok("14日の後: 運営が回収不能にできる（記録あり・自動ではしない）", mu.status === 200 && pay(h).startsWith("uncollectible") && sql(`select operator_email from b2c_order_events where order_id='${h.id}' and event='payment_uncollectible'`) === "ops-charge@example.invalid", mu.json)
  await processB2cOutbox(sandboxTransport, new Date())
  ok("回収不能の後は、まだ送っていない案内を送らない（cancelled・not_eligible）", sql(`select count(*) from b2c_outbox where ref_id='${hid}' and status='sent'`) === "0" || sql(`select count(*) from b2c_outbox where ref_id='${hid}' and status='cancelled'`) !== "0", sql(`select string_agg(status || ':' || coalesce(last_error,''), ',') from b2c_outbox where ref_id='${hid}'`))
  // 後から払った → succeeded に戻り、案内は止まる
  await stripe.paymentIntents.confirm(pay(h).split("|")[2], { payment_method: "pm_card_visa" })
  await http("POST", "/api/b2c/pay/status", { token: h.token })
  ok("回収不能の後に払われた → succeeded（決済の履歴は残る）", pay(h).startsWith("succeeded") && sql(`select count(*) from b2c_order_events where order_id='${h.id}' and event in ('charge_failed','payment_uncollectible','charge_succeeded')`) === "3")
  sql(`insert into b2c_outbox(order_id, kind, channel, dedupe_key, language, ref_id) values ('${h.id}', 'payment_action_required', 'email', 'payment_action_required:${hid}:9:email', 'ja', '${hid}')`)
  await processB2cOutbox(sandboxTransport, new Date())
  ok("支払の後の案内は送らない（not_eligible:payment_succeeded）", sql(`select status || '|' || last_error from b2c_outbox where dedupe_key='payment_action_required:${hid}:9:email'`) === "cancelled|not_eligible:payment_succeeded")
  const notice = JSON.parse(sql(`select rendered::text from b2c_outbox where ref_id='${hid}' and kind='payment_action_required' and channel='email' and status='sent' limit 1`) || "{}")
  ok("支払の案内の文面（日本語）: 額・支払のページの URL・共有しない注意", (notice.subject ?? "").includes("お支払いの手続きをお願いします") && notice.text?.includes(`/my/${h.token}/pay?lang=ja`) && notice.text?.includes("共有しないでください"), notice)

  console.log("C11 未収が上限（5件）に達したら、新しい予約を止める")
  // 試験用の未収の行（予約 a の追加の請求として 5件）。試験の後に消す
  sql(`insert into b2c_payments(order_id, kind, charge_key, amount_yen, pieces, unit_net_yen, status, scheduled_at, created_by, first_failed_at) select '${a.id}', 'extra', 'extra:${a.id}:unpaid-test-' || i, 100, 1, ${unit}, 'failed', now(), 'e2e', now() - interval '4 days' from generate_series(1, 5) i`)
  const stop = await http("POST", "/api/b2c/orders", { token: TOK, originPlaceId: TOKYO, destPlaceId: KYOTO, ...STAY, pieces: 1, pickupDate: "2026-11-10", deliveryDate: "2026-11-12", name: "止 太郎", email: "stop@example.invalid", whatsapp: "+81 90 1234 5678", language: "ja", consent: true })
  ok("未収 5件以上 → 新しい予約は 503 booking_closed", stop.status === 503 && stop.json?.error === "booking_closed", [stop.status, stop.json])
  sql(`delete from b2c_payments where charge_key like 'extra:${a.id}:unpaid-test-%'`)
  ok("未収が減れば受付を再開", (await http("POST", "/api/b2c/quote", { token: TOK, originPlaceId: TOKYO, destPlaceId: KYOTO, ...STAY, pieces: 1 })).status === 200 && Number(sql("select b2c_unpaid_count()")) < 5)

  console.log("C12 予約と実際の個数が違う → 自動で確定しない（運営が根拠を確かめる）")
  const m = await order("ja", 2)
  const cm = await confirmPickup(m, 3, "佐川の伝票で 3個を確認")
  ok("受託 3個（予約 2個）→ on_hold（pieces_mismatch）・額は 3個分", cm.status === 200 && pay(m).startsWith(`on_hold|${amountFor(unit, 3)}||pieces_mismatch`), pay(m))
  await runB2cCharges(stripe, plus(confirmedAt(m), 31))
  ok("止めている間は請求しない", (await pis(m)).length === 0)
  ok("共有パスワードでは確定できない（403）", (await ops({ action: "release_hold", paymentId: payId(m), note: "x" }, v1Cookie)).status === 403)
  const rel = await ops({ action: "release_hold", paymentId: payId(m), note: "佐川の受託の伝票で 3個を確認。同意の文のとおり同じ 1個あたりの料金" })
  await runB2cCharges(stripe, plus(confirmedAt(m), 32))
  ok("運営が確定 → 3個分を 1回請求・記録（解除した運営者と理由）", rel.status === 200 && pay(m).startsWith(`succeeded|${amountFor(unit, 3)}`) && (await paidCharges(m)).length === 1 && (await paidCharges(m))[0].amount === amountFor(unit, 3) && sql(`select override_by from b2c_payments where order_id='${m.id}'`) === "ops-charge@example.invalid", pay(m))
  const m2 = await order("en", 2)
  await confirmPickup(m2, 1, "佐川の伝票で 1個")
  ok("受託 1個（予約 2個）→ on_hold・額は 1個分（減った個数を自動で確定しない）", pay(m2).startsWith(`on_hold|${amountFor(unit, 1)}||pieces_mismatch`))
  await ops({ action: "release_hold", paymentId: payId(m2), note: "ホテルに確認、1個だけ預けた" })
  await runB2cCharges(stripe, plus(confirmedAt(m2), 31))
  ok("確定 → 1個分を請求", pay(m2).startsWith(`succeeded|${amountFor(unit, 1)}`) && (await paidCharges(m2))[0]?.amount === amountFor(unit, 1))
  const tr = await order("ja", 2)
  await confirmPickup(tr, 2)
  sql(`update shipments set tracking_numbers='["111","222","333"]'::jsonb where b2c_order_id='${tr.id}'`)
  await runB2cCharges(stripe, plus(confirmedAt(tr), 31))
  ok("佐川の追跡と矛盾（追跡番号 3つ・受託 2個）→ 自動の請求を止める（on_hold・PaymentIntent 0）", pay(tr).startsWith("on_hold") && pay(tr).endsWith("tracking_piece_mismatch") && (await pis(tr)).length === 0, pay(tr))
  const cn = await ops({ action: "cancel_hold", paymentId: payId(tr), note: "佐川に確認中のため請求をやめる" })
  ok("運営が請求をやめる → cancelled", cn.status === 200 && pay(tr).startsWith("cancelled"))
  const nc = await order("ja", 2)
  await confirmPickup(nc, 2)
  sql(`update b2c_orders set stripe_payment_method_id=null where id='${nc.id}'`)
  await runB2cCharges(stripe, plus(confirmedAt(nc), 31))
  ok("カードが無い → on_hold（no_card）・解除できない（not_overridable）", pay(nc).endsWith("no_card") && (await ops({ action: "release_hold", paymentId: payId(nc), note: "x" })).json?.error === "not_overridable")

  console.log("C13 請求の後に分かった個数の違い（追加の請求・返金）")
  const x = await order("ja", 2)
  await confirmPickup(x, 2)
  await runB2cCharges(stripe, plus(confirmedAt(x), 31))
  const inc = await ops({ action: "correct_pieces", orderNumber: x.n, actualPieces: 3, evidenceType: "sagawa_driver", evidenceRef: "世田谷営業所 11/10 15:00 電話", note: "集荷の現場で 1個増えていた" })
  const extraAmt = amountFor(unit, 3) - amountFor(unit, 2)
  ok("増えた → 追加の請求（額はサーバーの式: 同じ 1個あたりの料金・30分後）", inc.status === 200 && inc.json.result === "extra_scheduled" && pay(x, "extra").startsWith(`scheduled|${extraAmt}`), inc.json)
  ok("運営は額を指定できない（API に額の入力が無い）", inc.json.data.amount_yen === extraAmt)
  await runB2cCharges(stripe, plus(new Date(), 31))
  ok("追加の請求は別の PaymentIntent・1回（Charge 2 = 基本＋追加）", pay(x, "extra").startsWith(`succeeded|${extraAmt}`) && (await paidCharges(x)).length === 2 && (await pis(x)).length === 2)
  ok("同じ個数をもう一度入れても何もしない（no_difference）", (await ops({ action: "correct_pieces", orderNumber: x.n, actualPieces: 3, evidenceType: "sagawa_driver", evidenceRef: "同上", note: "再確認" })).json?.result === "no_difference")
  const dec = await ops({ action: "correct_pieces", orderNumber: x.n, actualPieces: 1, evidenceType: "sagawa_tracking", evidenceRef: "追跡番号 1つ", note: "実際は 1個だった" })
  const dueRefund = amountFor(unit, 3) - amountFor(unit, 1)
  ok("減った → 自動では返金せず、返金すべき額を返す", dec.json?.result === "refund_due" && dec.json.data.amount_yen === dueRefund && sql(`select count(*) from b2c_refunds r join b2c_payments p on p.id=r.payment_id where p.order_id='${x.id}'`) === "0", dec.json)
  const baseX = payId(x), extraX = payId(x, "extra")
  ok("返金: 共有パスワードは 403", (await ops({ action: "refund", paymentId: baseX, amountYen: 100, note: "x" }, v1Cookie)).status === 403)
  ok("返金: 請求額を超える額は拒否（exceeds_refundable）", (await ops({ action: "refund", paymentId: extraX, amountYen: extraAmt + 1, note: "超える" })).json?.error === "exceeds_refundable")
  const rf1 = await ops({ action: "refund", paymentId: extraX, amountYen: extraAmt, note: "追加の 1個は誤りだった" })
  ok("追加の請求を全額返金 → refunded・Stripe の返金 1件", rf1.status === 200 && rf1.json.result === "succeeded" && pay(x, "extra").startsWith("refunded"), [rf1.json, pay(x, "extra")])
  const rest = dueRefund - extraAmt
  const [p1, p2] = await Promise.all([
    ops({ action: "refund", paymentId: baseX, amountYen: rest, note: "1個分の返金（同時に押す 1）" }),
    ops({ action: "refund", paymentId: baseX, amountYen: amountFor(unit, 2) - rest + 1, note: "同時に押す 2（合わせると超える）" }),
  ])
  ok("同時の 2つの返金: 合計が請求額を超える方は拒否（過剰な返金なし）", [p1.status, p2.status].filter((s) => s === 200).length === 1 && Number(sql(`select refunded_yen from b2c_payments where id='${baseX}'`)) <= amountFor(unit, 2), [p1.json, p2.json])
  const baseRefunds = (await stripe.refunds.list({ payment_intent: pay(x).split("|")[2] })).data
  ok("基本料金の返金は Stripe で 1件・一部返金（partially_refunded）", baseRefunds.length === 1 && pay(x).startsWith("partially_refunded"), [baseRefunds.length, pay(x)])
  ok("返金の通知を積んだ", Number(sql(`select count(*) from b2c_outbox where order_id='${x.id}' and kind='refund_issued' and channel='email'`)) >= 2)
  // 返金を Stripe に出した直後に DB の記録が失敗 → 照合で同じ返金を使う（二重の返金なし）
  const rid = (sql(`select (b2c_request_refund('${baseX}', 100, '照合の試験', 'ops-charge@example.invalid', 'e2e-cred-0000000000000005'))->>'refund_id'`))
  try {
    await executeB2cRefund(faulty({ refunds: { create: async (...args: any[]) => { const r = await stripe.refunds.create(args[0], args[1]); sql("revoke update on public.b2c_refunds from service_role; revoke execute on function public.b2c_apply_refund_result(uuid, text, text, text) from service_role"); return r } } }), rid)
  } finally {
    restoreGrants()
    sql("grant execute on function public.b2c_apply_refund_result(uuid, text, text, text) to service_role")
  }
  const before = (await stripe.refunds.list({ payment_intent: pay(x).split("|")[2] })).data.length
  await reconcileB2cRefunds(stripe, new Date(Date.now() + 120_000))
  ok("返金の記録に失敗 → 照合で同じ返金を使う（Stripe の返金は増えない）", (await stripe.refunds.list({ payment_intent: pay(x).split("|")[2] })).data.length === before && sql(`select status from b2c_refunds where id='${rid}'`) === "succeeded", [before, sql(`select status || '|' || coalesce(stripe_refund_id,'') from b2c_refunds where id='${rid}'`)])

  console.log("C14 運営の画面・権限")
  const todo = await http("GET", "/api/b2c/ops/payments", undefined, v1Cookie)
  ok("要対応の一覧（運営のログインで見られる）: 止めた請求・未収・通知", todo.status === 200 && Array.isArray(todo.json.todo.heldCharges) && Array.isArray(todo.json.todo.unpaid) && Array.isArray(todo.json.todo.notifications), todo.status)
  const det = await http("GET", `/api/b2c/ops/payments?orderNumber=${x.n}`, undefined, v1Cookie)
  ok("予約の詳細: 集荷の確認・請求・返金・操作の履歴", det.status === 200 && det.json.detail.payments.length === 2 && det.json.detail.refunds.length >= 2 && det.json.detail.events.some((e: any) => e.event === "pickup_confirmed"))
  const page = await http("GET", "/operator/b2c", undefined, v1Cookie)
  // ローカルは OPERATOR_PASSWORD が無いので、既存の middleware が運営の画面を通す（本番は未設定なら 503・設定済みならログインへ）。
  // 画面のデータは API が運営のセッションを自分で確かめる（ログインなしは 401。上の C02）。
  ok("運営の画面 /operator/b2c は開ける（データは API がログインを確かめる）", page.status === 200 && (process.env.OPERATOR_PASSWORD ? (await http("GET", "/operator/b2c")).status === 307 : true))
  ok("anon は集荷の確認・請求の関数を呼べない", sqlFails(`set role anon; select b2c_confirm_pickup('${a.id}', 'x', 'x', 'other', 'x', 1, 'x')`) && sqlFails("set role anon; select * from b2c_claim_charges(now(), 1, 'x')") && sqlFails("set role authenticated; select b2c_request_refund(gen_random_uuid(), 1, 'x', 'x', 'x')"))
  ok("anon は集荷の確認の表を読めない", sqlFails("set role anon; select count(*) from b2c_pickup_confirmations") || sql("set role anon; select count(*) from b2c_pickup_confirmations") === "0")
  ok("請求済みの行は請求前の状態に戻せない（DB）", sqlFails(`update b2c_payments set status='scheduled' where id='${payId(a)}'`))
  ok("PaymentIntent は差し替えられない（DB）", sqlFails(`update b2c_payments set stripe_payment_intent_id='pi_other' where id='${payId(a)}'`))
  ok("請求を始めた後は額を変えられない（DB）", sqlFails(`update b2c_payments set amount_yen=1 where id='${payId(a)}'`))
  ok("基本料金の請求は 1予約 1行（DB）", sqlFails(`insert into b2c_payments(order_id, kind, charge_key, amount_yen, scheduled_at, created_by) values ('${a.id}', 'base', 'base:${a.id}', 100, now(), 'x')`))

  console.log("C15 本番に何もしていない")
  const acct = await stripe.balance.retrieve()
  ok("Stripe はテストモード（livemode=false）", acct.livemode === false)
  ok("外に送った通知は 0件（sandbox）", sql("select count(*) from b2c_outbox where provider in ('resend','smtp','whatsapp')") === "0")

  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { try { restoreGrants() } catch { /* */ } console.error(e); process.exit(1) })
