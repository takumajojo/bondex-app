import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { listHotelContactDue, countBoardViews } from "@/lib/shipments-db"
import { parseHotelContactInfo } from "@/lib/hotel-contact-info"
import { lookupHotelHistory } from "@/lib/hotel-history"
import { HOTEL_ROUTE_LABEL } from "@/lib/hotel-notification"

export const runtime = "nodejs"
export const maxDuration = 30

function todayJst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

/** urgency の並び順 (overdue が最優先)。 */
const URGENCY_RANK: Record<string, number> = { overdue: 0, urgent: 1, due: 2 }

export interface SagawaPickupTask {
  shipmentId: string
  bookingId: string
  legIndex: number
  representative: string
  tourNumber: string | null
  fromHotel: string
  fromHotelJa: string | null
  shipmentDate: string
  urgency: string
}

export interface HotelTodoTask {
  shipmentId: string
  bookingId: string
  legIndex: number
  representative: string
  tourNumber: string | null
  route: "pickup" | "guest"
  routeLabel: string
  hotel: string
  hotelJa: string | null
  deadline: string | null
  urgency: string
  notifiedAt: string | null
  /** 保存済みの連絡方法・連絡先 (未登録なら空)。 */
  method: string
  value: string
  memo: string
  firstTime: boolean
}

/**
 * GET /api/operator/today-todo
 *   運用担当の「今日やること」。中心はホテル連絡タスク (発送2営業日前が締切)。
 *   他カテゴリ (送り状郵送/集荷遅れ/配送遅れ/課金失敗/発行失敗) は件数を返し、
 *   ダッシュボードの既存フィルタ(view)へ誘導する。
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "today-todo")
  if (!limit.ok) return limit.response

  const today = todayJst()
  const sb = getSupabase()

  // ホテル連絡タスク (due/urgent/overdue の区間×ルート)。
  const hotelRows = await listHotelContactDue(today)

  // 保存済み連絡情報・place_id をまとめて引く (method/value/firstTime 用)。
  const extraById = new Map<
    string,
    {
      from_place_id: string | null; to_place_id: string | null
      from_hotel_ja: string | null; to_hotel_ja: string | null
      tour_number: string | null; hotel_contact_info: unknown
    }
  >()
  if (sb && hotelRows.length > 0) {
    const ids = hotelRows.map((r) => r.id)
    const { data } = await sb
      .from("shipments")
      .select("id, from_place_id, to_place_id, from_hotel_ja, to_hotel_ja, tour_number, hotel_contact_info")
      .in("id", ids)
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      extraById.set(r.id as string, {
        from_place_id: (r.from_place_id as string) ?? null,
        to_place_id: (r.to_place_id as string) ?? null,
        from_hotel_ja: (r.from_hotel_ja as string) ?? null,
        to_hotel_ja: (r.to_hotel_ja as string) ?? null,
        tour_number: (r.tour_number as string) ?? null,
        hotel_contact_info: r.hotel_contact_info,
      })
    }
  }

  const hotelTasks: HotelTodoTask[] = []
  for (const row of hotelRows) {
    const extra = extraById.get(row.id)
    const info = parseHotelContactInfo(extra?.hotel_contact_info)
    for (const rt of row.routes) {
      const saved = info[rt.route]
      const placeId = rt.route === "pickup" ? extra?.from_place_id ?? null : extra?.to_place_id ?? null
      const hotelNameJa = rt.route === "pickup" ? extra?.from_hotel_ja ?? null : extra?.to_hotel_ja ?? null
      let firstTime = false
      if (sb) {
        const h = await lookupHotelHistory(sb, {
          placeId,
          hotelName: rt.hotel,
          hotelNameJa,
          excludeBookingId: row.booking_id,
        })
        firstTime = h.firstTime
      }
      hotelTasks.push({
        shipmentId: row.id,
        bookingId: row.booking_id,
        legIndex: row.leg_index,
        representative: row.representative,
        tourNumber: extra?.tour_number ?? null,
        route: rt.route,
        routeLabel: HOTEL_ROUTE_LABEL[rt.route],
        hotel: rt.hotel,
        hotelJa: null,
        deadline: rt.deadline,
        urgency: rt.urgency,
        notifiedAt: null,
        method: saved.method,
        value: saved.value,
        memo: saved.memo,
        firstTime,
      })
    }
  }

  // 期限が厳しい順 → 締切日順 に並べる。
  hotelTasks.sort((a, b) => {
    const ur = (URGENCY_RANK[a.urgency] ?? 9) - (URGENCY_RANK[b.urgency] ?? 9)
    if (ur !== 0) return ur
    return (a.deadline ?? "").localeCompare(b.deadline ?? "")
  })

  // 佐川への集荷依頼タスク: 発行済み・集荷依頼未・発送日が今日/明日(JST)の区間。
  // 集荷の前日に佐川へ連絡が必要なので、明日発送分を今日出す(+今日発送で未依頼は overdue)。
  const tomorrow = new Date(Date.now() + 9 * 3600 * 1000 + 86_400_000).toISOString().slice(0, 10)
  let sagawaPickupTasks: SagawaPickupTask[] = []
  if (sb) {
    const { data: pk } = await sb
      .from("shipments")
      .select("id, booking_id, leg_index, representative, tour_number, from_hotel, from_hotel_ja, shipment_date")
      .eq("status", "issued")
      .is("pickup_requested_at", null)
      .gte("shipment_date", today)
      .lte("shipment_date", tomorrow)
      .order("shipment_date", { ascending: true })
    sagawaPickupTasks = (pk ?? []).map((r) => ({
      shipmentId: r.id as string,
      bookingId: r.booking_id as string,
      legIndex: r.leg_index as number,
      representative: (r.representative as string) ?? "",
      tourNumber: (r.tour_number as string | null) ?? null,
      fromHotel: (r.from_hotel as string) ?? "",
      fromHotelJa: (r.from_hotel_ja as string | null) ?? null,
      shipmentDate: r.shipment_date as string,
      urgency: (r.shipment_date as string) <= today ? "overdue" : "due",
    }))
  }

  // 他カテゴリの件数 (チップ表示・既存フィルタへ誘導)。
  const counts = (await countBoardViews(today)) ?? {}

  const total =
    hotelTasks.length +
    sagawaPickupTasks.length +
    Object.entries(counts).reduce((s, [, n]) => s + (typeof n === "number" ? n : 0), 0)

  return NextResponse.json({ today, total, hotelTasks, sagawaPickupTasks, counts })
}
