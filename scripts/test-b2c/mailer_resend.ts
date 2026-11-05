/**
 * lib/mailer.ts の B2C 用（strict）の送信の結果の分け方の試験。外には何も送らない（fetch を差し替える）。
 * Resend の冪等キーの仕様（https://resend.com/docs/dashboard/emails/idempotency-keys・2026-11-04 確認）:
 * 24時間保持・同じキー同じ内容は送らずに同じ応答・違う内容は 409 invalid_idempotent_request・処理中は 409 concurrent_idempotent_requests。
 * 実行: npx tsx --tsconfig scripts/test-b2c/tsconfig.json scripts/test-b2c/mailer_resend.ts
 */
process.env.RESEND_API_KEY = "re_test_dummy_not_real"
delete process.env.SMTP_HOST
delete process.env.MAIL_TEST_CAPTURE
import { sendMail } from "@/lib/mailer"
import { liveTransport } from "@/lib/b2c/notify"

let passed = 0
let failed = 0
const ok = (n: string, c: boolean, d?: unknown) => { if (c) { passed++; console.log(`  ok  ${n}`) } else { failed++; console.log(`  NG  ${n}`, JSON.stringify(d)) } }
const calls: Array<{ key: string | null; fallback?: boolean }> = []
function mock(status: number, body: unknown, throwErr?: Error) {
  globalThis.fetch = (async (_u: string, init: RequestInit) => {
    calls.push({ key: (init.headers as Record<string, string>)["Idempotency-Key"] ?? null })
    if (throwErr) throw throwErr
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
}
async function main() {
  mock(200, { id: "em_1" })
  const s1 = await sendMail({ to: "a@example.invalid", subject: "s", text: "t", idempotencyKey: "k1", strict: true })
  ok("成功 → sent・冪等キーをヘッダーで送る", s1.sent && calls.at(-1)?.key === "k1", s1)
  mock(409, { name: "concurrent_idempotent_requests", message: "in progress" })
  const t1 = await liveTransport.email("a@example.invalid", "s", "t", "k2")
  ok("409 concurrent_idempotent_requests → 届いたか不明・自動で再試行してよい（noAutoRetry なし）", !t1.ok && t1.uncertain === true && !t1.noAutoRetry && !t1.permanent, t1)
  mock(409, { name: "invalid_idempotent_request", message: "different payload" })
  const t2 = await liveTransport.email("a@example.invalid", "s", "t", "k3")
  ok("409 invalid_idempotent_request → 届いたか不明・自動で再送しない（noAutoRetry）", !t2.ok && t2.uncertain === true && t2.noAutoRetry === true, t2)
  mock(500, { name: "internal_server_error" })
  const t3 = await liveTransport.email("a@example.invalid", "s", "t", "k4")
  ok("5xx → 届いたか不明（同じキーで再試行）", !t3.ok && t3.uncertain === true && !t3.noAutoRetry, t3)
  mock(429, { name: "rate_limit_exceeded" })
  const t4 = await liveTransport.email("a@example.invalid", "s", "t", "k5")
  ok("429 → 送られていない・直る（再試行）", !t4.ok && !t4.uncertain && !t4.permanent, t4)
  mock(422, { name: "validation_error" })
  const t5 = await liveTransport.email("a@example.invalid", "s", "t", "k6")
  ok("422 → 送られていない・直らない（failed）", !t5.ok && !t5.uncertain && t5.permanent === true, t5)
  mock(0, {}, Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }))
  const t6 = await liveTransport.email("a@example.invalid", "s", "t", "k7")
  ok("名前の解決の失敗 → 送られていない", !t6.ok && !t6.uncertain, t6)
  mock(0, {}, Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))
  const t7 = await liveTransport.email("a@example.invalid", "s", "t", "k8")
  ok("時間切れ → 届いたか不明", !t7.ok && t7.uncertain === true, t7)
  const n0 = calls.length
  mock(500, {})
  process.env.SMTP_HOST = "smtp.invalid"; process.env.SMTP_USER = "u"; process.env.SMTP_PASS = "p"
  await liveTransport.email("a@example.invalid", "s", "t", "k9")
  ok("strict: Resend が失敗しても SMTP に送り直さない（二重送信の防止）", calls.length === n0 + 1)
  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main()
