/**
 * Stage 6: B2C の全工程の通しの試験（統合ブランチ = B2C ＋ Biz-Logi ＋ 最新 main）。
 * 予約 → ホテル確認 → 佐川への集荷依頼（Phase 1A は佐川指定の Excel・運営画面で「依頼済み」を記録）→ 問い合わせ番号 →
 * 前日・当日のリマインド → 集荷の確認 → 30分の後に Stripe で 1回だけ請求 → 配達完了 → 返金、
 * と、集荷依頼の後の取消（取消申請）・締切（18:30）・B2B の課金に入らないこと。
 *
 * 本番には接続しない: 開発サーバー・Supabase は localhost だけ、Stripe は sk_test_ だけ。通知は sandbox（外に送らない）。
 * Biz-Logi には送らない（Excel の記録だけ）。DB は scripts/test-integ/seed-integrated-dev.sh で作った統合版。
 * 実行: set -a; . ./.env.local; set +a; BASE=http://localhost:3216 npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-integ/b2c-fullflow.ts
 */
import Stripe from "stripe"
import { execFileSync } from "node:child_process"
import { issueOperatorSession, OPERATOR_SESSION_COOKIE } from "@/lib/operator-session"
import { enqueueB2cReminders, processB2cOutbox, sandboxTransport } from "@/lib/b2c/notify"
import { runB2cCharges } from "@/lib/b2c/charge-service"
import { D, T } from "../test-b2c/dates/test-dates" // 試験の日付を実際の今日から見て有効な週へ（7日の倍数・時計はずらさない）

const BASE = process.env.BASE ?? "http://localhost:3216"
const SK = process.env.STRIPE_SECRET_KEY ?? ""
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(BASE) || !/^http:\/\/(localhost|127\.0\.0\.1):/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("refusing: local only")
if (!SK.startsWith("sk_test_")) throw new Error("refusing: sk_test_ only")
if (process.env.B2C_NOTIFY_LIVE === "true") throw new Error("refusing: notifications must be sandbox")
if (process.env.BIZLOGI_LIVE === "true") throw new Error("refusing: Biz-Logi must not be live")
process.env.B2C_CHARGE_LIVE = "true"
const stripe = new Stripe(SK)
const TOK = "dev-hnk-local-token-0001"
let passed = 0
let failed = 0
let ipN = Math.floor(Math.random() * 60000)
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600)) }
}
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "|", "-c", q], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
async function http(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  ipN++
  const r = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", "x-real-ip": `10.9.${(ipN >> 8) % 250}.${(ipN % 250) + 1}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* html */ }
  return { status: r.status, json, text }
}
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000)

