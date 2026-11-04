/**
 * B2C の通知の送信待ち（b2c_outbox）の試験: 滞留・重要度・再試行・重複・期限切れ・結果が分からない時の照合（Stage 4 の追加）。
 * 方針: docs/b2c/B2C_NOTIFICATION_TEMPLATES.md 4章・sql/073_b2c_outbox_hardening.sql・lib/b2c/notify.ts。
 *
 * 本番には接続しない: 開発サーバー・DB はローカルだけ（ローカルの Docker のコンテナ）。データはダミーだけ。
 * 外には何も送らない: 送信手段は試験用の偽物（「相手のサービス」を真似て、届いた通知を数え、冪等キーで 1通にまとめる）。
 * DB の障害は、ローカルの DB で service_role の UPDATE の権限を一時的に外して起こす（試験の最後に必ず戻す）。
 *
 * 実行: set -a; . ./.env.local; set +a; BASE=http://localhost:3210 npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-b2c/outbox_e2e.ts
 */
import Stripe from "stripe"
import { execFileSync } from "node:child_process"
import { issueOperatorSession, OPERATOR_SESSION_COOKIE } from "@/lib/operator-session"
import { checkB2cOutboxHealth, enqueueB2cReminders, processB2cOutbox, sandboxTransport, type B2cTransport, type SendOutcome } from "@/lib/b2c/notify"
import type { OpsAlertInput } from "@/lib/ops-alert"

