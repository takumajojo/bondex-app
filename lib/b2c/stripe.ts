/**
 * B2C の Stripe の接続（Stage 3）。B2B の lib/charge.ts・app/api/stripe/* とは別の入口にする。
 *
 * - 本番のキー（sk_live_ / rk_live_ / pk_live_）は、B2C_STRIPE_ALLOW_LIVE=true が無い限り使わない。
 *   公開の承認の前に本番の Stripe に B2C の顧客・カードが作られることを防ぐ。
 * - 通信の再試行は Stripe の SDK に任せる（同じ冪等キーで送り直す）。
 */
import Stripe from "stripe"
import { assertEnvironmentSafe, externalEffectsBlocked } from "@/lib/env-guard"

export type B2cStripeUnavailable = "not_configured" | "live_key_blocked"

export interface B2cStripeConfig {
  stripe: Stripe
  publishableKey: string
  mode: "test" | "live"
}

export function b2cStripeConfig(): { ok: true; config: B2cStripeConfig } | { ok: false; reason: B2cStripeUnavailable } {
  assertEnvironmentSafe() // 試験環境（BONDEX_ENV=staging）では本番の鍵を使わない（それ以外は何もしない）
  const secret = process.env.STRIPE_SECRET_KEY ?? ""
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""
  if (!secret || !publishableKey) return { ok: false, reason: "not_configured" }
  const live = /^(sk|rk)_live_/.test(secret) || publishableKey.startsWith("pk_live_")
  if (live && process.env.B2C_STRIPE_ALLOW_LIVE !== "true") return { ok: false, reason: "live_key_blocked" }
  // Vercel の Preview・Development では、許可があっても本番の鍵を使わない (lib/env-guard.ts)
  if (live && externalEffectsBlocked()) return { ok: false, reason: "live_key_blocked" }
  return {
    ok: true,
    config: { stripe: new Stripe(secret, { maxNetworkRetries: 2 }), publishableKey, mode: live ? "live" : "test" },
  }
}

/** B2C の Stripe のオブジェクトにつける印。Webhook・照合で B2B のものと見分ける。 */
export const B2C_STRIPE_CHANNEL = "b2c"
