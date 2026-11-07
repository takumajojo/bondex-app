import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveEntry, B2cDbUnavailable } from "@/lib/b2c/booking-service"
import { b2cUnavailable } from "@/lib/b2c/api-common"
import { b2cStripeConfig } from "@/lib/b2c/stripe"
import { finalizeB2cCard, loadOrderForGuest } from "@/lib/b2c/card-service"

export const runtime = "nodejs"

/**
 * POST /api/b2c/card/status — カード登録の結果の照合と、予約の状態（Stage 3）。
 * 画面は Stripe でのカードの確認の後にこれを呼ぶ。通信が切れても、もう一度呼べば同じ結果になる
 * （Stripe から取り直して反映する。Webhook が先に反映していても同じ）。
 * 新規受付のスイッチが OFF でも、既に始めたカード登録の照合は止めない。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "b2c-card")
  if (!limit.ok) return limit.response
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }
  const s = b2cStripeConfig()
  if (!s.ok) return NextResponse.json({ ok: false, error: "card_unavailable" }, { status: 503 })
  try {
    const entry = await resolveEntry(body.token, { allowExpired: true }) // 下書きの後は入口の期限で止めない
    if (!entry) return NextResponse.json({ error: "invalid_link" }, { status: 404 })
    const order = await loadOrderForGuest(entry, body.orderNumber, body.accessToken)
    if (!order) return NextResponse.json({ ok: false, error: "order_not_found" }, { status: 404 })
    const r = await finalizeB2cCard(s.config.stripe, order.id, "guest")
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 })
    return NextResponse.json({ ok: true, view: r.view })
  } catch (e) {
    if (e instanceof B2cDbUnavailable) return b2cUnavailable()
    console.error("[b2c/card/status] failed", (e as { type?: string })?.type)
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 502 })
  }
}
