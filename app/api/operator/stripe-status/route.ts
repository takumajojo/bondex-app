import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"

/**
 * Stripe のキーモード診断 (読み取り専用・operator gate)。
 *
 *   GET /api/operator/stripe-status
 *
 * カード登録が「本番(実カード可)」か「テスト(実カードは拒否)」かは、Stripe キーの種別
 * (sk_live/pk_live か sk_test/pk_test か) だけで決まる。ここではキーの**種別(先頭)だけ**を
 * 見てモードを返す。**実際のキー値は絶対に返さない**。中身に触れないので課金も発生しない。
 */

function keyMode(key: string | undefined, kind: "sk" | "pk"): "live" | "test" | "unset" | "unknown" {
  if (!key) return "unset"
  if (key.startsWith(`${kind}_live_`)) return "live"
  if (key.startsWith(`${kind}_test_`)) return "test"
  return "unknown"
}

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "operator-stripe-status")
  if (!limit.ok) return limit.response

  const secretMode = keyMode(process.env.STRIPE_SECRET_KEY, "sk")
  const publishableMode = keyMode(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, "pk")
  const chargeLive = process.env.STRIPE_CHARGE_LIVE === "true"

  // 秘密キーと公開キーのモード不一致は登録エラーの原因になる (要修正)。
  const bothPresent = secretMode !== "unset" && publishableMode !== "unset"
  const mismatch = bothPresent && secretMode !== publishableMode

  return NextResponse.json({
    ok: true,
    secretMode, // live / test / unset / unknown
    publishableMode, // live / test / unset / unknown
    chargeLive, // カード課金スイッチ (登録とは別)
    mismatch,
  })
}
