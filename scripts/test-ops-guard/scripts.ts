// 手元の運用の道具 (本番の DB に触れる 2つ) の守りの試験 (2026-11-07)。外への通信は 0回 (fetch は模擬。本番・staging には接続しない)。
//   実行: npx tsx scripts/test-ops-guard/scripts.ts
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run as runImport } from "../sagawa-leadtime/import"
import { run as runCheck } from "../pickup-request/check-excel-rows"
import { prodWriteApprovalCode, contentDigest, readOnlyFetch } from "../../lib/ops/script-db-guard"
import { PROD_SUPABASE_REF, STAGING_SUPABASE_REF } from "../../lib/env-guard"

let pass = 0, fail = 0
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
const jwt = (payload: object) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.c2lnbm90cmVhbA`
const PROD_URL = `https://${PROD_SUPABASE_REF}.supabase.co`
const STG_URL = `https://${STAGING_SUPABASE_REF}.supabase.co`
const PROD_SR = jwt({ ref: PROD_SUPABASE_REF, role: "service_role" })
const PROD_ANON = jwt({ ref: PROD_SUPABASE_REF, role: "anon" })
const FUTURE = Math.floor(Date.now() / 1000) + 3600
const PROD_RO = jwt({ role: "bondex_excel_reader", exp: FUTURE })
const STG_SR = jwt({ ref: STAGING_SUPABASE_REF, role: "service_role" })
const prodEnv = { NEXT_PUBLIC_SUPABASE_URL: PROD_URL, SUPABASE_SERVICE_ROLE_KEY: PROD_SR }

// 模擬の PostgREST。送られた要求 (方法・パス) を記録する
interface Mock { calls: Array<{ method: string; path: string; apikey: string | null; auth: string | null }>; fetch: typeof fetch }
function mockDb(opts: { requests?: object[]; changes?: object[]; snapshot?: unknown; fail?: "throw" | 500 } = {}): Mock {
  const calls: Mock["calls"] = []
  const leg = { id: "11111111-1111-1111-1111-111111111111", booking_id: "BDX-TEST01", leg_index: 0, status: "issued", tracking_numbers: [], pickup_requested_at: null, suitcase_count: 2, shipment_date: "2026-11-10", expected_arrival: "2026-11-11" }
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input instanceof Request ? input.url : input))
    const method = (init?.method ?? "GET").toUpperCase()
    const h = new Headers(init?.headers)
    calls.push({ method, path: u.pathname, apikey: h.get("apikey"), auth: h.get("authorization") })
    if (opts.fail === "throw") throw new TypeError("fetch failed (模擬: DB に届かない)")
    if (opts.fail === 500) return new Response(JSON.stringify({ message: "模擬の障害" }), { status: 500, headers: { "content-type": "application/json" } })
    const json = (b: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json", ...extra } })
    const p = u.pathname.replace(/^\/rest\/v1\//, "")
    if (p === "rpc/excel_check_snapshot") return json("snapshot" in opts ? opts.snapshot : { complete: true, legs: [leg], requests: opts.requests ?? [], open_changes: opts.changes ?? [] })
    if (method === "HEAD") return new Response(null, { status: 200, headers: { "content-range": "0-0/42" } })
    if (method !== "GET") return json([], {})
    if (p === "shipments") return json([leg])
    if (p === "pickup_requests") return json(opts.requests ?? [])
    if (p === "shipment_change_requests") return json(opts.changes ?? [])
    return json([])
  }) as typeof fetch
  return { calls, fetch: f }
}
const writes = (m: Mock) => m.calls.filter((c) => c.method !== "GET" && c.method !== "HEAD").length

const W = mkdtempSync(join(tmpdir(), "ops-guard-"))
const rowsFile = join(W, "rows.json")
writeFileSync(rowsFile, JSON.stringify([{ "31": "BDX-TEST01-L1", "4": "2", "12": "20261110", "28": "20261111" }]))
const liveReq = { id: "r1", shipment_id: "11111111-1111-1111-1111-111111111111", channel: "bizlogi", state: "accepted" }

