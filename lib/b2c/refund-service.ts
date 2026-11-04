/**
 * B2C の返金（Stage 5）。設計: docs/b2c/B2C_STAGE5_PAYMENT_DESIGN.md 6章、DB: sql/074（b2c_request_refund・b2c_apply_refund_result）。
 *
 * - 受付は DB の関数で、請求の行をロックして「返金の合計（受付中・結果不明・成功）+ 今回 ≤ 請求額」を確かめてから作る（過剰な返金の防止）。
 * - refund_key（返金ごとの連番）を Stripe の冪等キーにする。結果が分からない時は、その PaymentIntent の返金の一覧から
 *   metadata.refund_key で探して使う（二重の返金の防止）。新しいキーで返金を作り直さない。
 * - 運営（個人のパスキー）だけが受け付ける（API の側で確かめる）。
 */
import Stripe from "stripe"
import { getSupabase } from "@/lib/supabase"
import { B2C_STRIPE_CHANNEL } from "./stripe"
import { enqueuePaymentNotice } from "./charge-service"
import type { B2cOperator } from "./operator-identity"

interface RefundRow {
  id: string
  payment_id: string
  amount_yen: number
  refund_key: string
  stripe_refund_id: string | null
  status: string
  stripe_started_at: string | null
}

export type RequestRefundResult =
  | { ok: true; refundId: string; status: string }
  | { ok: false; error: "not_found" | "not_refundable" | "exceeds_refundable" | "invalid_input" | "server_error"; refundableYen?: number }

export async function requestB2cRefund(stripe: Stripe, op: B2cOperator, paymentId: string, amountYen: number, reason: string, now: Date = new Date()): Promise<RequestRefundResult> {
  const sb = getSupabase()
  if (!sb) return { ok: false, error: "server_error" }
  const { data, error } = await sb.rpc("b2c_request_refund", { p_payment_id: paymentId, p_amount: amountYen, p_reason: reason, p_operator_email: op.operatorEmail, p_credential_id: op.credentialId })
  if (error) return { ok: false, error: "server_error" }
  const r = data as { result: string; refund_id?: string; refundable_yen?: number }
  if (r.result !== "requested") return { ok: false, error: r.result as "not_found", refundableYen: r.refundable_yen }
  const status = await executeB2cRefund(stripe, r.refund_id!, now)
  return { ok: true, refundId: r.refund_id!, status }
}

function mapStatus(s: string | null | undefined): "succeeded" | "pending" | "failed" {
  if (s === "succeeded") return "succeeded"
  if (s === "failed" || s === "canceled") return "failed"
  return "pending"
}

async function apply(refundId: string, status: string, stripeRefundId: string | null, err: string | null = null): Promise<boolean> {
  const sb = getSupabase()
  if (!sb) return false
  const { data, error } = await sb.rpc("b2c_apply_refund_result", { p_refund_id: refundId, p_status: status, p_stripe_refund_id: stripeRefundId, p_error: err })
  return !error && data === "ok"
}

async function findStripeRefund(stripe: Stripe, paymentIntent: string, refundKey: string): Promise<Stripe.Refund | null> {
  for await (const rf of stripe.refunds.list({ payment_intent: paymentIntent, limit: 100 })) {
    if (rf.metadata?.refund_key === refundKey) return rf
  }
  return null
}

/** 返金を Stripe に出す、または結果を照合する。戻り値は返金の状態。 */
export async function executeB2cRefund(stripe: Stripe, refundId: string, now: Date = new Date()): Promise<string> {
  const sb = getSupabase()
  if (!sb) return "unknown"
  const { data: r } = await sb.from("b2c_refunds").select("id, payment_id, amount_yen, refund_key, stripe_refund_id, status, stripe_started_at").eq("id", refundId).maybeSingle()
  if (!r) return "not_found"
  const row = r as RefundRow
  if (row.status === "succeeded" || row.status === "failed") return row.status
  const { data: p } = await sb.from("b2c_payments").select("id, order_id, stripe_payment_intent_id").eq("id", row.payment_id).maybeSingle()
  if (!p?.stripe_payment_intent_id) return row.status
  const pi = p.stripe_payment_intent_id as string

  try {
    let rf: Stripe.Refund | null = null
    if (row.stripe_refund_id) rf = await stripe.refunds.retrieve(row.stripe_refund_id)
    else if (row.stripe_started_at) rf = await findStripeRefund(stripe, pi, row.refund_key) // 前に出した結果が分からない → まず探す
    if (!rf) {
      // 出す前に記録する（記録できなければ出さない）
      const { data: mark } = await sb.from("b2c_refunds").update({ stripe_started_at: now.toISOString() }).eq("id", row.id).in("status", ["requested", "unknown", "pending"]).select("id").maybeSingle()
      if (!mark) return row.status
      rf = await stripe.refunds.create(
        { payment_intent: pi, amount: row.amount_yen, reason: "requested_by_customer", metadata: { channel: B2C_STRIPE_CHANNEL, refund_key: row.refund_key, refund_id: row.id, payment_id: row.payment_id } },
        { idempotencyKey: row.refund_key },
      )
    }
    const st = mapStatus(rf.status)
    const ok = await apply(row.id, st, rf.id, rf.failure_reason ?? null)
    if (!ok) {
      console.error(JSON.stringify({ event: "b2c_refund_unrecorded", refund_id: row.id, stripe_refund_id: rf.id }))
      return "unknown"
    }
    if (st === "succeeded" && row.status !== "succeeded") {
      const { data: o } = await sb.from("b2c_orders").select("language").eq("id", p.order_id).maybeSingle()
      await enqueuePaymentNotice(p.order_id as string, (o?.language as "ja" | "en") ?? "en", "refund_issued", row.id)
    }
    return st
  } catch (e) {
    const t = (e as { type?: string })?.type ?? ""
    const code = (e as { code?: string })?.code ?? ""
    if (t === "StripeInvalidRequestError" && code !== "idempotency_key_in_use") {
      // 直らない（返金できる額を超える・既に全額返金済み等）
      await apply(row.id, "failed", null, `${code || "invalid_request"}`.slice(0, 200))
      return "failed"
    }
    await sb.from("b2c_refunds").update({ status: "unknown", last_error: `${t}:${code}`.slice(0, 200), updated_at: now.toISOString() }).eq("id", row.id).in("status", ["requested", "pending", "unknown"])
    return "unknown"
  }
}

/** 定期の処理・Webhook: 受付中・処理中・結果不明の返金を照合する。 */
export async function reconcileB2cRefunds(stripe: Stripe, now: Date = new Date(), paymentId?: string): Promise<number> {
  const sb = getSupabase()
  if (!sb) return 0
  let q = sb.from("b2c_refunds").select("id").in("status", ["requested", "pending", "unknown"]).limit(50)
  if (paymentId) q = q.eq("payment_id", paymentId)
  else q = q.lt("updated_at", new Date(now.getTime() - 60_000).toISOString())
  const { data } = await q
  for (const r of data ?? []) await executeB2cRefund(stripe, r.id as string, now)
  return data?.length ?? 0
}