const BASE = process.env.BASE ?? "http://localhost:3210"
const SK = process.env.STRIPE_SECRET_KEY ?? ""
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(BASE) || !/^http:\/\/(localhost|127\.0\.0\.1):/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("refusing: local only")
if (!SK.startsWith("sk_test_")) throw new Error("refusing: sk_test_ only")
if (process.env.B2C_NOTIFY_LIVE === "true") throw new Error("refusing: B2C_NOTIFY_LIVE must be off (sandbox) for tests")
const stripe = new Stripe(SK)
const TOK = "dev-hnk-local-token-0001"
let passed = 0
let failed = 0
let ipN = Math.floor(Math.random() * 60000)
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600)) }
}
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "|", "-c", q], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
const sqlFails = (q: string) => { try { sql(q); return false } catch { return true } }
async function http(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  ipN++
  const r = await fetch(BASE + path, {
    method, redirect: "manual",
    headers: { "Content-Type": "application/json", "x-real-ip": `10.6.${(ipN >> 8) % 250}.${(ipN % 250) + 1}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* html */ }
  return { status: r.status, json, text }
}

// --- 偽の送信サービス -----------------------------------------------------------
// 「相手のサービスに届いた」通知を数える。冪等なメールは同じ冪等キーを 1通にまとめる（Resend と同じ動き）。
type Behave = { deliver: boolean; out: SendOutcome; delayMs?: number }
class FakeProvider {
  calls: Array<{ ch: string; id: string }> = []
  delivered = new Map<string, number>() // 通知ごとの、旅行者に届いた回数
  seenKeys = new Set<string>()
  constructor(public idem: { email: boolean; whatsapp: boolean }, public behave: (ch: "email" | "whatsapp", id: string) => Behave) {}
  transport(): B2cTransport {
    const self = this
    const run = async (ch: "email" | "whatsapp", id: string, key: string | null): Promise<SendOutcome> => {
      self.calls.push({ ch, id })
      const b = self.behave(ch, id)
      if (b.deliver) {
        const dedupe = key && self.idem[ch]
        if (!(dedupe && self.seenKeys.has(key!))) self.delivered.set(id, (self.delivered.get(id) ?? 0) + 1)
        if (key) self.seenKeys.add(key)
      }
      if (b.delayMs) await new Promise((r) => setTimeout(r, b.delayMs))
      return b.out
    }
    return {
      email: (_to, _s, _t, key) => run("email", key, key),
      whatsapp: (to, template, _l, params) => run("whatsapp", `${template}|${to}|${params[1]}`, null),
      idempotent: this.idem,
    }
  }
  callsFor(prefix: string) { return this.calls.filter((c) => c.id.startsWith(prefix)).length }
  deliveredFor(prefix: string) { return [...this.delivered.entries()].filter(([k]) => k.startsWith(prefix)).reduce((a, [, n]) => a + n, 0) }
  maxDeliveredPerNotification() { return Math.max(0, ...this.delivered.values()) }
}
const OK: Behave = { deliver: true, out: { ok: true, provider: "fake" } }

const alerts: OpsAlertInput[] = []
const alert = async (i: OpsAlertInput) => { alerts.push(i); return { emailSent: true, slackSent: false, errors: [] } }

/** 試験の場面ごとに、前の場面の送信待ちを片付ける（ローカルの DB だけ） */
const isolate = () => sql("update b2c_outbox set status='cancelled', locked_at=null, last_error='test_isolation' where status in ('pending','sending'); update b2c_outbox set ops_alerted_at=now() where ops_alerted_at is null; delete from b2c_ops_alert_gate;")
const st = (key: string) => sql(`select status || '|' || attempts || '|' || coalesce(last_error,'') from b2c_outbox where dedupe_key='${key}'`)
const count = (where: string) => Number(sql(`select count(*) from b2c_outbox where ${where}`))
const at = (iso: string) => new Date(iso)
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000)
const restoreGrants = () => sql("grant select, insert, update, delete on public.b2c_outbox to service_role")

let TOKYO = "", KYOTO = ""
const STAY = { origin: { checkIn: "2026-11-10", checkOut: "2026-11-12" }, dest: { checkIn: "2026-11-12", checkOut: "2026-11-15" } }
interface Ord { n: number; token: string; id: string }
async function order(lang: "ja" | "en", name: string): Promise<Ord> {
  const r = await http("POST", "/api/b2c/orders", { token: TOK, originPlaceId: TOKYO, destPlaceId: KYOTO, ...STAY, pieces: 2, pickupDate: "2026-11-12", deliveryDate: "2026-11-14", name, email: `${lang}-outbox@example.invalid`, whatsapp: lang === "ja" ? "+81 90 1234 5678" : "+44 7700 900123", language: lang, consent: true })
  if (r.status !== 200) throw new Error(`draft ${r.status} ${r.text.slice(0, 200)}`)
  const o = { n: r.json.orderNumber as number, token: r.json.accessToken as string, id: sql(`select id from b2c_orders where order_number=${r.json.orderNumber}`) }
  const s = await http("POST", "/api/b2c/card/start", { token: TOK, orderNumber: o.n, accessToken: o.token, cardConsent: true })
  if (s.status !== 200) throw new Error(`start ${s.status}`)
  await stripe.setupIntents.confirm(s.json.clientSecret.split("_secret_")[0], { payment_method: "pm_card_visa" })
  await http("POST", "/api/b2c/card/status", { token: TOK, orderNumber: o.n, accessToken: o.token })
  if (sql(`select status from b2c_orders where id='${o.id}'`) !== "confirmed") throw new Error("not confirmed")
  return o
}
/** 送信待ちの行を n 件まとめて積む（dedupe_key = prefix + 番号） */
const bulk = (o: Ord, kind: string, ch: string, prefix: string, n: number, ageMin: number) =>
  sql(`insert into b2c_outbox(order_id, kind, channel, dedupe_key, language, next_attempt_at) select '${o.id}', '${kind}', '${ch}', '${prefix}' || i, 'ja', now() - interval '${ageMin} minutes' from generate_series(1, ${n}) i`)

async function main() {
  // 前の実行の試験の行の名前をずらす（DB を作り直さずに続けて実行しても、同じ dedupe_key がぶつからないように）
  sql(`update b2c_outbox set dedupe_key = 'prev' || id || '#' || dedupe_key where dedupe_key ~ '^(idem409|backlog|blockfail|good|hang-mail|hang-wa|dbfail-mail|dbfail-wa|dbfail-smtp|prefail|stale-[a-e]|flap|stuck|stuck-rem|race):' or dedupe_key in ('ok-eve','exp-day','exp-eve','exp-conf','exp-day2')`)
  const place = async (q: string) => (await http("POST", "/api/b2c/places", { token: TOK, query: q, lang: "en" })).json.candidates[0].placeId as string
  TOKYO = await place("Keio Plaza Hotel Tokyo"); KYOTO = await place("Hotel Granvia Kyoto")
  for (const [pid, nm] of [[TOKYO, "Keio Plaza Hotel Tokyo"], [KYOTO, "Hotel Granvia Kyoto"]]) {
    sql(`insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('${pid}', '${nm}', 'verified', 'e2e@example.invalid', now()) on conflict (place_id) do update set status='verified', checked_by='e2e@example.invalid', last_verified_at=now()`)
  }
  sql("insert into b2c_ops_days(date, max_new_bookings, max_pieces) select d::date, 500, 2000 from generate_series('2026-11-04'::date, '2026-11-20'::date, '1 day') d on conflict (date) do update set max_new_bookings=500, max_pieces=2000, closed=false")
  sql("insert into operator_passkeys(credential_id, public_key, operator_email) values ('e2e-cred-0000000000000002', '\\x00', 'ops-outbox@example.invalid') on conflict do nothing")
  const P = await order("ja", "集荷 花子"), B = await order("en", "Backlog Smith"), C = await order("ja", "障害 次郎")
  await processB2cOutbox(sandboxTransport, new Date(), { alert })

  // 集荷日 11/12（JST）。前日 11/11・当日 11/12 の時刻を指定して動かす
  const DAY_0830 = at("2026-11-11T23:30:00Z") // 11/12 08:30 JST
  const EVE_1830 = at("2026-11-11T09:30:00Z") // 11/11 18:30 JST
  const NOON_BEFORE = at("2026-11-11T03:00:00Z") // 11/11 12:00 JST

  console.log("O01 重要度と期限: 古い通常の通知 300件が溜まっていても、当日のリマインドが先に送られる")
  isolate()
  bulk(B, "booking_confirmed", "email", "backlog:", 300, 180) // 3時間前から溜まっている
  const q = await enqueueB2cReminders(DAY_0830) // 当日のリマインド（P・B・C × メール・WhatsApp）
  ok("当日のリマインドを積んだ（重要度 10・期限は集荷日の 11:00 JST）", q >= 6 && sql(`select priority || '|' || to_char(expires_at at time zone 'Asia/Tokyo','MM-DD HH24:MI') from b2c_outbox where dedupe_key='reminder_day:${P.id}:email'`) === "10|11-12 11:00", sql(`select priority || '|' || expires_at from b2c_outbox where dedupe_key='reminder_day:${P.id}:email'`))
  ok("古い通知の方が予定の時刻は早い（古い順なら後ろに並ぶ状況）", sql(`select (select min(next_attempt_at) from b2c_outbox where dedupe_key like 'backlog:%') < (select next_attempt_at from b2c_outbox where dedupe_key='reminder_day:${P.id}:email')`) === "t")
  const slowOk = new FakeProvider({ email: true, whatsapp: false }, () => ({ ...OK, delayMs: 15 }))
  const r1 = await processB2cOutbox(slowOk.transport(), DAY_0830, { batch: 20, budgetMs: 700, alert })
  ok("1回目の処理（時間の上限 0.7秒）で当日のリマインド 6件はすべて送信", count(`kind='reminder_day' and status='sent' and order_id in ('${P.id}','${B.id}','${C.id}')`) === 6, r1)
  ok("1回目では古い通知 300件の一部だけ（残りは次回）・送らずに戻した行は再び待ち", count("dedupe_key like 'backlog:%' and status='sent'") < 300 && count("dedupe_key like 'backlog:%' and status='sending'") === 0, [count("dedupe_key like 'backlog:%' and status='sent'"), r1])

  console.log("O02 50件を超える滞留: 複数回の処理で確実に消化（1件 1回だけ）")
  let runs = 1
  while (count("dedupe_key like 'backlog:%' and status='pending'") > 0 && runs < 100) {
    await processB2cOutbox(slowOk.transport(), DAY_0830, { batch: 20, budgetMs: 700, alert })
    runs++
  }
  ok(`300件を ${runs}回の処理で消化・すべて sent・送信中のまま残った行なし`, count("dedupe_key like 'backlog:%' and status='sent'") === 300 && count("status='sending'") === 0, runs)
  ok("相手に届いた回数は 1件 1回（300通・重複 0）・送信の呼び出しも 300回", slowOk.deliveredFor("backlog:") === 300 && slowOk.maxDeliveredPerNotification() === 1 && slowOk.callsFor("backlog:") === 300, [slowOk.deliveredFor("backlog:"), slowOk.callsFor("backlog:")])

  console.log("O03 送信の失敗が後続を塞がない（失敗する 40件が先頭に並んでいても、後の 10件は同じ処理で送る）")
  isolate()
  bulk(B, "booking_confirmed", "email", "blockfail:", 40, 240)
  bulk(B, "booking_confirmed", "email", "good:", 10, 60)
  const mixed = new FakeProvider({ email: true, whatsapp: false }, (_ch, id) => id.startsWith("blockfail:") ? { deliver: false, out: { ok: false, provider: "fake", error: "mailbox_busy" } } : OK)
  await processB2cOutbox(mixed.transport(), NOON_BEFORE, { batch: 20, alert })
  ok("後の 10件は 1回目の処理で sent", count("dedupe_key like 'good:%' and status='sent'") === 10)
  ok("失敗した 40件は試行 1・2分後に再試行（今すぐは取らない）", count("dedupe_key like 'blockfail:%' and status='pending' and attempts=1") === 40 && count(`dedupe_key like 'blockfail:%' and next_attempt_at > '${NOON_BEFORE.toISOString()}'`) === 40)
  const c0 = mixed.callsFor("blockfail:")
  await processB2cOutbox(mixed.transport(), NOON_BEFORE, { alert })
  ok("待ち時間の前にもう一度動かしても、失敗した行は呼ばない", mixed.callsFor("blockfail:") === c0)
  alerts.length = 0
  let tt = NOON_BEFORE
  for (const m of [3, 6, 16, 61, 181]) { tt = plus(tt, m); await processB2cOutbox(mixed.transport(), tt, { alert }) }
  ok("6回失敗したら failed（それ以上は呼ばない・試行 6）", count("dedupe_key like 'blockfail:%' and status='failed' and attempts=6") === 40 && mixed.callsFor("blockfail:") === 240, [st("blockfail:1"), mixed.callsFor("blockfail:")])
  ok("運営に 1回だけ知らせる（failed 40件を 1通にまとめる）", alerts.length === 1 && alerts[0].lines.join("\n").includes("failed（40件）"), alerts.map((a) => a.subject))
  await processB2cOutbox(mixed.transport(), plus(tt, 5), { alert })
  ok("次の処理では同じ行を再び知らせない", alerts.length === 1)

  console.log("O04 送ったが相手の応答が来ない（時間切れ）: 冪等なメールは同じキーで再試行（届くのは 1通）／WhatsApp は自動で再送しない")
  isolate(); alerts.length = 0
  bulk(C, "booking_confirmed", "email", "hang-mail:", 1, 5)
  bulk(C, "booking_confirmed", "whatsapp", "hang-wa:", 1, 5)
  let hangOnce = true
  const hang = new FakeProvider({ email: true, whatsapp: false }, () => {
    if (hangOnce) return { ...OK, delayMs: 1500 } // 相手には届いたが、応答が 1.5秒来ない
    return OK
  })
  const h1 = await processB2cOutbox(hang.transport(), NOON_BEFORE, { sendTimeoutMs: 200, alert })
  ok("メール: 結果不明 → 再試行の待ち（pending・理由 uncertain:send_timeout）", st("hang-mail:1").startsWith("pending|1|uncertain:send_timeout"), [st("hang-mail:1"), h1])
  ok("WhatsApp: 結果不明 → unknown（自動で再送しない）", st("hang-wa:1").startsWith("unknown|1|uncertain:send_timeout"), st("hang-wa:1"))
  const bodyBefore = sql("select rendered::text from b2c_outbox where dedupe_key='hang-mail:1'")
  hangOnce = false
  await new Promise((r) => setTimeout(r, 1600))
  for (const m of [3, 10, 30]) await processB2cOutbox(hang.transport(), plus(NOON_BEFORE, m), { alert })
  ok("メールは同じ冪等キー・同じ文面で再送 → 送信の呼び出し 2回でも、旅行者に届いたのは 1通", st("hang-mail:1").startsWith("sent|2") && hang.callsFor("hang-mail:") === 2 && hang.deliveredFor("hang-mail:") === 1 && sql("select rendered::text from b2c_outbox where dedupe_key='hang-mail:1'") === bodyBefore, [st("hang-mail:1"), hang.callsFor("hang-mail:"), hang.deliveredFor("hang-mail:")])
  ok("WhatsApp は 1回だけ呼んだまま（二重送信なし）・unknown のまま", hang.calls.filter((c) => c.ch === "whatsapp").length === 1 && st("hang-wa:1").startsWith("unknown"))
  ok("運営への知らせ: unknown として照合を依頼（自動で再送しないと明記）", alerts.some((a) => a.lines.join("\n").includes("unknown（1件）") && a.lines.join("\n").includes("自動では再送しません")), alerts.map((a) => a.lines))

  console.log("O05 外に送った直後に DB の記録が失敗（本題）")
  isolate(); alerts.length = 0
  const dbfail = new FakeProvider({ email: true, whatsapp: false }, () => OK)
  const dbt = dbfail.transport()
  const breaking: B2cTransport = {
    idempotent: dbt.idempotent,
    // 相手に届いた直後に、DB の記録ができなくなる（ローカルの DB で service_role の UPDATE の権限を外す）
    async email(...a) { const r = await dbt.email(...a); sql("revoke update on public.b2c_outbox from service_role"); return r },
    async whatsapp(...a) { const r = await dbt.whatsapp(...a); sql("revoke update on public.b2c_outbox from service_role"); return r },
  }
  // (a) メール（冪等な送信手段: Resend と同じく同じ冪等キーを 1通にまとめる）
  bulk(C, "booking_confirmed", "email", "dbfail-mail:", 1, 5)
  let d1
  try { d1 = await processB2cOutbox(breaking, NOON_BEFORE, { alert }) } finally { restoreGrants() }
  ok("メール: 届いたが記録できなかった → 処理は止まらず unrecorded（記録を 3回試した後）", d1?.unrecorded === 1 && dbfail.deliveredFor("dbfail-mail:") === 1, d1)
  ok("行は sending のまま・送り始めの記録あり（＝送ったかもしれない印）", sql("select status || ':' || (send_started_at is not null)::text || ':' || send_idempotent::text from b2c_outbox where dedupe_key='dbfail-mail:1'") === "sending:true:true")
  await processB2cOutbox(dbfail.transport(), plus(NOON_BEFORE, 1), { alert })
  ok("10分経つまでは、止まった行に触らない（すぐ再送しない）", st("dbfail-mail:1").startsWith("sending") && dbfail.callsFor("dbfail-mail:") === 1)
  await processB2cOutbox(dbfail.transport(), plus(NOON_BEFORE, 11), { alert })
  ok("11分後の片付け → 同じ冪等キー・同じ文面で再送 → sent。呼び出しは 2回でも、旅行者に届いたのは 1通", st("dbfail-mail:1").startsWith("sent|2") && dbfail.callsFor("dbfail-mail:") === 2 && dbfail.deliveredFor("dbfail-mail:") === 1, [st("dbfail-mail:1"), dbfail.callsFor("dbfail-mail:"), dbfail.deliveredFor("dbfail-mail:")])
  // (b) WhatsApp（冪等キーが無い送信手段。SMTP だけのメールも同じ扱い）
  bulk(C, "booking_confirmed", "whatsapp", "dbfail-wa:", 1, 5)
  const T2 = plus(NOON_BEFORE, 20)
  let d2
  try { d2 = await processB2cOutbox(breaking, T2, { alert }) } finally { restoreGrants() }
  const waCalls = () => dbfail.calls.filter((c) => c.ch === "whatsapp").length
  ok("WhatsApp: 届いたが記録できなかった → unrecorded", d2?.unrecorded === 1 && waCalls() === 1, d2)
  await processB2cOutbox(dbfail.transport(), plus(T2, 11), { alert })
  await processB2cOutbox(dbfail.transport(), plus(T2, 60), { alert })
  ok("11分後の片付け → unknown（自動で再送しない）・呼び出し 1回のまま・届いたのは 1通", st("dbfail-wa:1").startsWith("unknown|1|stale_after_send_outcome_unknown") && waCalls() === 1 && dbfail.maxDeliveredPerNotification() === 1, [st("dbfail-wa:1"), waCalls()])
  ok("運営への知らせ: 届いたか分からない（照合を依頼）", alerts.some((a) => a.lines.join("\n").includes("unknown（1件）") && a.lines.join("\n").includes("stale_after_send_outcome_unknown")), alerts.map((a) => a.lines))
  // (c) SMTP だけのメール（冪等でない）も WhatsApp と同じく unknown
  const smtpLike = new FakeProvider({ email: false, whatsapp: false }, () => OK)
  const st3 = smtpLike.transport()
  bulk(C, "booking_confirmed", "email", "dbfail-smtp:", 1, 5)
  const T3 = plus(NOON_BEFORE, 100)
  try { await processB2cOutbox({ idempotent: st3.idempotent, whatsapp: st3.whatsapp, async email(...a) { const r = await st3.email(...a); sql("revoke update on public.b2c_outbox from service_role"); return r } }, T3, { alert }) } finally { restoreGrants() }
  await processB2cOutbox(smtpLike.transport(), plus(T3, 11), { alert })
  ok("SMTP だけのメール（冪等でない）: unknown・再送しない", st("dbfail-smtp:1").startsWith("unknown|1") && smtpLike.callsFor("dbfail-smtp:") === 1, st("dbfail-smtp:1"))

  console.log("O06 送る前の記録が失敗 → 外に送らない → 後で安全に再試行（1通だけ）")
  isolate(); alerts.length = 0
  bulk(C, "booking_confirmed", "email", "prefail:", 1, 5)
  const pre = new FakeProvider({ email: false, whatsapp: false }, () => OK) // 冪等でない手段でも安全なこと
  try {
    await processB2cOutbox(pre.transport(), NOON_BEFORE, { alert, afterClaim: async () => { sql("revoke update on public.b2c_outbox from service_role") } })
  } finally {
    restoreGrants()
  }
  ok("送る前の記録ができない → 外に送らない（呼び出し 0回）", pre.calls.length === 0 && sql("select status || '|' || (send_started_at is null)::text from b2c_outbox where dedupe_key='prefail:1'") === "sending|true", st("prefail:1"))
  await processB2cOutbox(pre.transport(), plus(NOON_BEFORE, 11), { alert })
  ok("11分後: 送る前に止まった行は「まだ送っていない」ので再試行 → sent・1通", st("prefail:1").startsWith("sent|1") && pre.deliveredFor("prefail:") === 1, st("prefail:1"))

  console.log("O07 送信中のまま止まった行（処理の途中で落ちた）の片付けの規則")
  isolate()
  bulk(C, "booking_confirmed", "email", "stale-a:", 1, 30) // 送る前に落ちた
  bulk(C, "booking_confirmed", "email", "stale-b:", 1, 30) // 送り始めた後に落ちた・冪等
  bulk(C, "booking_confirmed", "whatsapp", "stale-c:", 1, 30) // 送り始めた後に落ちた・冪等でない
  bulk(C, "booking_confirmed", "email", "stale-d:", 1, 30) // 冪等だが最初の送信から 24時間以上
  bulk(C, "booking_confirmed", "email", "stale-e:", 1, 30) // まだ 5分（触らない）
  const T = NOON_BEFORE.toISOString()
  sql(`update b2c_outbox set status='sending', locked_at='${T}'::timestamptz - interval '11 minutes' where dedupe_key in ('stale-a:1','stale-b:1','stale-c:1','stale-d:1');
       update b2c_outbox set status='sending', locked_at='${T}'::timestamptz - interval '5 minutes', send_started_at='${T}'::timestamptz - interval '5 minutes', send_idempotent=true where dedupe_key='stale-e:1';
       update b2c_outbox set send_started_at=locked_at, first_send_at=locked_at, send_idempotent=true where dedupe_key='stale-b:1';
       update b2c_outbox set send_started_at=locked_at, first_send_at=locked_at, send_idempotent=false where dedupe_key='stale-c:1';
       update b2c_outbox set send_started_at=locked_at, first_send_at='${T}'::timestamptz - interval '25 hours', send_idempotent=true where dedupe_key='stale-d:1';`)
  const m = JSON.parse(sql(`select b2c_outbox_maintain('${T}')::text`))
  ok("送る前に落ちた → pending（stale_before_send）", st("stale-a:1").startsWith("pending|0|stale_before_send"), st("stale-a:1"))
  ok("送り始めた後・冪等・24時間以内 → pending（同じキーで再試行）", st("stale-b:1").startsWith("pending|0|stale_after_send_idempotent_retry"), st("stale-b:1"))
  ok("送り始めた後・冪等でない → unknown（自動で再送しない）", st("stale-c:1").startsWith("unknown|0|stale_after_send_outcome_unknown"), st("stale-c:1"))
  ok("冪等でも冪等キーの期限（24時間）を過ぎた → unknown", st("stale-d:1").startsWith("unknown"), st("stale-d:1"))
  ok("まだ 10分経っていない送信中の行には触らない", st("stale-e:1").startsWith("sending"), [st("stale-e:1"), m])

  console.log("O08 期限を過ぎた通知は送らない（expired）")
  isolate(); alerts.length = 0
  const ins = (key: string, kind: string, ch = "email") => sql(`insert into b2c_outbox(order_id, kind, channel, dedupe_key, language) values ('${P.id}', '${kind}', '${ch}', '${key}', 'ja')`)
  const expP = new FakeProvider({ email: true, whatsapp: true }, () => OK)
  ins("ok-eve", "reminder_eve", "whatsapp"); ins("exp-day", "reminder_day")
  await processB2cOutbox(expP.transport(), EVE_1830, { alert }) // 前日 18:30
  ok("前日 18:30: 前日のリマインドは送信", st("ok-eve").startsWith("sent|1"))
  ok("当日のリマインドを前日に送らない（日付が違う → expired・not_eligible:date_mismatch）", st("exp-day").startsWith("expired|0|not_eligible:date_mismatch"), st("exp-day"))
  ins("exp-eve", "reminder_eve")
  await processB2cOutbox(expP.transport(), at("2026-11-11T15:30:00Z"), { alert }) // 集荷日の 00:30 JST
  ok("集荷日の 00:30 に残っていた前日のリマインドは送らない（「明日は集荷日」と誤って送らない）→ expired_before_send", st("exp-eve").startsWith("expired|0|expired_before_send"), st("exp-eve"))
  ins("exp-conf", "booking_confirmed"); ins("exp-day2", "reminder_day")
  ok("期限: 前日のリマインド＝集荷日の 0:00・当日＝11:00・予約確定＝集荷日の 11:00（JST）", sql("select string_agg(dedupe_key || '=' || to_char(expires_at at time zone 'Asia/Tokyo','MM-DD HH24:MI'), ',' order by dedupe_key) from b2c_outbox where dedupe_key in ('exp-eve','exp-day2','exp-conf')") === "exp-conf=11-12 11:00,exp-day2=11-12 11:00,exp-eve=11-12 00:00")
  await processB2cOutbox(expP.transport(), at("2026-11-12T02:30:00Z"), { alert }) // 11:30 JST
  ok("集荷日の 11:30: 当日のリマインド・予約確定の通知は送らない（expired_before_send）", st("exp-conf").startsWith("expired|0|expired_before_send") && st("exp-day2").startsWith("expired|0|expired_before_send"), [st("exp-conf"), st("exp-day2")])
  ok("期限切れの行で送信を呼んだ回数は 0（前日のリマインドの 1回だけ）", expP.calls.length === 1)
  ok("期限切れは運営に知らせる", alerts.some((a) => a.lines.join("\n").includes("expired（")), alerts.map((a) => a.subject))

  console.log("O09 冪等なメールの結果不明が続いた場合: 上限（6回）で unknown にして運営へ。旅行者に届いたのは 1通")
  isolate(); alerts.length = 0
  bulk(C, "booking_confirmed", "email", "flap:", 1, 5)
  const flap = new FakeProvider({ email: true, whatsapp: false }, () => ({ deliver: true, out: { ok: false, provider: "fake", error: "http_502", uncertain: true } }))
  let ft = NOON_BEFORE
  for (const mm of [0, 3, 6, 16, 61, 181, 300]) { ft = plus(ft, mm); await processB2cOutbox(flap.transport(), ft, { alert }) }
  ok("6回で止まり unknown・届いたのは 1通（同じ冪等キー）", st("flap:1").startsWith("unknown|6") && flap.callsFor("flap:") === 6 && flap.deliveredFor("flap:") === 1, [st("flap:1"), flap.callsFor("flap:")])

  console.log("O10 滞留の知らせ（1時間に 1回）")
  isolate(); alerts.length = 0
  bulk(C, "booking_confirmed", "email", "stuck:", 5, 30)
  bulk(P, "reminder_day", "email", "stuck-rem:", 1, 20)
  const now10 = new Date()
  const h1r = await checkB2cOutboxHealth(now10, alert)
  ok("15分以上遅れた送信待ち・遅れたリマインドを知らせる", h1r.backlogAlerted && alerts.some((a) => a.subject.includes("滞留")) && (h1r.health?.overdue_15m ?? 0) >= 5 && (h1r.health?.reminder_overdue_10m ?? 0) >= 1, h1r)
  const h2r = await checkB2cOutboxHealth(plus(now10, 30), alert)
  ok("30分後は知らせない（間引き）", !h2r.backlogAlerted && alerts.filter((a) => a.subject.includes("滞留")).length === 1)
  const h3r = await checkB2cOutboxHealth(plus(now10, 61), alert)
  ok("61分後も滞留していれば、もう一度知らせる", h3r.backlogAlerted && alerts.filter((a) => a.subject.includes("滞留")).length === 2)
  isolate()
  const h4r = await checkB2cOutboxHealth(plus(now10, 200), alert)
  ok("滞留が無ければ知らせない", !h4r.backlogAlerted)

  console.log("O11 5つの処理が同時に 100件を取り合っても、1件 1回")
  isolate()
  bulk(C, "booking_confirmed", "email", "race:", 100, 5)
  const race = new FakeProvider({ email: false, whatsapp: false }, () => ({ ...OK, delayMs: 5 }))
  await Promise.all([0, 1, 2, 3, 4].map(() => processB2cOutbox(race.transport(), NOON_BEFORE, { batch: 10, alert })))
  ok("100件すべて sent・呼び出し 100回・重複 0", count("dedupe_key like 'race:%' and status='sent'") === 100 && race.callsFor("race:") === 100 && race.maxDeliveredPerNotification() === 1, [count("dedupe_key like 'race:%' and status='sent'"), race.callsFor("race:")])

  console.log("O12 運営の照合（/api/b2c/ops/outbox）")
  const v2 = await issueOperatorSession("e2e-cred-0000000000000002")
  const v1 = await issueOperatorSession()
  const op = { cookie: `${OPERATOR_SESSION_COOKIE}=${v2}` }
  const unk = sql("select id from b2c_outbox where dedupe_key='hang-wa:1'")
  const unk2 = sql("select id from b2c_outbox where dedupe_key='flap:1'")
  const fail1 = sql("select id from b2c_outbox where dedupe_key='blockfail:1'")
  const exp1 = sql("select id from b2c_outbox where dedupe_key='exp-conf'")
  ok("ログインなし・共有パスワード（v1）は 403", (await http("GET", "/api/b2c/ops/outbox")).status === 403 && (await http("POST", "/api/b2c/ops/outbox", { id: Number(unk), resolution: "delivered", note: "x" }, { cookie: `${OPERATOR_SESSION_COOKIE}=${v1}` })).status === 403)
  const list = await http("GET", "/api/b2c/ops/outbox", undefined, op)
  ok("要確認の一覧に unknown・failed・expired（受付番号つき）", list.status === 200 && ["unknown", "failed", "expired"].every((s) => list.json.problems.some((p: any) => p.status === s && p.orderNumber)), list.json?.problems?.length)
  ok("理由（note）なしは 422", (await http("POST", "/api/b2c/ops/outbox", { id: Number(unk), resolution: "delivered" }, op)).status === 422)
  const r_del = await http("POST", "/api/b2c/ops/outbox", { id: Number(unk), resolution: "delivered", note: "WhatsApp の管理画面で配信済みを確認" }, op)
  ok("届いていた → sent・運営者と理由を記録", r_del.status === 200 && st("hang-wa:1").startsWith("sent") && sql(`select operator_email || '|' || event from b2c_order_events where event='notification_delivered' order by id desc limit 1`) === "ops-outbox@example.invalid|notification_delivered", [r_del.json, st("hang-wa:1")])
  ok("同じ行をもう一度 → 409（状態が違う）", (await http("POST", "/api/b2c/ops/outbox", { id: Number(unk), resolution: "delivered", note: "二回目" }, op)).status === 409)
  ok("期限切れの通知は再送できない（409）", (await http("POST", "/api/b2c/ops/outbox", { id: Number(exp1), resolution: "resend", note: "再送" }, op)).status === 409)
  isolate()
  const r_res = await http("POST", "/api/b2c/ops/outbox", { id: Number(unk2), resolution: "resend", note: "Resend のログに無い → 再送" }, op)
  const resendP = new FakeProvider({ email: true, whatsapp: false }, () => OK)
  await processB2cOutbox(resendP.transport(), NOON_BEFORE, { alert })
  ok("再送 → pending（試行 0 に戻す）→ 次の処理で sent・前と同じ冪等キー", r_res.status === 200 && st("flap:1").startsWith("sent|1") && resendP.calls.some((c) => c.id === "flap:1"), [r_res.json, st("flap:1")])
  const r_dis = await http("POST", "/api/b2c/ops/outbox", { id: Number(fail1), resolution: "dismiss", note: "電話で連絡済み" }, op)
  ok("送らないことにした → cancelled", r_dis.status === 200 && st("blockfail:1").startsWith("cancelled"))
  ok("存在しない行は 404", (await http("POST", "/api/b2c/ops/outbox", { id: 99999999, resolution: "dismiss", note: "x" }, op)).status === 404)

  console.log("O13 権限: 旅行者・ログインした利用者の鍵では送信待ちの関数を呼べない")
  ok("anon は b2c_outbox_claim を呼べない", sqlFails("set role anon; select count(*) from b2c_outbox_claim(now(), 1)"))
  ok("authenticated は b2c_outbox_maintain を呼べない", sqlFails("set role authenticated; select b2c_outbox_maintain(now())"))
  ok("anon は運営への知らせの間引きの表に触れない", sqlFails("set role anon; insert into b2c_ops_alert_gate values ('x', now())"))

  console.log("O14 定期の処理（/api/b2c/cron/tick）: 結果に滞留・期限切れ・結果不明の数を返す")
  isolate()
  const t = await http("POST", "/api/b2c/cron/tick", {}, { authorization: `Bearer ${process.env.CRON_SECRET}` })
  ok("200・errors なし・outbox に batches / expired / unknown / health", t.status === 200 && Array.isArray(t.json.errors) && t.json.errors.length === 0 && typeof t.json.outbox.expired === "number" && typeof t.json.outbox.unknown === "number" && t.json.outbox.health?.health?.pending_total !== undefined, t.json)

  console.log("O16 Resend の 409 invalid_idempotent_request（同じキーが違う内容で使用済み）→ 自動で再送せず unknown")
  isolate(); alerts.length = 0
  bulk(C, "booking_confirmed", "email", "idem409:", 1, 5)
  const p409 = new FakeProvider({ email: true, whatsapp: false }, () => ({ deliver: false, out: { ok: false, provider: "fake", error: "resend 409 invalid_idempotent_request", uncertain: true, noAutoRetry: true } }))
  await processB2cOutbox(p409.transport(), NOON_BEFORE, { alert })
  await processB2cOutbox(p409.transport(), plus(NOON_BEFORE, 30), { alert })
  ok("冪等な手段でも 409 invalid_idempotent_request は unknown・呼び出し 1回", st("idem409:1").startsWith("unknown|1|uncertain:resend 409 invalid_idempotent_request") && p409.callsFor("idem409:") === 1, st("idem409:1"))

  console.log("O15 外部への送信")
  ok("外に送った通知は 0件（試験は偽の送信手段・sandbox だけ）", sql("select count(*) from b2c_outbox where provider is not null and provider not in ('sandbox','test','fake','email','whatsapp')") === "0" && sql("select count(*) from b2c_outbox where provider in ('resend','smtp')") === "0")
  ok("service_role の UPDATE の権限は戻っている", sql("select has_table_privilege('service_role', 'public.b2c_outbox', 'UPDATE')") === "t")

  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { try { restoreGrants() } catch { /* */ } console.error(e); process.exit(1) })
