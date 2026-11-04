/**
 * 運営のパスキーの登録の API（email-code → register-options → register-verify）の総当たり対策の試験（Stage 6 B2）。
 *
 * 共有の DB（public）・REST・開発サーバーは使わない: Supabase の REST の代わりに、この台本の中で小さな模擬の
 * サーバーを立て、rpc の呼び出しをローカルの Docker のコンテナの独立した試験用のデータベース（bondex_b2auth_routes）の
 * 関数に psql で渡す。メールは送らない（MAIL_TEST_CAPTURE=1 で捕まえる）。API のルートの関数をそのまま呼ぶ。
 * 実行: set -a; . ./.env.local; set +a; npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-b2c/operator_email_code_routes.ts
 */
import { createServer } from "node:http"
import { execFile, execFileSync } from "node:child_process"
import { promisify } from "node:util"
import { readFileSync } from "node:fs"
import type { AddressInfo } from "node:net"

const run = promisify(execFile)
const C = "supabase_db_supa-local"
const DB = "bondex_b2auth_routes"
const psql = (db: string, q: string) => execFileSync("docker", ["exec", "-i", C, "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-qtA", "-c", q], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
let passed = 0
let failed = 0
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400)) }
}
const lit = (v: unknown) => (v === null || v === undefined ? "null" : typeof v === "boolean" ? String(v) : `'${String(v).replace(/'/g, "''")}'`)

