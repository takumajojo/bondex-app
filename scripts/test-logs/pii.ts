/**
 * ログに個人情報・秘密が出ないことの試験（2026-11-06・lib/safe-log.ts）。
 * 実際の関数・API を動かし、その間に出たログ（console の全部）を集めて、架空の個人情報・秘密が 1つも無いことを確かめる。
 * 外への送信は fetch を差し替えて止める（Resend・Slack・WhatsApp・LINE・Ship&co）。DB はローカル（.env.local）だけ。
 *   実行: set -a; . ./.env.local; set +a; npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-logs/pii.ts
 */
import assert from "node:assert/strict"
import crypto from "node:crypto"
import { NextRequest } from "next/server"

// ── 架空の個人情報・秘密（どれか 1つでもログに出たら失敗）
const NAME = "山田花子テスト"
const NAME_EN = "Hanako Testyamada"
const HOTEL = "テストグランドホテル新宿"
const ADDRESS = "東京都新宿区西新宿9-9-9"
const GUEST_EMAIL = "hanako.guest@example.invalid"
const AGENCY_EMAIL = "agency-pic@example.invalid"
const PHONE = "+819012345678"
const PHONE_LOCAL = "090-1234-5678"
const INVITE_LINK = "https://dscx.supabase.co/auth/v1/verify?token=INVITETOKEN123456&type=invite"
const MY_BOOKING_URL = "https://bondex.express/my/B2C-1/SECRETTOKENabcdef0123456789"
const TRACKING = "123456789012"
const OPS_EMAIL = "ops-log-test@jojo-test.example"
const SECRETS = [NAME, NAME_EN, HOTEL, ADDRESS, GUEST_EMAIL, AGENCY_EMAIL, PHONE, PHONE_LOCAL, "9012345678", "INVITETOKEN123456", "SECRETTOKENabcdef", TRACKING, OPS_EMAIL, "re_LOGTEST", "Bearer "]

// ── ログを全部集める
const logs: string[] = []
const real = { log: console.log, error: console.error, warn: console.warn, info: console.info }
for (const k of ["log", "error", "warn", "info"] as const) {
  console[k] = (...a: unknown[]) => {
    logs.push(a.map((x) => (typeof x === "string" ? x : x instanceof Error ? `${x.name}: ${x.message}` : JSON.stringify(x))).join(" "))
  }
}
const say = (s: string) => real.log(s)

// ── 外への送信を止める（宛先・本文を相手の応答に「こだま」させて、応答の全文がログに出ないかも確かめる）
type Mode = "ok" | "fail" | "throw" | "timeout"
const mode: Record<string, Mode> = { resend: "ok", slack: "ok", whatsapp: "ok", line: "ok", shipandco: "ok" }
const hits: Record<string, number> = {}
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  const svc = url.includes("api.resend.com") ? "resend" : url.includes("hooks.slack.com") ? "slack" : url.includes("graph.facebook.com") ? "whatsapp" : url.includes("api.line.me") ? "line" : url.includes("shipandco") ? "shipandco" : null
  if (!svc) return realFetch(input as string, init)
  hits[svc] = (hits[svc] ?? 0) + 1
  const m = mode[svc]
  const echo = `request to ${PHONE} ${GUEST_EMAIL} ${AGENCY_EMAIL} ${NAME} body=${String(init?.body ?? "").slice(0, 400)}`
  if (m === "throw") throw Object.assign(new TypeError(`fetch failed: ${echo}`), { cause: { code: "ECONNRESET" } })
  if (m === "timeout") throw Object.assign(new Error(`timeout ${echo}`), { name: "TimeoutError" })
  if (m === "fail") return new Response(JSON.stringify({ name: "validation_error", message: echo, error: { message: echo } }), { status: svc === "shipandco" ? 429 : 422 })
  if (svc === "shipandco") return new Response(JSON.stringify({ error: { code: "TRACKING_LIMIT_EXCEEDED", message: echo } }), { status: 429 })
  return new Response(JSON.stringify({ id: "fake", messages: [{ id: "wamid.fake" }] }), { status: 200 })
}) as typeof fetch

