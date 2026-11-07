/**
 * staging E2E の運営の認証「案A」（2026-11-07 谷口さん採用）の設定の組み合わせの試験。外には何も送らない（fetch を差し替える）。
 * Preview に足す予定の設定: STAGING_RESEND_API_KEY（staging 専用の Resend の鍵）・STAGING_MAIL_SEND=internal・
 * OPERATOR_EMAILS=support@bondex.express・MAIL_TEST_CAPTURE=1（今と同じ）。鍵・秘密の値はすべて架空。
 * 確かめること: 起動の守りが止めない／運営の認証コードのメールは support@ にだけ実際に送る（staging の鍵で）／
 * 旅行者・代理店・ホテル宛ては記録だけ／宛先が 1つでも社内でなければ送らない／本番の名前の鍵は使わない／
 * B2C の旅行者への通知は sandbox のまま（B2C_NOTIFY_LIVE を足さない）／設定の書き間違いは起動を止める。
 *   実行: npx tsx --tsconfig scripts/test-b2c/tsconfig.json scripts/test-staging-guard/case-a-auth.ts
 */
export {}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
const fakeJwt = `x.${b64({ ref: "oeucjrmuigtfnwowvzwr", role: "service_role" })}.y`
const U = "https://bondex-poc-main-git-example-preview.vercel.app"
const STG_KEY = "re_STAGINGFAKEKEY1234"
const PREVIEW: Record<string, string> = {
  VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "bondex-poc-main-example.vercel.app",
  BONDEX_ENV: "staging", MAIL_TEST_CAPTURE: "1", STAGING_SUPABASE_REF: "oeucjrmuigtfnwowvzwr",
  NEXT_PUBLIC_SUPABASE_URL: "https://oeucjrmuigtfnwowvzwr.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt, SUPABASE_SERVICE_ROLE_KEY: fakeJwt,
  STRIPE_SECRET_KEY: "sk_test_FAKE", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_FAKE",
  APP_BASE_URL: U, B2C_SITE_URL: U, OPERATOR_SESSION_SECRET: "x".repeat(40), CRON_SECRET: "x".repeat(40), B2C_ACCESS_TOKEN_SECRET: "x".repeat(40),
  B2C_BOOKING_ENABLED: "true", B2C_MY_BOOKING_ENABLED: "true", B2C_CHARGE_LIVE: "true", B2C_SCHEDULER_ENABLED: "true", B2C_LEGAL_PAGES_ENABLED: "true",
  STAGING_PLACES_MOCK: "true",
  // 案A で足す 3つ（MAIL_TEST_CAPTURE=1 は上で既に設定済み）
  STAGING_RESEND_API_KEY: STG_KEY, STAGING_MAIL_SEND: "internal", OPERATOR_EMAILS: "support@bondex.express",
}

let passed = 0, failed = 0
const ok = (n: string, c: boolean, d?: unknown) => { if (c) { passed++; console.log(`  ok  ${n}`) } else { failed++; console.log(`  NG  ${n}`, d === undefined ? "" : JSON.stringify(d).slice(0, 300)) } }

type Call = { url: string; auth: string; to: unknown }
const calls: Call[] = []
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url)
  if (!u.startsWith("https://api.resend.com/")) throw new Error(`unexpected network: ${u}`) // Resend 以外の通信は試験の失敗
  const body = JSON.parse(String(init?.body ?? "{}"))
  calls.push({ url: u, auth: String((init?.headers as Record<string, string>)?.Authorization ?? ""), to: body.to })
  return new Response(JSON.stringify({ id: "fake-id" }), { status: 200 })
}) as typeof fetch
const realLog = console.log
console.log = (...a: unknown[]) => { if (!String(a[0]).startsWith("[safe-log]")) realLog(...a) }

