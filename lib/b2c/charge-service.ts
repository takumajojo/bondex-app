/**
 * B2C の集荷の後の請求（Stage 5）。設計: docs/b2c/B2C_STAGE5_PAYMENT_DESIGN.md 3〜5章、DB: sql/074_b2c_stage5_payments.sql。
 *
 * お金が動くのは「DB に保存済みの PaymentIntent を確定（confirm）する」時だけ。
 * - PaymentIntent は confirm なしで作る（作っただけでは請求されない）。冪等キー = charge_key（論理の請求の ID）。
 *   ID を DB に保存できなければ確定しない。
 * - 確定の前に必ず Stripe から取り直す。成功済みなら DB を直すだけ（Stripe で成功し、DB の記録に失敗した場合の復旧）。
 * - 確定の冪等キー = charge_key + ":c" + 試行の番号。番号は確定の前に DB に保存する（結果が分からなければ同じキーで照合する）。
 * - 同じ論理の請求で、PaymentIntent を無条件に作り直さない。2回目以降の作成の前には、旅行者ごとの Customer の
 *   PaymentIntent の一覧（検索と違い反映の遅れが無い）から charge_key で探して、あればそれを使う。
 * - 結果が分からない（通信の切断・Stripe の 5xx・時間切れ）→ unknown。新しい請求は作らず、照合（reconcile）で決める。
 * - 自動の確定は 1つの請求に 1回だけ。失敗の後は、旅行者の支払のリンク（同じ PaymentIntent）か、運営の再試行だけ。
 */
import Stripe from "stripe"
import { getSupabase } from "@/lib/supabase"
import { b2cChargeLive } from "./flags"
import { B2C_STRIPE_CHANNEL } from "./stripe"
import { b2cNotifyLive, b2cWhatsAppLive } from "./notify"

export interface PaymentRow {
  id: string
  order_id: string
  kind: "base" | "extra"
  charge_key: string
  amount_yen: number
  pieces: number | null
  status: string
  stripe_payment_intent_id: string | null
  pi_create_started_at: string | null
  confirm_attempt: number
  first_failed_at: string | null
  last_error_code: string | null
}

interface OrderForCharge {
  id: string
  order_number: number
  language: "ja" | "en"
  stripe_customer_id: string | null
  stripe_payment_method_id: string | null
}

export type ChargeOutcome =
  | "succeeded"
  | "requires_action"
  | "failed"
  | "unknown"
  | "waiting"
  | "on_hold"
  | "unrecorded"
  | "not_live"
  | "skipped"

const IDEMPOTENT_CREATE_WINDOW_MS = 23 * 3600 * 1000
const UNKNOWN_RECHECK_MS = [2, 5, 15, 60].map((m) => m * 60_000)
const PAYMENT_COLS = "id, order_id, kind, charge_key, amount_yen, pieces, status, stripe_payment_intent_id, pi_create_started_at, confirm_attempt, first_failed_at, last_error_code"

/** DB の更新。一時的な失敗に備えて 3回まで。expect の状態の時だけ更新する。更新できたら true。 */
async function updatePayment(id: string, patch: Record<string, unknown>, expect: string[]): Promise<boolean> {
  const sb = getSupabase()
  if (!sb) return false
  for (const wait of [0, 300, 1500]) {
    if (wait) await new Promise((r) => setTimeout(r, wait))
    try {
      const { data, error } = await sb.from("b2c_payments").update(patch).eq("id", id).in("status", expect).select("id").maybeSingle()
      if (!error) return !!data
    } catch {
      /* 次の試行 */
    }
  }
  return false
}

async function loadOrder(orderId: string): Promise<OrderForCharge | null> {
  const sb = getSupabase()
  if (!sb) return null
  const { data } = await sb.from("b2c_orders").select("id, order_number, language, stripe_customer_id, stripe_payment_method_id").eq("id", orderId).maybeSingle()
  return (data as OrderForCharge | null) ?? null
}

