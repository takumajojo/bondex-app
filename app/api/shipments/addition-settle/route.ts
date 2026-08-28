import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { getShipment } from "@/lib/shipments-db"
import { sendMail } from "@/lib/mailer"
import { sendOpsAlert } from "@/lib/ops-alert"

export const runtime = "nodejs"

/**
 * POST /api/shipments/addition-settle — 旅行中の「追加」区間の清算を起票する。
 *   body: { id: string }   // 追加区間 (is_addition=true) の shipment id
 *
 * operator 専用 (middleware で OPERATOR_PASSWORD ゲート)。
 *
 * ── 清算方針 ─────────────────────────────────────────────
 *  - カード代理店 : Stripe Checkout の決済リンクを発行し、代理店へ提示/送付。
 *                   支払い完了は webhook (checkout.session.completed) で charged_at に反映。
 *  - 請求書代理店 : 月次請求に「追加」明細として計上 (ここではメール通知のみ)。
 * いずれも「追加のご依頼を承りました」メールを代理店へ送る。
 *
 * 冪等: 既に決済リンクがあれば作り直さず同じ URL を返す。
 */

function trustedOrigin(): string {
  return (
    process.env.APP_BASE_URL?.replace(/\/+$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "https://bondex.express"
  )
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "addition-settle")
  if (!limit.ok) return limit.response

  let body: { id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const id = typeof body.id === "string" ? body.id : ""
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  const shipment = await getShipment(id)
  if (!shipment) return NextResponse.json({ error: "shipment not found" }, { status: 404 })
  if (!shipment.is_addition) {
    return NextResponse.json({ error: "この区間は追加 (is_addition) ではありません。" }, { status: 400 })
  }
  const amountYen = shipment.amount_yen ?? 0
  if (!Number.isFinite(amountYen) || amountYen <= 0) {
    return NextResponse.json({ error: "金額が不正です (amount_yen)。" }, { status: 400 })
  }

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })

  const { data: agency } = await sb
    .from("agencies")
    .select("name, contact_email, payment_method, card_on_file, stripe_customer_id, billing_exempt")
    .eq("name", shipment.agency)
    .maybeSingle()
  if (!agency) return NextResponse.json({ error: "agency not found" }, { status: 404 })

  const legRef = `${shipment.booking_id}-L${shipment.leg_index + 1}`
  const tour = shipment.tour_number ? `ツアー番号 ${shipment.tour_number}` : ""
  const routeLine = `${shipment.from_hotel} → ${shipment.to_hotel}`
  const detailLines = [
    `予約番号: ${shipment.booking_id}${shipment.tour_number ? ` / ${tour}` : ""}`,
    `区間: ${routeLine}`,
    `個数: ${shipment.suitcase_count}個`,
    `金額(税込): ¥${amountYen.toLocaleString()}`,
  ]

  // テスト代理店は清算しない (billing_exempt)。
  if (agency.billing_exempt) {
    return NextResponse.json({ ok: true, settlement: "exempt" })
  }

  // ── 請求書代理店: 月次請求に「追加」明細として計上 (メール通知のみ) ──
  if (agency.payment_method !== "card") {
    await sendAdditionEmail(agency.contact_email, legRef, [
      "旅行中の追加のご依頼を承りました。下記の内容で手配いたします。",
      "",
      ...detailLines,
      "",
      "【お支払い】ご登録の月次請求書に「追加」明細として計上いたします。",
    ])
    return NextResponse.json({ ok: true, settlement: "invoice" })
  }

  // ── カード代理店: Stripe Checkout の決済リンク ──
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) {
    return NextResponse.json({ error: "Stripe 未設定 (STRIPE_SECRET_KEY)" }, { status: 503 })
  }

  // 冪等: 既にリンクがあれば再利用
  if (shipment.stripe_checkout_url) {
    return NextResponse.json({ ok: true, settlement: "card", url: shipment.stripe_checkout_url, reused: true })
  }

  const stripe = new Stripe(secret)
  const origin = trustedOrigin()
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: agency.stripe_customer_id ?? undefined,
      customer_email: agency.stripe_customer_id ? undefined : agency.contact_email ?? undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "jpy",
            unit_amount: amountYen, // JPY はゼロ小数通貨
            product_data: {
              name: `【追加】BondEx 手荷物配送 ${legRef}${shipment.tour_number ? ` / ${tour}` : ""}`,
              description: `${routeLine} / ${shipment.suitcase_count}個`,
            },
          },
        },
      ],
      metadata: {
        shipment_id: id,
        booking_id: shipment.booking_id,
        tour_number: shipment.tour_number ?? "",
        kind: "addition",
      },
      payment_intent_data: {
        description: `BondEx 追加 ${legRef}`,
        metadata: { shipment_id: id, booking_id: shipment.booking_id, kind: "addition" },
      },
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
    })

    await sb
      .from("shipments")
      .update({ stripe_checkout_session_id: session.id, stripe_checkout_url: session.url })
      .eq("id", id)

    await sendAdditionEmail(agency.contact_email, legRef, [
      "旅行中の追加のご依頼を承りました。下記の内容で手配いたします。",
      "",
      ...detailLines,
      "",
      "【お支払い】下記のリンクよりクレジットカードでお手続きください。",
      session.url ?? "",
    ])

    return NextResponse.json({ ok: true, settlement: "card", url: session.url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Stripe error"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

async function sendAdditionEmail(
  agencyEmail: string | null | undefined,
  legRef: string,
  lines: string[],
): Promise<void> {
  const subject = `【BondEx】追加のご依頼を承りました（${legRef}）`
  const text = [
    ...lines,
    "",
    "ご不明な点は support@bondex.express までお問い合わせください。",
    "— BondEx ／ 株式会社JOJO",
  ].join("\n")
  const bondexCopy = process.env.ALERT_EMAIL || "support@bondex.express"
  const recipients = [...(agencyEmail ? [agencyEmail] : []), bondexCopy]
  let anySent = false
  for (const to of recipients) {
    const r = await sendMail({ to, subject, text, replyTo: "support@bondex.express" })
    if (r.sent) anySent = true
  }
  if (!agencyEmail || !anySent) {
    await sendOpsAlert({
      subject: `【追加受付・代理店未達】${legRef}`,
      lines: [`追加を受け付けましたが、代理店へのメール送付が未達です。宛先: ${agencyEmail ?? "(未登録)"}`],
      agencyEmail: null,
    })
  }
}
