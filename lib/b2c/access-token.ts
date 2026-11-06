/**
 * B2C の予約の秘密の token（My Booking のリンク・カード登録の本人の確認）。Stage 4。
 *
 * token = HMAC-SHA256(B2C_ACCESS_TOKEN_SECRET, 予約の ID) の先頭 24バイトを base64url にした 32文字。
 * DB には token そのものは残さず、sha256 だけ（b2c_orders.access_token_hash）。
 * 予約の ID から作り直せるので、後から送る通知（リマインド・取消）にも My Booking のリンクを入れられる。
 * 鍵を変えると、それまでのリンクは使えなくなる（漏えいの時の緊急の手段）。
 */
import crypto from "node:crypto"
import { b2cSiteBaseUrl } from "../env-guard"

export function b2cAccessTokenSecretConfigured(): boolean {
  return (process.env.B2C_ACCESS_TOKEN_SECRET ?? "").length >= 32
}

export function b2cAccessToken(orderId: string): string {
  const secret = process.env.B2C_ACCESS_TOKEN_SECRET ?? ""
  if (secret.length < 32) throw new Error("B2C_ACCESS_TOKEN_SECRET is not configured (32+ chars)")
  return crypto.createHmac("sha256", secret).update(`b2c-order:${orderId}`).digest().subarray(0, 24).toString("base64url")
}

/** My Booking の URL。B2C_SITE_URL（本番の既定 https://bondex.express・Preview・staging では本番以外の URL が無ければ例外: lib/env-guard.ts）。 */
export function b2cMyBookingUrl(orderId: string, lang: "ja" | "en"): string {
  const base = b2cSiteBaseUrl()
  return `${base}/my/${b2cAccessToken(orderId)}${lang === "ja" ? "?lang=ja" : ""}`
}