export async function loadPayment(id: string): Promise<PaymentRow | null> {
  const sb = getSupabase()
  if (!sb) return null
  const { data, error } = await sb.from("b2c_payments").select(PAYMENT_COLS).eq("id", id).maybeSingle()
  if (error) throw new Error("db_unavailable")
  return (data as PaymentRow | null) ?? null
}

async function event(orderId: string, name: string, after: Record<string, unknown>, reason: string | null = null): Promise<void> {
  const sb = getSupabase()
  await sb?.from("b2c_order_events").insert({ order_id: orderId, event: name, actor_type: "system", reason, after_state: after })
}

/** 旅行者への支払の通知を送信待ちに積む（同じ通知は dedupe_key で 1回）。WhatsApp はテンプレートの承認の後だけ。 */
export async function enqueuePaymentNotice(orderId: string, lang: "ja" | "en", kind: "payment_action_required" | "payment_received" | "refund_issued", refId: string, seq = 0): Promise<void> {
  const sb = getSupabase()
  if (!sb) return
  const channels: Array<"email" | "whatsapp"> = ["email"]
  // 承認前は本番で WhatsApp を送らない（sandbox の試験では文面の確認のため両方積む）
  if (!b2cNotifyLive() || b2cWhatsAppLive()) channels.push("whatsapp")
  const rows = channels.map((ch) => ({ order_id: orderId, kind, channel: ch, ref_id: refId, language: lang, dedupe_key: `${kind}:${refId}:${seq}:${ch}` }))
  await sb.from("b2c_outbox").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true })
}

// ---------------------------------------------------------------------------
// Stripe の PaymentIntent の状態を DB に反映（確定はしない）。Webhook・支払のリンク・照合から呼ぶ。
// ---------------------------------------------------------------------------
const OPEN = ["processing", "unknown", "requires_action", "failed", "on_hold", "uncollectible"]

export async function applyPaymentIntent(p: PaymentRow, pi: Stripe.PaymentIntent, now: Date, lang: "ja" | "en"): Promise<ChargeOutcome> {
  const nowIso = now.toISOString()
  switch (pi.status) {
    case "succeeded": {
      if (p.status === "succeeded" || p.status === "partially_refunded" || p.status === "refunded") return "succeeded"
      const ok = await updatePayment(p.id, { status: "succeeded", succeeded_at: nowIso, last_error_code: null, last_error_message: null, locked_by: null, locked_at: null, next_check_at: null, hold_reason: null }, OPEN)
      if (!ok) return "unrecorded"
      await event(p.order_id, "charge_succeeded", { payment_id: p.id, kind: p.kind, amount_yen: p.amount_yen, payment_intent: pi.id })
      // 旅行者が支払のリンクで別のカードにした → 以後の請求（追加の個数）用にそのカードを保存
      const pm = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id
      if (pm) await getSupabase()?.from("b2c_orders").update({ stripe_payment_method_id: pm }).eq("id", p.order_id).neq("stripe_payment_method_id", pm)
      await enqueuePaymentNotice(p.order_id, lang, "payment_received", p.id)
      return "succeeded"
    }
    case "requires_action": {
      if (p.status === "requires_action") return "requires_action"
      const ok = await updatePayment(p.id, { status: "requires_action", first_failed_at: p.first_failed_at ?? nowIso, last_error_code: "authentication_required", locked_by: null, locked_at: null, next_check_at: null }, ["processing", "unknown", "failed"])
      if (!ok) return "unrecorded"
      await event(p.order_id, "charge_requires_action", { payment_id: p.id, payment_intent: pi.id })
      await enqueuePaymentNotice(p.order_id, lang, "payment_action_required", p.id, 0)
      return "requires_action"
    }
    case "requires_payment_method": {
      const err = pi.last_payment_error
      if (!err) return "waiting" // まだ一度も確定していない
      if (p.status === "failed") return "failed"
      const code = err.decline_code ?? err.code ?? "card_error"
      const ok = await updatePayment(p.id, { status: "failed", first_failed_at: p.first_failed_at ?? nowIso, last_error_code: code, last_error_message: (err.message ?? "").slice(0, 300), locked_by: null, locked_at: null, next_check_at: null }, ["processing", "unknown", "requires_action"])
      if (!ok) return "unrecorded"
      await event(p.order_id, "charge_failed", { payment_id: p.id, code, payment_intent: pi.id })
      await enqueuePaymentNotice(p.order_id, lang, "payment_action_required", p.id, 0)
      return "failed"
    }
    case "processing":
      // カードではほぼ無い（非同期の決済）。結果が出るまで照合で待つ
      await updatePayment(p.id, { status: "unknown", next_check_at: new Date(now.getTime() + 5 * 60_000).toISOString(), locked_by: null, locked_at: null }, ["processing", "unknown"])
      return "unknown"
    case "canceled": {
      const ok = await updatePayment(p.id, { status: "on_hold", hold_reason: "stripe_canceled", locked_by: null, locked_at: null }, ["processing", "unknown", "requires_action", "failed"])
      if (ok) await event(p.order_id, "charge_on_hold", { payment_id: p.id, hold_reason: "stripe_canceled", payment_intent: pi.id })
      return ok ? "on_hold" : "unrecorded"
    }
    default:
      return "waiting"
  }
}

