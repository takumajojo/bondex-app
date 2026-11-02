import { NextRequest, NextResponse } from "next/server"
import { b2cGuard, str, stay } from "@/lib/b2c/api-common"
import { createB2cDraftOrder } from "@/lib/b2c/booking-service"

export const runtime = "nodejs"

/**
 * POST /api/b2c/orders — 予約の下書きを作る（カード登録の前。Stage 3 でカード登録に進む）。
 * 画面から来た料金・ホテル・日付は使わず、サーバーで計算し直してから保存する。
 */
export async function POST(req: NextRequest) {
  const g = await b2cGuard(req, "b2c-orders")
  if (!g.ok) return g.res
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
