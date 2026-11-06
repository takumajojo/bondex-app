// 本番に届く URL の守り (2026-11-06 B2C 監査): 本番の別名を APP_BASE_URL・B2C_SITE_URL に入れても止める・
// Preview・staging で B2C_SITE_URL が無ければ本番のリンクを作らない・本番は今までどおり。
//   実行: npx tsx scripts/test-staging-guard/site-urls.ts
// 外へは何も送らない (fetch を止めて、呼ばれた先を数える)。DB は偽物 (メモリの中)。鍵はすべて試験用の偽物。
import { createRequire } from "node:module"
import path from "node:path"

const fetched: string[] = []
globalThis.fetch = (async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error("network blocked in test") }) as typeof fetch

let pass = 0, fail = 0
const check = (name: string, ok: boolean, info = "") => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name} ${info}`) } }
const throws = (f: () => unknown) => { try { f(); return false } catch { return true } }

// 偽の Supabase (processB2cOutbox が読む・書く分だけ)。書き込みは記録する
const updates: Array<Record<string, unknown>> = []
let claimRows: unknown[] = []
const ORDER = {
  id: "00000000-0000-0000-0000-0000000000b2", order_number: "B2C-TEST", status: "confirmed", language: "en", guest_name: "Test Guest",
  guest_email: "guest@example.invalid", guest_whatsapp: null, origin_snapshot: { name: "H1" }, dest_snapshot: { name: "H2" },
  pickup_date: "2026-12-01", delivery_date: "2026-12-02", pieces: 1, total_gross_yen: 3000, confirmation_due_at: null, cancel_reason: null,
}
function builder(table: string) {
  let op = "select"
  let patch: Record<string, unknown> | null = null
  const b: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "in", "order", "limit"]) b[m] = () => b
  b.update = (p: Record<string, unknown>) => { op = "update"; patch = p; return b }
  b.maybeSingle = async () => {
    if (op === "update") { updates.push({ table, ...patch! }); return { data: { id: 1 }, error: null } }
    return { data: table === "b2c_orders" ? ORDER : table === "shipments" ? { status: "requested" } : null, error: null }
  }
  b.then = (res: (v: unknown) => unknown) => { if (op === "update") updates.push({ table, ...patch! }); return Promise.resolve({ data: op === "update" ? { id: 1 } : [], error: null }).then(res) }
  return b
}
const fakeSb = {
  from: (t: string) => builder(t),
  rpc: async (fn: string) => {
    if (fn === "b2c_outbox_claim") { const r = claimRows; claimRows = []; return { data: r, error: null } }
    return { data: {}, error: null }
  },
}
const req = createRequire(import.meta.url)
const supaPath = req.resolve(path.resolve(process.cwd(), "lib/supabase.ts"))
req.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: { getSupabase: () => fakeSb } } as never

const PROD_ALIASES = [
  "https://bondex.express", "https://www.bondex.express", "https://bondex-poc-main.vercel.app",
  "https://bondex-poc-main-saxphonebaby-2794s-projects.vercel.app", "https://bondex-poc-main-git-main-saxphonebaby-2794s-projects.vercel.app",
  // 書き方の違いで本番に届くもの
  "https://BONDEX.EXPRESS/", "https://bondex.express./", "http://bondex.express", "https://bondex.express:443/path", "https://user@bondex.express",
  "bondex.express", "https://staging.bondex.express", "https://bondex-poc-main.vercel.app.",
]
const PREVIEW = {
  VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "bondex-poc-main-abc123-saxphonebaby-2794s-projects.vercel.app",
  BONDEX_ENV: "staging", STAGING_SUPABASE_REF: "oeucjrmuigtfnwowvzwr", MAIL_TEST_CAPTURE: "1",
  NEXT_PUBLIC_SUPABASE_URL: "https://oeucjrmuigtfnwowvzwr.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_FAKE",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_FAKE", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_FAKE", STRIPE_SECRET_KEY: "sk_test_FAKE",
}
const PRODUCTION = { VERCEL: "1", VERCEL_ENV: "production", VERCEL_URL: "bondex-poc-main-xyz-saxphonebaby-2794s-projects.vercel.app" }
const URL_KEYS = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "BONDEX_ENV", "APP_BASE_URL", "B2C_SITE_URL", ...Object.keys(PREVIEW)]
const setEnv = (e: Record<string, string>) => { for (const k of URL_KEYS) delete process.env[k]; Object.assign(process.env, e) }

;(async () => {
  const guard = await import("../../lib/env-guard")
  process.env.B2C_ACCESS_TOKEN_SECRET = "x".repeat(40)
  const { b2cMyBookingUrl } = await import("../../lib/b2c/access-token")
  const { processB2cOutbox } = await import("../../lib/b2c/notify")

  console.log("1. Preview: 本番の別名を APP_BASE_URL・B2C_SITE_URL に入れると止める")
  for (const u of PROD_ALIASES) {
    const env = { ...PREVIEW, APP_BASE_URL: u, B2C_SITE_URL: "https://preview.invalid" }
    check(`APP_BASE_URL=${u}: 起動を止める・自分自身の呼び出しも止める`, guard.environmentViolations(env).some((v) => v.startsWith("APP_BASE_URL")) && throws(() => guard.selfBaseUrl(env)))
    const env2 = { ...PREVIEW, APP_BASE_URL: "https://preview.invalid", B2C_SITE_URL: u }
    check(`B2C_SITE_URL=${u}: 起動を止める・リンクも作らない`, guard.environmentViolations(env2).some((v) => v.startsWith("B2C_SITE_URL")) && throws(() => guard.b2cSiteBaseUrl(env2)))
  }
  check("Preview の配置そのものの URL (bondex-poc-main-<hash>-…) は本番の別名として扱わない (Preview が自分を呼べる)", !guard.isProductionSiteHost("bondex-poc-main-abc123-saxphonebaby-2794s-projects.vercel.app"))
  check("bondex.express に似た別のドメイン (notbondex.express) は本番として扱わない", !guard.isProductionSiteHost("notbondex.express"))

  console.log("2. Preview: B2C_SITE_URL が無ければ本番のリンクを作らない")
  setEnv({ ...PREVIEW, APP_BASE_URL: "https://preview.invalid" })
  check("B2C_SITE_URL なし: b2cSiteBaseUrl は例外", throws(() => guard.b2cSiteBaseUrl()))
  check("B2C_SITE_URL なし: My Booking のリンクは作らない (例外)", throws(() => b2cMyBookingUrl(ORDER.id, "en")))
  updates.length = 0; fetched.length = 0
  claimRows = [{ id: 1, order_id: ORDER.id, kind: "booking_confirmed", channel: "email", dedupe_key: "k1", attempts: 0, rendered: null, first_send_at: null, expires_at: null, priority: 1, ref_id: null }]
  let sent = 0
  const transport = { email: async () => { sent++; return { ok: true, provider: "test" } }, whatsapp: async () => { sent++; return { ok: true, provider: "test" } }, whatsappEnabled: false }
  const r = await processB2cOutbox(transport as never, new Date("2026-11-30T00:00:00Z"), { budgetMs: 2000, alert: (async () => {}) as never })
  const back = updates.find((u) => u.table === "b2c_outbox" && u.last_error === "site_url_not_configured")
  check("通知の送信: 送らない (0通)", sent === 0, String(sent))
  check("通知の送信: 行を pending に戻し、理由 site_url_not_configured を残す (設定の後に再試行)", !!back && back.status === "pending" && back.locked_at === null, JSON.stringify(updates))
  check("通知の送信: 処理は例外で落ちずに続く (released に数える)", r.released === 1, JSON.stringify(r))
  check("通知の送信: 文面 (本番の URL を含むもの) を記録しない", !updates.some((u) => JSON.stringify(u).includes("bondex.express")))

  console.log("3. Preview: preview.invalid の時、本番への通信が起きない")
  setEnv({ ...PREVIEW, APP_BASE_URL: "https://preview.invalid", B2C_SITE_URL: "https://preview.invalid" })
  check("起動の守りを通る (違反 0件)", guard.environmentViolations().length === 0, JSON.stringify(guard.environmentViolations()))
  check("自分自身の呼び出し先は preview.invalid", guard.selfBaseUrl() === "https://preview.invalid")
  check("お客さまのリンクは preview.invalid", b2cMyBookingUrl(ORDER.id, "ja").startsWith("https://preview.invalid/my/") && b2cMyBookingUrl(ORDER.id, "ja").endsWith("?lang=ja"))
  fetched.length = 0; updates.length = 0
  claimRows = [{ id: 2, order_id: ORDER.id, kind: "booking_confirmed", channel: "email", dedupe_key: "k2", attempts: 0, rendered: null, first_send_at: null, expires_at: null, priority: 1, ref_id: null }]
  let body = ""
  const t2 = { email: async (_to: string, _s: string, text: string) => { body = text; return { ok: true, provider: "test" } }, whatsapp: async () => ({ ok: true, provider: "test" }), whatsappEnabled: false }
  await processB2cOutbox(t2 as never, new Date("2026-11-30T00:00:00Z"), { budgetMs: 2000, alert: (async () => {}) as never })
  const links = body.match(/https?:\/\/[^\s)]+/g) ?? []
  check("通知の文面のリンクはすべて preview.invalid で、本番のホストのリンクが無い", links.length > 0 && links.every((u) => new URL(u).hostname === "preview.invalid"), JSON.stringify(links))
  try { await fetch(`${guard.selfBaseUrl()}/api/shipandco/create`, { method: "POST" }) } catch { /* 試験では通信を止めている */ }
  check("本番のホストへの通信 0回 (呼んだのは preview.invalid だけ)", fetched.length > 0 && fetched.every((u) => new URL(u).hostname === "preview.invalid"), JSON.stringify(fetched))

  console.log("4. 本番: 今までどおり")
  setEnv({ ...PRODUCTION })
  check("本番の配置と判定", guard.isProductionDeployment())
  check("B2C_SITE_URL なし: 既定の https://bondex.express (今までどおり)", guard.b2cSiteBaseUrl() === "https://bondex.express")
  check("My Booking のリンクは https://bondex.express/my/… (今までどおり)", b2cMyBookingUrl(ORDER.id, "en").startsWith("https://bondex.express/my/") && !b2cMyBookingUrl(ORDER.id, "en").includes("?lang"))
  check("APP_BASE_URL なし: 自分自身の呼び出しは https://bondex.express (今までどおり)", guard.selfBaseUrl() === "https://bondex.express")
  setEnv({ ...PRODUCTION, B2C_SITE_URL: "https://bondex.express/", APP_BASE_URL: "https://bondex.express" })
  check("本番で B2C_SITE_URL・APP_BASE_URL に本番のドメインを入れても止めない (今までどおり)", guard.environmentViolations().length === 0 && guard.b2cSiteBaseUrl() === "https://bondex.express" && guard.selfBaseUrl() === "https://bondex.express")

  console.log("5. 手元 (Vercel でも staging でもない): 今までどおり")
  setEnv({})
  check("B2C_SITE_URL なし: 既定の https://bondex.express (手元の開発は変えない)", guard.b2cSiteBaseUrl() === "https://bondex.express")
  setEnv({ BONDEX_ENV: "staging" })
  check("手元で BONDEX_ENV=staging: B2C_SITE_URL が無ければ例外 (staging は本番のリンクを作らない)", throws(() => guard.b2cSiteBaseUrl()))

  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail ? 1 : 0)
})()
