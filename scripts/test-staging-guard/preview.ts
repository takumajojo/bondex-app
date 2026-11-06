// Vercel の Preview・Development からは、本番の鍵が入っていても外への実際の処理をしない (2026-11-06 Preview の本番の鍵の対策)。
//   実行: npx tsx scripts/test-staging-guard/preview.ts
// 外へは何も送らない (fetch と nodemailer を止め、呼ばれたら数える)。鍵はすべて試験用の偽物。
import { createRequire } from "node:module"

let fetches = 0
globalThis.fetch = (async () => { fetches++; throw new Error("network blocked in test") }) as typeof fetch
const req = createRequire(import.meta.url)
const nm = req("nodemailer")
let smtpSends = 0
nm.createTransport = () => ({ sendMail: async () => { smtpSends++; throw new Error("smtp blocked in test") } })

let pass = 0, fail = 0
const check = (name: string, ok: boolean, info = "") => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name} ${info}`) } }
const FAKE_LIVE_SK = ["sk", "live", "testonlynotarealkey000000"].join("_")
const FAKE_LIVE_PK = ["pk", "live", "testonlynotarealkey000000"].join("_")

;(async () => {
  const guard = await import("../../lib/env-guard")
  const { waybillIssuanceEnabled } = await import("../../lib/waybill-issuance")
  const { bizLogiConfigFromEnv } = await import("../../lib/bizlogi/client")
  const { b2cStripeConfig } = await import("../../lib/b2c/stripe")
  const { sendMail } = await import("../../lib/mailer")
  const { chargeShipmentIfDue } = await import("../../lib/charge")

  const base = {
    STRIPE_CHARGE_LIVE: "true", STRIPE_SECRET_KEY: FAKE_LIVE_SK, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: FAKE_LIVE_PK,
    B2C_STRIPE_ALLOW_LIVE: "true", AUTO_ISSUE_ENABLED: "true", SHIPANDCO_LIVE: "true",
    BIZLOGI_LIVE: "true", BIZLOGI_BASE_URL: "https://example.invalid/api", BIZLOGI_ENV: "production", BIZLOGI_CUSTOMER_ID: "x",
    BIZLOGI_LOGIN_PASSWORD: "x", BIZLOGI_KOKYAKU_CODE: "000000000000", BIZLOGI_OKURI_CODE: "N01",
    RESEND_API_KEY: "re_testonlynotarealkey", SMTP_HOST: "smtp.invalid", SMTP_USER: "u", SMTP_PASS: "p",
  }
  for (const target of ["preview", "development"]) {
    Object.assign(process.env, base, { VERCEL_ENV: target })
    delete process.env.MAIL_TEST_CAPTURE; delete process.env.BONDEX_ENV
    check(`${target}: 配置を本番以外と判定する`, guard.isNonProductionDeployment())
    check(`${target}: 自動の送り状の発行は OFF (AUTO_ISSUE_ENABLED=true でも)`, waybillIssuanceEnabled() === false)
    let biz: { live: boolean } | null = null
    try { biz = bizLogiConfigFromEnv(process.env) as { live: boolean } } catch (e) { biz = null; console.log("    (Biz-Logi の設定の読み込み:", e instanceof Error ? e.message.slice(0, 80) : e, ")") }
    check(`${target}: Biz-Logi の発行依頼は送らない (BIZLOGI_LIVE=true でも)`, biz === null || biz.live === false, JSON.stringify(biz?.live))
    const s = b2cStripeConfig()
    check(`${target}: B2C は本番の Stripe の鍵を使わない (許可があっても)`, s.ok === false && s.reason === "live_key_blocked", JSON.stringify(s.ok ? "ok" : s.reason))
    const c = await chargeShipmentIfDue("00000000-0000-0000-0000-000000000000")
    check(`${target}: B2B の請求はしない (STRIPE_CHARGE_LIVE=true でも)`, c.charged === false && c.reason === "non_production_deployment", JSON.stringify(c))
    const m = await sendMail({ to: "someone@example.invalid", subject: "t", text: "t" } as never)
    check(`${target}: メールは実際に送らない (Resend・SMTP の鍵があっても)`, smtpSends === 0 && fetches === 0 && (m as { sent: boolean }).sent === true)
  }
  // Preview・Development から本番の DB には接続しない (service_role は RLS を通らない)
  const fakeJwt = (ref: string) => ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ ref, role: "service_role" })).toString("base64url"), "sig"].join(".")
  for (const target of ["preview", "development"]) {
    const env = { VERCEL_ENV: target, NEXT_PUBLIC_SUPABASE_URL: `https://${guard.PROD_SUPABASE_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: fakeJwt(guard.PROD_SUPABASE_REF) }
    let threw = ""
    try { guard.assertEnvironmentSafe(env) } catch (e) { threw = e instanceof Error ? e.message : String(e) }
    check(`${target}: 本番の Supabase の URL・鍵なら止める`, /NEXT_PUBLIC_SUPABASE_URL/.test(threw) && /SUPABASE_SERVICE_ROLE_KEY/.test(threw), threw)
    check(`${target}: エラーの文に鍵の値を出さない`, !threw.includes(env.SUPABASE_SERVICE_ROLE_KEY))
    const stg = { VERCEL_ENV: target, NEXT_PUBLIC_SUPABASE_URL: `https://${guard.STAGING_SUPABASE_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: fakeJwt(guard.STAGING_SUPABASE_REF) }
    check(`${target}: 試験環境の Supabase なら止めない`, guard.previewDatabaseViolations(stg).length === 0)
  }
  const prodEnv = { VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: `https://${guard.PROD_SUPABASE_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: fakeJwt(guard.PROD_SUPABASE_REF) }
  check("production: 本番の Supabase に接続できる (今までどおり)", guard.previewDatabaseViolations(prodEnv).length === 0)
  check("VERCEL_ENV なし: 本番の URL でも止めない (手元の読み取りの道具・今までどおり)", guard.previewDatabaseViolations({ ...prodEnv, VERCEL_ENV: undefined }).length === 0)
  // 本番 (VERCEL_ENV=production) と手元 (VERCEL_ENV なし) の判定は今までどおり
  process.env.VERCEL_ENV = "production"
  check("production: 本番以外とは判定しない (今までどおり)", !guard.isNonProductionDeployment() && waybillIssuanceEnabled() === true)
  delete process.env.VERCEL_ENV
  check("VERCEL_ENV なし (手元の開発・試験): 今までどおり", !guard.isNonProductionDeployment())
  check("試験の全体で外への通信 0回", fetches === 0 && smtpSends === 0, `${fetches} ${smtpSends}`)
  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail ? 1 : 0)
})()
