/**
 * B2C Stage 4 の通しの試験（通知・ホテルの確認の結果・My Booking・取消・リマインド・再試行・重複の防止・B2B の分離）。
 *
 * 本番には接続しない: 開発サーバー・DB はローカルだけ、Stripe は sk_test_ だけ。
 * 通知は sandbox（B2C_NOTIFY_LIVE が無い）なので、メール・WhatsApp は外に出ず、文面は b2c_outbox.rendered に残る。
 *
 * 実行: set -a; . ./.env.local; set +a; BASE=http://localhost:3210 npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-b2c/notify_e2e.ts
 */
import Stripe from "stripe"
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { issueOperatorSession, OPERATOR_SESSION_COOKIE } from "@/lib/operator-session"
import { enqueueB2cReminders, processB2cOutbox, sandboxTransport, type B2cTransport } from "@/lib/b2c/notify"
import { listHotelContactDue } from "@/lib/shipments-db"

const BASE = process.env.BASE ?? "http://localhost:3210"
const SK = process.env.STRIPE_SECRET_KEY ?? ""
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(BASE) || !/^http:\/\/(localhost|127\.0\.0\.1):/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("refusing: local only")
if (!SK.startsWith("sk_test_")) throw new Error("refusing: sk_test_ only")
if (process.env.B2C_NOTIFY_LIVE === "true") throw new Error("refusing: B2C_NOTIFY_LIVE must be off (sandbox) for tests")
const stripe = new Stripe(SK)
const TOK = "dev-hnk-local-token-0001"
const OUT = process.env.NOTIFY_SAMPLES ?? "/tmp/b2c-notify-samples.json"
let passed = 0
let failed = 0
let ipN = Math.floor(Math.random() * 60000)
const samples: Record<string, unknown> = {}

