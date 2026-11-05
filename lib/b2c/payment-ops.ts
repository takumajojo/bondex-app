/**
 * 運営の B2C の作業（Stage 5）: 要対応の一覧・予約の詳細・集荷の確認と取消・止めた請求の解除と中止・請求の再試行・
 * 個数の訂正・返金・回収不能。設計: docs/b2c/B2C_STAGE5_PAYMENT_DESIGN.md 2・4・6・7章。
 *
 * どの操作も個人のパスキーの運営者（lib/b2c/operator-identity.ts）だけ。理由は必須。DB の関数（sql/074）が
 * 予約・請求の行をロックして状態を確かめ、操作の記録（b2c_order_events）を残す。
 */
import Stripe from "stripe"
import { getSupabase } from "@/lib/supabase"
import type { B2cOperator } from "./operator-identity"
import { b2cOpsAlert, jstYmdOf } from "./notify"
import { listOutboxProblems } from "./outbox-ops"
import { retryChargeByOps } from "./charge-service"
import { requestB2cRefund } from "./refund-service"
import { b2cChargeLive } from "./flags"

export const EVIDENCE_TYPES = ["sagawa_tracking", "sagawa_driver", "hotel_report", "other"] as const
export type EvidenceType = (typeof EVIDENCE_TYPES)[number]

async function orderIdOf(orderNumber: number): Promise<string | null> {
  const sb = getSupabase()
  if (!sb) return null
  const { data } = await sb.from("b2c_orders").select("id").eq("order_number", orderNumber).maybeSingle()
  return (data?.id as string | undefined) ?? null
}