let passed = 0
let failed = 0
function noLeak(label: string, from: number) {
  const chunk = logs.slice(from)
  const leaks = SECRETS.filter((s) => chunk.some((l) => l.includes(s)))
  if (leaks.length) {
    failed++
    say(`  NG  ${label}: ログに出た → ${leaks.join(", ")}\n${chunk.map((l) => "      | " + l.slice(0, 300)).join("\n")}`)
  } else {
    passed++
    say(`  ok  ${label}（ログ ${chunk.length}行・漏れ 0）`)
  }
}
function check(label: string, cond: boolean, detail = "") {
  if (cond) {
    passed++
    say(`  ok  ${label}`)
  } else {
    failed++
    say(`  NG  ${label} ${detail}`)
  }
}
const safeLines = (from: number) => logs.slice(from).filter((l) => l.startsWith("[safe-log] "))
const parsed = (from: number) => safeLines(from).map((l) => JSON.parse(l.slice("[safe-log] ".length)) as Record<string, unknown>)

function baseEnv() {
  for (const k of ["MAIL_TEST_CAPTURE", "BONDEX_ENV", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SLACK_WEBHOOK_URL", "STAGING_MAIL_SEND"]) delete process.env[k]
  process.env.RESEND_API_KEY = "re_LOGTEST_fake_key"
  process.env.ALERT_EMAIL = OPS_EMAIL
  process.env.OPERATOR_EMAILS = OPS_EMAIL
}

async function main() {
  const { sendOpsAlert } = await import("@/lib/ops-alert")
  const { sendMail } = await import("@/lib/mailer")
  const { sendBookingRequestEmail } = await import("@/lib/agency-notify")
  const { b2cOpsAlert } = await import("@/lib/b2c/notify")
  const { inviteAgencyUser } = await import("@/lib/agency-contacts")
  const { shipandcoTrackingProvider } = await import("@/lib/tracking/shipandco")
  const { shipandcoDispatchProvider } = await import("@/lib/dispatch/shipandco")
  const { getSupabase } = await import("@/lib/supabase")
  const sb = getSupabase()
  assert.ok(sb, "ローカルの Supabase（.env.local）が要る")

  const piiAlert = {
    subject: `【集荷漏れの可能性】BDX-LOG-L1 ${HOTEL}（${NAME}）`,
    lines: [`代表者: ${NAME} / ${NAME_EN}`, `ホテル: ${HOTEL} ${ADDRESS}`, `連絡先: ${GUEST_EMAIL} ${PHONE}`, `秘密のリンク: ${MY_BOOKING_URL}`, `追跡: ${TRACKING}`, `招待: ${INVITE_LINK}`],
    agencyEmail: AGENCY_EMAIL,
    source: "test.pickup-miss",
    refs: ["BDX-LOG-L1"],
  }

  say("1. 運営への通知（lib/ops-alert.ts）")
  for (const [m, label] of [["ok", "送れた"], ["fail", "相手が 422（本文に宛先をこだま）"], ["throw", "通信の例外"], ["timeout", "時間切れ"]] as const) {
    baseEnv()
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T/B/LOGTEST"
    mode.resend = m
    mode.slack = m
    const from = logs.length
    const r = await sendOpsAlert(piiAlert)
    noLeak(`運営への通知・${label}`, from)
    check(`運営への通知・${label}: 戻り値の errors にも宛先・本文が無い`, !SECRETS.some((s) => r.errors.join(" ").includes(s)), JSON.stringify(r.errors))
    const p = parsed(from).find((x) => x.kind === "ops_alert")
    check(`運営への通知・${label}: 起点の ID・予約の ID・結果が残る`, !!p && p.source === "test.pickup-miss" && JSON.stringify(p.ref) === '["BDX-LOG-L1"]' && p.outcome === (m === "ok" ? "ok" : "failed"), JSON.stringify(p))
  }
  {
    for (const k of ["RESEND_API_KEY", "SLACK_WEBHOOK_URL"]) delete process.env[k]
    const from = logs.length
    await sendOpsAlert(piiAlert)
    noLeak("運営への通知・送る手段が無い（取りこぼしの記録）", from)
    const p = parsed(from).find((x) => x.kind === "ops_alert")
    check("送る手段が無い: error=config_missing で error のログに残る", p?.error === "config_missing" && p?.outcome === "failed")
  }

  say("2. メールの送信（lib/mailer.ts）")
  for (const [m, label] of [["fail", "422"], ["throw", "通信の例外"], ["timeout", "時間切れ"]] as const) {
    baseEnv()
    mode.resend = m
    const from = logs.length
    const r = await sendMail({ to: GUEST_EMAIL, subject: `【BondEx】ご予約（${NAME}）`, text: `${NAME} ${MY_BOOKING_URL}`, strict: true })
    noLeak(`メール・${label}`, from)
    check(`メール・${label}: 戻り値の error も番号・種類だけ`, !SECRETS.some((s) => String(r.error).includes(s)) && /^resend /.test(String(r.error)), String(r.error))
    check(`メール・${label}: 届いたか不明の判定は今までどおり`, m === "fail" ? r.uncertain === false : r.uncertain === true)
  }
  {
    baseEnv()
    process.env.SMTP_HOST = "127.0.0.1"
    process.env.SMTP_PORT = "1"
    process.env.SMTP_USER = "u"
    process.env.SMTP_PASS = "p"
    delete process.env.RESEND_API_KEY
    const from = logs.length
    const r = await sendMail({ to: GUEST_EMAIL, subject: "x", text: NAME, timeoutMs: 3000 })
    noLeak("メール・SMTP の接続失敗", from)
    check("SMTP: error は番号・種類だけ", /^smtp [A-Z0-9_]+$|^smtp error$/.test(String(r.error)), String(r.error))
    delete process.env.SMTP_PORT
  }
  {
    baseEnv()
    process.env.MAIL_TEST_CAPTURE = "1"
    const from = logs.length
    await sendMail({ to: GUEST_EMAIL, subject: `【BondEx】${NAME} ${HOTEL}`, text: MY_BOOKING_URL })
    noLeak("メール・記録だけ（試験・staging）", from)
  }

  say("3. 代理店の依頼の受付メール（lib/agency-notify.ts）")
  for (const m of ["ok", "fail"] as const) {
    baseEnv()
    mode.resend = m
    const from = logs.length
    const r = await sendBookingRequestEmail({
      agencyEmail: AGENCY_EMAIL, agencyName: "Log Test Agency", bookingId: "BDX-LOG-1", tourNumber: "TOUR-9", earliestShipDate: "2026-12-01", needsLabelWait: false, legCount: 1, locale: "ja",
      representative: NAME, legs: [{ legIndex: 0, shipmentDate: "2026-12-01", expectedArrival: "2026-12-02", fromHotel: HOTEL, toHotel: `${HOTEL} 京都`, suitcaseCount: 2 }],
    })
    noLeak(`代理店の依頼のメール・${m === "ok" ? "送れた" : "失敗"}`, from)
    check(`代理店の依頼のメール・${m}: 戻り値に宛先が無い`, !SECRETS.some((s) => String(r.error ?? "").includes(s)), String(r.error))
    const p = parsed(from).find((x) => x.kind === "agency_booking_request_mail")
    check(`代理店の依頼のメール・${m}: 予約の ID と結果が残る（運営の画面で追える）`, p?.outcome === (m === "ok" ? "ok" : "failed") && JSON.stringify(p?.ref) === '["BDX-LOG-1"]', JSON.stringify(p))
  }

  say("4. 代理店の招待（lib/agency-contacts.ts）")
  {
    baseEnv()
    mode.resend = "fail"
    const fakeSb = {
      auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }), generateLink: async () => ({ data: { user: { id: "u-log" }, properties: { action_link: INVITE_LINK } }, error: null }) } },
      from: () => ({ insert: async () => ({ error: null }), select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    }
    const from = logs.length
    // 型は SupabaseClient の一部だけを使う
    const r = await inviteAgencyUser(fakeSb as never, "agency-log-1", AGENCY_EMAIL, { agencyName: "Log Test Agency" })
    noLeak("招待のメールの送信失敗（招待リンクを出さない）", from)
    check("招待: 応答（画面のメッセージ）にも招待リンクが無い", !JSON.stringify(r).includes("INVITETOKEN"), JSON.stringify(r))
    check("招待: 届かなかった時の手順（もう一度招待・パスワードの再設定）を案内する", /もう一度招待|パスワードをお忘れ/.test(String(r.error)))
    const p = parsed(from).find((x) => x.kind === "agency_invite_mail")
    check("招待: 代理店の ID・結果・HTTP の番号だけが残る", p?.outcome === "failed" && p?.http === 422 && JSON.stringify(p?.ref) === '["agency-log-1"]', JSON.stringify(p))
  }

  say("5. B2C の運営への通知（試験の形・lib/b2c/notify.ts）")
  {
    baseEnv()
    delete process.env.B2C_NOTIFY_LIVE
    const from = logs.length
    await b2cOpsAlert()(piiAlert)
    noLeak("B2C の運営への通知（sandbox）", from)
  }

  say("6. Ship&co（追跡の照会・送り状）")
  {
    baseEnv()
    process.env.SHIPANDCO_API_KEY = "shipandco-fake"
    for (const m of ["ok", "fail", "throw"] as const) {
      mode.shipandco = m
      const from = logs.length
      await shipandcoTrackingProvider.fetchOne("sagawa", TRACKING)
      noLeak(`追跡の照会・${m === "throw" ? "例外" : "429"}（問い合わせ番号を出さない）`, from)
    }
    delete process.env.SHIPANDCO_API_KEY
    const from = logs.length
    await shipandcoDispatchProvider.postLabel({
      carrierId: "c", service: "s", packSize: 160, refNumber: "BDX-LOG-1", shipmentDate: "2026-12-01", deliveryTime: "", suitcaseCount: 1, productName: "luggage", live: false,
      fromAddress: { full_name: NAME, company: HOTEL, phone: PHONE, address1: ADDRESS, email: GUEST_EMAIL },
      toAddress: { full_name: NAME_EN, company: HOTEL, phone: PHONE_LOCAL, address1: ADDRESS },
    } as never)
    noLeak("送り状の作成（送るデータを出さない）", from)
  }

  say("7. 代理店への WhatsApp・LINE（lib/agency-push.ts・ローカルの DB に試験の代理店）")
  const agencyName = `LOG-TEST-${Date.now()}`
  const { data: ag, error: agErr } = await sb!.from("agencies").insert({ name: agencyName, contact_email: AGENCY_EMAIL, notify_whatsapp: PHONE, notify_line_user_id: "Uloguser0001", locale: "ja" }).select("id").single()
  assert.ok(!agErr && ag, `試験の代理店を作れない: ${agErr?.message}`)
  try {
    const { pushToAgency } = await import("@/lib/agency-push")
    process.env.WHATSAPP_CLOUD_TOKEN = "wa-fake-token"
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123"
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-fake-token"
    for (const m of ["fail", "throw"] as const) {
      mode.whatsapp = m
      mode.line = m
      const from = logs.length
      const r = await pushToAgency(agencyName, { templateName: "t", bodyParams: [NAME, HOTEL], textJa: `${NAME} ${HOTEL} ${PHONE}`, textEn: NAME_EN } as never)
      noLeak(`WhatsApp・LINE・${m === "fail" ? "相手が 4xx（本文に電話番号をこだま）" : "通信の例外"}`, from)
      check(`WhatsApp・LINE・${m}: 送れなかった（動きは今までどおり）`, r.whatsapp === false && r.line === false, JSON.stringify(r))
    }
  } finally {
    await sb!.from("agencies").delete().eq("id", (ag as { id: string }).id)
    for (const k of ["WHATSAPP_CLOUD_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "LINE_CHANNEL_ACCESS_TOKEN"]) delete process.env[k]
  }

  say("8. WhatsApp の受信と自動の返信（app/api/whatsapp/webhook）")
  {
    baseEnv()
    process.env.WHATSAPP_APP_SECRET = "wa-app-secret-test"
    process.env.WHATSAPP_CLOUD_TOKEN = "wa-fake-token"
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123"
    mode.whatsapp = "fail"
    mode.resend = "ok"
    const { POST } = await import("@/app/api/whatsapp/webhook/route")
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: PHONE.replace("+", ""), type: "text", text: { body: `${NAME} BDX-NOPE-1 ${GUEST_EMAIL}` } }] } }] }] })
    const sig = "sha256=" + crypto.createHmac("sha256", "wa-app-secret-test").update(raw, "utf8").digest("hex")
    const from = logs.length
    const res = await POST(new NextRequest("http://localhost/api/whatsapp/webhook", { method: "POST", body: raw, headers: { "x-hub-signature-256": sig, "content-type": "application/json" } }))
    noLeak("WhatsApp の返信の失敗（電話番号・メッセージを出さない）", from)
    check("WhatsApp: 応答は今までどおり 200", res.status === 200)
    const kinds = parsed(from).map((x) => x.kind)
    check("WhatsApp: 返信の失敗と運営への通知がログに残る（中身なし）", kinds.includes("whatsapp_webhook") && kinds.includes("ops_alert"), JSON.stringify(kinds))
    for (const k of ["WHATSAPP_APP_SECRET", "WHATSAPP_CLOUD_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]) delete process.env[k]
  }

  say("9. お問い合わせ（app/api/contact）")
  {
    baseEnv()
    mode.resend = "fail"
    const { POST } = await import("@/app/api/contact/route")
    const body = { company: "Log Test Co", name: NAME, email: GUEST_EMAIL, message: `${HOTEL} ${PHONE}`, elapsedMs: 60_000 }
    const mk = () => new NextRequest("http://localhost/api/contact", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}` } })
    const from = logs.length
    const r1 = await POST(mk())
    const r2 = await POST(mk()) // 直近の連投（同じメール）→ 破棄
    noLeak("お問い合わせ・通知メールの失敗と連投の破棄", from)
    check("お問い合わせ: 応答は今までどおり 200", r1.status === 200 && r2.status === 200, `${r1.status} ${r2.status}`)
    await sb!.from("contact_inquiries").delete().eq("email", GUEST_EMAIL)
  }

  say("10. 運営者の認証コード（app/api/operator/passkey/email-code）")
  {
    baseEnv()
    process.env.MAIL_TEST_CAPTURE = "1"
    ;(globalThis as unknown as { __capturedMails?: unknown[] }).__capturedMails = []
    const { POST } = await import("@/app/api/operator/passkey/email-code/route")
    const from = logs.length
    const res = await POST(new NextRequest("http://localhost/api/operator/passkey/email-code", { method: "POST", body: JSON.stringify({ email: OPS_EMAIL }), headers: { "content-type": "application/json", "x-forwarded-for": "10.8.0.1" } }))
    const resText = await res.text()
    const mails = ((globalThis as unknown as { __capturedMails?: Array<{ subject: string }> }).__capturedMails ?? [])
    const textMails = mails as Array<{ subject: string; to: string }>
    check("認証コード: メールが 1通（記録）", res.status === 200 && textMails.length === 1, `${res.status} ${textMails.length} ${resText}`)
    const subject = String(textMails[0]?.subject ?? "")
    check("認証コード: 件名は決まった文で、数字を含まない", subject === "【BondEx 運営】ログイン認証コードのお知らせ" && !/\d/.test(subject), subject)
    // コードは本文にだけある（本文は試験の中だけで読む）。そのコードが、ログ・応答に無いことを確かめる
    const code = /認証コード: (\d{6})/.exec(String((textMails[0] as { text?: string })?.text ?? ""))?.[1]
    check("認証コード: 本文にコードがある", !!code)
    const chunk = logs.slice(from).join("\n")
    check("認証コード: そのコードがログに無い", !!code && !chunk.includes(code))
    check("認証コード: そのコードが応答に無い", !!code && !resText.includes(code))
    check("認証コード: ログに 6桁の数字が無い", !/\b\d{6}\b/.test(chunk), chunk.slice(0, 300))
    check("認証コード: 応答に 6桁の数字が無い", !/\b\d{6}\b/.test(resText), resText)
    noLeak("認証コードの送信", from)
  }

  console.log = real.log
  console.error = real.error
  console.warn = real.warn
  console.info = real.info
  globalThis.fetch = realFetch
  say(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.log = real.log
  console.error = real.error
  real.error(e)
  real.log(`\n${passed} passed, ${failed + 1} failed`)
  process.exit(1)
})