/** Stripe の例外の種類から「結果が分からない」かどうか */
function isUncertain(e: unknown): boolean {
  const t = (e as { type?: string })?.type ?? ""
  const status = (e as { statusCode?: number })?.statusCode ?? 0
  return t === "StripeConnectionError" || t === "StripeAPIError" || t === "StripeRateLimitError" || t === "StripeIdempotencyError" || status >= 500 || !t
}

async function markUnknown(p: PaymentRow, why: string, now: Date): Promise<ChargeOutcome> {
  const n = Math.min(Math.max(0, (p.status === "unknown" ? 1 : 0)), UNKNOWN_RECHECK_MS.length - 1)
  const ok = await updatePayment(p.id, { status: "unknown", last_error_code: why.slice(0, 80), next_check_at: new Date(now.getTime() + UNKNOWN_RECHECK_MS[n]).toISOString(), locked_by: null, locked_at: null }, ["processing", "unknown"])
  return ok ? "unknown" : "unrecorded"
}

/** 旅行者の Customer の PaymentIntent の一覧から、この論理の請求のものを探す（反映の遅れが無い一覧を使う） */
async function findPaymentIntentsFor(stripe: Stripe, customer: string, chargeKey: string): Promise<Stripe.PaymentIntent[]> {
  const out: Stripe.PaymentIntent[] = []
  for await (const pi of stripe.paymentIntents.list({ customer, limit: 100 })) {
    if (pi.metadata?.charge_key === chargeKey && pi.metadata?.channel === B2C_STRIPE_CHANNEL) out.push(pi)
  }
  return out
}

/**
 * 取消の申請（佐川の確認待ち）が残っているか。sql/082 の b2c_charge_check と同じ条件（kind=cancel・stage requested/contacted/approved）。
 * 定期の処理の取り出し（DB で確認済み）以外の入口（照合・運営の再試行・支払のページ・回収の案内）で使う。読めなければ true（請求しない側に倒す）。
 */
export async function b2cCancelPending(orderId: string): Promise<boolean> {
  const sb = getSupabase()
  if (!sb) return true
  const { data: ships, error } = await sb.from("shipments").select("id").eq("b2c_order_id", orderId)
  if (error) return true
  const ids = (ships ?? []).map((x) => x.id as string)
  if (!ids.length) return false
  const { count, error: e2 } = await sb
    .from("shipment_change_requests")
    .select("id", { count: "exact", head: true })
    .in("shipment_id", ids)
    .eq("kind", "cancel")
    .in("stage", ["requested", "contacted", "approved"])
  if (e2) return true
  return (count ?? 0) > 0
}

/**
 * PaymentIntent を用意する（作成または既存のものを使う）。DB に ID を保存できたら、その ID を返す。
 * 同じ論理の請求で PaymentIntent を無条件に作り直さない。
 */