// ---------------------------------------------------------------------------
// 要対応の一覧
// ---------------------------------------------------------------------------
export async function loadB2cTodo(now: Date = new Date()) {
  const sb = getSupabase()
  if (!sb) return null
  const nums = async (ids: string[]) => {
    if (!ids.length) return new Map<string, { n: number; lang: string; pickup: string }>()
    const { data } = await sb.from("b2c_orders").select("id, order_number, language, pickup_date").in("id", ids)
    return new Map((data ?? []).map((o) => [o.id as string, { n: o.order_number as number, lang: o.language as string, pickup: o.pickup_date as string }]))
  }
  const { data: pays, error } = await sb
    .from("b2c_payments")
    .select("id, order_id, kind, status, amount_yen, pieces, hold_reason, last_error_code, first_failed_at, scheduled_at, stripe_payment_intent_id, refunded_yen, updated_at")
    .in("status", ["unknown", "on_hold", "failed", "requires_action", "uncollectible", "processing", "scheduled"])
    .order("updated_at", { ascending: true })
    .limit(300)
  if (error) return null
  const today = jstYmdOf(now)
  const { data: due } = await sb
    .from("b2c_orders")
    .select("id, order_number, pickup_date, pieces")
    .eq("status", "confirmed")
    .lte("pickup_date", today)
    .limit(300)
  const dueIds = (due ?? []).map((o) => o.id as string)
  const { data: ships } = dueIds.length ? await sb.from("shipments").select("b2c_order_id, status").in("b2c_order_id", dueIds) : { data: [] }
  // 集荷の確認待ち: 集荷の前の区間に加え、追跡の同期が先に集荷済み以降に進めた区間（sql/082 で確認できる）も、
  // 基本料金の請求の行がまだ無い（または取り消した）予約は一覧に出す（出さないと請求されないまま埋もれる）
  const { data: basePays } = dueIds.length ? await sb.from("b2c_payments").select("order_id, status").eq("kind", "base").in("order_id", dueIds) : { data: [] }
  const billed = new Set((basePays ?? []).filter((p) => p.status !== "cancelled").map((p) => p.order_id as string))
  // 確認済み（取り消していない）の予約は出さない（運営が「請求をやめる」にした予約を、確認できないのに再び出さない）
  const { data: confs } = dueIds.length ? await sb.from("b2c_pickup_confirmations").select("order_id").is("revoked_at", null).in("order_id", dueIds) : { data: [] }
  for (const c of confs ?? []) billed.add(c.order_id as string)
  const pre = new Set(
    (ships ?? [])
      .filter((s) => ["requested", "pending", "issued", "picked_up", "in_transit", "delivered"].includes(s.status as string) && !billed.has(s.b2c_order_id as string))
      .map((s) => s.b2c_order_id as string),
  )
  const { data: awaiting } = await sb.from("b2c_orders").select("order_number, confirmation_due_at, confirmation_mode").eq("status", "awaiting_hotel_confirmation").order("confirmation_due_at").limit(100)

  const ids = [...new Set((pays ?? []).map((p) => p.order_id as string))]
  const m = await nums(ids)
  const row = (p: Record<string, unknown>) => {
    const o = m.get(p.order_id as string)
    const daysUnpaid = p.first_failed_at ? Math.floor((now.getTime() - new Date(p.first_failed_at as string).getTime()) / 86400_000) : null
    return {
      paymentId: p.id as string,
      orderNumber: o?.n ?? null,
      kind: p.kind as string,
      status: p.status as string,
      amountYen: p.amount_yen as number,
      pieces: p.pieces as number | null,
      holdReason: (p.hold_reason as string | null) ?? null,
      lastError: (p.last_error_code as string | null) ?? null,
      daysUnpaid,
      canMarkUncollectible: (p.status === "failed" || p.status === "requires_action") && daysUnpaid !== null && daysUnpaid >= 14,
      scheduledAt: p.scheduled_at as string,
      minutesToCharge: p.status === "scheduled" ? Math.ceil((new Date(p.scheduled_at as string).getTime() - now.getTime()) / 60_000) : null,
    }
  }
  const all = (pays ?? []).map(row)
  const stale = (p: Record<string, unknown>) => p.status === "processing" && now.getTime() - new Date(p.updated_at as string).getTime() > 10 * 60_000
  return {
    unknownCharges: all.filter((p, i) => p.status === "unknown" || stale((pays ?? [])[i])),
    heldCharges: all.filter((p) => p.status === "on_hold"),
    unpaid: all.filter((p) => ["failed", "requires_action", "uncollectible"].includes(p.status)),
    scheduled: all.filter((p) => p.status === "scheduled"),
    pickupUnconfirmed: (due ?? []).filter((o) => pre.has(o.id as string)).map((o) => ({ orderNumber: o.order_number as number, pickupDate: o.pickup_date as string, pieces: o.pieces as number })),
    awaitingHotel: (awaiting ?? []).map((o) => ({ orderNumber: o.order_number as number, dueAt: o.confirmation_due_at as string, mode: o.confirmation_mode as string })),
    notifications: (await listOutboxProblems(now)) ?? [],
  }
}

