/**
 * My Booking（旅行者の予約の確認ページ）のサーバー側（Stage 4）。秘密の token（lib/b2c/access-token.ts）だけで本人を確かめる。
 *
 * 予約（b2c_orders）・配送（shipments の B2C の行）・決済（カードの登録・b2c_payments）の状態は別々に持ち、
 * 画面にはそれぞれを旅行者の言葉に読み替えて出す。確認待ちの間は集荷を約束する表現を使わない（Beta 計画 4章）。
 * 取消は集荷の前日 17:00（JST）まで（lib/b2c/bookability.ts の締切と同じ）。それ以降は問い合わせ。
 */
import { getSupabase } from "@/lib/supabase"
import { b2cCutoffAt } from "./bookability"
import { sha256Hex, B2cDbUnavailable, B2C_DB_TIMEOUT_MS } from "./booking-service"

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/

export type MyBookingStage = "card_pending" | "awaiting_hotel" | "confirmed" | "picked_up" | "in_transit" | "delivered" | "cancelled" | "completed" | "problem"
export type MyPaymentStage = "no_card" | "card_registered_not_charged" | "charge_scheduled" | "charged" | "charge_failed" | "refunded" | "not_charged_cancelled"

export interface MyBookingView {
  orderId: string
  orderNumber: number
  language: "ja" | "en"
  stage: MyBookingStage
  payment: MyPaymentStage
  guestName: string
  /** name・address は日本語（ホテルのスタッフ向け）。nameEn・addressEn は英語（無ければ空） */
  origin: { name: string; address: string; nameEn: string; addressEn: string; checkIn: string; checkOut: string }
  dest: { name: string; address: string; nameEn: string; addressEn: string; checkIn: string; checkOut: string }
  pickupDate: string
  deliveryDate: string
  pieces: number
  unitNetYen: number
  subtotalNetYen: number
  taxYen: number
  totalGrossYen: number
  routeClass: string
  confirmationDueAt: string | null
  cancelReason: string | null
  cancelledAt: string | null
  canCancel: boolean
  cancelDeadline: string
  trackingNumbers: string[]
}

interface Snap {
  name?: string
  address?: string
  name_en?: string | null
  address_en?: string | null
  check_in?: string
  check_out?: string
}

export async function loadMyBooking(token: unknown, now: Date = new Date()): Promise<MyBookingView | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null
  const sb = getSupabase()
  if (!sb) throw new B2cDbUnavailable("not configured")
  const { data: o, error } = await sb
    .from("b2c_orders")
    .select("id, order_number, language, status, card_status, guest_name, origin_snapshot, dest_snapshot, pickup_date, delivery_date, pieces, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen, route_class, confirmation_due_at, cancel_reason, cancelled_at")
    .eq("access_token_hash", sha256Hex(token))
    .abortSignal(AbortSignal.timeout(B2C_DB_TIMEOUT_MS))
    .maybeSingle()
  if (error) throw new B2cDbUnavailable("order")
  if (!o || o.status === "draft") return null

  const [{ data: ship, error: shipErr }, { data: pays, error: payErr }] = await Promise.all([
    sb.from("shipments").select("status, tracking_numbers").eq("b2c_order_id", o.id).abortSignal(AbortSignal.timeout(B2C_DB_TIMEOUT_MS)).maybeSingle(),
    sb.from("b2c_payments").select("status").eq("order_id", o.id).abortSignal(AbortSignal.timeout(B2C_DB_TIMEOUT_MS)),
  ])
  if (shipErr || payErr) throw new B2cDbUnavailable("shipment")

  const shipStatus = (ship?.status as string | undefined) ?? null
  let stage: MyBookingStage
  if (o.status === "cancelled") stage = "cancelled"
  else if (o.status === "completed") stage = "completed"
  else if (o.status === "card_pending") stage = "card_pending"
  else if (o.status === "awaiting_hotel_confirmation") stage = "awaiting_hotel"
  else if (shipStatus === "picked_up") stage = "picked_up"
  else if (shipStatus === "in_transit") stage = "in_transit"
  else if (shipStatus === "delivered") stage = "delivered"
  else if (shipStatus === "failed") stage = "problem"
  else stage = "confirmed"

  const statuses = (pays ?? []).map((p) => p.status as string)
  let payment: MyPaymentStage
  if (statuses.includes("refunded") || statuses.includes("partially_refunded")) payment = "refunded"
  else if (statuses.includes("succeeded")) payment = "charged"
  else if (statuses.some((s) => ["failed", "requires_action"].includes(s))) payment = "charge_failed"
  else if (statuses.length) payment = "charge_scheduled"
  else if (o.status === "cancelled") payment = "not_charged_cancelled"
  else if (o.card_status === "registered") payment = "card_registered_not_charged"
  else payment = "no_card"

  const cutoff = b2cCutoffAt(o.pickup_date as string)
  const cancellableStage = ["card_pending", "awaiting_hotel", "confirmed"].includes(stage)
  const snap = (x: Snap) => ({ name: x?.name ?? "", address: x?.address ?? "", nameEn: x?.name_en ?? "", addressEn: x?.address_en ?? "", checkIn: x?.check_in ?? "", checkOut: x?.check_out ?? "" })
  return {
    orderId: o.id as string,
    orderNumber: o.order_number as number,
    language: o.language === "ja" ? "ja" : "en",
    stage,
    payment,
    guestName: o.guest_name as string,
    origin: snap(o.origin_snapshot as Snap),
    dest: snap(o.dest_snapshot as Snap),
    pickupDate: o.pickup_date as string,
    deliveryDate: o.delivery_date as string,
    pieces: o.pieces as number,
    unitNetYen: o.unit_net_yen as number,
    subtotalNetYen: o.subtotal_net_yen as number,
    taxYen: o.tax_yen as number,
    totalGrossYen: o.total_gross_yen as number,
    routeClass: o.route_class as string,
    confirmationDueAt: (o.confirmation_due_at as string | null) ?? null,
    cancelReason: (o.cancel_reason as string | null) ?? null,
    cancelledAt: (o.cancelled_at as string | null) ?? null,
    canCancel: cancellableStage && now < cutoff,
    cancelDeadline: cutoff.toISOString(),
    trackingNumbers: Array.isArray(ship?.tracking_numbers) ? (ship!.tracking_numbers as string[]) : [],
  }
}

export type MyCancelResult = "cancelled" | "already_cancelled" | "too_late" | "not_cancellable" | "not_found"

/** 旅行者の取消（集荷の前日 17:00 まで）。DB の 1つのトランザクション（b2c_cancel_order）。請求は発生しない。 */
export async function cancelMyBooking(token: unknown, now: Date = new Date()): Promise<MyCancelResult> {
  const v = await loadMyBooking(token, now)
  if (!v) return "not_found"
  if (v.stage === "cancelled") return "already_cancelled"
  if (!["card_pending", "awaiting_hotel", "confirmed"].includes(v.stage)) return "not_cancellable"
  if (now >= new Date(v.cancelDeadline)) return "too_late"
  const sb = getSupabase()
  if (!sb) throw new B2cDbUnavailable("not configured")
  const { data, error } = await sb.rpc("b2c_cancel_order", { p_order_id: v.orderId, p_reason: "guest", p_actor_type: "guest" })
  if (error) throw new B2cDbUnavailable("cancel")
  if (data === "cancelled" || data === "already_cancelled" || data === "not_cancellable") return data
  return "not_found"
}
