// 配置の種類ごとの起動と外への処理の守り (2026-11-07 Preview の完全な切り離し)。外へは何も送らない (fetch を止めて数える)。鍵はすべて偽物。
//   実行: npx tsx scripts/test-staging-guard/environments.ts
// 本番として扱うのは宣言のある時だけ (Vercel の VERCEL_ENV=production、または Vercel の外で BONDEX_ENV=production)。宣言の無い所で本番の鍵があれば止める。
import { NextRequest } from "next/server"

let fetches = 0
globalThis.fetch = (async () => { fetches++; throw new Error("network blocked in test") }) as typeof fetch
let pass = 0, fail = 0
const check = (name: string, ok: boolean, info = "") => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name} ${info}`) } }
type Env = Record<string, string | undefined>

const jwt = (ref: string) => ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ ref, role: "service_role" })).toString("base64url"), "sig"].join(".")
const LIVE_SK = ["sk", "live", "fakefakefakefake0000"].join("_"), LIVE_PK = ["pk", "live", "fakefakefakefake0000"].join("_")
const TEST_SK = ["sk", "test", "fakefakefakefake0000"].join("_"), TEST_PK = ["pk", "test", "fakefakefakefake0000"].join("_")

;(async () => {
  const g = await import("../../lib/env-guard")
  const PROD = g.PROD_SUPABASE_REF, STG = g.STAGING_SUPABASE_REF
  // 本番と同じ形の設定 (今の Production)
  const prodKeys: Env = {
    NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: jwt(PROD), NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(PROD),
    STRIPE_SECRET_KEY: LIVE_SK, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: LIVE_PK, STRIPE_CHARGE_LIVE: "true", SHIPANDCO_API_KEY: "x", SHIPANDCO_LIVE: "true",
    RESEND_API_KEY: "re_fakefakefake", SMTP_HOST: "smtp.invalid", SMTP_USER: "u", SMTP_PASS: "p", GOOGLE_DRIVE_SA_KEY: "{}", OPERATOR_PASSWORD: "x",
  }
  // Preview の正しい設定 (staging の条件)
  const stagingKeys: Env = {
    BONDEX_ENV: "staging", STAGING_SUPABASE_REF: STG, NEXT_PUBLIC_SUPABASE_URL: `https://${STG}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: jwt(STG), NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(STG),
    STRIPE_SECRET_KEY: TEST_SK, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: TEST_PK, MAIL_TEST_CAPTURE: "1", APP_BASE_URL: "https://bondex-preview.example.vercel.app", OPERATOR_PASSWORD: "preview-only",
  }
  const v = (e: Env) => { try { g.assertEnvironmentSafe(e); return [] as string[] } catch (x) { return [(x as Error).message] } }
  const self = (e: Env) => { try { return g.selfBaseUrl(e) } catch { return "THROWS" } }

  console.log("1. 配置の種類の判定")
  const kinds: Array<[string, Env, boolean]> = [
    ["Vercel Production", { VERCEL: "1", VERCEL_ENV: "production", VERCEL_URL: "x.vercel.app" }, false],
    ["Vercel Preview", { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "x.vercel.app" }, true],
    ["Vercel Development (vercel dev)", { VERCEL: "1", VERCEL_ENV: "development" }, true],
    ["手元の開発 (npm run dev)", { NODE_ENV: "development" }, false],
    ["GitHub Actions", { CI: "true", GITHUB_ACTIONS: "true" }, false],
    ["手元の next build", { NODE_ENV: "production", NEXT_PHASE: "phase-production-build" }, false],
    ["Vercel の Preview の build", { VERCEL: "1", VERCEL_ENV: "preview", NEXT_PHASE: "phase-production-build" }, true],
    ["環境名が空 (Vercel の上)", { VERCEL: "1", VERCEL_ENV: "" }, true],
    ["環境名が不正 (prod)", { VERCEL: "1", VERCEL_ENV: "prod" }, true],
    ["環境名が大文字 (Production)", { VERCEL: "1", VERCEL_ENV: "Production" }, true],
    ["VERCEL_URL だけ", { VERCEL_URL: "x.vercel.app" }, true],
  ]
  for (const [n, e, nonProd] of kinds) check(`${n} → ${nonProd ? "本番以外 (守りが効く)" : "本番・手元 (今までどおり)"}`, g.isNonProductionDeployment(e) === nonProd)

  console.log("2. 起動の時の守り (instrumentation と同じ assertEnvironmentSafe)")
  check("Vercel Production・本番の鍵 → 起動する", v({ VERCEL: "1", VERCEL_ENV: "production", ...prodKeys }).length === 0)
  check("Vercel Production の自分自身の URL は bondex.express (今までどおり)", self({ VERCEL: "1", VERCEL_ENV: "production" }) === "https://bondex.express")
  check("Vercel Preview・正しい staging の設定 → 起動する", v({ VERCEL: "1", VERCEL_ENV: "preview", ...stagingKeys }).length === 0, v({ VERCEL: "1", VERCEL_ENV: "preview", ...stagingKeys })[0])
  check("Vercel Preview の自分自身の URL は APP_BASE_URL (Preview 自身)", self({ VERCEL: "1", VERCEL_ENV: "preview", ...stagingKeys }) === stagingKeys.APP_BASE_URL)
  check("Vercel Preview・今の設定 (本番の鍵がそのまま) → 起動しない", v({ VERCEL: "1", VERCEL_ENV: "preview", ...prodKeys }).length === 1)
  const bad: Array<[string, Env]> = [
    ["BONDEX_ENV が無い", { BONDEX_ENV: undefined }],
    ["本番の Supabase の URL", { NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co` }],
    ["本番の service_role の鍵", { SUPABASE_SERVICE_ROLE_KEY: jwt(PROD) }],
    ["staging の DB が未設定 (URL なし)", { NEXT_PUBLIC_SUPABASE_URL: undefined }],
    ["STAGING_SUPABASE_REF が無い", { STAGING_SUPABASE_REF: undefined }],
    ["Stripe の本番の鍵", { STRIPE_SECRET_KEY: LIVE_SK }],
    ["Stripe の本番の公開鍵", { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: LIVE_PK }],
    ["メールを送る設定 (MAIL_TEST_CAPTURE なし)", { MAIL_TEST_CAPTURE: undefined }],
    ["Resend の鍵", { RESEND_API_KEY: "re_x" }],
    ["SMTP の鍵", { SMTP_HOST: "smtp.invalid" }],
    ["Ship&co の鍵", { SHIPANDCO_API_KEY: "x" }],
    ["Ship&co の実発行のスイッチ", { SHIPANDCO_LIVE: "true" }],
    ["Biz-Logi の鍵", { BIZLOGI_BASE_URL: "https://x.invalid" }],
    ["Biz-Logi の実送信のスイッチ", { BIZLOGI_LIVE: "true" }],
    ["Google Drive の鍵", { GOOGLE_DRIVE_SA_KEY: "{}" }],
    ["Slack の Webhook", { SLACK_WEBHOOK_URL: "https://hooks.invalid" }],
    ["WhatsApp の鍵", { WHATSAPP_CLOUD_TOKEN: "x" }],
    ["LINE の鍵", { LINE_CHANNEL_ACCESS_TOKEN: "x" }],
    ["自動の送り状の発行", { AUTO_ISSUE_ENABLED: "true" }],
    ["APP_BASE_URL が未設定", { APP_BASE_URL: undefined }],
    ["APP_BASE_URL が本番のドメイン", { APP_BASE_URL: "https://bondex.express" }],
    ["APP_BASE_URL が本番のドメイン (www)", { APP_BASE_URL: "https://www.bondex.express" }],
  ]
  for (const target of ["preview", "development"]) {
    for (const [n, over] of bad) {
      const e = { VERCEL: "1", VERCEL_ENV: target, ...stagingKeys, ...over }
      check(`${target}: ${n} → 起動しない`, v(e).length === 1)
    }
    check(`${target}: APP_BASE_URL が未設定なら自分自身の呼び出しは本番に向かない (止まる)`, self({ VERCEL: "1", VERCEL_ENV: target, ...stagingKeys, APP_BASE_URL: undefined }) === "THROWS")
    check(`${target}: APP_BASE_URL が本番なら自分自身の呼び出しは止まる`, self({ VERCEL: "1", VERCEL_ENV: target, APP_BASE_URL: "https://bondex.express/" }) === "THROWS")
  }
  check("エラーの文に鍵の値を出さない", !v({ VERCEL: "1", VERCEL_ENV: "preview", ...prodKeys })[0].includes(LIVE_SK) && !v({ VERCEL: "1", VERCEL_ENV: "preview", ...prodKeys })[0].includes(jwt(PROD)))
  // 2026-11-07 の設計 (f5b4721): 本番は宣言で決める。宣言の無い所 (手元・CI) で本番の鍵があれば止める。本番を触る手元の道具は BONDEX_ENV=production を明示する
  check("手元・CI で本番の鍵があって本番の宣言が無い → 止める", v({ ...prodKeys }).length === 1 && v({ CI: "true", GITHUB_ACTIONS: "true", ...prodKeys }).length === 1)
  check("手元で BONDEX_ENV=production を明示すれば本番の鍵で動く (運営の読み取りの道具)", v({ BONDEX_ENV: "production", ...prodKeys }).length === 0)
  check("手元・CI で本番の鍵が無ければ今までどおり (試験・開発を壊さない)", v({}).length === 0 && v({ CI: "true", GITHUB_ACTIONS: "true" }).length === 0)
  check("Vercel の Preview で BONDEX_ENV=production と書いても本番にならない (宣言の食い違いは本番にしない)", g.isProductionDeployment({ VERCEL: "1", VERCEL_ENV: "preview", BONDEX_ENV: "production" }) === false)

  console.log("3. 起動の処理 (instrumentation.ts) が本当に止める")
  {
    const realExit = process.exit
    let exited: number | null = null
    ;(process as unknown as { exit: (c?: number) => void }).exit = (c?: number) => { exited = c ?? 0; throw new Error("exit") }
    const saved = { ...process.env }
    Object.assign(process.env, { VERCEL: "1", VERCEL_ENV: "preview", NEXT_RUNTIME: "nodejs", ...prodKeys })
    const { register } = await import("../../instrumentation")
    try { register() } catch { /* exit を例外で止めた */ }
    check("Preview・本番の鍵のまま → 起動の処理が終了する (exit 1)", exited === 1)
    exited = null
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved, { VERCEL: "1", VERCEL_ENV: "production", NEXT_RUNTIME: "nodejs", ...prodKeys })
    let threw = false
    try { register() } catch { threw = true }
    check("Production・本番の鍵 → 起動する (終了しない)", exited === null && !threw)
    ;(process as unknown as { exit: typeof realExit }).exit = realExit
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }

  console.log("4. 起動の守りを抜けても、呼び出しの時に止まる (Stripe を直接作るルート・自分自身の呼び出し)")
  {
    // Webhook の鍵も入れて、「鍵が無いので何もしない」の手前ではなく、守りそのもので止まることを確かめる
    Object.assign(process.env, { VERCEL: "1", VERCEL_ENV: "preview", ...prodKeys, STRIPE_WEBHOOK_SECRET: "whsec_fakefakefake" })
    for (const [name, path] of [["setup-intent", "../../app/api/stripe/setup-intent/route"], ["card-confirm", "../../app/api/stripe/card-confirm/route"], ["stripe webhook", "../../app/api/stripe/webhook/route"]] as const) {
      const mod = await import(path)
      const f0 = fetches
      let status = 0
      try {
        const res = await mod.POST(new NextRequest(`http://localhost/api/${name}`, { method: "POST", body: "{}", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=x", authorization: "Bearer x" } }))
        status = res.status
      } catch { status = -1 }
      check(`${name}: Preview・本番の鍵 → Stripe に何も送らない (応答 ${status === -1 ? "例外" : status})`, fetches === f0 && status === -1, String(status))
    }
    const { selfBaseUrl } = g
    let blocked = false
    try { selfBaseUrl() } catch { blocked = true }
    check("Preview・APP_BASE_URL なし → 代理店の予約・送り状の自動発行の自分自身の呼び出しは止まる (本番の運営のパスワードを本番へ送らない)", blocked)
  }
  check("試験の全体で外への通信 0回", fetches === 0, String(fetches))
  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail ? 1 : 0)
})()
