/**
 * B2C のカード登録（Stage 3）。docs/b2c/B2C_MVP_SCHEMA_v1.md 5章・B2C_PHASE1A_BETA_PLAN.md。
 *
 * 予約の時点では請求もオーソリもしない。SetupIntent でカードを登録し（3D セキュアの認証を含む）、
 * 集荷の後の請求（Stage 5）に使う PaymentMethod を旅行者ごとの Stripe Customer に紐づけるだけ。
 * このファイルは PaymentIntent を作らない。
 *
 * カード登録の成功は予約の確定ではない。登録の後に b2c_confirm_order（DB の 1つのトランザクション）が
 * ホテルの条件を確かめ、満たせば confirmed、満たさなければ awaiting_hotel_confirmation にする。
 *
 * 状態の正は常に Stripe から取り直した SetupIntent。画面の報告・Webhook の中身は「照合のきっかけ」に
 * すぎないので、通知の重複・順序の逆転・画面の通信の切断があっても同じ結果になる。
 *
 * カードの番号・有効期限・CVC は BondEx に来ない（Stripe の入力欄から直接 Stripe に送られる）。
 * DB に残すのは Stripe の ID と 3D セキュアの結果だけ。ログにも Stripe のオブジェクトを出さない。
 */
import type Stripe from "stripe"
import { getSupabase } from "@/lib/supabase"
import { b2cCutoffAt, b2cCardWindowFits, B2C_CARD_WINDOW_MS } from "./bookability"
import { buildB2cQuote, sha256Hex, B2cDbUnavailable, B2C_DB_TIMEOUT_MS, type B2cEntry } from "./booking-service"
import { B2C_STRIPE_CHANNEL } from "./stripe"
import { B2C_CARD_CONSENT_VERSION } from "./legal-text"

/** カードの入力に使える時間。これを過ぎた card_pending の予約は枠を返す（expireStaleCardPending）。予約の画面と共通（bookability.ts）。 */
export { B2C_CARD_WINDOW_MS } from "./bookability"
/** カード登録と、集荷の後の請求への同意の文の版（画面の文と合わせて上げる）。 */
export { B2C_CARD_CONSENT_VERSION } from "./legal-text"

export type B2cCardState = "registering" | "requires_action" | "failed" | "registered"

export interface B2cOrderRow {
  id: string
  order_number: number
  entry_link_id: string
  status: string
  card_status: string
  confirmation_mode: string
  confirmation_due_at: string | null
  pickup_date: string
  delivery_date: string
  pieces: number
  total_gross_yen: number
  origin_place_id: string
  dest_place_id: string
  origin_snapshot: { check_in: string; check_out: string }
  dest_snapshot: { check_in: string; check_out: string }
  guest_name: string
  guest_email: string
  language: string
  stripe_customer_id: string | null
  stripe_setup_intent_id: string | null
  stripe_payment_method_id: string | null
  card_3ds_result: string | null
  cancelled_at: string | null
  updated_at: string
}

const ORDER_COLS =
  "id, order_number, entry_link_id, status, card_status, confirmation_mode, confirmation_due_at, pickup_date, delivery_date, pieces, total_gross_yen, origin_place_id, dest_place_id, origin_snapshot, dest_snapshot, guest_name, guest_email, language, stripe_customer_id, stripe_setup_intent_id, stripe_payment_method_id, card_3ds_result, cancelled_at, updated_at"

const ACCESS_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/

