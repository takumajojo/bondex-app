import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { getSupabase } from "@/lib/supabase"
import { b2cStripeConfig, B2C_STRIPE_CHANNEL } from "@/lib/b2c/stripe"
import { finalizeB2cCard } from "@/lib/b2c/card-service"
import { B2C_DB_TIMEOUT_MS } from "@/lib/b2c/booking-service"

export const runtime = "nodejs"

/**
 * POST /api/b2c/stripe/webhook — B2C 専用の Stripe の Webhook（Stage 3）。B2B の /api/stripe/webhook とは別の受信口・別の署名の鍵。
 *
 * - 署名を STRIPE_B2C_WEBHOOK_SECRET で確かめる。通らなければ 400 で何もしない。
 * - 対象は setup_intent.*（metadata.channel = b2c のものだけ）。
 * - 同じ通知は b2c_stripe_events（event_id が主キー）で 1回だけ処理する。処理に失敗したら 500 を返し、
 *   Stripe の再送に任せる（記録は「処理済み」にしない）。
 * - 中身は使わず、Stripe から SetupIntent を取り直して反映する（finalizeB2cCard）。通知の順序が逆でも結果は同じ。
 */
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
  if (!event.type.startsWith("setup_intent.")) return NextResponse.json({ received: true, ignored: "type" })
  const si = event.data.object as Stripe.SetupIntent
  const orderId = si.metadata?.order_id
  if (si.metadata?.channel !== B2C_STRIPE_CHANNEL || !orderId) return NextResponse.json({ received: true, ignored: "not_b2c" })

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "db unavailable" }, { status: 500 })
  const { error: insErr } = await sb
    .from("b2c_stripe_events")
    .upsert({ event_id: event.id, type: event.type, object_id: si.id }, { onConflict: "event_id", ignoreDuplicates: true })
    .abortSignal(AbortSignal.timeout(B2C_DB_TIMEOUT_MS))
  if (insErr) return NextResponse.json({ error: "db error" }, { status: 500 })
  const { data: rec, error: recErr } = await sb.from("b2c_stripe_events").select("processed_at").eq("event_id", event.id).abortSignal(AbortSignal.timeout(B2C_DB_TIMEOUT_MS)).maybeSingle()
  if (recErr) return NextResponse.json({ error: "db error" }, { status: 500 })
  if (rec?.processed_at) return NextResponse.json({ received: true, duplicate: true })

  try {
    const r = await finalizeB2cCard(s.config.stripe, orderId, "stripe")
    if (!r.ok && (r.error === "order_not_found" || r.error === "setup_intent_mismatch")) {
      // 再送しても直らない（予約が無い・別の予約の SetupIntent）。処理済みにして記録を残し、運営が調べる。
      console.error("[b2c/webhook] not retryable", event.type, r.error)
      await sb.from("b2c_stripe_events").update({ processed_at: new Date().toISOString(), result: `ignored:${r.error}` }).eq("event_id", event.id).is("processed_at", null)
      return NextResponse.json({ received: true, ignored: r.error })
    }
    if (!r.ok) throw new Error(r.error)
    await sb
      .from("b2c_stripe_events")
      .update({ processed_at: new Date().toISOString(), result: `${r.view?.status ?? "?"}/${r.view?.cardStatus ?? "?"}` })
      .eq("event_id", event.id)
      .is("processed_at", null)
    return NextResponse.json({ received: true })
  } catch (e) {
    console.error("[b2c/webhook] handler failed", event.type, e instanceof Error ? e.message : "error")
    return NextResponse.json({ error: "handler failed, retry please" }, { status: 500 })
  }
}
