import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { getSupabase } from "@/lib/supabase"
import { b2cStripeConfig, B2C_STRIPE_CHANNEL } from "@/lib/b2c/stripe"
import { finalizeB2cCard } from "@/lib/b2c/card-service"
import { B2C_DB_TIMEOUT_MS } from "@/lib/b2c/booking-service"
import { findB2cPaymentForPaymentIntent, syncPaymentFromStripe } from "@/lib/b2c/charge-service"
import { reconcileB2cRefunds } from "@/lib/b2c/refund-service"

export const runtime = "nodejs"

/**
 * POST /api/b2c/stripe/webhook — B2C 専用の Stripe の Webhook（Stage 3・Stage 5）。B2B の /api/stripe/webhook とは別の受信口・別の署名の鍵。
 *
 * - 署名を STRIPE_B2C_WEBHOOK_SECRET で確かめる。通らなければ 400 で何もしない。
 * - 対象: setup_intent.*（カード登録）、payment_intent.*（集荷の後の請求）、charge.refunded・refund.*・charge.refund.updated（返金）。
 * - 同じ通知は b2c_stripe_events（event_id が主キー）で 1回だけ処理する。処理に失敗したら 500 を返し、
 *   Stripe の再送に任せる（記録は「処理済み」にしない）。
 * - 中身は使わず、Stripe から取り直して反映する。通知の順序が逆でも結果は同じ（成功の後に古い失敗の通知が届いても成功のまま）。
 * - 請求の振り分けは metadata だけでなく DB の請求の記録と照らす（lib/b2c/charge-service.ts の findB2cPaymentForPaymentIntent）。
 */
type Target =
  | { kind: "setup"; orderId: string; objectId: string }
  | { kind: "payment"; piId: string; metadata: Record<string, string>; objectId: string }
  | { kind: "refund"; piId: string; metadata: Record<string, string>; objectId: string }
  | { kind: "ignore"; why: string }

function targetOf(event: Stripe.Event): Target {
  const t = event.type
  if (t.startsWith("setup_intent.")) {
    const si = event.data.object as Stripe.SetupIntent
    if (si.metadata?.channel !== B2C_STRIPE_CHANNEL || !si.metadata?.order_id) return { kind: "ignore", why: "not_b2c" }
    return { kind: "setup", orderId: si.metadata.order_id, objectId: si.id }
  }
  if (t.startsWith("payment_intent.")) {
    const pi = event.data.object as Stripe.PaymentIntent
    return { kind: "payment", piId: pi.id, metadata: (pi.metadata ?? {}) as Record<string, string>, objectId: pi.id }
  }
  if (t === "charge.refunded" || t === "charge.refund.updated" || t.startsWith("refund.")) {
    const o = event.data.object as Stripe.Charge | Stripe.Refund
    const pi = typeof o.payment_intent === "string" ? o.payment_intent : o.payment_intent?.id
    if (!pi) return { kind: "ignore", why: "no_payment_intent" }
    return { kind: "refund", piId: pi, metadata: (o.metadata ?? {}) as Record<string, string>, objectId: o.id }
  }
  return { kind: "ignore", why: "type" }
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_B2C_WEBHOOK_SECRET
  const s = b2cStripeConfig()
  if (!webhookSecret || !s.ok) return NextResponse.json({ error: "not_configured" }, { status: 503 })
  const sig = req.headers.get("stripe-signature")
  if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 400 })
  const raw = await req.text()

  let event: Stripe.Event
  try {
    event = await s.config.stripe.webhooks.constructEventAsync(raw, sig, webhookSecret)
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 })
  }
  const target = targetOf(event)
  if (target.kind === "ignore") return NextResponse.json({ received: true, ignored: target.why })

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "db unavailable" }, { status: 500 })
  try {
    // 請求・返金は、DB の B2C の請求の記録と照らす（B2C でなければ何もしない）
    let paymentId: string | null = null
    if (target.kind === "payment" || target.kind === "refund") {
      paymentId = await findB2cPaymentForPaymentIntent(target.piId, target.metadata)
      if (!paymentId) return NextResponse.json({ received: true, ignored: "not_b2c_payment" })
    }
    const { error: insErr } = await sb
      .from("b2c_stripe_events")
      .upsert({ event_id: event.id, type: event.type, object_id: target.objectId }, { onConflict: "event_id", ignoreDuplicates: true })
      .abortSignal(AbortSignal.timeout(B2C_DB_TIMEOUT_MS))
    if (insErr) return NextResponse.json({ error: "db error" }, { status: 500 })
    const { data: rec, error: recErr } = await sb.from("b2c_stripe_events").select("processed_at").eq("event_id", event.id).abortSignal(AbortSignal.timeout(B2C_DB_TIMEOUT_MS)).maybeSingle()
    if (recErr) return NextResponse.json({ error: "db error" }, { status: 500 })
    if (rec?.processed_at) return NextResponse.json({ received: true, duplicate: true })

    let result: string
    if (target.kind === "setup") {
      const r = await finalizeB2cCard(s.config.stripe, target.orderId, "stripe")
      if (!r.ok && (r.error === "order_not_found" || r.error === "setup_intent_mismatch")) {
        // 再送しても直らない（予約が無い・別の予約の SetupIntent）。処理済みにして記録を残し、運営が調べる。
        console.error("[b2c/webhook] not retryable", event.type, r.error)
        await sb.from("b2c_stripe_events").update({ processed_at: new Date().toISOString(), result: `ignored:${r.error}` }).eq("event_id", event.id).is("processed_at", null)
        return NextResponse.json({ received: true, ignored: r.error })
      }
      if (!r.ok) throw new Error(r.error)
      result = `${r.view?.status ?? "?"}/${r.view?.cardStatus ?? "?"}`
    } else if (target.kind === "payment") {
      const out = await syncPaymentFromStripe(s.config.stripe, paymentId!)
      if (out === "unrecorded") throw new Error("payment_unrecorded")
      result = `payment:${out}`
    } else {
      const n = await reconcileB2cRefunds(s.config.stripe, new Date(), paymentId!)
      result = `refund:${n}`
    }
    await sb.from("b2c_stripe_events").update({ processed_at: new Date().toISOString(), result }).eq("event_id", event.id).is("processed_at", null)
    return NextResponse.json({ received: true, result })
  } catch (e) {
    console.error("[b2c/webhook] handler failed", event.type, e instanceof Error ? e.message : "error")
    return NextResponse.json({ error: "handler failed, retry please" }, { status: 500 })
  }
}
