/**
 * 2026-11-06 監査 B-04・B-05（sql/082 と lib/b2c/charge-service.ts の b2cCancelPending）の通しの試験。
 * 取消の申請中は、定期の処理・照合・運営の再試行・支払のページ・回収の案内のどこからも請求しない／申請の却下・取り下げの後に
 * 運営が解除すると 1回だけ請求／追跡が先に集荷済み・配達済みにした区間も運営が確認でき、追跡だけでは請求しない。
 * 下は charge_e2e.ts と同じ道具（ローカルの DB・開発サーバー・Stripe テストモードだけ）。
 *
 * （以下 charge_e2e.ts の説明）B2C Stage 5 の通しの試験: 集荷の確認 → 30分の猶予 → 請求（Stripe のテストモード）・二重請求の防止・失敗と回収・
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
import { loadB2cTodo } from "@/lib/b2c/payment-ops"
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
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000)
let opCookie: Record<string, string> = {}
const ops = (body: Record<string, unknown>, h = opCookie) => http("POST", "/api/b2c/ops/payments", body, h)
const confirmPickup = (o: Ord, accepted = 2, note = "佐川の追跡で集荷済みを確認（e2e）") => ops({ action: "confirm_pickup", orderNumber: o.n, evidenceType: "sagawa_tracking", evidenceRef: "e2e-tracking-0001", acceptedPieces: accepted, note })
/** 集荷の確認の時刻（DB の scheduled_at の 30分前） */
const confirmedAt = (o: Ord) => new Date(new Date(sql(`select to_char(scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from b2c_payments where order_id='${o.id}' and kind='base'`)).getTime() - 30 * 60_000)
async function main() {
  const place = async (q: string) => (await http("POST", "/api/b2c/places", { token: TOK, query: q, lang: "en" })).json.candidates[0].placeId as string
  TOKYO = await place("Keio Plaza Hotel Tokyo"); KYOTO = await place("Hotel Granvia Kyoto")
  for (const [pid, nm] of [[TOKYO, "Keio Plaza Hotel Tokyo"], [KYOTO, "Hotel Granvia Kyoto"]]) {
    sql(`insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('${pid}', '${nm}', 'verified', 'e2e@example.invalid', now()) on conflict (place_id) do update set status='verified', checked_by='e2e@example.invalid', last_verified_at=now()`)
  }
  sql("insert into b2c_ops_days(date, max_new_bookings, max_pieces) select d::date, 500, 2000 from generate_series('2026-11-04'::date, '2026-11-20'::date, '1 day') d on conflict (date) do update set max_new_bookings=500, max_pieces=2000, closed=false")
  sql("insert into operator_passkeys(credential_id, public_key, operator_email) values ('e2e-cred-0000000000000005', '\\x00', 'ops-charge@example.invalid') on conflict do nothing")
  opCookie = { cookie: `${OPERATOR_SESSION_COOKIE}=${await issueOperatorSession("e2e-cred-0000000000000005")}` }

  const ship = (o: Ord) => sql(`select id from shipments where b2c_order_id='${o.id}'`)
  const fileCancel = (o: Ord) => sql(`insert into shipment_change_requests(shipment_id, booking_id, leg_index, requested_by, kind, stage, reason) select id, booking_id, leg_index, 'operator', 'cancel', 'requested', 'e2e 旅行者の取消の希望' from shipments where b2c_order_id='${o.id}' returning id`)
  const setStage = (crId: string, stage: string) => sql(`update shipment_change_requests set stage='${stage}' where id='${crId}'`)
  const release = (o: Ord) => ops({ action: "release_hold", paymentId: payId(o), note: "取消の申請は却下（e2e）" })
  const nPI = async (o: Ord) => (await pis(o)).length

  console.log("K01 定期の処理: 取消の申請中は請求を始めない（on_hold・cancel_pending）")
  const a = await order("ja")
  await confirmPickup(a)
  const crA = fileCancel(a)
  await runB2cCharges(stripe, plus(confirmedAt(a), 31))
  ok("on_hold・理由 cancel_pending", pay(a).startsWith("on_hold|") && pay(a).endsWith("|cancel_pending"), pay(a))
  ok("Stripe の PaymentIntent 0・成功の Charge 0", (await nPI(a)) === 0 && (await paidCharges(a)).length === 0)
  const r1 = await release(a)
  await runB2cCharges(stripe, plus(confirmedAt(a), 40))
  ok("申請が残ったまま解除しても、次の回で再び止まる（PaymentIntent 0）", r1.status === 200 && pay(a).startsWith("on_hold|") && (await nPI(a)) === 0, [r1.status, pay(a)])
  setStage(crA, "rejected")
  const r2 = await release(a)
  await runB2cCharges(stripe, plus(confirmedAt(a), 50))
  await runB2cCharges(stripe, plus(confirmedAt(a), 60))
  ok("申請の却下の後に解除 → 請求 1回（成功の Charge 1）", r2.status === 200 && pay(a).startsWith("succeeded|") && (await paidCharges(a)).length === 1, [r2.json, pay(a)])

  console.log("K02 取り下げの後も同じ（取り下げ → 解除 → 1回）")
  const b = await order("en")
  await confirmPickup(b)
  const crB = fileCancel(b)
  await runB2cCharges(stripe, plus(confirmedAt(b), 31))
  setStage(crB, "withdrawn")
  await release(b)
  await runB2cCharges(stripe, plus(confirmedAt(b), 45))
  ok("取り下げ → 解除 → 成功 1回", pay(b).startsWith("succeeded|") && (await paidCharges(b)).length === 1, pay(b))

  console.log("K03 照合: 作成の途中で止まった請求（processing のまま）も、取消の申請中は作らない")
  const c = await order("ja")
  await confirmPickup(c)
  sql(`update b2c_payments set status='processing', locked_by='crashed', locked_at=now() - interval '20 minutes' where order_id='${c.id}' and kind='base'`)
  fileCancel(c)
  await runB2cCharges(stripe, plus(confirmedAt(c), 31))
  ok("照合の後 on_hold・cancel_pending・PaymentIntent 0", pay(c).startsWith("on_hold|") && pay(c).endsWith("|cancel_pending") && (await nPI(c)) === 0, pay(c))

  console.log("K04 失敗した請求: 取消の申請中は運営の再試行・支払のページ・回収の案内のどれも動かない")
  const d = await order("en")
  await swapCard(d, "pm_card_chargeCustomerFail")
  await confirmPickup(d)
  await runB2cCharges(stripe, plus(confirmedAt(d), 31))
  ok("前提: 請求は failed", pay(d).startsWith("failed|"), pay(d))
  const piD = pay(d).split("|")[2]
  const attemptsBefore = sql(`select confirm_attempt from b2c_payments where order_id='${d.id}' and kind='base'`)
  const crD = fileCancel(d)
  const rt = await ops({ action: "retry_charge", paymentId: payId(d), note: "e2e 再試行" })
  ok("運営の再試行は拒否（cancel_pending）・状態 failed のまま・試行の番号も増えない", rt.json?.ok === false && rt.json?.error === "cancel_pending" && pay(d).startsWith("failed|") && sql(`select confirm_attempt from b2c_payments where order_id='${d.id}' and kind='base'`) === attemptsBefore, [rt.status, rt.json, pay(d)])
  const ps = await http("POST", "/api/b2c/pay/start", { token: d.token })
  ok("支払のページ: 支払の画面を出さない（checking・client_secret 無し）", ps.status === 200 && ps.json?.state === "checking" && !ps.json?.clientSecret, ps.json)
  const before = sql(`select count(*) from b2c_outbox where order_id='${d.id}' and kind='payment_action_required'`)
  sql(`update b2c_payments set first_failed_at=now() - interval '2 days' where order_id='${d.id}' and kind='base'`)
  await enqueueCollectionReminders(new Date())
  ok("回収の案内（1日後）を積まない", sql(`select count(*) from b2c_outbox where order_id='${d.id}' and kind='payment_action_required'`) === before, before)
  const pi = await stripe.paymentIntents.retrieve(piD)
  ok("Stripe: 成功の Charge 0・PaymentIntent は同じ 1つ", (await paidCharges(d)).length === 0 && (await nPI(d)) === 1 && pi.status !== "succeeded")
  setStage(crD, "rejected")
  await swapCard(d, "pm_card_visa")
  const rt2 = await ops({ action: "retry_charge", paymentId: payId(d), note: "e2e 却下の後の再試行" })
  ok("申請の却下の後は再試行できる → 成功 1回", rt2.json?.ok === true && pay(d).startsWith("succeeded|") && (await paidCharges(d)).length === 1, [rt2.json, pay(d)])
  await enqueueCollectionReminders(new Date())
  ok("支払の後は回収の案内を積まない", sql(`select count(*) from b2c_outbox where order_id='${d.id}' and kind='payment_action_required'`) === before)

  console.log("K05 追跡が先に配達済みにした区間（B-05）: 追跡だけでは請求しない・運営は確認できる・1回だけ")
  const e = await order("ja")
  sql(`update shipments set status='delivered', picked_up_at='2026-11-10T02:00:00Z' where id='${ship(e)}'`)
  await runB2cCharges(stripe, plus(new Date(), 60 * 24 * 3))
  ok("追跡だけでは請求の行 0・PaymentIntent 0", sql(`select count(*) from b2c_payments where order_id='${e.id}'`) === "0" && (await nPI(e)) === 0)
  const todo1 = await loadB2cTodo(new Date("2026-11-11T03:00:00Z"))
  ok("運営の「集荷の確認待ち」に出る", !!todo1?.pickupUnconfirmed.some((x) => x.orderNumber === e.n))
  const ce = await confirmPickup(e)
  const ce2 = await confirmPickup(e)
  ok("集荷の確認ができる・2回目は already_confirmed", ce.json?.ok === true && ce2.json?.ok === false && ce2.json?.error === "already_confirmed", [ce.json, ce2.json])
  ok("区間は delivered のまま・集荷の時刻は追跡の値", sql(`select status || '|' || to_char(picked_up_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI') from shipments where id='${ship(e)}'`) === "delivered|2026-11-10T02:00")
  await Promise.all([0, 1, 2].map((i) => runB2cCharges(stripe, plus(confirmedAt(e), 31), `race-k-${i}`)))
  await runB2cCharges(stripe, plus(confirmedAt(e), 45))
  ok("同時に 3回の定期の処理でも請求 1回", pay(e).startsWith("succeeded|") && (await paidCharges(e)).length === 1 && (await nPI(e)) === 1, pay(e))
  const todo2 = await loadB2cTodo(new Date("2026-11-11T03:00:00Z"))
  ok("請求の後は「集荷の確認待ち」から消える", !todo2?.pickupUnconfirmed.some((x) => x.orderNumber === e.n))

  console.log("K06 個数が違う・請求をやめた予約が一覧に戻らない")
  const f = await order("en")
  sql(`update shipments set status='in_transit', picked_up_at=now() where id='${ship(f)}'`)
  const cf = await confirmPickup(f, 3)
  ok("個数の違い → on_hold（pieces_mismatch）", pay(f).startsWith("on_hold|") && pay(f).endsWith("|pieces_mismatch"), [cf.json, pay(f)])
  await ops({ action: "cancel_hold", paymentId: payId(f), note: "e2e 請求をやめる" })
  const todo3 = await loadB2cTodo(new Date("2026-11-11T03:00:00Z"))
  ok("請求をやめた予約は「集荷の確認待ち」に戻らない（確認済み）", pay(f).startsWith("cancelled|") && !todo3?.pickupUnconfirmed.some((x) => x.orderNumber === f.n), pay(f))
  ok("PaymentIntent 0", (await nPI(f)) === 0)

  console.log("K07 本番に何もしていない")
  ok("Stripe はテストモード（livemode=false）", (await stripe.balance.retrieve()).livemode === false)
  ok("外に送った通知は 0件（sandbox）", sql("select count(*) from b2c_outbox where provider in ('resend','smtp','whatsapp')") === "0")
  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { try { restoreGrants() } catch { /* */ } console.error(e); process.exit(1) })