async function ensurePaymentIntent(stripe: Stripe, p: PaymentRow, o: OrderForCharge, now: Date): Promise<{ id: string } | { outcome: ChargeOutcome }> {
  const sb = getSupabase()!
  if (!o.stripe_customer_id || !o.stripe_payment_method_id) {
    const ok = await updatePayment(p.id, { status: "on_hold", hold_reason: "no_card", locked_by: null, locked_at: null }, ["processing"])
    return { outcome: ok ? "on_hold" : "unrecorded" }
  }
  const startedBefore = p.pi_create_started_at
  if (!startedBefore) {
    // 作成を始める前に記録する（記録できなければ作らない）
    const ok = await updatePayment(p.id, { pi_create_started_at: now.toISOString() }, ["processing"])
    if (!ok) return { outcome: "unrecorded" }
  }
  let piId: string | null = null
  if (startedBefore) {
    // 前に作成を試みた（結果が分からない・ID の保存に失敗した）→ 先に Stripe の一覧で探す
    try {
      const found = await findPaymentIntentsFor(stripe, o.stripe_customer_id, p.charge_key)
      const live = found.filter((x) => x.status !== "canceled")
      piId = (live.find((x) => x.status === "succeeded") ?? live[0])?.id ?? null
    } catch (e) {
      return { outcome: await markUnknown(p, `list_failed:${(e as Error).message ?? ""}`, now) }
    }
  }
  if (!piId) {
    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount: p.amount_yen,
          currency: "jpy",
          customer: o.stripe_customer_id,
          payment_method: o.stripe_payment_method_id,
          payment_method_types: ["card"],
          description: `BondEx B2C ${o.order_number} (${p.kind})`,
          metadata: { channel: B2C_STRIPE_CHANNEL, charge_key: p.charge_key, payment_id: p.id, order_id: p.order_id, kind: p.kind },
        },
        { idempotencyKey: p.charge_key },
      )
      piId = pi.id
    } catch (e) {
      // 同じキーで違う内容（カードが変わった等）→ 既にある PaymentIntent を一覧で探す
      if ((e as { type?: string })?.type === "StripeIdempotencyError" || (e as { type?: string })?.type === "StripeInvalidRequestError") {
        try {
          const found = (await findPaymentIntentsFor(stripe, o.stripe_customer_id, p.charge_key)).filter((x) => x.status !== "canceled")
          piId = found[0]?.id ?? null
        } catch {
          /* 下で unknown */
        }
      }
      if (!piId) return { outcome: await markUnknown(p, `create_failed:${(e as Error).message ?? ""}`.slice(0, 80), now) }
    }
  }
  // ID を保存（保存できなければ確定しない。次の照合で一覧から同じものを見つける）
  const { data: saved, error } = await sb
    .from("b2c_payments")
    .update({ stripe_payment_intent_id: piId })
    .eq("id", p.id)
    .is("stripe_payment_intent_id", null)
    .select("id")
    .maybeSingle()
  if (error || !saved) {
    console.error(JSON.stringify({ event: "b2c_charge_pi_unrecorded", payment_id: p.id, payment_intent: piId }))
    return { outcome: "unrecorded" }
  }
  // 万一同じ請求の PaymentIntent が他にもあれば、確定していないものを取り消す（請求はされていない）
  try {
    const others = (await findPaymentIntentsFor(stripe, o.stripe_customer_id, p.charge_key)).filter((x) => x.id !== piId && x.status !== "canceled" && x.status !== "succeeded")
    for (const x of others) await stripe.paymentIntents.cancel(x.id, {}, { idempotencyKey: `${p.charge_key}:cancel:${x.id}` }).catch(() => undefined)
  } catch {
    /* 片付けは次の照合でもよい */
  }
  return { id: piId }
}

/**
 * 1つの請求を進める（status = processing の行）。allowConfirm=false の時は Stripe の状態を反映するだけ。
 */
