import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { getShipment, setHotelContactRoute } from "@/lib/shipments-db"
import {
  parseHotelContactInfo,
  sanitizeRoutePatch,
  type HotelRoute,
} from "@/lib/hotel-contact-info"
import { lookupHotelHistory } from "@/lib/hotel-history"
import {
  hotelContactStatus,
  applicableRoutes,
  HOTEL_ROUTE_LABEL,
} from "@/lib/hotel-notification"

export const runtime = "nodejs"
export const maxDuration = 20

function todayJst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

/**
 * GET /api/operator/hotel-contact?shipmentId=<id>
 *   予約詳細のホテル連絡エディタ用コンテキストを返す。
 *   発送元(pickup)/お届け先(guest) の各ルートについて:
 *     hotel / hotelJa / placeId / 締切 / 緊急度 / 連絡済み日時 / 保存済み連絡情報 /
 *     初回ホテルか / 前回連絡情報(引き継ぎ候補)
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "hotel-contact")
  if (!limit.ok) return limit.response

  const shipmentId = (req.nextUrl.searchParams.get("shipmentId") || "").trim()
  if (!shipmentId) return NextResponse.json({ error: "shipmentId required" }, { status: 400 })

  const ship = await getShipment(shipmentId)
  if (!ship) return NextResponse.json({ error: "shipment not found" }, { status: 404 })

  const sb = getSupabase()
  const today = todayJst()
  const info = parseHotelContactInfo(ship.hotel_contact_info)
  const target = ship.note_target === "from" || ship.note_target === "to" || ship.note_target === "both"
    ? ship.note_target
    : "to"
  const applies = applicableRoutes(target)

  const routeMeta = {
    pickup: {
      hotel: ship.from_hotel,
      hotelJa: ship.from_hotel_ja,
      placeId: ship.from_place_id,
      notifiedAt: ship.pickup_hotel_notified_at,
    },
    guest: {
      hotel: ship.to_hotel,
      hotelJa: ship.to_hotel_ja,
      placeId: ship.to_place_id,
      notifiedAt: ship.guest_hotel_notified_at,
    },
  } as const

  const routes = await Promise.all(
    (["pickup", "guest"] as HotelRoute[]).map(async (route) => {
      const meta = routeMeta[route]
      const st = hotelContactStatus({
        shipmentDate: ship.shipment_date,
        notifiedAt: meta.notifiedAt,
        today,
      })
      const history = sb
        ? await lookupHotelHistory(sb, {
            placeId: meta.placeId,
            hotelName: meta.hotel,
            excludeBookingId: ship.booking_id,
          })
        : { firstTime: false, prior: null, matchedBy: "none" as const }
      return {
        route,
        label: HOTEL_ROUTE_LABEL[route],
        applies: applies[route],
        hotel: meta.hotel,
        hotelJa: meta.hotelJa,
        placeId: meta.placeId,
        deadline: st.deadline,
        urgency: st.urgency,
        businessDaysLeft: st.businessDaysLeft,
        notifiedAt: meta.notifiedAt,
        saved: info[route],
        firstTime: history.firstTime,
        prior: history.prior,
      }
    }),
  )

  return NextResponse.json({
    shipmentId,
    bookingId: ship.booking_id,
    legIndex: ship.leg_index,
    noteTarget: target,
    routes,
  })
}

/**
 * POST /api/operator/hotel-contact
 *   body: { shipmentId, route: "pickup"|"guest", patch: {...} }
 *   ホテル連絡情報(hotel_contact_info)の1ルートを部分更新する。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "hotel-contact")
  if (!limit.ok) return limit.response

  let body: { shipmentId?: unknown; route?: unknown; patch?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }
  const shipmentId = typeof body.shipmentId === "string" ? body.shipmentId.trim() : ""
  const route = body.route === "pickup" || body.route === "guest" ? body.route : null
  if (!shipmentId || !route) {
    return NextResponse.json({ error: "shipmentId and valid route required" }, { status: 400 })
  }
  const patch = sanitizeRoutePatch(body.patch)
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "empty patch" }, { status: 400 })
  }
  const r = await setHotelContactRoute(shipmentId, route, patch)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true, info: r.info })
}
