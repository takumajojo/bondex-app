/**
 * 試験環境の「社内だけ実送信」（lib/mailer.ts stagingInternalSendAllowed・lib/env-guard.ts）の試験。2026-11-06。
 * fetch を差し替えて Resend への送信を数える（外へは何も送らない）。鍵・宛先はすべて架空。
 *   実行: npx tsx --tsconfig scripts/test-b2c/tsconfig.json scripts/test-staging-guard/mail-send.ts
 */
import assert from "node:assert/strict"
import { sendMail } from "@/lib/mailer"
import { stagingGuardViolations, STAGING_SUPABASE_REF } from "@/lib/env-guard"

let passed = 0
const t = async (name: string, fn: () => Promise<void> | void) => {
  await fn()
  passed++
  console.log(`  ok  ${name}`)
}

const OPS = "ops-a@jojo-test.example"
const OPS2 = "ops-b@jojo-test.example"
const TRAVELER = "guest@example.invalid"
const AGENCY = "agency@example.invalid"
const STG_KEY = "re_STAGINGFAKE1234"
const PROD_KEY = "re_PRODFAKE99999999"

// ── 送信の数え方（Resend への fetch・記録・ログ）
type Call = { url: string; auth: string; body: Record<string, unknown> }
let calls: Call[] = []
let fetchStatus = 200
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url)
  if (!u.startsWith("https://api.resend.com/")) return realFetch(url as string, init)
  calls.push({ url: u, auth: String((init?.headers as Record<string, string>)?.Authorization ?? ""), body: JSON.parse(String(init?.body ?? "{}")) })
  return new Response(JSON.stringify(fetchStatus === 200 ? { id: "fake-id" } : { message: "fake error" }), { status: fetchStatus })
}) as typeof fetch
const logs: string[] = []
const realLog = console.log
console.log = (...a: unknown[]) => {
  const line = a.map(String).join(" ")
  if (line.startsWith("[safe-log]")) logs.push(line)
  else realLog(...a)
}
const captured = () => ((globalThis as unknown as { __capturedMails?: unknown[] }).__capturedMails ?? []).length

