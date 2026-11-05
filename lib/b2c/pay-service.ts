/**
 * 旅行者の支払のリンク（Stage 5・`/my/<秘密の token>/pay`）。設計: docs/b2c/B2C_STAGE5_PAYMENT_DESIGN.md 4章。
 *
 * - 本人の確認は My Booking と同じ秘密の token だけ。金額・PaymentIntent はサーバーの値（画面からは受け取らない）。
 * - 支払が必要な請求（failed・requires_action）の **同じ PaymentIntent** を旅行者が確定する（本人認証・別のカード）。
 *   新しい請求・新しい PaymentIntent は作らない。成功したカードは以後の請求（追加の個数）用に保存する（setup_future_usage）。
 * - 支払の後は Stripe から取り直して DB に反映する（lib/b2c/charge-service.ts の syncPaymentFromStripe・Webhook と同じ処理）。
 */
import Stripe from "stripe"
import { getSupabase } from "@/lib/supabase"
import { sha256Hex, B2cDbUnavailable, B2C_DB_TIMEOUT_MS } from "./booking-service"
import { syncPaymentFromStripe, b2cCancelPending } from "./charge-service"

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/

export type PayState = "pay" | "paid" | "checking" | "nothing_due" | "not_found"

export interface PayView {
  state: PayState
  orderNumber?: number
  language?: "ja" | "en"
  amountYen?: number
  reason?: string | null
  clientSecret?: string
  piStatus?: string
}

async function findOrder(token: unknown): Promise<{ id: string; order_number: number; language: "ja" | "en" } | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null
  const sb = getSupabase()
  if (!sb) throw new B2cDbUnavailable("not configured")
  const { data, error } = await sb.from("b2c_orders").select("id, order_number, language, status").eq("access_token_hash", sha256Hex(token)).abortSignal(AbortSignal.timeout(B2C_DB_TIMEOUT_MS)).maybeSingle()
  if (error) throw new B2cDbUnavailable("order")
  if (!data || data.status === "draft") return null
  return { id: data.id as string, order_number: data.order_number as number, language: data.language === "ja" ? "ja" : "en" }
}

async function paymentsOf(orderId: string) {
  const sb = getSupabase()!
  const { data, error } = await sb
    .from("b2c_payments")
    .select("id, status, amount_yen, stripe_payment_intent_id, last_error_code, created_at")
    .eq("order_id", orderId)
    .order("created_at")
    .abortSignal(AbortSignal.timeout(B2C_DB_TIMEOUT_MS))
  if (error) throw new B2cDbUnavailable("payments")
  return data ?? []
}

/** 支払のページを開いた時。支払が必要なら Stripe の画面に使う client_secret を返す。 */
export async function startPay(stripe: Stripe, token: unknown): Promise<PayView> {
  const o = await findOrder(token)
  if (!o) return { state: "not_found" }
  const base = { orderNumber: o.order_number, language: o.language }
  let pays = await paymentsOf(o.id)
  const due = pays.find((p) => (p.status === "failed" || p.status === "requires_action" || p.status === "uncollectible") && p.stripe_payment_intent_id)
  if (!due) {
    if (pays.some((p) => ["processing", "unknown"].includes(p.status as string))) return { ...base, state: "checking" }
    if (pays.some((p) => ["succeeded", "partially_refunded", "refunded"].includes(p.status as string))) return { ...base, state: "paid" }
    return { ...base, state: "nothing_due" }
  }
  // 取消の申請（佐川の確認待ち）が残っている間は、支払の画面を出さない（運営が申請の結果を確かめる。sql/082）
  if (await b2cCancelPending(o.id)) return { ...base, state: "checking" }
  let pi = await stripe.paymentIntents.retrieve(due.stripe_payment_intent_id as string)
  if (pi.status === "succeeded") {
    await syncPaymentFromStripe(stripe, due.id as string)
    pays = await paymentsOf(o.id)
    return { ...base, state: pays.some((p) => ["failed", "requires_action"].includes(p.status as string)) ? "checking" : "paid" }
  }
  if (pi.status === "requires_payment_method" && pi.setup_future_usage !== "off_session") {
    // 別のカードで払った時、そのカードを以後の請求（追加の個数）用に保存する
    pi = await stripe.paymentIntents.update(pi.id, { setup_future_usage: "off_session" })
  }
  if (!pi.client_secret || !["requires_payment_method", "requires_action", "requires_confirmation"].includes(pi.status)) return { ...base, state: "checking" }
  return { ...base, state: "pay", amountYen: due.amount_yen as number, reason: (due.last_error_code as string | null) ?? null, clientSecret: pi.client_secret, piStatus: pi.status }
}

/** 支払の後（または途中で戻った時）。Stripe から取り直して DB に反映し、今の状態を返す。 */
export async function payStatus(stripe: Stripe, token: unknown): Promise<PayView> {
  const o = await findOrder(token)
  if (!o) return { state: "not_found" }
  for (const p of await paymentsOf(o.id)) {
    if (["failed", "requires_action", "uncollectible", "processing", "unknown"].includes(p.status as string) && p.stripe_payment_intent_id) {
      await syncPaymentFromStripe(stripe, p.id as string)
    }
  }
  const pays = await paymentsOf(o.id)
  const base = { orderNumber: o.order_number, language: o.language }
  const due = pays.find((p) => ["failed", "requires_action", "uncollectible"].includes(p.status as string))
  if (due) return { ...base, state: "pay", amountYen: due.amount_yen as number, reason: (due.last_error_code as string | null) ?? null }
  if (pays.some((p) => ["processing", "unknown"].includes(p.status as string))) return { ...base, state: "checking" }
  if (pays.some((p) => ["succeeded", "partially_refunded", "refunded"].includes(p.status as string))) return { ...base, state: "paid" }
  return { ...base, state: "nothing_due" }
}
