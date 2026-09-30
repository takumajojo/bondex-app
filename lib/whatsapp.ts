// WhatsApp Cloud API の送信・署名検証ヘルパー。
//
// - sendWhatsAppText: 顧客起点(24時間のカスタマーサービス枠内)の自由文返信。
//   こちら起点のプッシュ(枠外)は承認テンプレが要る (lib/agency-push.ts) が、
//   受信Webhookへの"返信"は枠内なので自由文でよい。
// - verifyWhatsAppSignature: Webhook POST の X-Hub-Signature-256 を App Secret で検証。
//
// env: WHATSAPP_CLOUD_TOKEN / WHATSAPP_PHONE_NUMBER_ID (送信) / WHATSAPP_APP_SECRET (署名検証)。

import crypto from "crypto"

const GRAPH = "https://graph.facebook.com/v21.0"

/** 24時間枠内で自由文テキストを返信する。env 未設定なら送らず {ok:false}。 */
export async function sendWhatsAppText(
  to: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.WHATSAPP_CLOUD_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneId) return { ok: false, error: "whatsapp env not configured" }
  try {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to.replace(/[^+\d]/g, ""),
        type: "text",
        text: { body: body.slice(0, 4000), preview_url: false },
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => "")
      return { ok: false, error: `whatsapp ${res.status} ${t.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "whatsapp error" }
  }
}

/**
 * Webhook POST の署名を検証する。
 *   - WHATSAPP_APP_SECRET 未設定 → null (検証しない = ローカルcurlテスト用)。
 *   - 設定あり → 一致で true / 不一致で false。
 */
export function verifyWhatsAppSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean | null {
  const secret = process.env.WHATSAPP_APP_SECRET
  if (!secret) return null
  if (!signatureHeader) return false
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")
  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