const ENV_KEYS = ["BONDEX_ENV", "MAIL_TEST_CAPTURE", "STAGING_MAIL_SEND", "STAGING_RESEND_API_KEY", "STAGING_MAIL_FROM", "OPERATOR_EMAILS", "RESEND_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "ALERT_FROM_EMAIL"]
function setEnv(e: Record<string, string>) {
  for (const k of ENV_KEYS) delete process.env[k]
  Object.assign(process.env, e)
  calls = []
  logs.length = 0
  fetchStatus = 200
  ;(globalThis as unknown as { __capturedMails?: unknown[] }).__capturedMails = []
}
const STAGING_ON = { BONDEX_ENV: "staging", MAIL_TEST_CAPTURE: "1", STAGING_MAIL_SEND: "internal", STAGING_RESEND_API_KEY: STG_KEY, OPERATOR_EMAILS: `${OPS}, ${OPS2}` }
const mail = (to: string, extra: Partial<Parameters<typeof sendMail>[0]> = {}) => sendMail({ to, subject: "【BondEx 運営】認証コード 482913", text: "認証コード: 482913", ...extra })

async function main() {
  console.log("staging・スイッチ OFF（既定）: 何も送らない")
  await t("社内の宛先でも記録だけ・Resend を呼ばない", async () => {
    setEnv({ ...STAGING_ON, STAGING_MAIL_SEND: "" })
    const r = await mail(OPS)
    assert.equal(r.sent, true)
    assert.equal(calls.length, 0)
    assert.equal(captured(), 1)
  })
  await t("MAIL_TEST_CAPTURE が無くても staging は記録だけ（安全装置を外しても送らない）", async () => {
    setEnv({ BONDEX_ENV: "staging", OPERATOR_EMAILS: OPS, RESEND_API_KEY: PROD_KEY })
    await mail(OPS)
    assert.equal(calls.length, 0)
    assert.equal(captured(), 1)
  })

  console.log("staging・スイッチ ON: 社内の宛先だけ実際に送る")
  await t("OPERATOR_EMAILS の宛先: Resend を 1回・staging の鍵・件名に [STAGING]", async () => {
    setEnv(STAGING_ON)
    const r = await mail(OPS)
    assert.equal(r.sent, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].auth, `Bearer ${STG_KEY}`)
    assert.deepEqual(calls[0].body.to, [OPS])
    assert.ok(String(calls[0].body.subject).startsWith("[STAGING] "))
    assert.equal(captured(), 0)
  })
  await t("大文字の違いは同じ宛先として扱う", async () => {
    setEnv(STAGING_ON)
    await mail(OPS.toUpperCase())
    assert.equal(calls.length, 1)
  })
  await t("旅行者の宛先: 送らない（記録だけ）", async () => {
    setEnv(STAGING_ON)
    await mail(TRAVELER)
    assert.equal(calls.length, 0)
    assert.equal(captured(), 1)
  })
  await t("代理店の宛先: 送らない（記録だけ）", async () => {
    setEnv(STAGING_ON)
    await mail(AGENCY, { subject: "【BondEx】集荷完了　BDX-1-L1（T Agency）" })
    assert.equal(calls.length, 0)
  })
  await t("to が社内でも bcc に社外が 1つあれば、メール全体を送らない", async () => {
    setEnv(STAGING_ON)
    await mail(OPS, { bcc: [OPS2, AGENCY] })
    assert.equal(calls.length, 0)
    assert.equal(captured(), 1)
  })
  await t("to と bcc がすべて社内なら送る", async () => {
    setEnv(STAGING_ON)
    await mail(OPS, { bcc: OPS2 })
    assert.equal(calls.length, 1)
  })
  await t("to に社内と社外をカンマで並べても送らない", async () => {
    setEnv(STAGING_ON)
    await mail(`${OPS},${TRAVELER}`)
    assert.equal(calls.length, 0)
  })
  await t("OPERATOR_EMAILS が無い: 既定のアドレス（運営画面のログインの既定）にも送らない", async () => {
    setEnv({ ...STAGING_ON, OPERATOR_EMAILS: "" })
    await mail("taniguchi@jojo-tokyo.com")
    assert.equal(calls.length, 0)
  })
  await t("staging の鍵が無い・形が違う: 送らない", async () => {
    setEnv({ ...STAGING_ON, STAGING_RESEND_API_KEY: "" })
    await mail(OPS)
    setEnv({ ...STAGING_ON, STAGING_RESEND_API_KEY: "sk_test_x" })
    await mail(OPS)
    assert.equal(calls.length, 0)
  })
  await t("本番の名前の鍵（RESEND_API_KEY）があっても、staging は staging の鍵だけを使う", async () => {
    setEnv({ ...STAGING_ON, RESEND_API_KEY: PROD_KEY })
    await mail(OPS)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].auth, `Bearer ${STG_KEY}`)
  })
  await t("Resend が失敗しても SMTP で送り直さない（staging では SMTP を使わない）", async () => {
    setEnv({ ...STAGING_ON, SMTP_HOST: "127.0.0.1", SMTP_USER: "u", SMTP_PASS: "p" })
    fetchStatus = 500
    const r = await mail(OPS)
    assert.equal(r.sent, false)
    assert.equal(calls.length, 1)
    assert.ok(!/smtp/i.test(String(r.error ?? "")), String(r.error))
  })
  await t("strict（B2C の通知）でも同じ: 社外には送らない・社内は Resend 1回", async () => {
    setEnv(STAGING_ON)
    await mail(TRAVELER, { strict: true })
    assert.equal(calls.length, 0)
    await mail(OPS, { strict: true })
    assert.equal(calls.length, 1)
  })
  await t("差出人は STAGING_MAIL_FROM（本番の ALERT_FROM_EMAIL は使わない）", async () => {
    setEnv({ ...STAGING_ON, ALERT_FROM_EMAIL: "Prod <prod@bondex.express>", STAGING_MAIL_FROM: "BondEx staging <stg@bondex.express>" })
    await mail(OPS)
    assert.equal(calls[0].body.from, "BondEx staging <stg@bondex.express>")
  })

  console.log("ログ: 認証コード・受付番号・名前を出さない")
  await t("記録のログに認証コードが無い", async () => {
    setEnv({ ...STAGING_ON, STAGING_MAIL_SEND: "" })
    await mail(OPS)
    assert.equal(logs.length, 1)
    assert.ok(!logs[0].includes("482913"), logs[0])
    assert.ok(!logs[0].includes("ops-a"), logs[0])
  })
  await t("実送信のログにも認証コードと宛先の名前が無い", async () => {
    setEnv(STAGING_ON)
    await mail(OPS)
    assert.equal(logs.length, 1)
    assert.ok(logs[0].includes('"kind":"mail_staging_send"') && logs[0].includes('"outcome":"ok"'), logs[0])
    assert.ok(!logs[0].includes("482913") && !logs[0].includes("ops-a") && !logs[0].includes(STG_KEY), logs[0])
  })
  await t("ログに件名を出さない（ホテル名がかっこの外にある件名でも）", async () => {
    setEnv({ ...STAGING_ON, STAGING_MAIL_SEND: "" })
    await mail(TRAVELER, { subject: "【集荷漏れの可能性】BDX-1-L1 テストホテル新宿" })
    assert.equal(logs.length, 1)
    assert.ok(!logs[0].includes("テストホテル") && !logs[0].includes("集荷漏れ") && !logs[0].includes("guest"), logs[0])
  })

  console.log("本番（BONDEX_ENV が staging でない）の動きは変わらない")
  await t("本番: RESEND_API_KEY で送る・件名はそのまま・staging の設定は無視", async () => {
    setEnv({ RESEND_API_KEY: PROD_KEY, STAGING_MAIL_SEND: "internal", STAGING_RESEND_API_KEY: STG_KEY, OPERATOR_EMAILS: OPS })
    await mail(TRAVELER)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].auth, `Bearer ${PROD_KEY}`)
    assert.equal(calls[0].body.subject, "【BondEx 運営】認証コード 482913")
    assert.deepEqual(calls[0].body.to, [TRAVELER])
  })
  await t("本番の試験（MAIL_TEST_CAPTURE=1・staging でない）: 今までどおり記録だけ", async () => {
    setEnv({ MAIL_TEST_CAPTURE: "1", RESEND_API_KEY: PROD_KEY })
    await mail(TRAVELER)
    assert.equal(calls.length, 0)
    assert.equal(captured(), 1)
  })

  console.log("起動の安全装置（lib/env-guard.ts）")
  const GOOD: Record<string, string> = {
    BONDEX_ENV: "staging",
    STAGING_SUPABASE_REF,
    NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_SUPABASE_REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_FAKE",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_FAKE",
    STRIPE_SECRET_KEY: "sk_test_FAKE",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_FAKE",
    APP_BASE_URL: "https://bondex-staging.vercel.app",
    B2C_SITE_URL: "https://bondex-staging.vercel.app",
    MAIL_TEST_CAPTURE: "1",
  }
  const v = (over: Record<string, string>) => stagingGuardViolations({ ...GOOD, ...over })
  await t("社内への送信の正しい設定: 違反 0", () => assert.deepEqual(v({ STAGING_MAIL_SEND: "internal", STAGING_RESEND_API_KEY: STG_KEY, OPERATOR_EMAILS: `${OPS},${OPS2}` }), []))
  await t("本番の名前の鍵（RESEND_API_KEY・SMTP_*）は止める", () => {
    for (const k of ["RESEND_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) assert.ok(v({ [k]: "x" }).some((m) => m.startsWith(k)), k)
  })
  await t("STAGING_MAIL_SEND が internal 以外は止める", () => assert.ok(v({ STAGING_MAIL_SEND: "all", STAGING_RESEND_API_KEY: STG_KEY, OPERATOR_EMAILS: OPS }).some((m) => m.startsWith("STAGING_MAIL_SEND"))))
  await t("staging の鍵が無いと止める", () => assert.ok(v({ STAGING_MAIL_SEND: "internal", OPERATOR_EMAILS: OPS }).some((m) => m.startsWith("STAGING_RESEND_API_KEY"))))
  await t("宛先の一覧が無い・形が違うと止める", () => {
    assert.ok(v({ STAGING_MAIL_SEND: "internal", STAGING_RESEND_API_KEY: STG_KEY }).some((m) => m.startsWith("OPERATOR_EMAILS")))
    assert.ok(v({ STAGING_MAIL_SEND: "internal", STAGING_RESEND_API_KEY: STG_KEY, OPERATOR_EMAILS: "ops, x@y.z" }).some((m) => m.startsWith("OPERATOR_EMAILS")))
  })
  await t("MAIL_TEST_CAPTURE を外すと止める（社内への送信を有効にしても）", () => assert.ok(v({ MAIL_TEST_CAPTURE: "", STAGING_MAIL_SEND: "internal", STAGING_RESEND_API_KEY: STG_KEY, OPERATOR_EMAILS: OPS }).some((m) => m.startsWith("MAIL_TEST_CAPTURE"))))
  await t("本番（staging でない）は RESEND_API_KEY があっても違反 0", () => assert.deepEqual(stagingGuardViolations({ RESEND_API_KEY: PROD_KEY, SMTP_HOST: "smtp.example" }), []))

  console.log = realLog
  globalThis.fetch = realFetch
  console.log(`\n${passed} passed, 0 failed`)
}

main().catch((e) => {
  console.log = realLog
  console.error(e)
  console.log(`\n${passed} passed, 1 failed`)
  process.exit(1)
})
