/**
 * 運営のパスキーの登録のメールの 6桁のコードの総当たり対策の試験（Stage 6 の Blocker B2・sql/077・lib/operator-email-challenge.ts）。
 *
 * 共有の DB（public）・REST・開発サーバーは使わない。ローカルの Docker のコンテナの中に独立した試験用のデータベース
 * （既定 bondex_b2auth_test・B2AUTH_TEST_DB で変更）を作り、DB の関数を psql で直接呼ぶ（アプリの照合の処理はそのまま使う）。
 * 実行: set -a; . ./.env.local; set +a; npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-b2c/operator_email_code.ts
 */
import { execFile, execFileSync } from "node:child_process"
import { promisify } from "node:util"
import { readFileSync } from "node:fs"
import { attemptEmailCode, issueEmailChallenge, newEmailCode, type ChallengeRpc } from "@/lib/operator-email-challenge"
import { issueEmailChallengeCookie } from "@/lib/operator-session"

const run = promisify(execFile)
const C = "supabase_db_supa-local"
const DB = process.env.B2AUTH_TEST_DB ?? "bondex_b2auth_test"
if (!/^bondex_[a-z0-9_]+$/.test(DB) || DB === "postgres") throw new Error("refusing: test database name")
let passed = 0
let failed = 0
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 500)) }
}
const psql = (db: string, q: string) => execFileSync("docker", ["exec", "-i", C, "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "|", "-c", q], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
const sql = (q: string) => psql(DB, q)
const sqlFails = (q: string) => { try { sql(q); return false } catch { return true } }
const lit = (v: unknown) => (v === null || v === undefined ? "null" : typeof v === "boolean" ? String(v) : `'${String(v).replace(/'/g, "''")}'`)

/** DB の関数を独立した試験用のデータベースで呼ぶ（Supabase の rpc の代わり） */
const rpc: ChallengeRpc = async (fn, a) => {
  const args = fn === "operator_email_challenge_issue"
    ? `${lit(a.p_id)}::uuid, ${lit(a.p_email)}, ${lit(a.p_code_hash)}, ${lit(a.p_now)}::timestamptz`
    : `${lit(a.p_id)}::uuid, ${lit(a.p_email)}, ${lit(a.p_code_hash)}, ${lit(a.p_consume)}, ${lit(a.p_now)}::timestamptz`
  try {
    const { stdout } = await run("docker", ["exec", "-i", C, "psql", "-U", "postgres", "-d", DB, "-v", "ON_ERROR_STOP=1", "-qtA", "-c", `select public.${fn}(${args})`])
    return { data: stdout.trim(), error: null }
  } catch (e) {
    return { data: null, error: String(e) }
  }
}
const idOf = (cookie: string) => cookie.split(".")[2]
const st = (id: string) => sql(`select status || '|' || attempts from operator_email_challenges where id='${id}'`)
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000)

async function main() {
  // 独立した試験用のデータベースを作る（共有の public には触れない）
  psql("postgres", `drop database if exists ${DB}`)
  psql("postgres", `create database ${DB}`)
  execFileSync("docker", ["exec", "-i", C, "psql", "-U", "postgres", "-d", DB, "-v", "ON_ERROR_STOP=1", "-q"], { input: readFileSync("sql/077_operator_email_code_attempts.sql", "utf8"), stdio: ["pipe", "pipe", "pipe"] })
  execFileSync("docker", ["exec", "-i", C, "psql", "-U", "postgres", "-d", DB, "-v", "ON_ERROR_STOP=1", "-q"], { input: readFileSync("sql/077_operator_email_code_attempts.sql", "utf8"), stdio: ["pipe", "pipe", "pipe"] })
  ok("sql/077 を独立した DB に 2回流せる（再実行できる）", sql("select count(*) from pg_proc where proname like 'operator_email_challenge_%'") === "2")
  const t0 = new Date()

  console.log("A. 1回限り（登録の第1段で確認・第2段で使い切る・その後は使えない）")
  const codeA = newEmailCode()
  const a = await issueEmailChallenge("Ops-A@Example.invalid", codeA, rpc, t0)
  ok("発行（cookie にコードは入らない）", a.ok && !(a as { cookie: string }).cookie.includes(codeA), a)
  const ca = (a as { cookie: string }).cookie
  ok("第1段: 正しいコード → ok（verified）", (await attemptEmailCode(ca, "ops-a@example.invalid", codeA, false, rpc, t0)) === "ok" && st(idOf(ca)) === "verified|0")
  ok("第1段をやり直しても ok（第2段の前）", (await attemptEmailCode(ca, "ops-a@example.invalid", codeA, false, rpc, t0)) === "ok")
  ok("第2段: 正しいコード → ok（used）", (await attemptEmailCode(ca, "ops-a@example.invalid", codeA, true, rpc, t0)) === "ok" && st(idOf(ca)).startsWith("used|"))
  ok("成功の後に同じコードを使う → used（再利用できない）", (await attemptEmailCode(ca, "ops-a@example.invalid", codeA, true, rpc, t0)) === "used" && (await attemptEmailCode(ca, "ops-a@example.invalid", codeA, false, rpc, t0)) === "used")

  console.log("B. 失敗 5回で無効化（その後は正しいコードでも通らない）")
  const codeB = newEmailCode()
  const cb = ((await issueEmailChallenge("ops-b@example.invalid", codeB, rpc, t0)) as { cookie: string }).cookie
  const wrong = (c: string) => (c === "000000" ? "000001" : "000000")
  const rs: string[] = []
  for (let i = 0; i < 5; i++) rs.push(await attemptEmailCode(cb, "ops-b@example.invalid", wrong(codeB), false, rpc, t0))
  ok("4回は wrong、5回目で locked", rs.join(",") === "wrong,wrong,wrong,wrong,locked" && st(idOf(cb)) === "locked|5", [rs, st(idOf(cb))])
  ok("無効化の後は正しいコードでも locked", (await attemptEmailCode(cb, "ops-b@example.invalid", codeB, true, rpc, t0)) === "locked" && st(idOf(cb)) === "locked|5")
  ok("無効化されたメールには 60分コードを出さない（locked_out）", JSON.stringify(await issueEmailChallenge("ops-b@example.invalid", newEmailCode(), rpc, plus(t0, 30))) === '{"ok":false,"reason":"locked_out"}')
  const after = await issueEmailChallenge("ops-b@example.invalid", newEmailCode(), rpc, plus(t0, 61))
  ok("61分の後は出せる（回数は 0 から）", after.ok && st(idOf((after as { cookie: string }).cookie)) === "active|0", after)

  console.log("C. 送り直しで回数を戻せない")
  const c1 = newEmailCode()
  const k1 = ((await issueEmailChallenge("ops-c@example.invalid", c1, rpc, t0)) as { cookie: string }).cookie
  for (let i = 0; i < 4; i++) await attemptEmailCode(k1, "ops-c@example.invalid", wrong(c1), false, rpc, t0)
  const c2 = newEmailCode()
  const k2 = ((await issueEmailChallenge("ops-c@example.invalid", c2, rpc, plus(t0, 1))) as { cookie: string }).cookie
  ok("送り直したコードは前の失敗 4回を引き継ぐ・前のコードは superseded", st(idOf(k2)) === "active|4" && st(idOf(k1)) === "superseded|4", [st(idOf(k2)), st(idOf(k1))])
  ok("前のコード（正しくても）は使えない", (await attemptEmailCode(k1, "ops-c@example.invalid", c1, true, rpc, plus(t0, 1))) === "superseded")
  ok("新しいコードで 1回間違えると無効（合計 5回）", (await attemptEmailCode(k2, "ops-c@example.invalid", wrong(c2), false, rpc, plus(t0, 1))) === "locked")
  const many: string[] = []
  for (let i = 0; i < 6; i++) { const r = await issueEmailChallenge("ops-d@example.invalid", newEmailCode(), rpc, plus(t0, i)); many.push(r.ok ? "issued" : r.reason) }
  ok("同じメールに出すコードは 60分に 5回まで（6回目は rate_limited）", many.join(",") === "issued,issued,issued,issued,issued,rate_limited", many)
  ok("60分の後は出せる", (await issueEmailChallenge("ops-d@example.invalid", newEmailCode(), rpc, plus(t0, 62))).ok)

  console.log("D. 同時の要求で 5回を超えられない（DB の行のロック）")
  const codeE = newEmailCode()
  const ce = ((await issueEmailChallenge("ops-e@example.invalid", codeE, rpc, t0)) as { cookie: string }).cookie
  const par = await Promise.all(Array.from({ length: 30 }, (_, i) => attemptEmailCode(ce, "ops-e@example.invalid", String((Number(codeE) + 1 + i) % 1_000_000).padStart(6, "0"), false, rpc, t0)))
  const cnt = (v: string) => par.filter((x) => x === v).length
  ok("30件を同時に送る → wrong 4・locked 26・DB の試行は 5回ちょうど", cnt("wrong") === 4 && cnt("locked") === 26 && st(idOf(ce)) === "locked|5", [cnt("wrong"), cnt("locked"), st(idOf(ce))])
  ok("監査の記録: 失敗 4・無効化 1（同時でも数えすぎない）", sql(`select string_agg(event || ':' || n, ',' order by event) from (select event, count(*) n from operator_auth_events where challenge_id='${idOf(ce)}' and event in ('code_failed','code_locked') group by event) x`) === "code_failed:4,code_locked:1")
  const codeF = newEmailCode()
  const cf = ((await issueEmailChallenge("ops-f@example.invalid", codeF, rpc, t0)) as { cookie: string }).cookie
  const both = await Promise.all([
    ...Array.from({ length: 10 }, () => attemptEmailCode(cf, "ops-f@example.invalid", codeF, true, rpc, t0)),
  ])
  ok("正しいコードで同時に 10件の登録 → 成功は 1件だけ（残りは used）", both.filter((x) => x === "ok").length === 1 && both.filter((x) => x === "used").length === 9, both)
  const codeG = newEmailCode()
  const cg = ((await issueEmailChallenge("ops-g@example.invalid", codeG, rpc, t0)) as { cookie: string }).cookie
  const mix = await Promise.all(Array.from({ length: 20 }, (_, i) => attemptEmailCode(cg, "ops-g@example.invalid", i === 10 ? codeG : String((Number(codeG) + 1 + i) % 1_000_000).padStart(6, "0"), false, rpc, t0)))
  ok("間違い 19件と正しい 1件を同時に → 失敗は 5回まで（正しいコードが無効化の後なら通らない）", Number(st(idOf(cg)).split("|")[1]) <= 5 && mix.filter((x) => x === "wrong").length <= 4, [st(idOf(cg)), mix.filter((x) => x === "ok").length])

  console.log("E. cookie と記録の照合")
  const codeH = newEmailCode()
  const ch = ((await issueEmailChallenge("ops-h@example.invalid", codeH, rpc, t0)) as { cookie: string }).cookie
  ok("別のメールで使う → not_found（回数も数えない）", (await attemptEmailCode(ch, "ops-x@example.invalid", codeH, false, rpc, t0)) === "not_found" && st(idOf(ch)) === "active|0")
  ok("cookie の書き換え（署名の不一致）→ not_found", (await attemptEmailCode(ch.slice(0, -2) + "AA", "ops-h@example.invalid", codeH, false, rpc, t0)) === "not_found")
  const forged = await issueEmailChallengeCookie(crypto.randomUUID(), "ops-h@example.invalid")
  ok("存在しない記録の ID → not_found", (await attemptEmailCode(forged, "ops-h@example.invalid", codeH, false, rpc, t0)) === "not_found")
  ok("旧形式の cookie（e1.…）は受け付けない", (await attemptEmailCode("e1.9999999999.b3BzQGV4YW1wbGUuaW52YWxpZA.AAAAAAAAAAAAAAAAAAAAAAAA", "ops-h@example.invalid", codeH, false, rpc, t0)) === "not_found")
  ok("10分の期限を過ぎた → expired", (await attemptEmailCode(ch, "ops-h@example.invalid", codeH, true, rpc, plus(t0, 11))) === "expired" && st(idOf(ch)).startsWith("expired|"))
  ok("6桁でない入力は DB に送らない（wrong・回数は数えない）", (await attemptEmailCode(ch, "ops-h@example.invalid", "12a456", false, rpc, t0)) === "wrong")

  console.log("F. 監査の記録・コードを保存しない・権限")
  ok("監査の記録: 発行・失敗・無効化・確認・使用・拒否・発行の拒否がある", ["code_issued", "code_failed", "code_locked", "code_verified", "code_used", "code_rejected", "code_issue_refused"].every((e) => Number(sql(`select count(*) from operator_auth_events where event='${e}'`)) > 0))
  const allText = sql("select string_agg(coalesce(detail,'') || ' ' || coalesce(email,'') || ' ' || coalesce(attempts::text,''), ' ') from operator_auth_events") + " " + sql("select string_agg(code_hash, ' ') from operator_email_challenges")
  ok("監査の記録・コードの記録のどこにもコード（6桁）が入っていない", ![codeA, codeB, c1, c2, codeE, codeF, codeG, codeH].some((c) => allText.includes(c)))
  ok("コードの記録はコードではなく HMAC（43文字）", sql("select min(length(code_hash)) || '|' || max(length(code_hash)) from operator_email_challenges") === "43|43")
  ok("anon はコードの記録・監査の記録を読めない", sqlFails("set role anon; select count(*) from operator_email_challenges") && sqlFails("set role anon; select count(*) from operator_auth_events"))
  ok("anon・authenticated は関数を呼べない", sqlFails(`set role anon; select operator_email_challenge_attempt(gen_random_uuid(), 'a@b.c', 'x', true, now())`) && sqlFails(`set role authenticated; select operator_email_challenge_issue(gen_random_uuid(), 'a@b.c', '${"x".repeat(43)}', now(), interval '10 minutes')`))

  psql("postgres", `drop database if exists ${DB}`)
  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); try { psql("postgres", `drop database if exists ${DB}`) } catch { /* */ } process.exit(1) })
