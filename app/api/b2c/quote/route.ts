import { NextRequest, NextResponse } from "next/server"
import { b2cGuard, str, stay } from "@/lib/b2c/api-common"
import { buildB2cQuote } from "@/lib/b2c/booking-service"

export const runtime = "nodejs"

/**
 * POST /api/b2c/quote { token, originPlaceId, destPlaceId, origin:{checkIn,checkOut}, dest:{checkIn,checkOut}, pieces, pickupDate?, deliveryDate? }
 * 選べる集荷日・お届け日・確定の形・料金を、すべてサーバーで計算して返す。
 */
export async function POST(req: NextRequest) {
  const g = await b2cGuard(req, "b2c-quote")
  if (!g.ok) return g.res
  const b = g.body
  const q = await buildB2cQuote({
    now: new Date(),
    originPlaceId: str(b.originPlaceId),
    destPlaceId: str(b.destPlaceId),
    origin: stay(b.origin),
    dest: stay(b.dest),
    pieces: Number(b.pieces),
    pickupDate: b.pickupDate === undefined ? undefined : str(b.pickupDate),
    deliveryDate: b.deliveryDate === undefined ? undefined : str(b.deliveryDate),
  })
  return NextResponse.json({
    ok: q.ok,
    errors: q.errors,
    origin: q.origin && { placeId: q.origin.placeId, name: q.origin.name, prefecture: q.origin.prefecture, status: q.origin.status },
    dest: q.dest && { placeId: q.dest.placeId, name: q.dest.name, prefecture: q.dest.prefecture, status: q.dest.status },
    transitDays: q.transitDays,
    price: q.price,
    options: q.options,
    selected: q.selected,
  })
}
