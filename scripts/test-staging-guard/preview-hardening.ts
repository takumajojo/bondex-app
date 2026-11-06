// Vercel の Preview・Development と本番の分離の試験 (2026-11-07 緊急対応)。外へは何も送らない (fetch と nodemailer を止めて数える)。
//   実行: npx tsx --tsconfig scripts/test-b2c/tsconfig.json scripts/test-staging-guard/preview-hardening.ts
// 鍵はすべて本番に似せた偽物 (本物の値は使わない・出力しない)。
import { createRequire } from "node:module"

// Drive のフォルダの ID は読み込みの時に読まれるので、先に入れる (Drive の判定を本当に確かめるため)
process.env.GOOGLE_DRIVE_ROOT_ID = "root-FAKE"
let fetches: string[] = []
globalThis.fetch = (async (u: unknown) => { fetches.push(String(u).slice(0, 40)); throw new Error("network blocked in test") }) as typeof fetch
const req = createRequire(import.meta.url)
const nm = req("nodemailer")
let smtpSends = 0
nm.createTransport = () => ({ sendMail: async () => { smtpSends++; throw new Error("smtp blocked in test") } })

let pass = 0, fail = 0
const check = (name: string, ok: boolean, info = "") => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name} ${info}`) } }

const PROD_REF = "dscxftwfspgihkszfakk"
const STG_REF = "oeucjrmuigtfnwowvzwr"
const jwt = (ref: string, role: string) => ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ ref, role })).toString("base64url"), "fakesig"].join(".")
const LIVE_SK = ["sk", "live", "FAKEdummyvalue0000000000"].join("_")
const LIVE_PK = ["pk", "live", "FAKEdummyvalue0000000000"].join("_")
const TEST_SK = ["sk", "test", "FAKEdummyvalue0000000000"].join("_")
const TEST_PK = ["pk", "test", "FAKEdummyvalue0000000000"].join("_")

// 今の Vercel の Preview の形 (2026-11-07 の env ls の名前の一覧と同じ鍵がそろう・値は偽物)
const PROD_LIKE: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(PROD_REF, "anon"),
  SUPABASE_SERVICE_ROLE_KEY: jwt(PROD_REF, "service_role"),
  STRIPE_SECRET_KEY: LIVE_SK, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: LIVE_PK, STRIPE_CHARGE_LIVE: "true",
  SHIPANDCO_API_KEY: "shipandco-FAKE", SHIPANDCO_LIVE: "true",
  RESEND_API_KEY: "re_FAKEdummyvalue", SMTP_HOST: "smtp.invalid", SMTP_USER: "u-FAKE", SMTP_PASS: "p-FAKE",
  GOOGLE_DRIVE_SA_KEY: "{\"FAKE\":true}", GOOGLE_DRIVE_ROOT_ID: "root-FAKE", OPERATOR_PASSWORD: "op-FAKE",
  SLACK_WEBHOOK_URL: "https://hooks.slack.invalid/FAKE", WHATSAPP_CLOUD_TOKEN: "wa-FAKE", WHATSAPP_PHONE_NUMBER_ID: "123",
  LINE_CHANNEL_ACCESS_TOKEN: "line-FAKE", ALERT_EMAIL: "ops@example.invalid",
}
// staging の正しい設定 (Preview を staging に向けた後の形)
const STAGING_OK: Record<string, string> = {
  BONDEX_ENV: "staging", STAGING_SUPABASE_REF: STG_REF,
  NEXT_PUBLIC_SUPABASE_URL: `https://${STG_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(STG_REF, "anon"), SUPABASE_SERVICE_ROLE_KEY: jwt(STG_REF, "service_role"),
  STRIPE_SECRET_KEY: TEST_SK, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: TEST_PK,
  APP_BASE_URL: "https://bondex-staging.vercel.app", B2C_SITE_URL: "https://bondex-staging.vercel.app", MAIL_TEST_CAPTURE: "1",
}
const ALL_KEYS = [...new Set([...Object.keys(PROD_LIKE), ...Object.keys(STAGING_OK), "VERCEL", "VERCEL_ENV", "VERCEL_URL", "BONDEX_ENV", "APP_BASE_URL", "B2C_STRIPE_ALLOW_LIVE"])]
const setEnv = (e: Record<string, string>) => { for (const k of ALL_KEYS) delete process.env[k]; Object.assign(process.env, e) }
const secretsIn = (msg: string) => Object.values(PROD_LIKE).filter((v) => v.length >= 6 && msg.includes(v))

