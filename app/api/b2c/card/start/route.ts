import { NextRequest, NextResponse } from "next/server"
import { b2cGuard, b2cUnavailable } from "@/lib/b2c/api-common"
import { B2cDbUnavailable } from "@/lib/b2c/booking-service"
import { b2cStripeConfig } from "@/lib/b2c/stripe"
import { expireStaleCardPending, loadOrderForGuest, startB2cCardRegistration } from "@/lib/b2c/card-service"

export const runtime = "nodejs"

/**
 * POST /api/b2c/card/start — カード登録の開始（Stage 3）。SetupIntent の client_secret を返す。請求はしない。
 * 本人の確認: 入口の token＋予約番号＋下書きの作成時に返した秘密の token。
 */
export async function POST(req: NextRequest) {
  const g = await b2cGuard(req, "b2c-card")
  if (!g.ok) return g.res
  const s = b2cStripeConfig()
  if (!s.ok) return NextResponse.json({ ok: false, error: "card_unavailable" }, { status: 503 })
  let r: Awaited<ReturnType<typeof startB2cCardRegistration>>
  try {
    const order = await loadOrderForGuest(g.entry, g.body.orderNumber, g.body.accessToken)
    if (!order) return NextResponse.json({ ok: false, error: "order_not_found" }, { status: 404 })
    // 放置された予約の枠を返す（定期の処理は Stage 4。ここでも少しずつ片付ける）
    await expireStaleCardPending(s.config.stripe).catch(() => undefined)
    r = await startB2cCardRegistration(s.config.stripe, s.config.publishableKey, order, g.body.cardConsent === true)
  } catch (e) {
    if (e instanceof B2cDbUnavailable) return b2cUnavailable()
    throw e
  }
  if (!r.ok) {
    const status = r.error === "server_error" ? 500 : r.error === "stripe_busy" ? 409 : r.error === "order_not_found" ? 404 : 422
    return NextResponse.json({ ok: false, error: r.error }, { status })
  }
  return NextResponse.json(r)
}
