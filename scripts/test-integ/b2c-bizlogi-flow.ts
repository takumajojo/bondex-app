/**
 * B1 統合の検証: 旅行者の予約 → 規約の同意 → カード登録 → 確定 → **Biz-Logi で集荷依頼（模擬の Biz-Logi）** → 問い合わせ番号 →
 * 集荷の確認 → 30分の後に 1回だけ請求、と、規約の版と同意の記録（sql/079）・送信の障害・未集荷・B2C 停止の間の既存の予約。
 *
 * 本番には接続しない: 開発サーバー・Supabase は localhost だけ、Stripe は sk_test_ だけ、通知は sandbox。
 * Biz-Logi は模擬（https://mock-bizlogi.invalid。この処理の中の fetch で応答する。佐川・SG のテスト環境にも送らない）。
 * 集荷依頼の API（app/api/operator/pickup-request）はこの処理の中で呼ぶ（運営の認証は middleware の役目なので、ここでは通さない）。
 * 実行: set -a; . ./.env.local; set +a; BASE=http://localhost:3218 npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-integ/b2c-bizlogi-flow.ts
 * 前提: scripts/test-integ/seed-integrated-dev.sh（079 を含む）で作った DB。
 */
import Stripe from "stripe"
import { execFileSync } from "node:child_process"
import { NextRequest } from "next/server"

const BASE = process.env.BASE ?? "http://localhost:3218"
const SK = process.env.STRIPE_SECRET_KEY ?? ""
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(BASE) || !/^http:\/\/(localhost|127\.0\.0\.1):/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("refusing: local only")
if (!SK.startsWith("sk_test_")) throw new Error("refusing: sk_test_ only")
if (process.env.B2C_NOTIFY_LIVE === "true") throw new Error("refusing: notifications must be sandbox")