async function main() {
  for (const k of Object.keys(process.env)) if (/^(VERCEL|BONDEX_|STAGING_|B2C_|MAIL_|RESEND|SMTP|OPERATOR_|STRIPE|NEXT_PUBLIC_|SUPABASE|APP_BASE|CRON|WHATSAPP|SLACK|LINE_)/.test(k)) delete process.env[k]
  Object.assign(process.env, PREVIEW)
  const { environmentViolations, externalEffectsBlocked } = await import("@/lib/env-guard")
  const { sendMail, mailerConfigured, stagingInternalSendAllowed } = await import("@/lib/mailer")
  const { operatorEmailAllowed } = await import("@/lib/operator-webauthn")
  const { b2cNotifyLive } = await import("@/lib/b2c/notify")

  console.log("A1 起動の守り")
  ok("案A の設定で起動が止まらない", environmentViolations(PREVIEW).length === 0, environmentViolations(PREVIEW))
  ok("外への送信（WhatsApp 等）は止まったまま", externalEffectsBlocked(PREVIEW) === true)
  ok("B2C の旅行者への通知は sandbox のまま（B2C_NOTIFY_LIVE を足さない）", b2cNotifyLive() === false)
  ok("メールの送信の手段がある扱い（運営の認証コードの画面が 503 にならない）", mailerConfigured() === true)

  console.log("A2 運営の認証コード: support@ だけ")
  ok("support@bondex.express はコードを受け取れる（大文字・空白も同じ扱い）", operatorEmailAllowed("support@bondex.express") && operatorEmailAllowed(" Support@BondEx.express "))
  ok("既定の個人のアドレス・他のアドレスは受け取れない", !operatorEmailAllowed("taniguchi@jojo-tokyo.com") && !operatorEmailAllowed("ops@bondex.express") && !operatorEmailAllowed("guest@example.invalid"))
  calls.length = 0
  const r1 = await sendMail({ to: "support@bondex.express", subject: "【BondEx 運営】ログイン認証コードのお知らせ", text: "認証コード: 000000" })
  ok("support@ 宛ては実際に送る（Resend に 1回・staging の鍵）", r1.sent === true && calls.length === 1 && calls[0].auth === `Bearer ${STG_KEY}`, { r1, calls })

  console.log("A3 旅行者・代理店・ホテル宛ては記録だけ")
  calls.length = 0
  for (const to of ["guest@example.invalid", "agency@example.invalid", "front@hotel.example", "taniguchi@jojo-tokyo.com"]) {
    const r = await sendMail({ to, subject: "s", text: "t" })
    ok(`${to}: 成功の扱い（記録）だが送らない`, r.sent === true && calls.length === 0)
  }
  const mixed = await sendMail({ to: "support@bondex.express", bcc: "guest@example.invalid", subject: "s", text: "t" })
  ok("宛先に 1つでも社内でないもの（BCC）があれば送らない", mixed.sent === true && calls.length === 0 && !stagingInternalSendAllowed({ to: "support@bondex.express", bcc: "guest@example.invalid" }))
  ok("複数の宛先の片方が社外なら送らない", !stagingInternalSendAllowed({ to: "support@bondex.express,guest@example.invalid" }))
  ok("見た目の似た文字（全角・ケルビン記号）の宛先は社内と見なさない", !stagingInternalSendAllowed({ to: "ｓupport@bondex.express" }) && !stagingInternalSendAllowed({ to: "support@bondex.expressK" }))

  console.log("A4 本番の名前の鍵は使わない・書き間違いは起動を止める")
  process.env.RESEND_API_KEY = "re_PRODFAKE99999999"
  calls.length = 0
  await sendMail({ to: "support@bondex.express", subject: "s", text: "t" })
  ok("RESEND_API_KEY（本番の名前）が入ると起動の守りが止め、社内宛ても送らない", environmentViolations({ ...PREVIEW, RESEND_API_KEY: "re_PRODFAKE99999999" }).length > 0 && calls.length === 0, calls)
  delete process.env.RESEND_API_KEY
  ok("STAGING_MAIL_SEND が internal 以外 → 起動を止める", environmentViolations({ ...PREVIEW, STAGING_MAIL_SEND: "all" }).length > 0)
  ok("鍵の形が違う（re_ でない）→ 起動を止める", environmentViolations({ ...PREVIEW, STAGING_RESEND_API_KEY: "sk_live_x" }).length > 0)
  ok("OPERATOR_EMAILS が空 → 起動を止める", environmentViolations({ ...PREVIEW, OPERATOR_EMAILS: "" }).length > 0)
  ok("MAIL_TEST_CAPTURE を外す → 起動を止める（旅行者宛てを記録だけにする前提が崩れる）", environmentViolations({ ...PREVIEW, MAIL_TEST_CAPTURE: "" }).length > 0)
  ok("B2C_WHATSAPP_LIVE を足す → 起動を止める", environmentViolations({ ...PREVIEW, B2C_WHATSAPP_LIVE: "true" }).length > 0)
  const prod = { ...PREVIEW, VERCEL_ENV: "production", BONDEX_ENV: "" }
  ok("同じ値を本番の配置に入れる → 起動を止める", environmentViolations(prod).length > 0)

  console.log(`case-a-auth: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
