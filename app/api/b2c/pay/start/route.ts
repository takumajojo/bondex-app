import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { b2cMyBookingEnabled } from "@/lib/b2c/flags"
import { B2cDbUnavailable } from "@/lib/b2c/booking-service"
import { b2cUnavailable } from "@/lib/b2c/api-common"
import { b2cStripeConfig } from "@/lib/b2c/stripe"
import { startPay } from "@/lib/b2c/pay-service"

export const runtime = "nodejs"

/**
 * POST /api/b2c/pay/start — 旅行者の支払のリンク（Stage 5）。lib/b2c/pay-service.ts。
 * body: { token }（My Booking と同じ秘密の token）。金額・PaymentIntent はサーバーの値だけを使う。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "b2c-my")
  if (!limit.ok) return limit.response
  if (!b2cMyBookingEnabled()) return NextResponse.json({ ok: false, error: "my_booking_closed" }, { status: 503 })
  const s = b2cStripeConfig()
  if (!s.ok) return NextResponse.json({ ok: false, error: s.reason }, { status: 503 })
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 })
  }
  try {
    const v = await startPay(s.config.stripe, body.token)
    if (v.state === "not_found") return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 })
    return NextResponse.json({ ok: true, ...v, publishableKey: s.config.publishableKey })
  } catch (e) {
    if (e instanceof B2cDbUnavailable) return b2cUnavailable()
    console.error("[b2c/pay/start]", e instanceof Error ? e.message : "error")
    return NextResponse.json({ ok: false, error: "temporarily_unavailable" }, { status: 503 })
  }
}