// 模擬の Biz-Logi（この処理の中だけ。開発サーバーの設定は変えない）
Object.assign(process.env, {
  BIZLOGI_BASE_URL: "https://mock-bizlogi.invalid/api",
  BIZLOGI_ENV: "production",
  BIZLOGI_CUSTOMER_ID: "mockcustomer",
  BIZLOGI_LOGIN_PASSWORD: "mock-password",
  BIZLOGI_KOKYAKU_CODE: "100000000000",
  BIZLOGI_OKURI_CODE: "N01",
  BIZLOGI_LIVE: "true",
  BONDEX_SENDER_PHONE: "03-0000-0000",
  B2C_CHARGE_LIVE: "true",
})
const tag = (xml: string, t: string) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(xml)?.[1] ?? ""
const mock = { mode: "ok" as "ok" | "issue-network-error", issues: 0, checks: 0, seq: 0, lastIssueXml: "" }
function shippingXml(body: string, okResp: boolean, number: string | null) {
  return `<?xml version="1.0" encoding="UTF-8"?><shippingResponse><printOutFlg>${tag(body, "printOutFlg")}</printOutFlg><okuriCode>N01</okuriCode><outputLevel>000</outputLevel>
<resultCode>${okResp ? "S0-0001" : "E8-0001"}</resultCode>${okResp ? `<printRequestId>P-${mock.issues}</printRequestId>` : ""}
<printDataList><printDataDetail><userManageNumber>${tag(body, "userManageNumber")}</userManageNumber><resultCodeList><resultCode>${okResp ? "S0-0001" : "E2-0004"}</resultCode></resultCodeList>
${number ? `<shippingNumberList><shippingNumber>${number}</shippingNumber></shippingNumberList>` : ""}</printDataDetail></printDataList></shippingResponse>`
}
const realFetch = globalThis.fetch
const outside: string[] = []
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith("https://mock-bizlogi.invalid/api/shipping")) {
    const body = String(init?.body ?? "")
    if (tag(body, "printOutFlg") === "1") {
      mock.issues++
      mock.lastIssueXml = body
      if (mock.mode === "issue-network-error") throw new TypeError("fetch failed (模擬: 通信断)")
      mock.seq++
      return new Response(shippingXml(body, true, String(400100000000 + mock.seq)))
    }
    mock.checks++
    return new Response(shippingXml(body, true, null))
  }
  if (url.startsWith("https://mock-bizlogi.invalid/api/riyoujisseki")) {
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><riyouJissekiResponse><customerId>mockcustomer</customerId><startDate>x</startDate><endDate>x</endDate><count>0</count><resultCode>S0-0001</resultCode></riyouJissekiResponse>`)
  }
  // 通してよい先: ローカル（開発サーバー・Supabase）・Stripe のテストモード・Google の場所の照会（読み取りだけ）
  if (/^http:\/\/(localhost|127\.0\.0\.1):/.test(url) || url.startsWith("https://api.stripe.com/") || url.startsWith("https://maps.googleapis.com/") || url.startsWith("https://places.googleapis.com/")) {
    return realFetch(input as string, init)
  }
  outside.push(url)
  throw new Error(`外部通信は禁止 (試験): ${url}`)
}) as typeof fetch

const stripe = new Stripe(SK, { maxNetworkRetries: 2 })
const TOK = "dev-hnk-local-token-0001"
let passed = 0
let failed = 0
let ipN = Math.floor(Math.random() * 60000)
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600)) }
}
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "|", "-c", q], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
const sqlFile = (path: string) => execFileSync("bash", ["-c", `docker exec -i supabase_db_supa-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < '${path}'`], { encoding: "utf8" })
async function http(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  ipN++
  const r = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", "x-real-ip": `10.8.${(ipN >> 8) % 250}.${(ipN % 250) + 1}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* html */ }
  return { status: r.status, json, text }
}
let ipC = 0
// 集荷依頼の操作は運営のハンドラーでも認可する（B2C の区間は個人のパスキーの運営者だけ・lib/operator-authz.ts）
let opCookieHeader = ""
let pickupRoute: any
async function pickupCall(body: unknown) {
  ipC++
  const req = new NextRequest("http://localhost/api/operator/pickup-request", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.7.0.${ipC % 250}`, cookie: opCookieHeader }, body: JSON.stringify(body) })
  const res = await pickupRoute.POST(req)
  return { status: res.status as number, body: (await res.json()) as Record<string, any> }
}
async function bizlogiSend(shipmentId: string) {
  const pv = await pickupCall({ action: "bizlogi_preview", shipmentId })
  if (!pv.body.ok) return { pv, send: null }
  const send = await pickupCall({ action: "bizlogi_send", shipmentId, fingerprint: pv.body.fingerprint, actor: "b1-e2e", confirmNoManual: true })
  return { pv, send }
}
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000)

async function main() {
  pickupRoute = await import("../../app/api/operator/pickup-request/route")
  const { issueOperatorSession, OPERATOR_SESSION_COOKIE } = await import("@/lib/operator-session")
  const { runB2cCharges } = await import("@/lib/b2c/charge-service")
  const { processB2cOutbox, sandboxTransport } = await import("@/lib/b2c/notify")

  // 規約の本文（今の版）を登録（公開の手順と同じ SQL）
  const reg = "/tmp/b1_bizlogi_register.sql"
  execFileSync("bash", ["-c", `npx tsx scripts/b2c-legal/register-docs.ts > ${reg} 2>/dev/null`])
  sqlFile(reg)

  const place = async (q: string) => (await http("POST", "/api/b2c/places", { token: TOK, query: q, lang: "en" })).json.candidates[0].placeId as string
  const TOKYO = await place("Keio Plaza Hotel Tokyo"), KYOTO = await place("Hotel Granvia Kyoto")
  sql(`insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('${TOKYO}', 'Keio Plaza Hotel Tokyo', 'verified', 'e2e@example.invalid', now()), ('${KYOTO}', 'Hotel Granvia Kyoto', 'verified', 'e2e@example.invalid', now()) on conflict (place_id) do update set status='verified', checked_by='e2e@example.invalid', last_verified_at=now()`)
  sql("insert into b2c_ops_days(date, max_new_bookings, max_pieces) select d::date, 500, 2000 from generate_series('2026-11-04'::date, '2026-11-30'::date, '1 day') d on conflict (date) do update set max_new_bookings=500, max_pieces=2000, closed=false")
  sql("insert into operator_passkeys(credential_id, public_key, operator_email) values ('e2e-cred-b1-000000000001', '\\x00', 'ops-b1@example.invalid') on conflict do nothing")
  const op = { cookie: `${OPERATOR_SESSION_COOKIE}=${await issueOperatorSession("e2e-cred-b1-000000000001")}` }
  opCookieHeader = op.cookie

  const STAY = { origin: { checkIn: "2026-11-15", checkOut: "2026-11-17" }, dest: { checkIn: "2026-11-17", checkOut: "2026-11-21" } }
  async function book(lang: "ja" | "en", pieces = 2) {
    const quote = (await http("POST", "/api/b2c/quote", { token: TOK, originPlaceId: TOKYO, destPlaceId: KYOTO, ...STAY, pieces })).json
    const opt = (quote.options as Array<{ pickupDate: string; earliestDelivery: string; confirmationMode: string }>).find((o) => o.pickupDate === "2026-11-17")!
    const d = await http("POST", "/api/b2c/orders", { token: TOK, originPlaceId: TOKYO, destPlaceId: KYOTO, ...STAY, pieces, pickupDate: opt.pickupDate, deliveryDate: opt.earliestDelivery, name: "B1 Test", email: "b1-e2e@example.invalid", whatsapp: "+81 90 1234 5678", language: lang, consent: true })
    const n = d.json.orderNumber as number, token = d.json.accessToken as string
    const id = sql(`select id from b2c_orders where order_number=${n}`)
    return { d, n, token, id, mode: opt.confirmationMode }
  }
  async function registerCard(o: { n: number; token: string; id: string }, pm = "pm_card_visa") {
    const s = await http("POST", "/api/b2c/card/start", { token: TOK, orderNumber: o.n, accessToken: o.token, cardConsent: true })
    await stripe.setupIntents.confirm(s.json.clientSecret.split("_secret_")[0], { payment_method: pm })
    return http("POST", "/api/b2c/card/status", { token: TOK, orderNumber: o.n, accessToken: o.token })
  }

  console.log("B01 予約（英語）→ 規約の同意の記録（予約の画面）")
  const a = await book("en")
  ok("同意なしの予約は 422 consent_required", (await http("POST", "/api/b2c/orders", { token: TOK, originPlaceId: TOKYO, destPlaceId: KYOTO, ...STAY, pieces: 2, pickupDate: "2026-11-17", deliveryDate: "2026-11-18", name: "x", email: "x@example.invalid", whatsapp: "+81 90 1234 5678", language: "en", consent: false })).json?.errors?.includes("consent_required"))
  ok("下書き 200・確認済みのホテルは即時確定の予定", a.d.status === 200 && a.mode === "instant", a.d.json)
  ok("予約の時: 規約の版・言語・日時を記録（カードの同意はまだ無い）", sql(`select terms_version||'|'||terms_lang||'|'||(terms_consented_at is not null)||'|'||coalesce(card_consent_version,'-') from b2c_orders where id='${a.id}'`) === "2026-11-phase1a-draft|en|true|-")

  console.log("B02 カード登録（後日の請求の同意）→ 確定 → 2つの同意が別々に残る・本文を引ける")
  const st = await registerCard(a)
  ok("確定・配送データ 1行（b2c）", st.json?.view?.status === "confirmed" && sql(`select count(*) from shipments where b2c_order_id='${a.id}' and channel='b2c'`) === "1", st.json)
  ok("カードの同意の版・日時を記録し、予約の時の規約の版は残ったまま", sql(`select terms_version||'|'||card_consent_version||'|'||consent_version from b2c_orders where id='${a.id}'`) === "2026-11-phase1a-draft|2026-11-phase1a-card-draft|2026-11-phase1a-draft")
  ok("予約から同意した規約の本文（英語）とカードの同意の文言を引ける・本文とハッシュが一致", sql(`select count(*) from b2c_orders o join b2c_legal_documents d on (d.version=o.terms_version and d.kind in ('terms','cancellation','tokushoho','privacy','booking_consent')) or (d.version=o.card_consent_version and d.kind='card_consent') where o.id='${a.id}' and d.lang=o.terms_lang and d.sha256=encode(sha256(convert_to(d.body,'UTF8')),'hex')`) === "6")
  ok("予約の時は請求しない（PaymentIntent 0）", (await stripe.paymentIntents.list({ customer: sql(`select stripe_customer_id from b2c_orders where id='${a.id}'`) })).data.length === 0)
  const shipA = sql(`select id from shipments where b2c_order_id='${a.id}'`)

  console.log("B03 Biz-Logi で集荷依頼（模擬）→ 受付・問い合わせ番号")
  const r1 = await bizlogiSend(shipA)
  ok("送信内容の確認（確認機能）→ 送信 → accepted", r1.pv.body.ok === true && r1.send?.body?.outcome === "accepted", [r1.pv.body, r1.send?.body])
  const reqA = sql(`select channel||'|'||state||'|'||coalesce(shipping_number,'') from pickup_requests where shipment_id='${shipA}' and state<>'void' order by created_at desc limit 1`)
  ok("集荷依頼の記録: bizlogi・accepted・問い合わせ番号あり", /^bizlogi\|accepted\|\d{12}$/.test(reqA), reqA)
  // サイズの区分（weight1）は運営の集荷依頼の経路では送らない（lib/pickup-request/leg-input.ts の weight: null）
  ok("送った電文: 個数 2・集荷日 2026-11-17・サイズの区分は送らない", tag(mock.lastIssueXml, "haisoKosu") === "2" && tag(mock.lastIssueXml, "shukaIraiShiteiDate").replace(/\D/g, "") === "20261117" && !mock.lastIssueXml.includes("<weight1>"), [tag(mock.lastIssueXml, "haisoKosu"), tag(mock.lastIssueXml, "shukaIraiShiteiDate"), tag(mock.lastIssueXml, "weight1")])
  const again = await bizlogiSend(shipA)
  ok("同じ区間に二度目は送れない（発行 1回のまま）", mock.issues === 1 && again.send?.body?.outcome !== "accepted", [mock.issues, again.pv.body?.error ?? again.send?.body])
  const num = reqA.split("|")[2]
  const ed = await http("POST", `/api/operator/shipment/${shipA}/edit`, { tracking: [num] }, op)
  ok("問い合わせ番号を区間に記録", ed.status === 200 && sql(`select tracking_numbers::text from shipments where id='${shipA}'`).includes(num), ed.json)

  console.log("B04 集荷の確認 → 30分は請求しない → 30分の後に 1回だけ請求 → 配達 → 返金")
  const customer = sql(`select stripe_customer_id from b2c_orders where id='${a.id}'`)
  sql(`update shipments set tracking_detail='[{"number":"${num}","pieceCount":2}]'::jsonb where id='${shipA}'`)
  const pk = await http("POST", "/api/b2c/ops/payments", { action: "confirm_pickup", orderNumber: a.n, evidenceType: "sagawa_tracking", evidenceRef: `問い合わせ番号 ${num}・正式な個数 2`, acceptedPieces: 2, note: "佐川のお荷物問い合わせで集荷を確認（B1）" }, op)
  ok("集荷の確認 → picked_up・請求は scheduled", pk.status === 200 && sql(`select status from b2c_payments where order_id='${a.id}'`) === "scheduled", pk.json)
  const t0 = new Date(new Date(sql(`select to_char(scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from b2c_payments where order_id='${a.id}'`)).getTime() - 30 * 60_000)
  await runB2cCharges(stripe, plus(t0, 29))
  ok("29分: 請求しない", (await stripe.paymentIntents.list({ customer })).data.length === 0)
  await Promise.all([runB2cCharges(stripe, plus(t0, 31)), runB2cCharges(stripe, plus(t0, 31)), runB2cCharges(stripe, plus(t0, 32))])
  await runB2cCharges(stripe, plus(t0, 90))
  const paid = (await stripe.charges.list({ customer })).data.filter((c) => c.paid)
  const total = Number(sql(`select total_gross_yen from b2c_orders where id='${a.id}'`))
  ok("同時に 3回動かしても請求は 1回・額は予約の控えどおり", paid.length === 1 && paid[0].amount === total, [paid.length, paid[0]?.amount, total])
  ok("請求の前の確認（079 の版）が通った: no_card_consent で止まっていない", sql(`select status||'|'||coalesce(hold_reason,'') from b2c_payments where order_id='${a.id}'`) === "succeeded|")
  const dl = await http("PATCH", "/api/shipments", { id: shipA, status: "delivered" }, op)
  ok("配達完了を記録・再び請求しない", dl.status === 200 && (await stripe.charges.list({ customer })).data.filter((c) => c.paid).length === 1, dl.json)
  const pid = sql(`select id from b2c_payments where order_id='${a.id}' and kind='base'`)
  const [rf1, rf2] = await Promise.all([
    http("POST", "/api/b2c/ops/payments", { action: "refund", paymentId: pid, amountYen: total, note: "遅延の個別判断（試験）: 原因=天候・実損あり・佐川の回答待ち" }, op),
    http("POST", "/api/b2c/ops/payments", { action: "refund", paymentId: pid, amountYen: total, note: "同じ返金の二重の操作（試験）" }, op),
  ])
  const refunds = (await stripe.refunds.list({ payment_intent: sql(`select stripe_payment_intent_id from b2c_payments where id='${pid}'`) })).data
  ok("同時の 2つの全額返金: 1つだけ通る・Stripe の返金 1件・合計は請求額以下", [rf1.status, rf2.status].filter((s) => s === 200).length === 1 && refunds.length === 1 && Number(sql(`select refunded_yen from b2c_payments where id='${pid}'`)) <= total, [rf1.status, rf2.status, refunds.length])
  ok("通った返金の理由と運営者が記録に残る（どちらの操作が通っても）", /^(遅延の個別判断|同じ返金の二重の操作).+\|.+/.test(sql(`select reason||'|'||requested_by from b2c_refunds where payment_id='${pid}'`)), sql(`select reason||'|'||requested_by from b2c_refunds where payment_id='${pid}'`))
  await processB2cOutbox(sandboxTransport, new Date())

  console.log("B05 Biz-Logi の送信の障害（通信断）→ 結果不明・自動で再送しない・Excel に切り替えない")
  const b = await book("ja")
  await registerCard(b)
  const shipB = sql(`select id from shipments where b2c_order_id='${b.id}'`)
  mock.mode = "issue-network-error"
  const before = mock.issues
  const r2 = await bizlogiSend(shipB)
  mock.mode = "ok"
  ok("通信断 → unknown（結果不明）", r2.send?.body?.outcome === "unknown" && sql(`select state from pickup_requests where shipment_id='${shipB}' order by created_at desc limit 1`) === "unknown", r2.send?.body)
  const r3 = await bizlogiSend(shipB)
  ok("結果不明の区間は送り直せない（発行は 1回のまま）", mock.issues === before + 1 && r3.send?.body?.outcome !== "accepted", [mock.issues - before, r3.pv.body?.error ?? r3.send?.body])
  const man = await pickupCall({ action: "manual_mark", shipmentId: shipB, actor: "b1-e2e", note: "Excel に切り替え（試験）" })
  ok("結果不明の区間を Excel の依頼に切り替えられない", man.status !== 200 || man.body.claimed === false, man.body)

  console.log("B06 未集荷（集荷の確認が無い）→ 請求しない")
  const c = await book("ja")
  await registerCard(c)
  const shipC = sql(`select id from shipments where b2c_order_id='${c.id}'`)
  const r4 = await bizlogiSend(shipC)
  ok("集荷依頼は受付", r4.send?.body?.outcome === "accepted", r4.send?.body)
  await runB2cCharges(stripe, plus(new Date(), 24 * 60))
  ok("集荷の確認が無い予約: 請求の行 0・PaymentIntent 0", sql(`select count(*) from b2c_payments where order_id='${c.id}'`) === "0" && (await stripe.paymentIntents.list({ customer: sql(`select stripe_customer_id from b2c_orders where id='${c.id}'`) })).data.length === 0)
  ok("集荷依頼の後は区間の日付を直接は変えられない（DB のロック・変更申請から）", (() => { try { sql(`update shipments set shipment_date=current_date where id='${shipC}'`); return false } catch { return true } })())
  // 集荷日（2026-11-17）を「今日」とした時の、未集荷のアラートの条件（lib/shipments-db.ts listPickupMisses と同じ）
  ok("集荷日になって集荷の確認が無い区間は、未集荷のアラートの対象", sql(`select count(*) from shipments where id='${shipC}' and status in ('requested','pending','issued') and shipment_date <= date '2026-11-17' and pickup_alert_sent_at is null`) === "1")

  console.log("B07 B2C の受付を止めても既存の予約は動く（同じ処理の中・スイッチ OFF）")
  const saved = { b: process.env.B2C_BOOKING_ENABLED }
  delete process.env.B2C_BOOKING_ENABLED
  try {
    const { b2cBookingEnabled } = await import("@/lib/b2c/flags")
    ok("新しい予約の受付は OFF", b2cBookingEnabled() === false)
    const numC = sql(`select shipping_number from pickup_requests where shipment_id='${shipC}' and state='accepted'`)
    await http("POST", `/api/operator/shipment/${shipC}/edit`, { tracking: [numC] }, op)
    sql(`update shipments set tracking_detail='[{"number":"${numC}","pieceCount":2}]'::jsonb where id='${shipC}'`)
    const pk2 = await http("POST", "/api/b2c/ops/payments", { action: "confirm_pickup", orderNumber: c.n, evidenceType: "sagawa_tracking", evidenceRef: `${numC}・正式な個数 2`, acceptedPieces: 2, note: "再集荷で集荷を確認（試験）" }, op)
    const t1 = new Date(new Date(sql(`select to_char(scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from b2c_payments where order_id='${c.id}'`)).getTime() - 30 * 60_000)
    await runB2cCharges(stripe, plus(t1, 31))
    ok("止めている間も、既存の予約の集荷の確認と請求は動く（再集荷の後に 1回だけ請求）", pk2.status === 200 && (await stripe.charges.list({ customer: sql(`select stripe_customer_id from b2c_orders where id='${c.id}'`) })).data.filter((x) => x.paid).length === 1, pk2.json)
  } finally {
    if (saved.b !== undefined) process.env.B2C_BOOKING_ENABLED = saved.b
  }

  console.log("B08 安全")
  ok("外に送った通知は 0件（sandbox）", sql("select count(*) from b2c_outbox where provider in ('resend','smtp','whatsapp')") === "0")
  ok("許可していない外部への通信は 0件", outside.length === 0, outside)
  ok("B2B の課金の列は B2C の区間で空のまま", sql("select count(*) from shipments where channel='b2c' and charged_at is not null") === "0")

  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