/** 予約の詳細（予約・配送・集荷の確認・請求・返金・通知・操作の記録） */
export async function loadB2cOrderDetail(orderNumber: number) {
  const sb = getSupabase()
  if (!sb) return null
  const { data: o } = await sb
    .from("b2c_orders")
    .select("id, order_number, status, language, guest_name, pickup_date, delivery_date, pieces, unit_net_yen, total_gross_yen, card_status, origin_snapshot, dest_snapshot, cancel_reason, confirmed_at, cancelled_at")
    .eq("order_number", orderNumber)
    .maybeSingle()
  if (!o) return null
  const id = o.id as string
  const [ship, conf, pays, outbox, events] = await Promise.all([
    sb.from("shipments").select("id, status, tracking_numbers, tracking_detail, picked_up_at, suitcase_count").eq("b2c_order_id", id).maybeSingle(),
    sb.from("b2c_pickup_confirmations").select("id, operator_email, evidence_type, evidence_ref, booked_pieces, accepted_pieces, reason, confirmed_at, revoked_at, revoked_by, revoke_reason").eq("order_id", id).order("confirmed_at"),
    sb.from("b2c_payments").select("id, kind, status, amount_yen, pieces, refunded_yen, hold_reason, last_error_code, scheduled_at, succeeded_at, first_failed_at, stripe_payment_intent_id, checks_overridden, override_by, override_reason, created_at").eq("order_id", id).order("created_at"),
    sb.from("b2c_outbox").select("id, kind, channel, status, attempts, last_error, sent_at, created_at").eq("order_id", id).order("id"),
    sb.from("b2c_order_events").select("event, actor_type, operator_email, reason, created_at, after_state").eq("order_id", id).order("id"),
  ])
  const payIds = (pays.data ?? []).map((p) => p.id as string)
  const { data: refunds } = payIds.length ? await sb.from("b2c_refunds").select("id, payment_id, amount_yen, status, reason, requested_by, stripe_refund_id, created_at").in("payment_id", payIds).order("created_at") : { data: [] }
  return {
    order: { ...o, origin: (o.origin_snapshot as { name?: string })?.name ?? "", dest: (o.dest_snapshot as { name?: string })?.name ?? "", origin_snapshot: undefined, dest_snapshot: undefined },
    shipment: ship.data ?? null,
    pickupConfirmations: conf.data ?? [],
    payments: pays.data ?? [],
    refunds: refunds ?? [],
    notifications: outbox.data ?? [],
    events: events.data ?? [],
  }
}

// ---------------------------------------------------------------------------
// 操作
// ---------------------------------------------------------------------------
export type OpsResult = { ok: true; result: string; data?: unknown } | { ok: false; error: string; data?: unknown }

export async function confirmPickup(op: B2cOperator, orderNumber: number, evidenceType: EvidenceType, evidenceRef: string, acceptedPieces: number, reason: string, now: Date = new Date()): Promise<OpsResult> {
  const sb = getSupabase()
  const id = await orderIdOf(orderNumber)
  if (!sb || !id) return { ok: false, error: "order_not_found" }
  const { data, error } = await sb.rpc("b2c_confirm_pickup", {
    p_order_id: id, p_operator_email: op.operatorEmail, p_credential_id: op.credentialId,
    p_evidence_type: evidenceType, p_evidence_ref: evidenceRef, p_accepted_pieces: acceptedPieces, p_reason: reason, p_now: now.toISOString(),
  })
  if (error) return { ok: false, error: "server_error" }
  const r = data as { result: string; pieces_mismatch?: boolean; amount_yen?: number; scheduled_at?: string; payment_id?: string }
  if (r.result !== "confirmed") return { ok: false, error: r.result, data: r }
  if (r.pieces_mismatch) {
    // 予約と実際の個数が違う → 請求は止めてある。運営が根拠を確かめて確定する
    await b2cOpsAlert()({
      subject: `【B2C 個数の違い】受付番号 ${orderNumber}: 予約と佐川の受託の個数が違います（請求を止めています）`,
      lines: [`受託の個数: ${acceptedPieces}個 / 請求の予定額: ¥${(r.amount_yen ?? 0).toLocaleString("ja-JP")}`, `根拠: ${evidenceType} ${evidenceRef}`, "→ 運営の画面（/operator/b2c）で根拠を確かめ、「この個数で請求する」か「請求をやめる」を選んでください。"],
      agencyEmail: null,
    }).catch(() => undefined)
  }
  return { ok: true, result: "confirmed", data: r }
}

export async function revokePickup(op: B2cOperator, orderNumber: number, reason: string, now: Date = new Date()): Promise<OpsResult> {
  const sb = getSupabase()
  const id = await orderIdOf(orderNumber)
  if (!sb || !id) return { ok: false, error: "order_not_found" }
  const { data, error } = await sb.rpc("b2c_revoke_pickup", { p_order_id: id, p_operator_email: op.operatorEmail, p_credential_id: op.credentialId, p_reason: reason, p_now: now.toISOString() })
  if (error) return { ok: false, error: "server_error" }
  return data === "revoked" ? { ok: true, result: "revoked" } : { ok: false, error: String(data) }
}

