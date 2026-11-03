import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { b2cMyBookingEnabled } from "@/lib/b2c/flags"
import { B2cDbUnavailable } from "@/lib/b2c/booking-service"
import { b2cUnavailable } from "@/lib/b2c/api-common"
import { cancelMyBooking, loadMyBooking } from "@/lib/b2c/my-booking"
import { b2cStripeConfig } from "@/lib/b2c/stripe"
import { getSupabase } from "@/lib/supabase"
import { sendOpsAlert } from "@/lib/ops-alert"

export const runtime = "nodejs"

/**
 * POST /api/b2c/my/cancel — 旅行者の取消（My Booking・集荷の前日 18:30 まで）。Stage 4。
 * 佐川へ集荷依頼済みなら即時には取り消さず、取消申請として受け付ける（202・result=cancel_requested）。
 * 世田谷営業所へ確認 → 佐川の取消確認 → BondEx が確定するまで、予約・区間・集荷依頼・カードはそのまま。
 * 本人の確認は My Booking の秘密の token だけ。取消・shipments の行の取消・記録・通知は DB の 1つの関数（sql/062）。
 * 請求は発生しない。登録したカードは Stripe の Customer から外す（使わないカードを持たない）。運営に知らせる（ホテルへの連絡のため）。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "b2c-my")
  if (!limit.ok) return limit.response
  if (!b2cMyBookingEnabled()) return NextResponse.json({ ok: false, error: "my_booking_closed" }, { status: 503 })
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 })
  }
  try {
    const r = await cancelMyBooking(body.token)
    if (r === "not_found") return NextResponse.json({ ok: false, error: r }, { status: 404 })
    if (r === "cancel_requested" || r === "already_requested") {
      const v = await loadMyBooking(body.token)
      if (r === "cancel_requested" && v) {
        await sendOpsAlert({
          subject: `【B2C 取消申請・集荷依頼済み】受付番号 ${v.orderNumber}（集荷 ${v.pickupDate}）`,
          lines: [
            `集荷元: ${v.origin.name}`, `配送先: ${v.dest.name}`,
            "→ 旅行者が取消を希望しています。佐川へ集荷依頼済みのため、まだ取り消していません。",
            "→ 運営画面の集荷依頼の変更申請（取消）から、世田谷営業所へ確認し、佐川の取消確認を記録してから確定してください。",
          ],
          agencyEmail: null,
        }).catch(() => undefined)
      }
      return NextResponse.json({ ok: true, result: r, stage: v?.stage, cancelRequested: true }, { status: 202 })
    }
    if (r !== "cancelled" && r !== "already_cancelled") return NextResponse.json({ ok: false, error: r }, { status: 409 })
    const v = await loadMyBooking(body.token)
    if (r === "cancelled" && v) {
      const sb = getSupabase()
      const { data: o } = (await sb?.from("b2c_orders").select("stripe_payment_method_id").eq("id", v.orderId).maybeSingle()) ?? { data: null }
      const s = b2cStripeConfig()
      if (s.ok && o?.stripe_payment_method_id) await s.config.stripe.paymentMethods.detach(o.stripe_payment_method_id as string).catch(() => undefined)
      await sendOpsAlert({
        subject: `【B2C 旅行者の取消】受付番号 ${v.orderNumber}（集荷 ${v.pickupDate}）`,
        lines: [`集荷元: ${v.origin.name}`, `配送先: ${v.dest.name}`, "→ ホテル・佐川に連絡済みなら取消を連絡してください。請求は発生しません。"],
        agencyEmail: null,
      }).catch(() => undefined)
    }
    return NextResponse.json({ ok: true, result: r, stage: v?.stage })
  } catch (e) {
    if (e instanceof B2cDbUnavailable) return b2cUnavailable()
    throw e
  }
}