/** 予約番号と秘密の token（下書きの作成時に一度だけ返したもの）で予約を引く。入口のリンクも一致させる。 */
export async function loadOrderForGuest(entry: B2cEntry, orderNumber: unknown, accessToken: unknown): Promise<B2cOrderRow | null> {
  const n = Number(orderNumber)
  if (!Number.isInteger(n) || n <= 0 || typeof accessToken !== "string" || !ACCESS_TOKEN_RE.test(accessToken)) return null
  const sb = getSupabase()
  if (!sb) throw new B2cDbUnavailable("not configured")
  const { data, error } = await sb
    .from("b2c_orders")
    .select(ORDER_COLS)
    .eq("order_number", n)
    .eq("access_token_hash", sha256Hex(accessToken))
    .eq("entry_link_id", entry.id)
    .abortSignal(AbortSignal.timeout(B2C_DB_TIMEOUT_MS))
    .maybeSingle()
  if (error) throw new B2cDbUnavailable("order")
  return (data as B2cOrderRow | null) ?? null
}

/** 読めない時は例外（「予約が無い」と区別する。Webhook は 500 で Stripe の再送に任せる）。 */
async function loadOrderById(id: string): Promise<B2cOrderRow | null> {
  const sb = getSupabase()
  if (!sb) throw new B2cDbUnavailable("not configured")
  const { data, error } = await sb.from("b2c_orders").select(ORDER_COLS).eq("id", id).abortSignal(AbortSignal.timeout(B2C_DB_TIMEOUT_MS)).maybeSingle()
  if (error) throw new B2cDbUnavailable("order")
  return (data as B2cOrderRow | null) ?? null
}

async function addEvent(orderId: string, event: string, actor: "guest" | "system" | "stripe", before: unknown, after: unknown): Promise<void> {
  const sb = getSupabase()
  if (!sb) return
  const { error } = await sb.from("b2c_order_events").insert({ order_id: orderId, event, actor_type: actor, before_state: before, after_state: after })
  if (error) console.error("[b2c/card] event insert failed", event, error.code)
}

// ---------------------------------------------------------------------------
// SetupIntent の状態の読み替え（純粋な関数。試験は scripts/test-b2c/run.ts）
// ---------------------------------------------------------------------------
export function cardStateOfSetupIntent(si: Pick<Stripe.SetupIntent, "status" | "last_setup_error">): B2cCardState {
  switch (si.status) {
    case "succeeded":
      return "registered"
    case "requires_action":
      return "requires_action"
    case "processing":
    case "requires_confirmation":
      return "registering"
    case "requires_payment_method":
      return si.last_setup_error ? "failed" : "registering"
    case "canceled":
      return "failed"
    default:
      return "registering"
  }
}

export function threeDsResultOf(si: Pick<Stripe.SetupIntent, "latest_attempt">): "authenticated" | "attempted" | "not_required" | "unknown" {
  const att = si.latest_attempt
  if (!att || typeof att === "string") return "unknown"
  const tds = att.payment_method_details?.card?.three_d_secure
  if (!tds) return "not_required"
  if (tds.result === "authenticated") return "authenticated"
  if (tds.result === "attempt_acknowledged") return "attempted"
  if (tds.result === "exempted") return "not_required"
  return "unknown"
}

/** 画面に返す予約の状態（カードの情報は Stripe から取り直した末尾 4桁とブランドだけ。DB には残さない）。 */
export interface B2cCardStatusView {
  orderNumber: number
  status: string
  cardStatus: string
  confirmationMode: string
  confirmationDueAt: string | null
  totalGrossYen: number
  card?: { brand: string; last4: string }
  cardError?: string
}