async function main() {
  const place = async (q: string) => (await http("POST", "/api/b2c/places", { token: TOK, query: q, lang: "en" })).json.candidates[0].placeId as string
  const TOKYO = await place("Keio Plaza Hotel Tokyo"), NAHA = await place("Hotel Collective Naha"), KYOTO = await place("Hotel Granvia Kyoto")
  sql(`insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('${TOKYO}', 'Keio Plaza Hotel Tokyo', 'verified', 'e2e@example.invalid', now()), ('${KYOTO}', 'Hotel Granvia Kyoto', 'verified', 'e2e@example.invalid', now()) on conflict (place_id) do update set status='verified', checked_by='e2e@example.invalid', last_verified_at=now()`)
  sql(`insert into b2c_facilities(place_id, name, status) values ('${NAHA}', 'Hotel Collective Naha', 'unknown') on conflict (place_id) do update set status='unknown', checked_by=null, last_verified_at=null`)
  sql(`insert into b2c_ops_days(date, max_new_bookings, max_pieces) select d::date, 500, 2000 from generate_series('${D("2026-11-04")}'::date, '${D("2026-11-25")}'::date, '1 day') d on conflict (date) do update set max_new_bookings=500, max_pieces=2000, closed=false`)
  sql("insert into operator_passkeys(credential_id, public_key, operator_email) values ('e2e-cred-stage6-0000000001', '\\x00', 'ops-stage6@example.invalid') on conflict do nothing")
  const op = { cookie: `${OPERATOR_SESSION_COOKIE}=${await issueOperatorSession("e2e-cred-stage6-0000000001")}` }

  console.log("F01 予約（日本語）→ 未確認のホテル → カード登録 → ホテル確認待ち（確定しない・集荷依頼の対象にならない）")
  const quote = (await http("POST", "/api/b2c/quote", { token: TOK, originPlaceId: TOKYO, destPlaceId: NAHA, origin: { checkIn: D("2026-11-14"), checkOut: D("2026-11-16") }, dest: { checkIn: D("2026-11-16"), checkOut: D("2026-11-20") }, pieces: 2 })).json
  const delivery = (quote.options as Array<{ pickupDate: string; earliestDelivery: string }>).find((o) => o.pickupDate === D("2026-11-16"))!.earliestDelivery
  const d = await http("POST", "/api/b2c/orders", { token: TOK, originPlaceId: TOKYO, destPlaceId: NAHA, origin: { checkIn: D("2026-11-14"), checkOut: D("2026-11-16") }, dest: { checkIn: D("2026-11-16"), checkOut: D("2026-11-20") }, pieces: 2, pickupDate: D("2026-11-16"), deliveryDate: delivery, name: "通し 花子", email: "fullflow@example.invalid", whatsapp: "+81 90 1234 5678", language: "ja", consent: true })
  ok("予約の下書き 200", d.status === 200, d.json)
  const n = d.json.orderNumber as number, token = d.json.accessToken as string
  const id = sql(`select id from b2c_orders where order_number=${n}`)
  const s = await http("POST", "/api/b2c/card/start", { token: TOK, orderNumber: n, accessToken: token, cardConsent: true })
  await stripe.setupIntents.confirm(s.json.clientSecret.split("_secret_")[0], { payment_method: "pm_card_visa" })
  const st = await http("POST", "/api/b2c/card/status", { token: TOK, orderNumber: n, accessToken: token })
  ok("カード登録の後: 確認待ち・配送データなし・予約時は請求なし（PaymentIntent 0）", st.json?.view?.status === "awaiting_hotel_confirmation" && sql(`select count(*) from shipments where b2c_order_id='${id}'`) === "0" && (await stripe.paymentIntents.list({ customer: sql(`select stripe_customer_id from b2c_orders where id='${id}'`) })).data.length === 0, st.json)
  const customer = sql(`select stripe_customer_id from b2c_orders where id='${id}'`)

  console.log("F02 運営がホテルを確認 → 確定 → 配送データ（B2C の区間）・確定の通知（日本語・18:30 の締切）")
  const ver = await http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: NAHA, status: "verified", note: "電話でフロント常駐・荷物預かり可を確認（stage6）" }, op)
  ok("確定・配送データ 1行（channel b2c・BondEx Direct・課金の列は空）", ver.status === 200 && sql(`select status from b2c_orders where id='${id}'`) === "confirmed" && sql(`select channel || '|' || agency || '|' || (charged_at is null)::text from shipments where b2c_order_id='${id}'`) === "b2c|BondEx Direct|true", ver.json)
  await processB2cOutbox(sandboxTransport, new Date())
  const conf = JSON.parse(sql(`select rendered::text from b2c_outbox where order_id='${id}' and kind='booking_confirmed' and channel='email'`) || "{}")
  ok("確定の通知（日本語）: 取消は集荷の前日 18:30 まで", (conf.subject ?? "").startsWith("【BondEx】ご予約が確定しました") && conf.text?.includes("18:30"), conf.text?.slice(0, 300))
  const shipId = sql(`select id from shipments where b2c_order_id='${id}'`)

  console.log("F03 佐川への集荷依頼（Phase 1A: 佐川指定の Excel で依頼 → 運営画面で「依頼済み」を記録）→ 問い合わせ番号")
  const mark = await http("POST", "/api/operator/pickup-request", { action: "manual_mark", shipmentId: shipId, actor: "stage6-ops", note: "世田谷営業所へ Excel で依頼（試験）" }, op)
  ok("Excel で依頼済みを記録（B2C の区間も集荷依頼の対象）", mark.status === 200, mark.json)
  const reqRow = sql(`select channel || '|' || state from pickup_requests where shipment_id='${shipId}'`)
  ok("集荷依頼の記録: manual・有効", reqRow.startsWith("manual|"), reqRow)
  const num = "400012345678"
  const ed = await http("POST", `/api/operator/shipment/${shipId}/edit`, { tracking: [num] }, op)
  ok("問い合わせ番号を記録（複数個口でも 1つ）", ed.status === 200 && sql(`select tracking_numbers::text from shipments where id='${shipId}'`).includes(num), [ed.status, ed.json])
  const cx = await http("POST", "/api/b2c/my/cancel", { token })
  ok("集荷依頼の後の旅行者の取消 → すぐには取り消さず取消申請（202 cancel_requested）・予約は確定のまま", cx.status === 202 && sql(`select status from b2c_orders where id='${id}'`) === "confirmed", [cx.status, cx.json])
  // 取消申請は運営が佐川に確認する。この試験では申請を取り下げた扱いにして続ける（佐川の確認の流れは統合ブランチの試験 22件で確認済み）
  const changeId = sql(`select id from shipment_change_requests where shipment_id='${shipId}' order by created_at desc limit 1`)
  const wd = await http("POST", "/api/operator/pickup-request", { action: "change_step", changeId, step: "withdraw", actor: "stage6-ops", note: "旅行者から取消の取り下げの連絡（試験）" }, op)
  ok("取消申請の取り下げ（運営の変更申請の操作）→ 予約は確定のまま", wd.status === 200 && sql(`select status from b2c_orders where id='${id}'`) === "confirmed", [wd.status, wd.json])

  console.log("F04 前日・当日のリマインド（集荷依頼済み・確定のまま）")
  await enqueueB2cReminders(new Date(T("2026-11-15T09:30:00Z"))) // 11/15 18:30 JST
  await processB2cOutbox(sandboxTransport, new Date(T("2026-11-15T09:31:00Z")))
  await enqueueB2cReminders(new Date(T("2026-11-15T23:30:00Z"))) // 11/16 08:30 JST
  await processB2cOutbox(sandboxTransport, new Date(T("2026-11-15T23:31:00Z")))
  ok("前日・当日のリマインドを送信（sandbox）", sql(`select string_agg(kind || ':' || status, ',' order by kind) from b2c_outbox where order_id='${id}' and channel='email' and kind like 'reminder%'`) === "reminder_day:sent,reminder_eve:sent")

  console.log("F05 集荷の確認（運営・佐川の正式な個数）→ 30分は請求しない → 30分の後に 1回だけ請求")
  sql(`update shipments set tracking_detail='[{"number":"${num}","pieceCount":2}]'::jsonb where id='${shipId}'`)
  const pk = await http("POST", "/api/b2c/ops/payments", { action: "confirm_pickup", orderNumber: n, evidenceType: "sagawa_tracking", evidenceRef: `問い合わせ番号 ${num}・正式な個数 2`, acceptedPieces: 2, note: "佐川のお荷物問い合わせで集荷を確認" }, op)
  ok("集荷の確認 → 区間 picked_up・請求は 30分後", pk.status === 200 && sql(`select status from shipments where id='${shipId}'`) === "picked_up" && sql(`select status from b2c_payments where order_id='${id}'`) === "scheduled", pk.json)
  const t0 = new Date(new Date(sql(`select to_char(scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from b2c_payments where order_id='${id}'`)).getTime() - 30 * 60_000)
  await runB2cCharges(stripe, plus(t0, 29))
  ok("29分: 請求しない", (await stripe.paymentIntents.list({ customer })).data.length === 0)
  await runB2cCharges(stripe, plus(t0, 31)); await runB2cCharges(stripe, plus(t0, 45)); await runB2cCharges(stripe, plus(t0, 120))
  const charges = (await stripe.charges.list({ customer })).data.filter((c) => c.paid)
  const total = Number(sql(`select total_gross_yen from b2c_orders where id='${id}'`))
  ok("請求 1回・額は予約の控えどおり（沖縄 13,000円×2＋税）・B2B の課金の列は空のまま", charges.length === 1 && charges[0].amount === total && total === 28600 && sql(`select charged_at is null from shipments where id='${shipId}'`) === "t", [charges.length, charges[0]?.amount, total])
  await processB2cOutbox(sandboxTransport, new Date())
  ok("支払の受領の通知（日本語）", sql(`select status from b2c_outbox where order_id='${id}' and kind='payment_received' and channel='email'`) === "sent")

  console.log("F06 配達完了（運営が配達を記録）→ My Booking は配達済み・請求済み")
  const dl = await http("PATCH", "/api/shipments", { id: shipId, status: "delivered" }, op)
  ok("配達完了を記録（B2B の課金の経路は B2C を課金しない）", dl.status === 200 && sql(`select status || '|' || (charged_at is null)::text from shipments where id='${shipId}'`) === "delivered|true", [dl.status, dl.json])
  ok("Stripe の請求は 1回のまま（配達の記録で再び請求しない）", (await stripe.charges.list({ customer })).data.filter((c) => c.paid).length === 1)
  const my = await http("GET", `/my/${token}?lang=ja`)
  ok("My Booking: 配達済み・請求済み", my.text.includes('data-my-stage="delivered"') && my.text.includes('data-my-payment="charged"'))
  const myEn = await http("GET", `/my/${token}?lang=en`)
  ok("My Booking（英語の表示）", myEn.text.includes("Delivered") || myEn.text.includes("delivered"))

  console.log("F07 返金（運営・一部）→ 返金の通知")
  const pid = sql(`select id from b2c_payments where order_id='${id}' and kind='base'`)
  const rf = await http("POST", "/api/b2c/ops/payments", { action: "refund", paymentId: pid, amountYen: 1000, note: "配達の遅れのお詫び（試験）" }, op)
  ok("一部返金 → partially_refunded・Stripe の返金 1件", rf.status === 200 && sql(`select status || '|' || refunded_yen from b2c_payments where id='${pid}'`) === "partially_refunded|1000" && (await stripe.refunds.list({ payment_intent: sql(`select stripe_payment_intent_id from b2c_payments where id='${pid}'`) })).data.length === 1, rf.json)
  await processB2cOutbox(sandboxTransport, new Date())
  ok("返金の通知（日本語）", sql(`select status from b2c_outbox where order_id='${id}' and kind='refund_issued' and channel='email'`) === "sent")

  console.log("F08 締切（集荷の前日 18:30）と B2B の分離")
  ok("B2B の CSV・代理店の一覧に BondEx Direct の代理店は無い（代理店として扱わない）", sql("select count(*) from agencies where name='BondEx Direct'") === "0")
  ok("外に送った通知は 0件（sandbox）", sql("select count(*) from b2c_outbox where provider in ('resend','smtp','whatsapp')") === "0")
  ok("Biz-Logi への送信の記録は 0件（Excel の記録だけ）", sql("select count(*) from pickup_requests where channel='bizlogi'") === "0")

  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
