// WhatsApp の受信口 (app/api/whatsapp/webhook) の署名の検証 (2026-11-07 監査 B-11)。
//   実行: npx tsx scripts/test-whatsapp/signature.ts
// 外へは何も送らない (fetch を差し替えて、呼ばれたら数える)。DB の接続先も空にする。
import crypto from "crypto"
import { NextRequest } from "next/server"

for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "WHATSAPP_CLOUD_TOKEN", "WHATSAPP_PHONE_NUMBER_ID",
  "RESEND_API_KEY", "SLACK_WEBHOOK_URL", "OPS_ALERT_SLACK_WEBHOOK_URL", "SMTP_HOST"]) delete process.env[k]
let fetches = 0
globalThis.fetch = (async () => { fetches++; throw new Error("network blocked in test") }) as typeof fetch

const SECRET = "wa-test-secret-b11"
let pass = 0, fail = 0
const check = (name: string, ok: boolean, info = "") => {
  if (ok) { pass++; console.log(`ok   ${name}`) } else { fail++; console.log(`FAIL ${name} ${info}`) }
}
const sign = (body: Buffer | string, secret = SECRET) =>
  "sha256=" + crypto.createHmac("sha256", secret).update(typeof body === "string" ? Buffer.from(body, "utf8") : body).digest("hex")

;(async () => {
  const { POST } = await import("@/app/api/whatsapp/webhook/route")
  const { verifyWhatsAppSignature } = await import("@/lib/whatsapp")
  const post = (body: Buffer | string, sig?: string) =>
    POST(new NextRequest("http://localhost/api/whatsapp/webhook", {
      method: "POST", body: typeof body === "string" ? body : new Uint8Array(body),
      headers: { "content-type": "application/json", ...(sig !== undefined ? { "x-hub-signature-256": sig } : {}) },
    }))
  // 送り主の無いメッセージ = 正しい署名でも返信・DB・通知のどれも起きない本文 (外へ出ないことを数で確かめる)
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ type: "text", text: { body: "BDX-TEST01" } }] } }] }] })

  delete process.env.WHATSAPP_APP_SECRET
  let r = await post(body, sign(body))
  check("鍵 (WHATSAPP_APP_SECRET) が未設定なら、署名が付いていても 401 (以前は検証せずに受けた)", r.status === 401, String(r.status))
  check("鍵が未設定: 関数も false", verifyWhatsAppSignature(body, sign(body)) === false)

  process.env.WHATSAPP_APP_SECRET = SECRET
  r = await post(body)
  check("署名が無い → 401", r.status === 401, String(r.status))
  r = await post(body, "")
  check("署名が空 → 401", r.status === 401, String(r.status))
  r = await post(body, "sha1=" + crypto.createHmac("sha1", SECRET).update(body).digest("hex"))
  check("sha256 以外の形式 → 401", r.status === 401, String(r.status))
  r = await post(body, "sha256=zz")
  check("16進でない・長さが違う → 401", r.status === 401, String(r.status))
  r = await post(body, sign(body, "another-secret"))
  check("別の鍵で作った署名 → 401", r.status === 401, String(r.status))
  const tampered = body.replace("BDX-TEST01", "BDX-TEST02")
  r = await post(tampered, sign(body))
  check("本文の改ざん (署名は元の本文のもの) → 401", r.status === 401, String(r.status))
  r = await post(body + " ", sign(body))
  check("本文の末尾に空白を1つ足しただけでも → 401", r.status === 401, String(r.status))
  check("拒否した要求では外への通信が 0 回", fetches === 0, String(fetches))

  r = await post(body, sign(body))
  check("正しい署名 → 200", r.status === 200, String(r.status))
  r = await post(body, "sha256=" + sign(body).slice("sha256=".length).toUpperCase())
  check("正しい署名 (16進が大文字) → 200", r.status === 200, String(r.status))
  // Meta は本文の日本語を \\uXXXX のまま送ることがある。受け取ったバイト列で計算するので、どちらでも一致する
  const escaped = Buffer.from(body.replace("BDX-TEST01", "\\u3042\\u3044"), "utf8")
  r = await post(escaped, sign(escaped))
  check("日本語をエスケープした本文 (\\uXXXX) の正しい署名 → 200", r.status === 200, String(r.status))
  const utf8 = Buffer.from(body.replace("BDX-TEST01", "あいう"), "utf8")
  r = await post(utf8, sign(utf8))
  check("日本語をそのまま (UTF-8) 含む本文の正しい署名 → 200", r.status === 200, String(r.status))
  check("エスケープした本文の署名で、エスケープしない本文は通らない", (await post(utf8, sign(escaped))).status === 401)
  check("試験の全体で外への通信が 0 回", fetches === 0, String(fetches))

  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail ? 1 : 0)
})()
