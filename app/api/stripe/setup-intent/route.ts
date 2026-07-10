import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"

export const runtime = "nodejs"

/**
 * POST /api/stripe/setup-intent — 代理店のカード保存用 SetupIntent を発行する。
 *
 * 認証: Authorization: Bearer <Supabase access token> (代理店本人)。
 * Stripe キー未設定時は { available:false } を返し、UI 側で「準備中」を表示する
 * (「枠だけ先に作る」方針。キーを Vercel に入れた瞬間に有効化される)。
 *
 * 返り値: { available, clientSecret, publishableKey }
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "stripe-setup")
  if (!limit.ok) return limit.response

  const secret = process.env.STRIPE_SECRET_KEY
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  if (!secret || !publishableKey) {
    return NextResponse.json({ available: false })
  }

  const resolved = await resolveAgencyFromRequest(req)
  if (!resolved) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 })
  }
  const { agency } = resolved

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ available: false })

  const stripe = new Stripe(secret)

  try {
    // Stripe Customer を確保 (無ければ作成し agencies に保存)
    let customerId = agency.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: agency.name,
        email: agency.contact_email ?? undefined,
        metadata: { agency_id: agency.id },
      })
      customerId = customer.id
      await sb.from("agencies").update({ stripe_customer_id: customerId }).eq("id", agency.id)
    }

    const intent = await stripe.setupIntents.create({
      customer: customerId,
      usage: "off_session",
      automatic_payment_methods: { enabled: true },
      metadata: { agency_id: agency.id },
    })

    return NextResponse.json({
      available: true,
      clientSecret: intent.client_secret,
      publishableKey,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe error"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