function viewOf(o: B2cOrderRow, extra: Partial<B2cCardStatusView> = {}): B2cCardStatusView {
  return {
    orderNumber: o.order_number,
    status: o.status,
    cardStatus: o.card_status,
    confirmationMode: o.confirmation_mode,
    confirmationDueAt: o.confirmation_due_at,
    totalGrossYen: o.total_gross_yen,
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// カード登録の開始
// ---------------------------------------------------------------------------
export type B2cCardStartError =
  | "order_not_found"
  | "order_cancelled"
  | "card_consent_required"
  | "quote_changed"
  | "date_not_available"
  | "too_close_to_deadline"
  | "capacity_full"
  | "stripe_busy"
  | "server_error"

export type B2cCardStartResult =
  | { ok: true; clientSecret: string; publishableKey: string; view: B2cCardStatusView }
  | { ok: true; alreadyRegistered: true; view: B2cCardStatusView }
  | { ok: false; error: B2cCardStartError }

/**
 * 下書き → card_pending（枠の確保。DB の受付の上限の trigger が同時の予約を防ぐ）→ Customer・SetupIntent の作成。
 * 同じ予約で何度呼ばれても、Customer・SetupIntent は 1つずつ（冪等キー＋「まだ無い時だけ保存」）。
 */
export async function startB2cCardRegistration(
  stripe: Stripe,
  publishableKey: string,
  order: B2cOrderRow,
  cardConsent: boolean,
  now: Date = new Date(),
): Promise<B2cCardStartResult> {
  const sb = getSupabase()
  if (!sb) return { ok: false, error: "server_error" }
  if (order.cancelled_at || order.status === "cancelled") return { ok: false, error: "order_cancelled" }
  if (order.card_status === "registered") {
    const fin = await finalizeB2cCard(stripe, order.id, "guest")
    return { ok: true, alreadyRegistered: true, view: fin.view ?? viewOf(order) }
  }
  if (!["draft", "card_pending"].includes(order.status)) return { ok: false, error: "order_not_found" }
  if (!cardConsent) return { ok: false, error: "card_consent_required" }

  // 締切・ホテルの確認の期限まで、カードの入力の時間が残っていること
  if (!b2cCardWindowFits(now, order.pickup_date, order.confirmation_due_at)) return { ok: false, error: "too_close_to_deadline" }

  if (order.status === "draft") {
    // 下書きの後に日付・料金の条件が変わっていないか、サーバーで計算し直す（画面の値は使わない）
    const q = await buildB2cQuote({
      now,
      originPlaceId: order.origin_place_id,
      destPlaceId: order.dest_place_id,
      origin: { checkIn: order.origin_snapshot.check_in, checkOut: order.origin_snapshot.check_out },
      dest: { checkIn: order.dest_snapshot.check_in, checkOut: order.dest_snapshot.check_out },
      pieces: order.pieces,
      pickupDate: order.pickup_date,
      deliveryDate: order.delivery_date,
    })
    // 日付が選べなくなった（満枠・締切・休業日など）と、料金が変わったを分けて案内する
    if (!q.selected) return { ok: false, error: "date_not_available" }
    if (!q.price || q.price.totalGrossYen !== order.total_gross_yen) return { ok: false, error: "quote_changed" }

    const { data: claimed, error: claimErr } = await sb
      .from("b2c_orders")
      .update({ status: "card_pending", card_status: "registering", card_consent_version: B2C_CARD_CONSENT_VERSION, card_consented_at: now.toISOString() })
      .eq("id", order.id)
      .eq("status", "draft")
      .select("id")
    if (claimErr) {
      if (claimErr.message?.includes("b2c_capacity")) return { ok: false, error: "capacity_full" }
      console.error("[b2c/card] claim failed", claimErr.code)
      return { ok: false, error: "server_error" }
    }
    if (claimed && claimed.length === 1) {
      await addEvent(order.id, "card_started", "guest", { status: "draft" }, { status: "card_pending", consent_version: B2C_CARD_CONSENT_VERSION })
    }
    const fresh = await loadOrderById(order.id)
    if (!fresh || fresh.status !== "card_pending") return { ok: false, error: fresh?.status === "cancelled" ? "order_cancelled" : "server_error" }
    order = fresh
  }

  try {
    // 旅行者ごとの Customer（B2B の代理店の Customer とは別。metadata で見分ける）
    let customerId = order.stripe_customer_id
    if (!customerId) {
      const c = await stripe.customers.create(
        {
          name: order.guest_name,
          email: order.guest_email,
          preferred_locales: [order.language === "ja" ? "ja" : "en"],
          metadata: { channel: B2C_STRIPE_CHANNEL, order_id: order.id, order_number: String(order.order_number) },
        },
        { idempotencyKey: `b2c-cus-${order.id}` },
      )
      customerId = c.id
      await sb.from("b2c_orders").update({ stripe_customer_id: customerId }).eq("id", order.id).is("stripe_customer_id", null)
      const again = await loadOrderById(order.id)
      if (!again || again.stripe_customer_id !== customerId) return { ok: false, error: "server_error" }
      order = again
    }

    let si: Stripe.SetupIntent
    if (order.stripe_setup_intent_id) {
      si = await stripe.setupIntents.retrieve(order.stripe_setup_intent_id)
    } else {
      si = await stripe.setupIntents.create(
        {
          customer: customerId,
          usage: "off_session",
          payment_method_types: ["card"],
          description: `BondEx B2C ${order.order_number}`,
          metadata: { channel: B2C_STRIPE_CHANNEL, order_id: order.id, order_number: String(order.order_number) },
        },
        { idempotencyKey: `b2c-si-${order.id}` },
      )
      await sb.from("b2c_orders").update({ stripe_setup_intent_id: si.id }).eq("id", order.id).is("stripe_setup_intent_id", null)
      const again = await loadOrderById(order.id)
      if (!again || again.stripe_setup_intent_id !== si.id) return { ok: false, error: "server_error" }
      order = again
    }

    if (si.status === "succeeded") {
      const fin = await finalizeB2cCard(stripe, order.id, "guest")
      const after = fin.view
      if (!after || after.cardStatus !== "failed" || after.status !== "card_pending") {
        return { ok: true, alreadyRegistered: true, view: after ?? viewOf(order) }
      }
      // 登録は通ったが受け付けなかったカード（CVC の照合の失敗）。終わった SetupIntent は使い直せないので、新しく作る。
      const { count } = await sb.from("b2c_order_events").select("id", { count: "exact", head: true }).eq("order_id", order.id).eq("event", "card_rejected")
      const oldId = si.id
      si = await stripe.setupIntents.create(
        {
          customer: customerId,
          usage: "off_session",
          payment_method_types: ["card"],
          description: `BondEx B2C ${order.order_number}`,
          metadata: { channel: B2C_STRIPE_CHANNEL, order_id: order.id, order_number: String(order.order_number) },
        },
        { idempotencyKey: `b2c-si-${order.id}-r${count ?? 0}` },
      )
      await sb.from("b2c_orders").update({ stripe_setup_intent_id: si.id }).eq("id", order.id).eq("stripe_setup_intent_id", oldId)
      const again = await loadOrderById(order.id)
      if (!again || again.stripe_setup_intent_id !== si.id) return { ok: false, error: "stripe_busy" }
      order = again
    }
    if (si.status === "canceled" || !si.client_secret) return { ok: false, error: "order_cancelled" }
    return { ok: true, clientSecret: si.client_secret, publishableKey, view: viewOf(order) }
  } catch (e) {
    const se = e as { type?: string; code?: string; statusCode?: number }
    // 同じ冪等キーの要求がまだ処理中（同時の 2回の押下など）。少し待って呼び直してもらう。
    if (se?.type === "StripeIdempotencyError" || se?.statusCode === 409) return { ok: false, error: "stripe_busy" }
    console.error("[b2c/card] stripe error on start", se?.type, se?.code)
    return { ok: false, error: "server_error" }
  }
}

// ---------------------------------------------------------------------------
// 照合と確定（画面・Webhook・期限切れの片付けの 3つの入口から同じ関数を呼ぶ）
// ---------------------------------------------------------------------------
export interface B2cFinalizeResult {
  ok: boolean
  error?: "order_not_found" | "setup_intent_mismatch" | "server_error"
  view?: B2cCardStatusView
}

/**
 * Stripe から SetupIntent を取り直し、予約の行に反映する。何度呼んでも結果は同じ。
 * - succeeded: card_status=registered（registered から戻すことはない）→ b2c_confirm_order。
 * - 失敗: card_status=failed（同じ SetupIntent で別のカードを入れ直せる）。
 * - 取消済みの予約にカードが登録された場合: 予約は戻さず、カードを Customer から外す。
 */
export async function finalizeB2cCard(stripe: Stripe, orderId: string, actor: "guest" | "stripe" | "system", now: Date = new Date()): Promise<B2cFinalizeResult> {
  const sb = getSupabase()
  if (!sb) return { ok: false, error: "server_error" }
  let order = await loadOrderById(orderId)
  if (!order) return { ok: false, error: "order_not_found" }
  if (!order.stripe_setup_intent_id) return { ok: true, view: viewOf(order) }

  const si = await stripe.setupIntents.retrieve(order.stripe_setup_intent_id, { expand: ["latest_attempt", "payment_method"] })
  const customerId = typeof si.customer === "string" ? si.customer : si.customer?.id
  if (si.metadata?.order_id !== order.id || si.metadata?.channel !== B2C_STRIPE_CHANNEL || customerId !== order.stripe_customer_id) {
    console.error("[b2c/card] setup intent does not belong to order", order.order_number)
    return { ok: false, error: "setup_intent_mismatch" }
  }
  const state = cardStateOfSetupIntent(si)
  const pm = si.payment_method && typeof si.payment_method !== "string" ? si.payment_method : null
  const card = pm?.card ? { brand: pm.card.brand, last4: pm.card.last4 } : undefined

  if (state === "registered") {
    if (!pm) return { ok: false, error: "server_error" }
    if (order.status === "cancelled") {
      // 期限切れなどで取消した後に、遅れて登録が終わった。請求しないカードは持たない。
      await stripe.paymentMethods.detach(pm.id).catch(() => undefined)
      await addEvent(order.id, "card_registered_after_cancel", actor, { status: "cancelled" }, { payment_method_detached: true })
      return { ok: true, view: viewOf(order) }
    }
    // CVC（裏面の 3桁）の照合に失敗したカードは受け付けない（集荷の後の請求で失敗・不正利用になりやすい）
    if (order.card_status !== "registered" && pm.card?.checks?.cvc_check === "fail") {
      await stripe.paymentMethods.detach(pm.id).catch(() => undefined)
      const { data: upd } = await sb.from("b2c_orders").update({ card_status: "failed" }).eq("id", order.id).eq("card_status", "registering").select("id")
      if (upd && upd.length === 1) {
        await addEvent(order.id, "card_rejected", actor, { card_status: "registering" }, { card_status: "failed", code: "cvc_check_failed", payment_method_detached: true })
      }
      order = (await loadOrderById(order.id)) ?? order
      return { ok: true, view: viewOf(order, { cardError: "cvc_check_failed" }) }
    }
    if (order.card_status !== "registered") {
      const { data: upd, error } = await sb
        .from("b2c_orders")
        .update({ card_status: "registered", stripe_payment_method_id: pm.id, card_3ds_result: threeDsResultOf(si) })
        .eq("id", order.id)
        .neq("card_status", "registered")
        .neq("status", "cancelled")
        .select("id")
      if (error) {
        console.error("[b2c/card] card update failed", error.code)
        return { ok: false, error: "server_error" }
      }
      if (upd && upd.length === 1) {
        await addEvent(order.id, "card_registered", actor, { card_status: order.card_status }, { card_status: "registered", card_3ds_result: threeDsResultOf(si) })
      }
      order = (await loadOrderById(order.id)) ?? order
    }
    // 締切を過ぎてからの登録は確定しない（運営の判断に回す。請求はしていない）
    if (["card_pending", "awaiting_hotel_confirmation"].includes(order.status) && now < b2cCutoffAt(order.pickup_date)) {
      const { error } = await sb.rpc("b2c_confirm_order", { p_order_id: order.id })
      if (error) {
        console.error("[b2c/card] confirm failed", error.code)
        return { ok: false, error: "server_error" }
      }
      order = (await loadOrderById(order.id)) ?? order
    }
    return { ok: true, view: viewOf(order, { card }) }
  }

  if (state === "failed" && order.card_status === "registering") {
    const { data: upd } = await sb.from("b2c_orders").update({ card_status: "failed" }).eq("id", order.id).eq("card_status", "registering").select("id")
    if (upd && upd.length === 1) {
      await addEvent(order.id, "card_failed", actor, { card_status: "registering" }, { card_status: "failed", code: si.last_setup_error?.code ?? si.status })
    }
    order = (await loadOrderById(order.id)) ?? order
  } else if ((state === "registering" || state === "requires_action") && order.card_status === "failed") {
    // 別のカードで入れ直している最中
    await sb.from("b2c_orders").update({ card_status: "registering" }).eq("id", order.id).eq("card_status", "failed")
    order = (await loadOrderById(order.id)) ?? order
  }
  return {
    ok: true,
    view: viewOf(order, { card, cardError: state === "failed" ? (si.last_setup_error?.decline_code ?? si.last_setup_error?.code ?? "card_failed") : undefined }),
  }
}

// ---------------------------------------------------------------------------
// 期限切れの片付け（カードの入力を始めたまま放置された予約の枠を返す）
// ---------------------------------------------------------------------------
/**
 * card_pending のまま B2C_CARD_WINDOW_MS を過ぎた予約を取り消す。
 * Stripe で SetupIntent を先に取り消し、取り消せた時だけ予約を取り消す。取り消せない（直前に登録が終わった・処理中）
 * 時は finalizeB2cCard に回す。これで「登録が終わったのに予約を取り消した」が起きない。
 */
export async function expireStaleCardPending(stripe: Stripe, now: Date = new Date(), limit = 5): Promise<{ expired: number; finalized: number }> {
  const sb = getSupabase()
  if (!sb) return { expired: 0, finalized: 0 }
  const before = new Date(now.getTime() - B2C_CARD_WINDOW_MS).toISOString()
  const { data } = await sb
    .from("b2c_orders")
    .select("id, stripe_setup_intent_id")
    .eq("status", "card_pending")
    .neq("card_status", "registered")
    .lt("updated_at", before)
    .order("updated_at", { ascending: true })
    .limit(limit)
  let expired = 0
  let finalized = 0
  for (const r of data ?? []) {
    const id = r.id as string
    const siId = r.stripe_setup_intent_id as string | null
    if (siId) {
      try {
        const si = await stripe.setupIntents.retrieve(siId)
        if (si.status === "processing") {
          finalized++
          continue
        }
        if (si.status === "succeeded") {
          const fin = await finalizeB2cCard(stripe, id, "system", now)
          finalized++
          if (fin.view?.cardStatus === "registered") continue
          // 受け付けなかったカード（CVC の失敗）のまま放置 → 下で予約を取り消す（SetupIntent は終わっているので取り消せない）
        } else if (si.status !== "canceled") {
          await stripe.setupIntents.cancel(siId)
        }
      } catch (e) {
        // 取消の直前に登録が終わった等。予約は取り消さず、照合に回す。
        console.error("[b2c/card] expire: cancel failed", (e as { code?: string })?.code)
        await finalizeB2cCard(stripe, id, "system", now).catch(() => undefined)
        finalized++
        continue
      }
    }
    // 取消・記録・旅行者への通知を DB の 1つのトランザクションで（sql/062 b2c_cancel_order）。直前に進んだ予約は取り消さない。
    const { data: out, error: cancelErr } = await sb.rpc("b2c_cancel_order", {
      p_order_id: id, p_reason: "card_timeout", p_actor_type: "system", p_expect_status: "card_pending",
    })
    if (cancelErr) console.error("[b2c/card] expire: cancel failed", cancelErr.code)
    if (out === "cancelled") expired++
  }
  return { expired, finalized }
}
