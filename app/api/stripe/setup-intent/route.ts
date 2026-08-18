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
    // Stripe Customer を確保。
    // 既存の customerId があっても、現在のキーのモード(test/live)に実在するか検証する。
    // テスト→本番などモードを切り替えると、旧モードで作成した顧客はライブ側に存在せず
    // 「No such customer」になる。その場合(および顧客が削除済みの場合)は作り直して
    // agencies を更新する = モード切替に強い自己修復。
    let customerId: string | null = agency.stripe_customer_id
    if (customerId) {
      try {
        const existing = await stripe.customers.retrieve(customerId)
        if ((existing as { deleted?: boolean }).deleted === true) customerId = null
      } catch (e) {
        // No such customer (resource_missing) や 404 = このモードに顧客が居ない → 作り直す。
        const se = e as { code?: string; statusCode?: number }
        if (se?.code === "resource_missing" || se?.statusCode === 404) {
          customerId = null
        } else {
          throw e
        }
      }
    }
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
