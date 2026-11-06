// B2C の定期の処理 (/api/b2c/cron/tick) の入口の守り (2026-11-06 監査 B-07)。DB・Stripe・外部には接続しない。
//   実行: npx tsx scripts/test-b2c/tick-guard.ts
// 確かめること: 鍵 (CRON_SECRET) が無い・違う時は何もしない／スイッチ (B2C_SCHEDULER_ENABLED) が OFF の間は何もしない／
// ON でも DB が無ければ 200 (成功) を返さない (pg_cron・見張りの側で失敗として見える)。
import { NextRequest } from "next/server"

for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY", "B2C_STRIPE_SECRET_KEY", "RESEND_API_KEY",
  "SLACK_WEBHOOK_URL", "OPS_ALERT_SLACK_WEBHOOK_URL", "SMTP_HOST", "B2C_NOTIFY_LIVE", "B2C_CHARGE_LIVE"]) delete process.env[k]
let fetches = 0
globalThis.fetch = (async () => { fetches++; throw new Error("network blocked in test") }) as typeof fetch
let pass = 0, fail = 0
const check = (name: string, ok: boolean, info = "") => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name} ${info}`) } }

;(async () => {
  const { POST } = await import("@/app/api/b2c/cron/tick/route")
  const call = (auth?: string) => POST(new NextRequest("http://localhost/api/b2c/cron/tick", { method: "POST", body: "{}", headers: auth ? { authorization: auth } : {} }))

  delete process.env.CRON_SECRET
  process.env.B2C_SCHEDULER_ENABLED = "true"
  check("鍵 (CRON_SECRET) が未設定 → 503・何もしない", (await call("Bearer x")).status === 503)
  process.env.CRON_SECRET = "tick-test-secret"
  check("鍵なし → 401", (await call()).status === 401)
  check("鍵が違う → 401", (await call("Bearer wrong")).status === 401)
  check("Bearer の形でない → 401", (await call("tick-test-secret")).status === 401)
  delete process.env.B2C_SCHEDULER_ENABLED
  const off = await call("Bearer tick-test-secret")
  const offBody = await off.json()
  check("スイッチ OFF (未設定) → 200・skipped (登録だけ先にしても無害)", off.status === 200 && offBody.skipped === "scheduler disabled", JSON.stringify(offBody))
  process.env.B2C_SCHEDULER_ENABLED = "false"
  check("スイッチ OFF (false) → skipped", (await (await call("Bearer tick-test-secret")).json()).skipped === "scheduler disabled")
  check("ここまで外への通信 0回", fetches === 0, String(fetches))
  process.env.B2C_SCHEDULER_ENABLED = "true"
  const on = await call("Bearer tick-test-secret")
  const onBody = await on.json().catch(() => ({}))
  check("スイッチ ON でも DB が無ければ 200 を返さない (失敗として見える)", on.status !== 200 && onBody.ok !== true, `${on.status} ${JSON.stringify(onBody).slice(0, 200)}`)
  check("試験の全体で外への通信 0回", fetches === 0, String(fetches))
  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail ? 1 : 0)
})()