export async function processPayment(stripe: Stripe, row: PaymentRow, now: Date, opts: { allowConfirm?: boolean } = {}): Promise<ChargeOutcome> {
  const allowConfirm = opts.allowConfirm ?? b2cChargeLive()
  const o = await loadOrder(row.order_id)
  if (!o) return markUnknown(row, "order_unreadable", now)
  let p = row
  // 照合で取り出した行（作成・確定の途中で止まった）も、確定をまだ送っていなければ取消の申請を確かめる（送った後は結果の確認を優先）
  if (allowConfirm && p.confirm_attempt === 0 && (await b2cCancelPending(p.order_id))) {
    const ok = await updatePayment(p.id, { status: "on_hold", hold_reason: "cancel_pending", locked_by: null, locked_at: null }, ["processing", "unknown"])
    if (ok) await event(p.order_id, "charge_on_hold", { payment_id: p.id, hold_reason: "cancel_pending" })
    return ok ? "on_hold" : "unrecorded"
  }
  let piId = p.stripe_payment_intent_id
  if (!piId) {
    if (!allowConfirm) {
      // 請求を止めている間は作成もしない（scheduled に戻す）
      await updatePayment(p.id, { status: "scheduled", locked_by: null, locked_at: null }, ["processing"])
      return "not_live"
    }
    const r = await ensurePaymentIntent(stripe, p, o, now)
    if ("outcome" in r) return r.outcome
    piId = r.id
    p = { ...p, stripe_payment_intent_id: piId }
  }

  let pi: Stripe.PaymentIntent
  try {
    pi = await stripe.paymentIntents.retrieve(piId)
  } catch (e) {
    return markUnknown(p, `retrieve_failed:${(e as Error).message ?? ""}`.slice(0, 80), now)
  }
  if (pi.amount !== p.amount_yen || pi.currency !== "jpy" || pi.metadata?.charge_key !== p.charge_key) {
    // Stripe の中身が DB と違う → 自動で確定しない
    await updatePayment(p.id, { status: "on_hold", hold_reason: "stripe_mismatch", locked_by: null, locked_at: null }, ["processing", "unknown"])
    await event(p.order_id, "charge_on_hold", { payment_id: p.id, hold_reason: "stripe_mismatch", payment_intent: pi.id })
    return "on_hold"
  }
  const needsConfirm = pi.status === "requires_confirmation" || (pi.status === "requires_payment_method" && !pi.last_payment_error)
  if (!needsConfirm) {
    const r = await applyPaymentIntent(p, pi, now, o.language)
    if (r === "waiting") await updatePayment(p.id, { status: "unknown", next_check_at: new Date(now.getTime() + 2 * 60_000).toISOString(), locked_by: null, locked_at: null }, ["processing"])
    return r
  }
  if (!allowConfirm) {
    await updatePayment(p.id, { status: "unknown", next_check_at: new Date(now.getTime() + 15 * 60_000).toISOString(), locked_by: null, locked_at: null, last_error_code: "charge_not_live" }, ["processing"])
    return "not_live"
  }

  // 確定。試行の番号は確定の前に保存（保存できなければ確定しない）。番号が既にあれば同じキーで送る（届いていれば Stripe が前の結果を返す）
  let attempt = p.confirm_attempt
  if (attempt === 0) {
    attempt = 1
    const ok = await updatePayment(p.id, { confirm_attempt: 1, confirm_started_at: now.toISOString() }, ["processing"])
    if (!ok) return "unrecorded"
  }
  let confirmed: Stripe.PaymentIntent
  try {
    confirmed = await stripe.paymentIntents.confirm(piId, { payment_method: (typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id) ?? o.stripe_payment_method_id!, off_session: true }, { idempotencyKey: `${p.charge_key}:c${attempt}` })
  } catch (e) {
    const se = e as { type?: string; payment_intent?: Stripe.PaymentIntent; code?: string }
    if (se.type === "StripeCardError" && se.payment_intent) return applyPaymentIntent(p, se.payment_intent, now, o.language)
    if (isUncertain(e)) return markUnknown(p, `confirm_uncertain:${se.code ?? se.type ?? ""}`, now)
    // その他（状態が合わない等）→ 取り直して反映
    try {
      return applyPaymentIntent(p, await stripe.paymentIntents.retrieve(piId), now, o.language)
    } catch {
      return markUnknown(p, `confirm_error:${se.code ?? ""}`, now)
    }
  }
  return applyPaymentIntent(p, confirmed, now, o.language)
}

