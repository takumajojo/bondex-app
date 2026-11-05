/**
 * 試験環境の誤接続の防止（lib/env-guard.ts）の試験。値はすべて架空（本物の鍵・接続文字列は使わない）。
 *   実行: npx tsx --tsconfig scripts/test-b2c/tsconfig.json scripts/test-staging-guard/run.ts
 */
import assert from "node:assert/strict"
import { stagingGuardViolations, assertEnvironmentSafe, STAGING_SUPABASE_REF, PROD_SUPABASE_REF } from "@/lib/env-guard"
import { register } from "../../instrumentation"

let passed = 0
const t = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`) }
const jwt = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`

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
const bad = (over: Record<string, string>) => stagingGuardViolations({ ...GOOD, ...over })

console.log("staging でない時は何もしない（本番の動きは変わらない）")
t("BONDEX_ENV が無い: 本番の値があっても違反 0・止めない", () => {
  const prodLike = { NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_SUPABASE_REF}.supabase.co`, STRIPE_SECRET_KEY: "sk_live_FAKE", MAIL_TEST_CAPTURE: "" }
  assert.deepEqual(stagingGuardViolations(prodLike), [])
  assert.doesNotThrow(() => assertEnvironmentSafe(prodLike))
})
t("BONDEX_ENV=production も何もしない", () => assert.deepEqual(stagingGuardViolations({ BONDEX_ENV: "production", STRIPE_SECRET_KEY: "sk_live_FAKE" }), []))

console.log("staging の正しい設定は通る")
t("正しい設定: 違反 0", () => assert.deepEqual(stagingGuardViolations(GOOD), []))
t("JWT 形式の鍵でも試験環境の ID なら通る", () => assert.deepEqual(bad({ SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: STAGING_SUPABASE_REF, role: "service_role" }) }), []))

console.log("本番の接続先・鍵は止める")
t("Supabase の URL が本番", () => assert.ok(bad({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_SUPABASE_REF}.supabase.co` }).some((x) => x.includes("本番の Supabase"))))
t("Supabase の URL が別の project", () => assert.ok(bad({ NEXT_PUBLIC_SUPABASE_URL: "https://otherproject.supabase.co" }).some((x) => x.includes("試験環境の Supabase ではない"))))
t("service_role の鍵が本番の JWT", () => assert.ok(bad({ SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: PROD_SUPABASE_REF, role: "service_role" }) }).length > 0))
t("STAGING_SUPABASE_REF が無い・違う", () => assert.ok(bad({ STAGING_SUPABASE_REF: "" }).some((x) => x.startsWith("STAGING_SUPABASE_REF"))))
t("Stripe の本番の鍵（sk_live・rk_live・pk_live）", () => {
  assert.ok(bad({ STRIPE_SECRET_KEY: "sk_live_FAKE" }).some((x) => x.startsWith("STRIPE_SECRET_KEY")))
  assert.ok(bad({ STRIPE_SECRET_KEY: "rk_live_FAKE" }).some((x) => x.startsWith("STRIPE_SECRET_KEY")))
  assert.ok(bad({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_FAKE" }).some((x) => x.startsWith("NEXT_PUBLIC_STRIPE")))
  assert.ok(bad({ B2C_STRIPE_ALLOW_LIVE: "true" }).length > 0)
})
t("サイトの URL が本番のドメイン", () => {
  assert.ok(bad({ APP_BASE_URL: "https://bondex.express" }).some((x) => x.startsWith("APP_BASE_URL")))
  assert.ok(bad({ B2C_SITE_URL: "https://www.bondex.express/" }).some((x) => x.startsWith("B2C_SITE_URL")))
})

console.log("外への送信の設定は止める")
t("メールを実際に送る設定（MAIL_TEST_CAPTURE が 1 でない）", () => assert.ok(bad({ MAIL_TEST_CAPTURE: "" }).some((x) => x.startsWith("MAIL_TEST_CAPTURE"))))
for (const k of ["WHATSAPP_CLOUD_TOKEN", "LINE_CHANNEL_ACCESS_TOKEN", "SLACK_WEBHOOK_URL", "SHIPANDCO_API_KEY", "GOOGLE_DRIVE_SA_KEY", "BIZLOGI_BASE_URL", "BIZLOGI_LOGIN_PASSWORD"]) {
  t(`${k} がある`, () => assert.ok(bad({ [k]: "FAKE" }).some((x) => x.startsWith(k))))
}
for (const k of ["B2C_WHATSAPP_LIVE", "SHIPANDCO_LIVE", "BIZLOGI_LIVE", "AUTO_ISSUE_ENABLED"]) {
  t(`${k}=true`, () => assert.ok(bad({ [k]: "true" }).some((x) => x.startsWith(k))))
}

console.log("止め方")
t("違反があれば例外・文に値を出さない（変数の名前と理由だけ）", () => {
  const secret = "sk_live_THIS_MUST_NOT_APPEAR"
  assert.throws(() => assertEnvironmentSafe({ ...GOOD, STRIPE_SECRET_KEY: secret }), (e: Error) => !e.message.includes(secret) && e.message.includes("STRIPE_SECRET_KEY"))
})
t("起動の時（instrumentation の register）も止まる", () => {
  const saved = { ...process.env }
  try {
    Object.assign(process.env, GOOD, { NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_SUPABASE_REF}.supabase.co` })
    assert.throws(() => register())
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }
})
t("起動の時: staging でなければ止まらない", () => assert.doesNotThrow(() => register()))

console.log(`\n${passed} passed`)