async function main() {
  const CSV = { "zip_offices.csv": "zip,office,prefecture,city,town,fetched_at\n1000001,東京,東京都,千代田区,,2026-01-01", "office_pairs.csv": "from_office,to_office,days,sample_from_zip,sample_to_zip,fetched_at\n東京,大阪,1,,,2026-01-01", "zip_pairs.csv": "from_zip,to_zip,from_office,to_office,days,source,fetched_at\n1000001,5300001,東京,大阪,1,api,2026-01-01" } as Record<string, string>
  const readFile = (n: string) => CSV[n]
  const digest = contentDigest(["zip_offices.csv", "office_pairs.csv", "zip_pairs.csv"].map((n) => CSV[n]))
  const now = new Date("2026-11-07T01:00:00Z")
  const code = prodWriteApprovalCode("sagawa-leadtime", digest, now)
  const imp = async (argv: string[], env: Record<string, string | undefined>, m = mockDb()) => {
    const out: string[] = []
    const rc = await runImport(argv, env, { readFile, fetch: m.fetch, log: (s) => out.push(s), now })
    return { rc, out: out.join("\n"), m }
  }

  console.log("[1] 本番の DB への書き込みの無断実行の防止 (import.ts)")
  let r = await imp([], prodEnv)
  ok("本番の鍵があるだけ → 計画の表示だけ・接続 0回", r.rc === 0 && r.m.calls.length === 0 && r.out.includes(code))
  r = await imp(["--write"], prodEnv)
  ok("--write だけ → 止める・接続 0回", r.rc === 1 && r.m.calls.length === 0 && /承認の文字列/.test(r.out))
  r = await imp(["--write"], { ...prodEnv, BONDEX_PROD_WRITE_APPROVAL: code, APPROVE_PROD_WRITE: code })
  ok("承認を環境変数に置いても効かない → 止める", r.rc === 1 && r.m.calls.length === 0)
  r = await imp(["--write", `--approve-prod-write=${prodWriteApprovalCode("sagawa-leadtime", digest, new Date("2026-11-05T01:00:00Z"))}`], prodEnv)
  ok("前の日の承認 → 止める", r.rc === 1 && r.m.calls.length === 0)
  r = await imp(["--write", `--approve-prod-write=${prodWriteApprovalCode("sagawa-leadtime", "000000000000", now)}`], prodEnv)
  ok("別の中身の承認 → 止める", r.rc === 1 && r.m.calls.length === 0)
  r = await imp(["--write", `--approve-prod-write=${prodWriteApprovalCode("other-tool", digest, now)}`], prodEnv)
  ok("別の道具の承認 → 止める", r.rc === 1 && r.m.calls.length === 0)
  r = await imp([`--approve-prod-write=${code}`], prodEnv)
  ok("承認だけで --write なし → 止める", r.rc === 1 && r.m.calls.length === 0)
  r = await imp(["--write", "--force", `--approve-prod-write=${code}`], prodEnv)
  ok("知らない指定 (--force) → 止める", r.rc === 1 && r.m.calls.length === 0)
  r = await imp(["--write", `--approve-prod-write=${code}`], prodEnv)
  ok("--write と正しい承認 → 書く (模擬)", r.rc === 0 && writes(r.m) === 3, r.out)
  r = await imp(["--write", "--approve-prod-write", code], prodEnv)
  ok("承認を「--approve-prod-write 値」の形でも受け取る", r.rc === 0 && writes(r.m) === 3)
  r = await imp(["--write"], { NEXT_PUBLIC_SUPABASE_URL: STG_URL, SUPABASE_SERVICE_ROLE_KEY: STG_SR })
  ok("staging へは --write だけで書ける (模擬)", r.rc === 0 && writes(r.m) === 3)
  r = await imp(["--write", `--approve-prod-write=${code}`], { NEXT_PUBLIC_SUPABASE_URL: STG_URL, SUPABASE_SERVICE_ROLE_KEY: STG_SR })
  ok("staging に本番の承認を付けた → 止める (取り違え)", r.rc === 1 && r.m.calls.length === 0)

  console.log("[2] 不正な実行モード・接続先の拒否")
  r = await imp(["--write", `--approve-prod-write=${code}`], { ...prodEnv, BONDEX_ENV: "staging" })
  ok("staging の宣言で本番へ → 止める", r.rc === 1 && r.m.calls.length === 0)
  r = await imp(["--write"], { NEXT_PUBLIC_SUPABASE_URL: PROD_URL, SUPABASE_SERVICE_ROLE_KEY: STG_SR })
  ok("本番の URL と staging の鍵 → 止める", r.rc === 1 && r.m.calls.length === 0)
  r = await imp(["--write"], { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: STG_SR })
  ok("知らない接続先 → 止める", r.rc === 1 && r.m.calls.length === 0)
  r = await imp(["--write"], { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: PROD_SR })
  ok("手元の URL に本番の鍵 → 止める", r.rc === 1 && r.m.calls.length === 0)

  const chk = async (argv: string[], env: Record<string, string | undefined>, m = mockDb()) => {
    const out: string[] = []
    const rc = await runCheck([rowsFile, ...argv], env, { fetch: m.fetch, log: (s) => out.push(s) })
    return { rc, out: out.join("\n"), m }
  }
  const allOk = (s: string) => s.includes("すべて Excel に入れて問題ありません")
  let c = await chk(["--ops-mode=excel-chek"], prodEnv)
  ok("照合: モードの打ち間違い → 止める・接続 0回", c.rc === 1 && c.m.calls.length === 0 && !allOk(c.out))
  c = await chk(["--ops-mode=write"], { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "local" })
  ok("照合: 手元でも不正なモード → 止める", c.rc === 1 && c.m.calls.length === 0)
  c = await chk(["--ops-mode=excel-check"], { ...prodEnv, BONDEX_ENV: "staging" })
  ok("照合: staging の宣言で本番 → 止める", c.rc === 1 && c.m.calls.length === 0)
  c = await chk(["--ops-mode=excel-check"], { NEXT_PUBLIC_SUPABASE_URL: PROD_URL, SUPABASE_SERVICE_ROLE_KEY: PROD_ANON })
  ok("照合: anon の鍵 (RLS で行が見えない) → 止める", c.rc === 1 && c.m.calls.length === 0)
  c = await chk(["--ops-mode=excel-check"], { ...prodEnv, NEXT_PUBLIC_SUPABASE_ANON_KEY: PROD_ANON, EXCEL_CHECK_READONLY_KEY: PROD_SR })
  ok("照合: 読み取り専用の欄に service_role の鍵 → 止める", c.rc === 1 && c.m.calls.length === 0)

  console.log("[3] 本番の鍵が混入した開発環境での停止")
  c = await chk([], prodEnv)
  ok("照合: 本番の鍵があるだけ (モードなし) → 止める・接続 0回", c.rc === 1 && c.m.calls.length === 0 && /運営の照合のモード/.test(c.out))
  r = await imp(["--write"], prodEnv)
  ok("import: 本番の鍵があるだけ → 書かない", r.rc === 1 && writes(r.m) === 0)

  console.log("[4] Preview・CI からの実行の拒否")
  for (const extra of [{ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "x.vercel.app" }, { VERCEL: "1", VERCEL_ENV: "production", VERCEL_URL: "bondex.express" }, { VERCEL_ENV: "" }, { CI: "true" }, { GITHUB_ACTIONS: "true" }]) {
    const label = Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(" ")
    c = await chk(["--ops-mode=excel-check"], { ...prodEnv, ...extra })
    ok(`照合: ${label} → 止める`, c.rc === 1 && c.m.calls.length === 0)
    r = await imp(["--write", `--approve-prod-write=${code}`], { ...prodEnv, ...extra })
    ok(`import: ${label} → 止める`, r.rc === 1 && r.m.calls.length === 0)
  }

  console.log("[5] 読み取り専用の照合の正常動作")
  c = await chk(["--ops-mode=excel-check"], prodEnv)
  ok("移行期 (service_role): 依頼なし → OK・読み取りだけ", c.rc === 0 && allOk(c.out) && writes(c.m) === 0 && c.m.calls.length === 3, c.out)
  c = await chk(["--ops-mode", "excel-check"], prodEnv, mockDb({ requests: [liveReq] }))
  ok("移行期: 依頼の記録あり → NG・終了コード 1", c.rc === 1 && /NG/.test(c.out) && !allOk(c.out))
  c = await chk(["--ops-mode=excel-check"], prodEnv, mockDb({ changes: [{ shipment_id: liveReq.shipment_id, kind: "cancel", stage: "requested" }] }))
  ok("移行期: 変更・取消の申請中 → NG", c.rc === 1 && /申請/.test(c.out))
  const ro = { NEXT_PUBLIC_SUPABASE_URL: PROD_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: PROD_ANON, EXCEL_CHECK_READONLY_KEY: PROD_RO }
  c = await chk(["--ops-mode=excel-check"], ro)
  ok("読み取りの役割: 関数を GET で 1回だけ・依頼なし → OK", c.rc === 0 && allOk(c.out) && c.m.calls.length === 1 && c.m.calls[0].method === "GET" && c.m.calls[0].path.endsWith("/rpc/excel_check_snapshot"), JSON.stringify(c.m.calls))
  ok("読み取りの役割: apikey は公開の鍵 (anon)・Authorization は役割の鍵 (ゲートウェイの決まり)", c.m.calls[0]?.apikey === PROD_ANON && c.m.calls[0]?.auth === `Bearer ${PROD_RO}`)
  c = await chk(["--ops-mode=excel-check"], { NEXT_PUBLIC_SUPABASE_URL: PROD_URL, EXCEL_CHECK_READONLY_KEY: PROD_RO })
  ok("読み取りの役割: 公開の鍵が無い → 止める", c.rc === 1 && c.m.calls.length === 0)
  c = await chk(["--ops-mode=excel-check"], { ...ro, NEXT_PUBLIC_SUPABASE_ANON_KEY: PROD_SR })
  ok("読み取りの役割: 公開の鍵の欄に service_role → 止める", c.rc === 1 && c.m.calls.length === 0)
  c = await chk(["--ops-mode=excel-check"], { ...ro, EXCEL_CHECK_READONLY_KEY: jwt({ role: "bondex_excel_reader", exp: Math.floor(Date.now() / 1000) - 60 }) })
  ok("読み取りの役割: 有効期限切れ → 止める・接続 0回", c.rc === 1 && c.m.calls.length === 0 && /期限が切れ/.test(c.out))
  c = await chk(["--ops-mode=excel-check"], { ...ro, EXCEL_CHECK_READONLY_KEY: jwt({ role: "bondex_excel_reader" }) })
  ok("読み取りの役割: 有効期限なし → 止める", c.rc === 1 && c.m.calls.length === 0)
  c = await chk(["--ops-mode=excel-check"], { ...ro, EXCEL_CHECK_READONLY_KEY: jwt({ role: "bondex_excel_reader", ref: STAGING_SUPABASE_REF, exp: FUTURE }) })
  ok("読み取りの役割: 鍵が staging のもの → 止める", c.rc === 1 && c.m.calls.length === 0)
  c = await chk(["--ops-mode=excel-check"], { ...ro, SUPABASE_SERVICE_ROLE_KEY: PROD_SR })
  ok("読み取りの役割の鍵があれば service_role より優先", c.rc === 0 && c.m.calls.length === 1 && /読み取りだけの役割/.test(c.out))
  c = await chk(["--ops-mode=excel-check"], ro, mockDb({ requests: [liveReq] }))
  ok("読み取りの役割: 依頼の記録あり → NG", c.rc === 1 && /NG/.test(c.out))
  c = await chk(["--ops-mode=excel-check"], ro, mockDb({ snapshot: { legs: [], requests: [], open_changes: [] } }))
  ok("読み取りの役割: 関数の結果に complete が無い → 止める", c.rc === 1 && !allOk(c.out))
  c = await chk(["--ops-mode=excel-check"], ro, mockDb({ snapshot: null }))
  ok("読み取りの役割: 関数の結果が空 → 止める", c.rc === 1 && !allOk(c.out))
  let threw = false
  try { await readOnlyFetch(mockDb().fetch)("http://127.0.0.1/rest/v1/shipments", { method: "PATCH" }) } catch { threw = true }
  ok("読み取りの接続は PATCH を送る前に止める", threw)
  threw = false
  try { await readOnlyFetch(mockDb().fetch)("http://127.0.0.1/rest/v1/rpc/x", { method: "POST" }) } catch { threw = true }
  ok("読み取りの接続は POST (関数の呼び出しの書き込み) も止める", threw)

  console.log("[6] DB の接続の失敗で止める")
  c = await chk(["--ops-mode=excel-check"], prodEnv, mockDb({ fail: "throw" }))
  ok("届かない → 止める (OK と言わない)", c.rc === 1 && !allOk(c.out))
  c = await chk(["--ops-mode=excel-check"], prodEnv, mockDb({ fail: 500 }))
  ok("500 → 止める", c.rc === 1 && !allOk(c.out))
  c = await chk(["--ops-mode=excel-check"], ro, mockDb({ fail: 500 }))
  ok("読み取りの役割で 500 → 止める", c.rc === 1 && !allOk(c.out))
  writeFileSync(join(W, "empty.json"), "[]")
  const out: string[] = []
  const rc = await runCheck([join(W, "empty.json"), "--ops-mode=excel-check"], prodEnv, { fetch: mockDb().fetch, log: (s) => out.push(s) })
  ok("区間が 0件 → OK と言わない", rc === 1 && !allOk(out.join("\n")))

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main()