async function main() {
  psql("postgres", `drop database if exists ${DB}`)
  psql("postgres", `create database ${DB}`)
  execFileSync("docker", ["exec", "-i", C, "psql", "-U", "postgres", "-d", DB, "-v", "ON_ERROR_STOP=1", "-q"], { input: readFileSync("sql/077_operator_email_code_attempts.sql", "utf8"), stdio: ["pipe", "pipe", "pipe"] })

  // 模擬の Supabase の REST（rpc の 2つの関数と operator_passkeys の一覧だけ）
  const server = createServer(async (req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    await new Promise((r) => req.on("end", r))
    const url = req.url ?? ""
    res.setHeader("content-type", "application/json")
    if (url.startsWith("/rest/v1/rpc/operator_email_challenge_")) {
      const fn = url.split("/").pop()!.split("?")[0]
      const a = JSON.parse(body || "{}")
      const args = fn === "operator_email_challenge_issue"
        ? `${lit(a.p_id)}::uuid, ${lit(a.p_email)}, ${lit(a.p_code_hash)}, ${lit(a.p_now)}::timestamptz`
        : `${lit(a.p_id)}::uuid, ${lit(a.p_email)}, ${lit(a.p_code_hash)}, ${lit(a.p_consume)}, ${lit(a.p_now)}::timestamptz`
      try {
        const { stdout } = await run("docker", ["exec", "-i", C, "psql", "-U", "postgres", "-d", DB, "-qtA", "-c", `select public.${fn}(${args})`])
        res.end(JSON.stringify(stdout.trim()))
      } catch (e) {
        res.statusCode = 500
        res.end(JSON.stringify({ message: String(e).slice(0, 200) }))
      }
      return
    }
    if (url.startsWith("/rest/v1/operator_passkeys")) return void res.end("[]")
    res.statusCode = 404
    res.end("{}")
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
  const port = (server.address() as AddressInfo).port
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-not-real"
  process.env.MAIL_TEST_CAPTURE = "1"
  process.env.RESEND_API_KEY = "re_test_dummy_not_real"
  process.env.OPERATOR_EMAILS = "ops-allowed@example.invalid"
  delete process.env.OPERATOR_PASSWORD

  const { NextRequest } = await import("next/server")
  const emailCode = (await import("@/app/api/operator/passkey/email-code/route")).POST
  const regOptions = (await import("@/app/api/operator/passkey/register-options/route")).POST
  const regVerify = (await import("@/app/api/operator/passkey/register-verify/route")).POST
  const g = globalThis as unknown as { __capturedMails?: Array<{ to: string; subject: string }> }
  let ip = 0
  const call = async (handler: (r: InstanceType<typeof NextRequest>) => Promise<Response>, path: string, body: unknown, cookie = "") => {
    ip++
    const req = new NextRequest(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": `10.55.${ip >> 8}.${ip % 250}`, cookie }, body: JSON.stringify(body) })
    const res = await handler(req)
    const setCookie = res.headers.get("set-cookie") ?? ""
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown>, setCookie }
  }
  const cookieOf = (set: string) => /bondex_op_emailcode=([^;]+)/.exec(set)?.[1] ?? ""
  const lastCode = () => /認証コード (\d{6})/.exec(g.__capturedMails?.at(-1)?.subject ?? "")?.[1] ?? ""
  const E = "ops-allowed@example.invalid"

  console.log("R1. 正しい流れ: コードの送信 → 登録の第1段 → 第2段（コードは 1回限り）")
  const s1 = await call(emailCode, "/api/operator/passkey/email-code", { email: E })
  const ck1 = cookieOf(s1.setCookie)
  const code1 = lastCode()
  ok("コードの送信 200・cookie にコードが入らない・記録は DB（HMAC だけ）", s1.status === 200 && ck1.startsWith("e2.") && !ck1.includes(code1) && psql(DB, "select count(*) from operator_email_challenges") === "1")
  const o1 = await call(regOptions, "/api/operator/passkey/register-options", { email: E, code: code1 }, `bondex_op_emailcode=${ck1}`)
  ok("登録の第1段: 正しいコード → 200（登録のオプション）", o1.status === 200 && !!(o1.json.options as { challenge?: string } | undefined)?.challenge, o1)
  const v1 = await call(regVerify, "/api/operator/passkey/register-verify", { email: E, code: code1, attestation: {} }, `bondex_op_emailcode=${ck1}`)
  ok("登録の第2段: コードを使い切る（パスキーの検証の前で止まる: チャレンジの cookie が無い）", v1.status === 400 && psql(DB, "select status from operator_email_challenges") === "used", [v1.status, v1.json])
  const v2 = await call(regVerify, "/api/operator/passkey/register-verify", { email: E, code: code1, attestation: {} }, `bondex_op_emailcode=${ck1}`)
  ok("同じコードをもう一度 → 401（使用済み）", v2.status === 401 && String(v2.json.error).includes("使用済み"), v2.json)
  const o2 = await call(regOptions, "/api/operator/passkey/register-options", { email: E, code: code1 }, `bondex_op_emailcode=${ck1}`)
  ok("使用済みのコードで第1段も通らない", o2.status === 401)

  console.log("R2. 総当たり: 5回の失敗で無効化・送り直しで戻らない・60分止める")
  const s2 = await call(emailCode, "/api/operator/passkey/email-code", { email: E })
  const ck2 = cookieOf(s2.setCookie)
  const code2 = lastCode()
  const w = code2 === "000000" ? "000001" : "000000"
  const st: number[] = []
  for (let i = 0; i < 4; i++) st.push((await call(regOptions, "/api/operator/passkey/register-options", { email: E, code: w }, `bondex_op_emailcode=${ck2}`)).status)
  const s3 = await call(emailCode, "/api/operator/passkey/email-code", { email: E })
  const ck3 = cookieOf(s3.setCookie)
  const code3 = lastCode()
  const w3 = code3 === "000000" ? "000001" : "000000"
  const fifth = await call(regOptions, "/api/operator/passkey/register-options", { email: E, code: w3 }, `bondex_op_emailcode=${ck3}`)
  ok("4回間違え → 送り直し → 1回間違えると無効（合計 5回）", st.every((x) => x === 401) && fifth.status === 401 && String(fifth.json.error).includes("5回"), [st, fifth.json])
  const right = await call(regOptions, "/api/operator/passkey/register-options", { email: E, code: code3 }, `bondex_op_emailcode=${ck3}`)
  ok("無効化の後は正しいコードでも 401", right.status === 401)
  const s4 = await call(emailCode, "/api/operator/passkey/email-code", { email: E })
  ok("無効化されたメールには新しいコードを出さない（429・メールも送らない）", s4.status === 429 && !cookieOf(s4.setCookie), [s4.status, s4.json])
  ok("前のコード（送り直す前）も使えない", (await call(regOptions, "/api/operator/passkey/register-options", { email: E, code: code2 }, `bondex_op_emailcode=${ck2}`)).status === 401)

  console.log("R3. 同時の要求（30件）でも 5回を超えて試せない")
  process.env.OPERATOR_EMAILS = "ops-allowed@example.invalid,ops-race@example.invalid"
  const s5 = await call(emailCode, "/api/operator/passkey/email-code", { email: "ops-race@example.invalid" })
  const ck5 = cookieOf(s5.setCookie)
  const code5 = lastCode()
  const par = await Promise.all(Array.from({ length: 30 }, (_, i) => call(regOptions, "/api/operator/passkey/register-options", { email: "ops-race@example.invalid", code: String((Number(code5) + 1 + i) % 1_000_000).padStart(6, "0") }, `bondex_op_emailcode=${ck5}`)))
  ok("30件すべて 401・DB の試行は 5回ちょうど・無効", par.every((r) => r.status === 401) && psql(DB, "select status || '|' || attempts from operator_email_challenges where email='ops-race@example.invalid'") === "locked|5")

  console.log("R4. 許可されていないメール（アカウントの列挙の防止）・運営のパスワードの経路")
  const n0 = g.__capturedMails?.length ?? 0
  const s6 = await call(emailCode, "/api/operator/passkey/email-code", { email: "stranger@example.invalid" })
  ok("許可外のメールにも同じ応答（200・cookie あり）・メールは送らない", s6.status === 200 && !!cookieOf(s6.setCookie) && (g.__capturedMails?.length ?? 0) === n0)
  ok("許可外のメールはどのコードでも通らない", (await call(regOptions, "/api/operator/passkey/register-options", { email: "stranger@example.invalid", code: "123456" }, `bondex_op_emailcode=${cookieOf(s6.setCookie)}`)).status === 401)
  process.env.OPERATOR_PASSWORD = "test-operator-password-not-real"
  const pw = await call(regOptions, "/api/operator/passkey/register-options", { password: "test-operator-password-not-real" })
  ok("運営のパスワードでの登録の第1段は今までどおり（メールのコードを数えない）", pw.status === 200 && !!(pw.json.options as { challenge?: string } | undefined)?.challenge, pw.status)
  const pwBad = await call(regOptions, "/api/operator/passkey/register-options", { password: "wrong" })
  ok("運営のパスワードの誤りは 401（今までどおり）", pwBad.status === 401)
  ok("監査の記録にコードが入っていない", !psql(DB, "select string_agg(coalesce(detail,'') || coalesce(email,''), ' ') from operator_auth_events").match(/\b\d{6}\b/))

  server.close()
  psql("postgres", `drop database if exists ${DB}`)
  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); try { psql("postgres", `drop database if exists ${DB}`) } catch { /* */ } process.exit(1) })
