import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import {
  getShipment,
  getShipmentByPaymentIntentId,
  updateShipmentChargeState,
  type ShipmentRecord,
} from "@/lib/shipments-db"
import { sendOpsAlert } from "@/lib/ops-alert"

export const runtime = "nodejs"

/**
 * POST /api/stripe/webhook — Stripe からの署名付き webhook 受信口。
 *
 * 本番課金 (集荷完了時の off_session 課金) の「その後」を検知するための最小実装。
 * 対象イベント:
 *   - charge.refunded              返金 (全額/一部)
 *   - charge.dispute.created       チャージバック(係争)開始
 *   - payment_intent.payment_failed 決済失敗 (再課金時など)
 *
 * ── 方針 (検知＋DB状態同期のみ) ─────────────────────────────
 * 返金/再課金/自動対応などの副作用はここでは行わない。shipments に状態を
 * 書き込み、運用 (/operator) が気づけるよう ops アラートを飛ばすだけ。
 *
 * ── セキュリティ ─────────────────────────────────────────────
 * 署名 (Stripe-Signature ヘッダー) を STRIPE_WEBHOOK_SECRET で必ず検証する。
 * 検証に失敗したリクエストは 400 で拒否し、一切処理しない。
 *
 * ── 冪等性 / リトライ ────────────────────────────────────────
 * 署名検証を通った後は、DB 更新の成否に関わらず 200 を返す (Stripe の
 * リトライ嵐を避ける)。状態列は「最新で上書き」なので重複配信でも安全。
 *
 * ── 前提 ─────────────────────────────────────────────────────
 * sql/019_shipment_charge_state.sql を適用済みであること。未適用だと状態列が
 * 無く update がエラーになるが、握って 200 を返しログに残す。
 */

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !webhookSecret) {
    // 未設定の間は無効化状態 (Stripe 側で endpoint 未登録なら呼ばれない)。
    return NextResponse.json({ configured: false }, { status: 200 })
  }

  const sig = req.headers.get("stripe-signature")
  if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 400 })

  const raw = await req.text()
  const stripe = new Stripe(secret)

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, webhookSecret)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "signature verification failed"
    console.error("[stripe/webhook] signature verification failed:", msg)
    return NextResponse.json({ error: "invalid signature" }, { status: 400 })
  }

  try {
    switch (event.type) {
      case "charge.refunded":
        await handleRefund(event.data.object as Stripe.Charge, event.created)
        break
      case "charge.dispute.created":
        await handleDispute(event.data.object as Stripe.Dispute, event.created)
        break
      case "payment_intent.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent, event.created)
        break
      default:
        // 対象外イベントは黙って 200 (Stripe 側で絞れなくても安全)。
        break
    }
  } catch (err) {
    // 署名は通っているので 200 を返す (再送されても状態は最新で上書きされる)。
    console.error("[stripe/webhook] handler error:", err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ received: true }, { status: 200 })
}

// --- helpers ---------------------------------------------------------------

function piIdOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null
  return typeof v === "string" ? v : v.id
}

function iso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString()
}

function legRef(s: ShipmentRecord): string {
  return `${s.booking_id}-L${s.leg_index + 1}`
}

async function handleRefund(charge: Stripe.Charge, createdAt: number): Promise<void> {
  const pi = piIdOf(charge.payment_intent)
  if (!pi) return
  const shipment = await getShipmentByPaymentIntentId(pi)
  if (!shipment) {
    console.error(`[stripe/webhook] refund: shipment not found for PI ${pi}`)
    return
  }
  const refundYen = charge.amount_refunded ?? 0 // JPY はゼロ小数通貨 → 円そのまま
  await updateShipmentChargeState(shipment.id, {
    refunded_at: iso(createdAt),
    refund_amount_yen: refundYen,
  })
  await sendOpsAlert({
    subject: `【返金を検知】${legRef(shipment)} (${shipment.agency})`,
    lines: [
      `予約: ${legRef(shipment)} / 代理店: ${shipment.agency}`,
      `返金額: ¥${refundYen.toLocaleString()}${charge.refunded ? " (全額)" : " (一部)"}`,
      `PaymentIntent: ${pi}`,
      "→ 内容をご確認ください (自動対応はしていません)。",
      "  ダッシュボード: https://bondex.express/operator/dashboard",
    ],
    agencyEmail: null, // 与信/経理事項なので代理店には自動送信しない
  })
}

async function handleDispute(dispute: Stripe.Dispute, createdAt: number): Promise<void> {
  const pi = piIdOf(dispute.payment_intent)
  if (!pi) return
  const shipment = await getShipmentByPaymentIntentId(pi)
  if (!shipment) {
    console.error(`[stripe/webhook] dispute: shipment not found for PI ${pi}`)
    return
  }
  await updateShipmentChargeState(shipment.id, {
    disputed_at: iso(createdAt),
    dispute_status: dispute.status ?? null,
  })
  await sendOpsAlert({
    subject: `【チャージバック(係争)を検知】${legRef(shipment)} (${shipment.agency})`,
    lines: [
      `予約: ${legRef(shipment)} / 代理店: ${shipment.agency}`,
      `係争額: ¥${(dispute.amount ?? 0).toLocaleString()} / ステータス: ${dispute.status ?? "unknown"}`,
      `理由: ${dispute.reason ?? "unknown"}`,
      `PaymentIntent: ${pi}`,
      "→ 期限内の証拠提出が必要な場合があります。Stripe ダッシュボードをご確認ください。",
    ],
    agencyEmail: null,
  })
}

async function handlePaymentFailed(pi: Stripe.PaymentIntent, createdAt: number): Promise<void> {
  // 失敗した PI は課金未成立なので stripe_payment_intent_id 列に載っていないことがある。
  // まず PI metadata の shipment_id で引き、無ければ PI ID で逆引きする。
  const shipmentId = pi.metadata?.shipment_id || null
  const shipment = shipmentId
    ? await getShipment(shipmentId)
    : await getShipmentByPaymentIntentId(pi.id)
  if (!shipment) {
    console.error(`[stripe/webhook] payment_failed: shipment not found (PI ${pi.id})`)
    return
  }
  const message = pi.last_payment_error?.message ?? "決済に失敗しました"
  await updateShipmentChargeState(shipment.id, {
    payment_failed_at: iso(createdAt),
    payment_failure_message: message.slice(0, 500),
  })
  await sendOpsAlert({
    subject: `【決済失敗を検知】${legRef(shipment)} (${shipment.agency})`,
    lines: [
      `予約: ${legRef(shipment)} / 代理店: ${shipment.agency}`,
      `理由: ${message}`,
      `PaymentIntent: ${pi.id}`,
      "→ カードの再登録 or 請求書での回収をご検討ください。",
    ],
    agencyEmail: null,
  })
}