export interface ChargeRunResult {
  claimed: number
  reconciled: number
  outcomes: Record<string, number>
  notLive: boolean
}

/** 定期の処理: 30分を過ぎた請求（DB の関数で条件を再確認）と、結果が分からない請求の照合。 */
export async function runB2cCharges(stripe: Stripe, now: Date = new Date(), worker = "tick", limit = 10): Promise<ChargeRunResult> {
  const res: ChargeRunResult = { claimed: 0, reconciled: 0, outcomes: {}, notLive: !b2cChargeLive() }
  const sb = getSupabase()
  if (!sb) return res
  const count = (o: ChargeOutcome) => (res.outcomes[o] = (res.outcomes[o] ?? 0) + 1)
  // 照合（請求を止めている間も、Stripe の状態の反映だけは行う）
  const { data: rec, error: recErr } = await sb.rpc("b2c_claim_reconcile", { p_now: now.toISOString(), p_stale: "10 minutes", p_limit: limit, p_worker: worker })
  if (recErr) throw new Error(`claim_reconcile: ${recErr.message}`)
  for (const row of (rec ?? []) as PaymentRow[]) {
    res.reconciled++
    count(await processPayment(stripe, row, now))
  }
  if (!b2cChargeLive()) return res
  const { data: rows, error } = await sb.rpc("b2c_claim_charges", { p_now: now.toISOString(), p_limit: limit, p_worker: worker })
  if (error) throw new Error(`claim_charges: ${error.message}`)
  for (const row of (rows ?? []) as PaymentRow[]) {
    res.claimed++
    count(await processPayment(stripe, row, now))
  }
  return res
}

/** 1つの請求を Stripe の今の状態に合わせる（Webhook・支払のリンクの後）。確定はしない。 */
export async function syncPaymentFromStripe(stripe: Stripe, paymentId: string, now: Date = new Date()): Promise<ChargeOutcome> {
  const p = await loadPayment(paymentId)
  if (!p || !p.stripe_payment_intent_id) return "skipped"
  const o = await loadOrder(p.order_id)
  const pi = await stripe.paymentIntents.retrieve(p.stripe_payment_intent_id)
  if (pi.metadata?.charge_key !== p.charge_key) return "skipped"
  return applyPaymentIntent(p, pi, now, o?.language ?? "en")
}

/** 運営の再試行（失敗した請求を、登録済みのカードでもう一度）。新しい試行の番号で確定する。同じ PaymentIntent。 */
export async function retryChargeByOps(stripe: Stripe, paymentId: string, now: Date = new Date()): Promise<ChargeOutcome | "not_retryable" | "cancel_pending"> {
  const p = await loadPayment(paymentId)
  if (!p || p.status !== "failed" || !p.stripe_payment_intent_id) return "not_retryable"
  if (await b2cCancelPending(p.order_id)) return "cancel_pending"
  const ok = await updatePayment(p.id, { status: "processing", locked_by: "ops", locked_at: now.toISOString(), confirm_attempt: p.confirm_attempt + 1, confirm_started_at: now.toISOString() }, ["failed"])
  if (!ok) return "not_retryable"
  const o = await loadOrder(p.order_id)
  if (!o) return markUnknown(p, "order_unreadable", now)
  const attempt = p.confirm_attempt + 1
  try {
    const confirmed = await stripe.paymentIntents.confirm(p.stripe_payment_intent_id, { payment_method: o.stripe_payment_method_id!, off_session: true }, { idempotencyKey: `${p.charge_key}:c${attempt}` })
    return applyPaymentIntent({ ...p, status: "processing" }, confirmed, now, o.language)
  } catch (e) {
    const se = e as { type?: string; payment_intent?: Stripe.PaymentIntent }
    if (se.type === "StripeCardError" && se.payment_intent) return applyPaymentIntent({ ...p, status: "processing" }, se.payment_intent, now, o.language)
    return markUnknown({ ...p, status: "processing" }, "ops_retry_uncertain", now)
  }
}

