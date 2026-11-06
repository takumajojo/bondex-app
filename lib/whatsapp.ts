// WhatsApp Cloud API の送信・署名検証ヘルパー。
//
// - sendWhatsAppText: 顧客起点(24時間のカスタマーサービス枠内)の自由文返信。
//   こちら起点のプッシュ(枠外)は承認テンプレが要る (lib/agency-push.ts) が、
//   受信Webhookへの"返信"は枠内なので自由文でよい。
// - verifyWhatsAppSignature: Webhook POST の X-Hub-Signature-256 を App Secret で検証。
//
// env: WHATSAPP_CLOUD_TOKEN / WHATSAPP_PHONE_NUMBER_ID (送信) / WHATSAPP_APP_SECRET (署名検証)。

import { externalEffectsBlocked } from "@/lib/env-guard"
import crypto from "crypto"

const GRAPH = "https://graph.facebook.com/v21.0"

/** 24時間枠内で自由文テキストを返信する。env 未設定なら送らず {ok:false}。 */
export async function sendWhatsAppText(
  to: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.WHATSAPP_CLOUD_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  // Preview・Development からは送らない (lib/env-guard.ts)
  if (externalEffectsBlocked()) return { ok: false, error: "non_production_deployment" }
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
 * Webhook POST の署名を検証する (Meta の仕様: X-Hub-Signature-256 = "sha256=" + 受信した本文のバイト列の
 * HMAC-SHA256 (鍵 = App Secret) の16進)。本文は受け取ったバイト列そのもので計算する (文字列にして
 * 作り直すと、エスケープや改行の違いで一致しなくなる・改ざんを見逃す)。
 *   - WHATSAPP_APP_SECRET 未設定 → false (検証できないものは受け付けない。2026-11-07 監査 B-11。
 *     以前は「未設定なら検証しない」だったため、鍵を入れ忘れると誰でも送れた)
 *   - 署名が無い・形式が違う・一致しない → false / 一致 → true
 */
export function verifyWhatsAppSignature(
  rawBody: Buffer | string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET
  if (!secret) return false
  if (!signatureHeader) return false
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(signatureHeader.trim())
  if (!m) return false
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody
  const expected = crypto.createHmac("sha256", secret).update(body).digest()
  const got = Buffer.from(m[1], "hex")
  return got.length === expected.length && crypto.timingSafeEqual(got, expected)
}
