/**
 * P0-1 の DB の障害の試験（2026-11-08）: DB に届かない時、ホテルの確認の API が 2xx を返さず・例外で落ちず・何も変えないこと。
 * ルートをこの処理の中で直接呼ぶ。Supabase の URL を、つながらないローカルの番号（127.0.0.1:9）にする。外には接続しない。
 *   実行: set -a; . ./.env.local; set +a; npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-b2c/p0_hotel_dbdown.ts
 */
import { execFileSync } from "node:child_process"
import { NextRequest } from "next/server"

if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("refusing: local only")
let passed = 0, failed = 0
const ok = (name: string, cond: boolean, detail?: unknown) => { if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, JSON.stringify(detail ?? "").slice(0, 300)) } }
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-qtA", "-c", q], { encoding: "utf8" }).trim()

async function main() {
  sql(`insert into operator_passkeys(credential_id, public_key, operator_email) values ('dbdown-cred-000000000001', '\\x00', 'ops-dbdown@example.invalid') on conflict do nothing`)
  sql(`insert into b2c_facilities(place_id, name, status) values ('dbdown_hotel_000001', 'x', 'unknown') on conflict (place_id) do update set status='unknown', checked_by=null, last_verified_at=null`)
  const before = sql(`select status from b2c_facilities where place_id='dbdown_hotel_000001'`)
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9" // DB に届かない
  const { issueOperatorSession, OPERATOR_SESSION_COOKIE } = await import("@/lib/operator-session")
  const { GET, POST } = await import("@/app/api/b2c/ops/hotel/route")
  const cookie = `${OPERATOR_SESSION_COOKIE}=${await issueOperatorSession("dbdown-cred-000000000001")}`
  const mk = (method: string, body?: unknown) => new NextRequest("http://localhost/api/b2c/ops/hotel", { method, headers: { cookie, "content-type": "application/json", "x-real-ip": `10.98.0.${Math.floor(Math.random() * 200) + 1}` }, body: body ? JSON.stringify(body) : undefined })
  let g: Response | null = null, p: Response | null = null, threw = ""
  try {
    g = await GET(mk("GET"))
    p = await POST(mk("POST", { action: "facility", placeId: "dbdown_hotel_000001", status: "unsupported", note: "障害中の操作" }))
  } catch (e) { threw = String(e) }
  ok("例外で落ちない", !threw, threw)
  ok("一覧: 2xx を返さない（中身の無い一覧を「ありません」と見せない）", !!g && g.status >= 400, g?.status)
  ok("操作: 2xx を返さない", !!p && p.status >= 400, p?.status)
  ok("運営者を確かめられない時は操作を拒否（失敗の側に倒す: 403）", p?.status === 403 && g?.status === 403, [g?.status, p?.status])
  ok("DB は何も変わっていない", sql(`select status from b2c_facilities where place_id='dbdown_hotel_000001'`) === before)
  console.log(`p0_hotel_dbdown: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