const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400)) }
}
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-qtA", "-F", "|", "-c", q], { encoding: "utf8" }).trim()
async function http(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  ipN++
  const r = await fetch(BASE + path, {
    method, redirect: "manual",
    headers: { "Content-Type": "application/json", "x-real-ip": `10.4.${(ipN >> 8) % 250}.${(ipN % 250) + 1}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* html */ }
  return { status: r.status, json, text }
}
/** ページの「見つからない」（root の loading.tsx があるため Next は 200 で 404 の画面を返す。中身で判定する） */
const notFoundPage = (r: { status: number; text: string }) => r.status === 404 || r.text.includes("NEXT_HTTP_ERROR_FALLBACK;404")
const tickOnce = () => http("POST", "/api/b2c/cron/tick", {}, { authorization: `Bearer ${process.env.CRON_SECRET}` })
const skips: unknown[] = []
/** 定期の処理を 1回（前の実行のロックが残っていれば少し待って再実行。試験の中で順に呼ぶため） */
async function tick() {
  for (let i = 0; i < 5; i++) {
    const r = await tickOnce()
    if (r.json?.skipped !== "already running") return r
    skips.push(r.json)
    await new Promise((res) => setTimeout(res, 1000))
  }
  return tickOnce()
}

let TOKYO = "", KYOTO = "", NAHA = ""
const STAY = { origin: { checkIn: "2026-11-10", checkOut: "2026-11-12" }, dest: { checkIn: "2026-11-12", checkOut: "2026-11-15" } }
interface Ord { n: number; token: string; id: string }
async function draft(lang: "ja" | "en", dest = KYOTO, pickup = "2026-11-10", delivery = "2026-11-12", name = lang === "ja" ? "山田 花子" : "Emma Smith"): Promise<Ord> {
  const r = await http("POST", "/api/b2c/orders", { token: TOK, originPlaceId: TOKYO, destPlaceId: dest, ...STAY, pieces: 2, pickupDate: pickup, deliveryDate: delivery, name, email: `${lang}-guest@example.invalid`, whatsapp: lang === "ja" ? "+81 90 1234 5678" : "+44 7700 900123", language: lang, consent: true })
  if (r.status !== 200) throw new Error(`draft ${r.status} ${r.text.slice(0, 200)}`)
  const id = sql(`select id from b2c_orders where order_number=${r.json.orderNumber}`)
  return { n: r.json.orderNumber, token: r.json.accessToken, id }
}
async function registerCard(o: Ord, pm = "pm_card_visa") {
  const s = await http("POST", "/api/b2c/card/start", { token: TOK, orderNumber: o.n, accessToken: o.token, cardConsent: true })
  if (s.status !== 200) throw new Error(`start ${s.status} ${s.text.slice(0, 200)}`)
  await stripe.setupIntents.confirm(s.json.clientSecret.split("_secret_")[0], { payment_method: pm })
  return http("POST", "/api/b2c/card/status", { token: TOK, orderNumber: o.n, accessToken: o.token })
}
const status = (o: Ord) => sql(`select status from b2c_orders where id='${o.id}'`)
const outbox = (o: Ord) => sql(`select kind || ':' || channel || ':' || status from b2c_outbox where order_id='${o.id}' order by kind, channel`).split("\n").filter(Boolean)
const rendered = (o: Ord, kind: string, ch: string) => JSON.parse(sql(`select coalesce(rendered::text,'{}') from b2c_outbox where order_id='${o.id}' and kind='${kind}' and channel='${ch}'`) || "{}")
const ships = (o: Ord) => sql(`select coalesce(string_agg(status || '/' || coalesce(guest_language,'-'), ','), '') from shipments where b2c_order_id='${o.id}'`)

async function main() {
  const place = async (q: string) => (await http("POST", "/api/b2c/places", { token: TOK, query: q, lang: "en" })).json.candidates[0].placeId as string
  TOKYO = await place("Keio Plaza Hotel Tokyo"); KYOTO = await place("Hotel Granvia Kyoto"); NAHA = await place("Hotel Collective Naha")
  for (const [pid, nm] of [[TOKYO, "Keio Plaza Hotel Tokyo"], [KYOTO, "Hotel Granvia Kyoto"]]) {
    sql(`insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('${pid}', '${nm}', 'verified', 'e2e@example.invalid', now()) on conflict (place_id) do update set status='verified', checked_by='e2e@example.invalid', last_verified_at=now()`)
  }
  sql(`insert into b2c_facilities(place_id, name, status) values ('${NAHA}', 'Hotel Collective Naha', 'unknown') on conflict (place_id) do update set status='unknown', checked_by=null, last_verified_at=null`)
  sql("insert into b2c_ops_days(date, max_new_bookings, max_pieces) select d::date, 500, 2000 from generate_series('2026-11-04'::date, '2026-11-20'::date, '1 day') d on conflict (date) do update set max_new_bookings=500, max_pieces=2000, closed=false")
  sql("insert into operator_passkeys(credential_id, public_key, operator_email) values ('e2e-cred-0000000000000001', '\\x00', 'ops-e2e@example.invalid') on conflict do nothing")
  const v2 = await issueOperatorSession("e2e-cred-0000000000000001")
  const v1 = await issueOperatorSession()
  const opCookie = { cookie: `${OPERATOR_SESSION_COOKIE}=${v2}` }

  console.log("S01 日本語の予約・確認済みのホテル → 予約確定の通知（日本語）・配送データは確定の後だけ")
  const a = await draft("ja")
  ok("下書きの時点で配送データ・通知なし", ships(a) === "" && outbox(a).length === 0)
  await registerCard(a)
  ok("確定・配送データ 1行（言語 ja・英語の固定を修正）", status(a) === "confirmed" && ships(a) === "issued/ja", ships(a))
  ok("積まれた通知は「予約確定」のメールと WhatsApp だけ（確認待ちは無い）", outbox(a).join() === "booking_confirmed:email:pending,booking_confirmed:whatsapp:pending", outbox(a))
  const t1 = await tick()
  ok("定期の処理で送信（外には出さない sandbox）", t1.status === 200 && outbox(a).join() === "booking_confirmed:email:sent,booking_confirmed:whatsapp:sent", [t1.json, outbox(a)])
  const ea = rendered(a, "booking_confirmed", "email"), wa = rendered(a, "booking_confirmed", "whatsapp")
  samples["01_ja_booking_confirmed_email"] = ea; samples["01_ja_booking_confirmed_whatsapp"] = wa
  ok("メールは日本語: 件名・受付番号・料金・集荷の手順・My Booking のリンク（?lang=ja）", ea.subject === `【BondEx】ご予約が確定しました（受付番号 ${a.n}）` && ea.text.includes("¥10,956（税込）") && ea.text.includes("11:00 までに") && ea.text.includes(`/my/${a.token}?lang=ja`) && ea.text.includes("いまは請求されていません"), ea)
  ok("WhatsApp は日本語のテンプレート", wa.template === "bondex_b2c_booking_confirmed" && wa.language === "ja" && wa.params[0] === "山田 花子", wa)
  const sentAt = sql(`select string_agg(sent_at::text, ',' order by id) from b2c_outbox where order_id='${a.id}'`)
  await tick(); await tick()
  ok("定期の処理を何度動かしても再送しない（送信日時が変わらない・行が増えない）", sql(`select string_agg(sent_at::text, ',' order by id) from b2c_outbox where order_id='${a.id}'`) === sentAt && outbox(a).length === 2)
  await http("POST", "/api/b2c/card/status", { token: TOK, orderNumber: a.n, accessToken: a.token })
  ok("カード登録の照合を繰り返しても確定の通知は増えない", outbox(a).length === 2)

  console.log("S02 英語の予約 → 英語の通知")
  const b = await draft("en")
  await registerCard(b)
  const t2 = await tick()
  if (process.env.DEBUG_E2E) console.log("  debug tick", JSON.stringify(t2.json), outbox(b), sql(`select string_agg(to_char(next_attempt_at,'HH24:MI:SS.MS') || '/' || to_char(now(),'HH24:MI:SS.MS'), ',') from b2c_outbox where order_id='${b.id}'`))
  const eb = rendered(b, "booking_confirmed", "email"), wb = rendered(b, "booking_confirmed", "whatsapp")
  samples["02_en_booking_confirmed_email"] = eb; samples["02_en_booking_confirmed_whatsapp"] = wb
  ok("英語のメール・WhatsApp（en_US）・配送データの言語 en", eb.subject === `BondEx: Your booking is confirmed (request ${b.n})` && eb.text.includes("Leave your bags at the hotel front desk by 11:00") && wb.language === "en_US" && ships(b) === "issued/en", [eb.subject, wb.language, ships(b)])
  ok("英語の通知のホテル名は英語（Keio Plaza…・Granvia…）", eb.text.includes("Keio Plaza Hotel") && eb.text.toLowerCase().includes("granvia") && !eb.text.includes("京王プラザ"), eb.text)
  ok("英語の My Booking も英語のホテル名", (await http("GET", `/my/${b.token}`)).text.includes("Keio Plaza Hotel"))
  ok("英語の旅行者でも配送データ（佐川・ホテル向け）のホテル名は日本語", sql(`select from_hotel from shipments where b2c_order_id='${b.id}'`).includes("京王プラザ"))
  ok("英語のリンクには ?lang= を付けない（英語が既定）", eb.text.includes(`/my/${b.token}\n`) || eb.text.includes(`/my/${b.token}`) && !eb.text.includes(`/my/${b.token}?lang=ja`))

  console.log("S03 未確認のホテル → カード登録後も確認待ち（確定の通知は送らない）→ 運営が確認 → 確定の通知")
  const c = await draft("ja", NAHA, "2026-11-10", (await http("POST", "/api/b2c/quote", { token: TOK, originPlaceId: TOKYO, destPlaceId: NAHA, ...STAY, pieces: 2 })).json.options[0].earliestDelivery)
  await registerCard(c)
  ok("カード登録の後: awaiting_hotel_confirmation・配送データなし", status(c) === "awaiting_hotel_confirmation" && ships(c) === "", [status(c), ships(c)])
  ok("積まれた通知は「確認待ち」だけ（予約確定は無い）", outbox(c).join() === "awaiting_hotel:email:pending,awaiting_hotel:whatsapp:pending", outbox(c))
  await tick()
  const ec = rendered(c, "awaiting_hotel", "email")
  samples["03_ja_awaiting_hotel_email"] = ec; samples["03_ja_awaiting_hotel_whatsapp"] = rendered(c, "awaiting_hotel", "whatsapp")
  ok("確認待ちのメール: 「まだ確定していません」・期限・自動取消・料金なし。「確定しました」と書かない", ec.text.includes("まだ確定していません") && ec.text.includes("日本時間") && ec.text.includes("料金は一切かかりません") && !ec.text.includes("確定しました") && !ec.subject.includes("確定しました"), ec)
  const mc = await http("GET", `/my/${c.token}`)
  ok("My Booking: 「ホテルに確認中（まだ確定していません）」・預けないでの案内・案内のページは出さない", mc.status === 200 && mc.text.includes("ホテルに確認中") && mc.text.includes("フロントに預けないでください") && !mc.text.includes("ホテルのスタッフ向けの案内を開く"))
  const fc = await http("GET", `/my/${c.token}/frontdesk`)
  ok("フロント向けのページ: 確定前は「お荷物は預からないでください」", fc.status === 200 && fc.text.includes("お荷物は預からないでください") && fc.text.includes('data-frontdesk="inactive"'))
  const noAuth = await http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: NAHA, status: "verified", note: "電話で確認" })
  const v1Auth = await http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: NAHA, status: "verified", note: "電話で確認" }, { cookie: `${OPERATOR_SESSION_COOKIE}=${v1}` })
  ok("運営の入力: ログインなし・共有パスワード（v1）は 403", noAuth.status === 403 && v1Auth.status === 403, [noAuth.status, v1Auth.status])
  const noNote = await http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: NAHA, status: "verified" }, opCookie)
  ok("確認の方法（note）なしは 422", noNote.status === 422)
  const ver = await http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: NAHA, status: "verified", note: "電話でフロント常駐・荷物預かり可を確認（e2e）" }, opCookie)
  ok("個人のパスキー（v2）で施設を確認済みに → この予約が確定", ver.status === 200 && ver.json.confirmed.includes(c.n) && status(c) === "confirmed" && ships(c) === "issued/ja", [ver.json, status(c)])
  ok("記録: 確認した運営者と理由", sql(`select operator_email || '|' || reason from b2c_order_events where order_id='${c.id}' and event='facility_verified'`).startsWith("ops-e2e@example.invalid|電話で"))
  await tick()
  ok("ホテル確認の結果の通知（予約確定）を送信・確認待ちは 1回のまま", outbox(c).join() === "awaiting_hotel:email:sent,awaiting_hotel:whatsapp:sent,booking_confirmed:email:sent,booking_confirmed:whatsapp:sent", outbox(c))
  sql(`update b2c_facilities set status='unknown', checked_by=null, last_verified_at=null where place_id='${NAHA}'`)

  console.log("S04 直前予約: ホテルの受入 → 片方が断った → 取消と通知（請求なし）／両方受けた → 確定")
  const d = await draft("en")
  sql(`alter table b2c_orders disable trigger user; update b2c_orders set confirmation_mode='awaiting_hotel_acceptance', confirmation_due_at=now() + interval '6 hours' where id='${d.id}'; alter table b2c_orders enable trigger user;`)
  await registerCard(d)
  ok("受入の確認待ち", status(d) === "awaiting_hotel_confirmation")
  const acc1 = await http("POST", "/api/b2c/ops/hotel", { action: "acceptance", orderNumber: d.n, side: "origin", status: "accepted", note: "集荷元のフロントが了承" }, opCookie)
  ok("集荷元だけ了承 → まだ確認待ち", acc1.status === 200 && acc1.json.stillWaiting.includes(d.n) && status(d) === "awaiting_hotel_confirmation", acc1.json)
  const ref = await http("POST", "/api/b2c/ops/hotel", { action: "acceptance", orderNumber: d.n, side: "dest", status: "refused", note: "配送先のホテルが当日満室のため受けられない" }, opCookie)
  ok("配送先が断った → 取消・配送データなし", ref.status === 200 && ref.json.cancelled.includes(d.n) && status(d) === "cancelled" && ships(d) === "", [ref.json, status(d)])
  await tick()
  const ed = rendered(d, "cancelled", "email")
  samples["04_en_cancelled_hotel_refused_email"] = ed
  ok("取消の通知（英語）: ホテルが受けられない・料金なし。予約確定の通知は無い", ed.text.includes("The hotel told us it cannot hold your bags") && ed.text.includes("There is no charge") && !outbox(d).some((x) => x.startsWith("booking_confirmed")), [ed, outbox(d)])
  const d2 = await draft("ja")
  sql(`alter table b2c_orders disable trigger user; update b2c_orders set confirmation_mode='awaiting_hotel_acceptance', confirmation_due_at=now() + interval '6 hours' where id='${d2.id}'; alter table b2c_orders enable trigger user;`)
  await registerCard(d2)
  await http("POST", "/api/b2c/ops/hotel", { action: "acceptance", orderNumber: d2.n, side: "origin", status: "accepted", note: "了承" }, opCookie)
  const acc2 = await http("POST", "/api/b2c/ops/hotel", { action: "acceptance", orderNumber: d2.n, side: "dest", status: "accepted", note: "了承" }, opCookie)
  ok("両方了承 → 確定・配送データ", acc2.json.confirmed.includes(d2.n) && status(d2) === "confirmed" && ships(d2) === "issued/ja", acc2.json)

  console.log("S05 ホテルの確認の期限切れ → 自動の取消と通知")
  const e = await draft("ja", NAHA, "2026-11-10", "2026-11-13")
  await registerCard(e)
  sql(`alter table b2c_orders disable trigger user; update b2c_orders set confirmation_due_at=now() - interval '1 minute' where id='${e.id}'; alter table b2c_orders enable trigger user;`)
  const t5 = await tick()
  ok("定期の処理で取消（confirmation_timeout）", status(e) === "cancelled" && sql(`select cancel_reason from b2c_orders where id='${e.id}'`) === "confirmation_timeout" && t5.json.confirmationTimeouts >= 1, t5.json)
  const ee = rendered(e, "cancelled", "email")
  samples["05_ja_cancelled_timeout_email"] = ee
  ok("取消の通知（日本語）: 期限までに確認が取れなかった・料金なし", ee.text.includes("期限までにホテルの確認が取れなかった") && ee.text.includes("料金は一切かかりません"), ee)

  console.log("S06 カードの入力のまま 30分放置 → 自動の取消と通知")
  const f = await draft("en")
  await http("POST", "/api/b2c/card/start", { token: TOK, orderNumber: f.n, accessToken: f.token, cardConsent: true })
  sql(`alter table b2c_orders disable trigger user; update b2c_orders set updated_at = now() - interval '31 minutes' where id='${f.id}'; alter table b2c_orders enable trigger user;`)
  const t6 = await tick()
  ok("定期の処理で取消（card_timeout）・Stripe の SetupIntent も取消", status(f) === "cancelled" && sql(`select cancel_reason from b2c_orders where id='${f.id}'`) === "card_timeout" && (await stripe.setupIntents.retrieve(sql(`select stripe_setup_intent_id from b2c_orders where id='${f.id}'`))).status === "canceled", t6.json)
  samples["06_en_cancelled_card_timeout_email"] = rendered(f, "cancelled", "email")
  ok("取消の通知（英語・カードの登録が終わらなかった）", rendered(f, "cancelled", "email").text?.includes("Card registration was not completed"))

  console.log("S07 My Booking の表示（予約・配送・決済）")
  const m = await http("GET", `/my/${a.token}`)
  ok("200・確定・カード登録済みで未請求・集荷の手順・フロント向けの案内のリンク", m.status === 200 && m.text.includes("予約が確定しています") && m.text.includes("カード登録済み・まだ請求していません") && m.text.includes("11:00 までに") && m.text.includes(`/my/${a.token}/frontdesk`))
  ok("検索エンジンに載せない・リンク元に URL を渡さない", /<meta name="robots" content="noindex, nofollow, nocache"/.test(m.text) && /<meta name="referrer" content="no-referrer"/.test(m.text))
  const men = await http("GET", `/my/${b.token}`)
  ok("英語の予約は英語で表示", men.text.includes("Your booking is confirmed") && men.text.includes("Card registered — not charged yet"))
  const nf1 = await http("GET", `/my/${"x".repeat(32)}`), nf2 = await http("GET", `/my/${(await draft("en")).token}`)
  ok("無効な token・下書きの予約は「見つかりません」（予約の中身を出さない）", notFoundPage(nf1) && notFoundPage(nf2) && !nf2.text.includes("Request number"), [nf1.status, nf2.status])
  sql(`update shipments set status='picked_up' where b2c_order_id='${b.id}'`)
  ok("配送の状態の反映（集荷済み）・取消はできない", (await http("GET", `/my/${b.token}`)).text.includes("Sagawa has picked up your bags") && !(await http("GET", `/my/${b.token}`)).text.includes("Cancel this booking"))
  const fd = await http("GET", `/my/${a.token}/frontdesk`)
  ok("フロント向けの案内: 受付番号・個数・集荷日・送り状は佐川が持参", fd.text.includes(`B2C-${a.n}`) && fd.text.includes("佐川急便のドライバーが持参") && fd.text.includes('data-frontdesk="active"'))

  console.log("S08 旅行者の取消（前日 17:00 まで）")
  sql(`insert into b2c_outbox(order_id, kind, channel, dedupe_key, language) values ('${a.id}', 'reminder_eve', 'email', 'reminder_eve:${a.id}:email', 'ja')`)
  const pmId = sql(`select stripe_payment_method_id from b2c_orders where id='${a.id}'`)
  const cx = await http("POST", "/api/b2c/my/cancel", { token: a.token })
  ok("取消 → cancelled・配送データも cancelled", cx.status === 200 && cx.json.result === "cancelled" && status(a) === "cancelled" && ships(a) === "cancelled/ja", [cx.json, ships(a)])
  ok("まだ送っていないリマインドは送らない（cancelled）", outbox(a).includes("reminder_eve:email:cancelled"), outbox(a))
  ok("登録したカードは Stripe の Customer から外す", (await stripe.paymentMethods.retrieve(pmId)).customer === null)
  const cx2 = await http("POST", "/api/b2c/my/cancel", { token: a.token })
  ok("2回目は already_cancelled（取消の通知は増えない）", cx2.json.result === "already_cancelled" && outbox(a).filter((x) => x.startsWith("cancelled:")).length === 2)
  await tick()
  samples["08_ja_cancelled_guest_email"] = rendered(a, "cancelled", "email")
  ok("取消の通知（日本語・ご依頼による取消）を送信", rendered(a, "cancelled", "email").text?.includes("ご依頼により"))
  ok("My Booking: 取り消し済み・請求なし", (await http("GET", `/my/${a.token}`)).text.includes("取消のため請求はありません"))
  const late = await draft("ja")
  await registerCard(late)
  sql(`alter table b2c_orders disable trigger user; update b2c_orders set pickup_date=(now() at time zone 'Asia/Tokyo')::date, delivery_date=(now() at time zone 'Asia/Tokyo')::date + 2 where id='${late.id}'; alter table b2c_orders enable trigger user;`)
  const lx = await http("POST", "/api/b2c/my/cancel", { token: late.token })
  ok("締切の後は too_late（409）・予約は確定のまま", lx.status === 409 && lx.json.error === "too_late" && status(late) === "confirmed", lx.json)
  ok("不正な token の取消は 404", (await http("POST", "/api/b2c/my/cancel", { token: "y".repeat(32) })).status === 404)

  console.log("S09 前日・当日の集荷のリマインド（時刻を指定して実行）")
  const r1 = await draft("ja", KYOTO, "2026-11-12", "2026-11-14", "鈴木 一郎")
  // 集荷日 11/12 の予約（滞在 11/10-11/12 の中）
  await registerCard(r1)
  const r2 = await draft("en", KYOTO, "2026-11-12", "2026-11-14", "Liam Brown")
  await registerCard(r2)
  await processB2cOutbox(sandboxTransport, new Date())
  const eve = new Date("2026-11-11T09:30:00Z") // 11/11 18:30 JST
  const q1 = await enqueueB2cReminders(eve)
  const q2 = await enqueueB2cReminders(eve)
  ok("前日 18:30: 2予約 × メール・WhatsApp = 4件を積む・2回目は 0件（重複なし）", q1 >= 4 && q2 === 0, [q1, q2])
  await processB2cOutbox(sandboxTransport, eve)
  samples["09_ja_reminder_eve_email"] = rendered(r1, "reminder_eve", "email"); samples["09_en_reminder_eve_whatsapp"] = rendered(r2, "reminder_eve", "whatsapp")
  ok("前日のリマインドは取消を案内しない（18:00 は取消の締切の後）", !rendered(r1, "reminder_eve", "email").text.includes("取消") && rendered(r1, "reminder_eve", "email").text.includes("ご予約の確認:"))
  ok("前日のリマインド（日本語・英語）", rendered(r1, "reminder_eve", "email").subject === `【BondEx】明日は集荷日です（受付番号 ${r1.n}）` && rendered(r2, "reminder_eve", "whatsapp").template === "bondex_b2c_pickup_tomorrow")
  const before17 = new Date("2026-11-11T07:00:00Z") // 16:00 JST
  ok("前日の 18:00 前は積まない", (await enqueueB2cReminders(before17)) === 0)
  const morning = new Date("2026-11-11T23:30:00Z") // 11/12 08:30 JST
  await enqueueB2cReminders(morning)
  await processB2cOutbox(sandboxTransport, morning)
  samples["09_ja_reminder_day_email"] = rendered(r1, "reminder_day", "email")
  ok("当日 8:30 のリマインド（日本語）", rendered(r1, "reminder_day", "email").subject?.startsWith("【BondEx】本日は集荷日です"))
  const r3 = await draft("ja", KYOTO, "2026-11-12", "2026-11-14", "取消 太郎")
  await registerCard(r3)
  await processB2cOutbox(sandboxTransport, new Date())
  sql(`insert into b2c_outbox(order_id, kind, channel, dedupe_key, language) values ('${r3.id}', 'reminder_day', 'email', 'reminder_day:${r3.id}:email', 'ja')`)
  const lateMorning = new Date("2026-11-12T02:30:00Z") // 11:30 JST
  await processB2cOutbox(sandboxTransport, lateMorning)
  ok("11:00 を過ぎた当日のリマインドは送らない（期限切れ expired_before_send・sql/073）", sql(`select status || '|' || last_error from b2c_outbox where dedupe_key='reminder_day:${r3.id}:email'`) === "expired|expired_before_send")

  console.log("S10 送信の失敗と再試行・同時の処理での二重送信の防止・止まった送信の回復")
  const g = await draft("ja")
  await registerCard(g)
  let calls = 0
  const flaky: B2cTransport = {
    async email() { calls++; return calls <= 2 ? { ok: false, provider: "test", error: "smtp_timeout" } : { ok: true, provider: "test" } },
    async whatsapp() { return { ok: true, provider: "test" } },
  }
  const now0 = new Date()
  await processB2cOutbox(flaky, now0)
  const row1 = sql(`select status || '|' || attempts || '|' || last_error from b2c_outbox where dedupe_key='booking_confirmed:${g.id}:email'`)
  ok("1回目の失敗: pending・試行 1・理由を記録", row1 === "pending|1|smtp_timeout", row1)
  await processB2cOutbox(flaky, now0)
  ok("待ち時間（2分）の前は再試行しない", calls === 1, calls)
  await processB2cOutbox(flaky, new Date(now0.getTime() + 1 * 60_000 + 5_000))
  await processB2cOutbox(flaky, new Date(now0.getTime() + 7 * 60_000))
  ok("3回目で送信（試行 3）", sql(`select status || '|' || attempts from b2c_outbox where dedupe_key='booking_confirmed:${g.id}:email'`) === "sent|3" && calls === 3)
  const h = await draft("en")
  await registerCard(h)
  const perm: B2cTransport = { async email() { return { ok: false, provider: "test", error: "invalid_recipient", permanent: true } }, async whatsapp() { return { ok: true, provider: "test" } } }
  await processB2cOutbox(perm, new Date())
  ok("直らない失敗は failed（運営に知らせる）", sql(`select status from b2c_outbox where dedupe_key='booking_confirmed:${h.id}:email'`) === "failed")
  const k = await draft("ja")
  await registerCard(k)
  let concurrentCalls = 0
  const slow: B2cTransport = {
    async email() { concurrentCalls++; await new Promise((r) => setTimeout(r, 300)); return { ok: true, provider: "test" } },
    async whatsapp() { concurrentCalls++; await new Promise((r) => setTimeout(r, 300)); return { ok: true, provider: "test" } },
  }
  await Promise.all([processB2cOutbox(slow), processB2cOutbox(slow), processB2cOutbox(slow), processB2cOutbox(slow)])
  ok("4つの送信の処理が同時に動いても、1件の通知は 1回だけ送る", concurrentCalls === 2 && outbox(k).join() === "booking_confirmed:email:sent,booking_confirmed:whatsapp:sent", [concurrentCalls, outbox(k)])
  const st = await draft("en")
  await registerCard(st)
  sql(`update b2c_outbox set status='sending', locked_at=now() - interval '11 minutes' where order_id='${st.id}'`)
  const rec = await processB2cOutbox(sandboxTransport, new Date())
  ok("送信中のまま 10分止まった通知は再試行に戻して送る", rec.recovered >= 2 && outbox(st).every((x) => x.endsWith(":sent")), [rec, outbox(st)])
  const ticks = await Promise.all([tickOnce(), tickOnce(), tickOnce()])
  ok("定期の処理を同時に 3回呼んでも、動くのは 1つ（他は already running）", ticks.filter((x) => x.json?.skipped === "already running").length >= 1, ticks.map((x) => x.json))

  console.log("S11 B2B の分離")
  const hc = await listHotelContactDue("2026-11-08")
  ok("B2B のホテル連絡の催促に B2C の配送データを出さない", !hc.some((r) => (r as { agency?: string }).agency === "BondEx Direct"), hc.length)
  ok("B2C の配送データは代理店名 BondEx Direct・B2B の課金の列は空", sql("select count(*) from shipments where channel='b2c' and (agency <> 'BondEx Direct' or charged_at is not null or stripe_payment_intent_id is not null)") === "0")
  ok("請求・オーソリは作っていない（b2c_payments 0行）", sql("select count(*) from b2c_payments") === "0")
  ok("外に送った通知は 0件（すべて sandbox か試験の送信手段）", sql("select count(*) from b2c_outbox where provider is not null and provider not in ('sandbox','test')") === "0")

  if (skips.length) console.log("  (順の呼び出しでロックの待ちが起きた回数)", skips.length)
  writeFileSync(OUT, JSON.stringify(samples, null, 2))
  console.log(`\n通知の文面の見本: ${OUT}`)
  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