/** 回収の案内: 失敗の時（積む時に送る）に加えて、1日後・3日後・7日後。支払の後は送らない（送る直前に状態を確かめる）。 */
export async function enqueueCollectionReminders(now: Date = new Date()): Promise<number> {
  const sb = getSupabase()
  if (!sb) return 0
  const { data } = await sb.from("b2c_payments").select("id, order_id, first_failed_at").in("status", ["failed", "requires_action"]).not("first_failed_at", "is", null).limit(500)
  let n = 0
  for (const p of data ?? []) {
    const days = (now.getTime() - new Date(p.first_failed_at as string).getTime()) / 86400_000
    const seq = days >= 7 ? 3 : days >= 3 ? 2 : days >= 1 ? 1 : 0
    if (seq === 0) continue
    if (await b2cCancelPending(p.order_id as string)) continue // 取消の申請中は支払を促さない
    const { data: o } = await sb.from("b2c_orders").select("language").eq("id", p.order_id).maybeSingle()
    await enqueuePaymentNotice(p.order_id as string, (o?.language as "ja" | "en") ?? "en", "payment_action_required", p.id as string, seq)
    n++
  }
  return n
}

// ---------------------------------------------------------------------------
// Stripe の PaymentIntent が B2C の請求かどうか（Webhook の振り分け）。metadata だけに頼らず、DB の請求の記録と照らす。
// ---------------------------------------------------------------------------
/**
 * B2C の請求の記録を探す。見つかれば請求の ID。
 * 1. PaymentIntent の ID が b2c_payments にある → B2C。
 * 2. metadata（channel=b2c・charge_key・payment_id）が DB の同じ請求（同じ charge_key）と一致する → B2C
 *    （PaymentIntent の ID の保存に失敗した直後の通知。この時は ID を記録する）。
 * どちらでもなければ null（B2C ではない、または DB に無い）。DB を読めない時は例外（呼び出し側で再送させる）。
 */
export async function findB2cPaymentForPaymentIntent(piId: string, metadata: Record<string, string> | null | undefined, adopt = true): Promise<string | null> {
  const sb = getSupabase()
  if (!sb) throw new Error("db_unavailable")
  const { data, error } = await sb.from("b2c_payments").select("id").eq("stripe_payment_intent_id", piId).maybeSingle()
  if (error) throw new Error("db_unavailable")
  if (data) return data.id as string
  const pid = metadata?.payment_id
  if (metadata?.channel !== B2C_STRIPE_CHANNEL || !pid || !metadata?.charge_key) return null
  const { data: byKey, error: e2 } = await sb.from("b2c_payments").select("id, charge_key, stripe_payment_intent_id").eq("id", pid).maybeSingle()
  if (e2) throw new Error("db_unavailable")
  if (!byKey || byKey.charge_key !== metadata.charge_key) return null
  if (adopt && !byKey.stripe_payment_intent_id) {
    await sb.from("b2c_payments").update({ stripe_payment_intent_id: piId }).eq("id", pid).is("stripe_payment_intent_id", null)
  }
  return byKey.id as string
}

/**
 * B2B の Stripe の Webhook（app/api/stripe/webhook）用: この PaymentIntent は B2C の請求か。
 * DB の B2C の請求の記録と照らす（metadata だけでは判断しない）。B2C の表がまだ無い DB（本番に 061 を適用する前）や
 * DB を読めない時は false（B2B の今までの処理に任せる）。
 */
export async function isB2cPaymentIntent(piId: string | null, metadata: Record<string, string> | null | undefined): Promise<boolean> {
  if (!piId) return false
  try {
    return (await findB2cPaymentForPaymentIntent(piId, metadata, false)) !== null
  } catch {
    return false
  }
}