export async function resolveHold(op: B2cOperator, paymentId: string, action: "release" | "cancel", reason: string, now: Date = new Date()): Promise<OpsResult> {
  const sb = getSupabase()
  if (!sb) return { ok: false, error: "server_error" }
  const { data, error } = await sb.rpc("b2c_resolve_charge_hold", { p_payment_id: paymentId, p_action: action, p_operator_email: op.operatorEmail, p_credential_id: op.credentialId, p_reason: reason, p_now: now.toISOString() })
  if (error) return { ok: false, error: "server_error" }
  return data === "released" || data === "cancelled" ? { ok: true, result: data } : { ok: false, error: String(data) }
}

export async function retryCharge(op: B2cOperator, stripe: Stripe, paymentId: string, reason: string, now: Date = new Date()): Promise<OpsResult> {
  if (!b2cChargeLive()) return { ok: false, error: "charge_not_live" }
  const sb = getSupabase()
  if (!sb) return { ok: false, error: "server_error" }
  const { data: p } = await sb.from("b2c_payments").select("order_id").eq("id", paymentId).maybeSingle()
  if (!p) return { ok: false, error: "not_found" }
  const out = await retryChargeByOps(stripe, paymentId, now)
  if (out === "not_retryable" || out === "cancel_pending") return { ok: false, error: out }
  await sb.from("b2c_order_events").insert({ order_id: p.order_id, event: "charge_retried_by_ops", actor_type: "operator", operator_email: op.operatorEmail, credential_id: op.credentialId, reason, after_state: { payment_id: paymentId, outcome: out } })
  return { ok: true, result: out }
}

export async function correctPieces(op: B2cOperator, orderNumber: number, actualPieces: number, evidenceType: EvidenceType, evidenceRef: string, reason: string, now: Date = new Date()): Promise<OpsResult> {
  const sb = getSupabase()
  const id = await orderIdOf(orderNumber)
  if (!sb || !id) return { ok: false, error: "order_not_found" }
  const { data, error } = await sb.rpc("b2c_record_piece_correction", {
    p_order_id: id, p_actual_pieces: actualPieces, p_evidence_type: evidenceType, p_evidence_ref: evidenceRef,
    p_operator_email: op.operatorEmail, p_credential_id: op.credentialId, p_reason: reason, p_now: now.toISOString(),
  })
  if (error) return { ok: false, error: "server_error" }
  const r = data as { result: string }
  return ["extra_scheduled", "refund_due", "no_difference"].includes(r.result) ? { ok: true, result: r.result, data: r } : { ok: false, error: r.result, data: r }
}

export async function refund(op: B2cOperator, stripe: Stripe, paymentId: string, amountYen: number, reason: string, now: Date = new Date()): Promise<OpsResult> {
  const r = await requestB2cRefund(stripe, op, paymentId, amountYen, reason, now)
  return r.ok ? { ok: true, result: r.status, data: { refundId: r.refundId } } : { ok: false, error: r.error, data: { refundableYen: r.refundableYen } }
}

export async function markUncollectible(op: B2cOperator, paymentId: string, reason: string, now: Date = new Date()): Promise<OpsResult> {
  const sb = getSupabase()
  if (!sb) return { ok: false, error: "server_error" }
  const { data, error } = await sb.rpc("b2c_mark_uncollectible", { p_payment_id: paymentId, p_operator_email: op.operatorEmail, p_credential_id: op.credentialId, p_reason: reason, p_now: now.toISOString() })
  if (error) return { ok: false, error: "server_error" }
  return data === "marked" ? { ok: true, result: "marked" } : { ok: false, error: String(data) }
}