;(async () => {
  const guard = await import("../../lib/env-guard")
  const { register } = await import("../../instrumentation")
  const { b2cStripeConfig } = await import("../../lib/b2c/stripe")
  const { chargeShipmentIfDue } = await import("../../lib/charge")
  const { sendMail } = await import("../../lib/mailer")
  const { sendOpsAlert } = await import("../../lib/ops-alert")
  const { sendWhatsAppText } = await import("../../lib/whatsapp")
  const { isDriveConfigured } = await import("../../lib/google-drive")
  const { waybillIssuanceEnabled } = await import("../../lib/waybill-issuance")
  const realExit = process.exit
  // Node の実行環境 (Vercel の関数と同じ) で起動の処理を動かし、プロセスを止めたか (終了コード) を見る
  const tryRegister = () => {
    let code: number | null = null
    const prevRt = process.env.NEXT_RUNTIME
    process.env.NEXT_RUNTIME = "nodejs"
    process.exit = ((c?: number) => { code = c ?? 0; throw new Error("exit") }) as typeof process.exit
    try { register() } catch { /* exit */ } finally { process.exit = realExit; if (prevRt === undefined) delete process.env.NEXT_RUNTIME; else process.env.NEXT_RUNTIME = prevRt }
    return code
  }
  const violations = (e: Record<string, string>) => { let msg = ""; try { guard.assertEnvironmentSafe(e) } catch (x) { msg = x instanceof Error ? x.message : String(x) } return msg }

  console.log("1. Preview + 本番の DB → 起動・操作を拒否")
  for (const target of [{ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "x.vercel.app" }, { VERCEL_ENV: "development" }] as Array<Record<string, string>>) {
    const label = target.VERCEL_ENV
    setEnv({ ...PROD_LIKE, ...target })
    const msg = violations(process.env as Record<string, string>)
    check(`${label}: 本番の Supabase の URL・鍵を理由に止める`, /NEXT_PUBLIC_SUPABASE_URL/.test(msg) && /SUPABASE_SERVICE_ROLE_KEY/.test(msg), msg.slice(0, 200))
    check(`${label}: 起動の時 (instrumentation) にプロセスを止める`, tryRegister() === 1)
    const { getSupabase } = await import("../../lib/supabase")
    let threw = false
    try { getSupabase() } catch { threw = true }
    check(`${label}: 実行の時も DB のクライアントを作らない (起動の守りが効かなくても)`, threw)
    check(`${label}: エラーの文に鍵の値を出さない`, secretsIn(msg).length === 0, String(secretsIn(msg).length))
  }

  console.log("2. Preview + Stripe の本番の鍵 → 拒否 (DB は試験環境でも)")
  setEnv({ ...STAGING_OK, STRIPE_SECRET_KEY: LIVE_SK, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: LIVE_PK, B2C_STRIPE_ALLOW_LIVE: "true", VERCEL: "1", VERCEL_ENV: "preview" })
  const m2 = violations(process.env as Record<string, string>)
  check("起動の守りが Stripe の本番の鍵を理由に止める", /STRIPE_SECRET_KEY/.test(m2) && /NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY/.test(m2), m2.slice(0, 200))
  check("起動の時にプロセスを止める", tryRegister() === 1)
  let s2: ReturnType<typeof b2cStripeConfig> | null = null
  try { s2 = b2cStripeConfig() } catch { s2 = null }
  check("B2C: 本番の鍵を使わない (許可の変数があっても)", s2 === null || (s2.ok === false && s2.reason === "live_key_blocked"))
  process.env.STRIPE_CHARGE_LIVE = "true"
  const c2 = await chargeShipmentIfDue("00000000-0000-0000-0000-000000000000")
  check("B2B: 請求しない (STRIPE_CHARGE_LIVE=true でも)", c2.charged === false, JSON.stringify(c2))

  console.log("3. Preview + 試験環境の DB + Stripe のテストの鍵 → 許可")
  setEnv({ ...STAGING_OK, VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "x.vercel.app" })
  check("違反なし (起動できる)", violations(process.env as Record<string, string>) === "" && tryRegister() === null)
  const s3 = b2cStripeConfig()
  check("B2C: テストモードの Stripe を使える (staging の試験ができる)", s3.ok === true && s3.config.mode === "test")
  check("自分自身の呼び出しは staging の URL", guard.selfBaseUrl() === "https://bondex-staging.vercel.app")
  const m3 = await sendMail({ to: "guest@example.invalid", subject: "t", text: "t" } as never)
  check("メールは記録だけ (実際には送らない)", (m3 as { sent: boolean }).sent === true && smtpSends === 0)

  console.log("4. Preview + 環境の判定ができない → 拒否")
  for (const [label, env] of [
    ["VERCEL=1 だけ (VERCEL_ENV が無い)", { VERCEL: "1" }],
    ["VERCEL_URL だけ", { VERCEL_URL: "x.vercel.app" }],
    ["VERCEL_ENV が知らない値 (staging)", { VERCEL: "1", VERCEL_ENV: "staging" }],
    ["VERCEL_ENV が空", { VERCEL: "1", VERCEL_ENV: "" }],
  ] as Array<[string, Record<string, string>]>) {
    setEnv({ ...PROD_LIKE, ...env })
    check(`${label}: 本番ではないとみなす`, guard.isNonProductionDeployment())
    check(`${label}: 本番の鍵があれば起動しない`, tryRegister() === 1)
  }
  setEnv({ ...STAGING_OK, BONDEX_ENV: "", VERCEL: "1", VERCEL_ENV: "preview" })
  check("Preview で BONDEX_ENV=staging が無ければ止める", /BONDEX_ENV/.test(violations(process.env as Record<string, string>)))
  setEnv({ ...STAGING_OK, APP_BASE_URL: "", VERCEL: "1", VERCEL_ENV: "preview" })
  check("Preview で APP_BASE_URL が無ければ止める (本番のドメインを呼ばない)", /APP_BASE_URL/.test(violations(process.env as Record<string, string>)))

  console.log("5. Production + 本番の設定 → 今までどおり")
  setEnv({ ...PROD_LIKE, VERCEL: "1", VERCEL_ENV: "production", VERCEL_URL: "bondex.express" })
  check("違反なし・起動する", violations(process.env as Record<string, string>) === "" && tryRegister() === null)
  check("本番の配置と判定", !guard.isNonProductionDeployment())
  check("自分自身の呼び出しは今までどおり (APP_BASE_URL が無ければ bondex.express)", guard.selfBaseUrl() === "https://bondex.express")
  check("Google Drive は今までどおり使う (鍵とフォルダがあれば)", isDriveConfigured() === true)
  process.env.AUTO_ISSUE_ENABLED = "true"
  check("自動の発行のスイッチは今までどおり (AUTO_ISSUE_ENABLED=true なら発行する)", waybillIssuanceEnabled() === true)
  delete process.env.AUTO_ISSUE_ENABLED
  fetches = []
  const r5 = await sendOpsAlert({ subject: "t", lines: ["t"] })
  check("運営への通知: Slack に投稿しようとする (今までどおり)", r5.errors.some((e) => e.startsWith("slack")) && fetches.some((f) => f.includes("hooks.slack.invalid")), JSON.stringify(r5.errors))
  setEnv({ ...PROD_LIKE })
  check("手元の開発・試験 (Vercel の変数なし): 今までどおり", !guard.isNonProductionDeployment() && violations(process.env as Record<string, string>) === "")

  console.log("6. 外への送信は、起動の守りを通り越しても止まる (Preview に本番の鍵がそろった時)")
  setEnv({ ...PROD_LIKE, VERCEL: "1", VERCEL_ENV: "preview", AUTO_ISSUE_ENABLED: "true" })
  fetches = []; smtpSends = 0
  const r6 = await sendOpsAlert({ subject: "t", lines: ["t"], agencyEmail: "agency@example.invalid" })
  check("運営への通知: Slack に投稿しない・メールは記録だけ", r6.slackSent === false && !fetches.some((f) => f.includes("slack")) && smtpSends === 0)
  const w6 = await sendWhatsAppText("+810000000000", "t")
  check("WhatsApp: 送らない", w6.ok === false && w6.error === "non_production_deployment")
  check("Google Drive: 書かない (設定なしと同じ)", isDriveConfigured() === false)
  check("自動の送り状の発行: しない", waybillIssuanceEnabled() === false)
  let selfErr = ""
  try { guard.selfBaseUrl() } catch (e) { selfErr = e instanceof Error ? e.message : String(e) }
  check("自分自身の呼び出し: 本番のドメインを運営のパスワードつきで呼ばない", /本番のドメインを呼びません/.test(selfErr))
  process.env.APP_BASE_URL = "https://bondex.express"
  let selfErr2 = ""
  try { guard.selfBaseUrl() } catch (e) { selfErr2 = e instanceof Error ? e.message : String(e) }
  check("APP_BASE_URL が本番のドメインでも呼ばない", /本番のドメインを呼びません/.test(selfErr2))
  const c6 = await chargeShipmentIfDue("00000000-0000-0000-0000-000000000000")
  check("B2B の請求: しない", c6.charged === false)
  check("試験の全体で外への通信は、本番の配置の Slack の 1回だけ (他は 0)", fetches.length === 0 && smtpSends === 0, `${fetches.join(",")} ${smtpSends}`)

  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail ? 1 : 0)
})()
