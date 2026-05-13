import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"

const SECRET = process.env.STRIPE_SECRET_KEY ?? ""

// 円単位の整数。100 円未満は Stripe の最小金額制約も含めて拒否、
// 1,000,000 円超は POC で想定外のため拒否。
const MIN_AMOUNT_JPY = 100
const MAX_AMOUNT_JPY = 1_000_000

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "payment-intent")
  if (!limit.ok) return limit.response

  if (!SECRET) {
    return NextResponse.json({ error: "STRIPE_SECRET_KEY not configured" }, { status: 500 })
  }

  let body: { orderId?: unknown; amount?: unknown; currency?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : ""
  const amount = typeof body.amount === "number" ? body.amount : NaN
  const currency = typeof body.currency === "string" && body.currency.trim() ? body.currency.trim() : "jpy"

  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 })
  }
  if (!Number.isInteger(amount) || amount < MIN_AMOUNT_JPY || amount > MAX_AMOUNT_JPY) {
    return NextResponse.json(
      { error: `amount must be an integer between ${MIN_AMOUNT_JPY} and ${MAX_AMOUNT_JPY}` },
      { status: 400 },
    )
  }

  const stripe = new Stripe(SECRET)

  try {
    const intent = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: { orderId },
    })
    if (!intent.client_secret) {
      return NextResponse.json({ error: "PaymentIntent missing client_secret" }, { status: 502 })
    }
    return NextResponse.json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe error"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
