import { NextRequest, NextResponse } from "next/server"
import { b2cGuard, b2cUnavailable, str, stay } from "@/lib/b2c/api-common"
import { b2cUnpaidPause } from "@/lib/b2c/unpaid-gate"
import { createB2cDraftOrder } from "@/lib/b2c/booking-service"

export const runtime = "nodejs"

/**
 * POST /api/b2c/orders — 予約の下書きを作る（カード登録の前。Stage 3 でカード登録に進む）。
 * 画面から来た料金・ホテル・日付は使わず、サーバーで計算し直してから保存する。
 * 未回収の請求が 2件、または合計 3万円に達している間は、新しい予約を受け付けない（lib/b2c/unpaid-gate.ts。
 * B2C_PHASE1A_BETA_PLAN.md 5章。既存の予約の集荷・請求・回収は続ける）。
 */
export async function POST(req: NextRequest) {
  const g = await b2cGuard(req, "b2c-orders")
  if (!g.ok) return g.res
  // 未収による新規受付の停止（既存の予約の集荷・請求・回収は止めない）
  const paused = await b2cUnpaidPause()
  if (paused === "db_error") return b2cUnavailable()
  if (paused) return NextResponse.json({ ok: false, error: "booking_closed", errors: ["booking_closed"] }, { status: 503 })
  const b = g.body
  const r = await createB2cDraftOrder(
    g.entry,
    {
      now: new Date(),
      originPlaceId: str(b.originPlaceId),
      destPlaceId: str(b.destPlaceId),
      origin: stay(b.origin),
      dest: stay(b.dest),
      pieces: Number(b.pieces),
      pickupDate: str(b.pickupDate),
      deliveryDate: str(b.deliveryDate),
    },
    {
      name: str(b.name),
      email: str(b.email),
      whatsapp: str(b.whatsapp),
      language: b.language === "ja" ? "ja" : "en",
      consent: b.consent === true,
    },
  )
  if (!r.ok) return NextResponse.json({ ok: false, errors: r.errors }, { status: r.errors.includes("server_error") ? 500 : 422 })
  return NextResponse.json(r)
}
