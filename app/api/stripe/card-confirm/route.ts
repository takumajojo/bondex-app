import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"

export const runtime = "nodejs"

/**
 * POST /api/stripe/card-confirm — SetupIntent 成功後、保存されたカードを既定に設定し、
 * agencies.card_on_file = true にする。
 *
 * 認証: Authorization: Bearer <Supabase access token>。
 * body: { setupIntentId }
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "stripe-card-confirm")
  if (!limit.ok) return limit.response

  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) return NextResponse.json({ error: "Stripe 未設定" }, { status: 503 })

  const resolved = await resolveAgencyFromRequest(req)
  if (!resolved) return NextResponse.json({ error: "認証が必要です。" }, { status: 401 })
  const { agency } = resolved

  let body: { setupIntentId?: unknown }
  try {
    body = (await req.json()) as { setupIntentId?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const setupIntentId = typeof body.setupIntentId === "string" ? body.setupIntentId.trim() : ""
  if (!setupIntentId) return NextResponse.json({ error: "setupIntentId is required" }, { status: 400 })

  const stripe = new Stripe(secret)
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "DB 未設定" }, { status: 503 })

  try {
    const intent = await stripe.setupIntents.retrieve(setupIntentId)
    // なりすまし防止: SetupIntent の customer が本人のものか確認
    if (!intent.customer || intent.customer !== agency.stripe_customer_id) {
      return NextResponse.json({ error: "対象のカード登録が確認できません。" }, { status: 403 })
    }
    if (intent.status !== "succeeded" || !intent.payment_method) {
      return NextResponse.json({ error: "カード登録が完了していません。" }, { status: 400 })
    }
    const paymentMethodId =
      typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method.id

    // 保存カードを顧客の既定に設定
    await stripe.customers.update(agency.stripe_customer_id, {
      invoice_settings: { default_payment_method: paymentMethodId },
    })

    // agencies に反映
    await sb.from("agencies").update({ card_on_file: true }).eq("id", agency.id)

    return NextResponse.json({ ok: true, cardOnFile: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe error"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
