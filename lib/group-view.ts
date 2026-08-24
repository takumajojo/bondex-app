// 団体ダッシュボードの読み取りモデル構築。運営用 (/api/groups) と
// 代理店用 (/api/agency/group) の両ルートから共用する。
import { getSupabase } from "./supabase"
import type { ShipmentRecord } from "./shipments-db"
import {
  listGroupLuggage,
  deriveLuggageStatus,
  deriveGroupStatus,
  summarize,
  type TrackingDetailEntry,
  type LuggageStatus,
} from "./group-luggage-db"

export interface LuggageView {
  id: string
  legIndex: number
  luggageNo: number
  guestName: string
  trackingNumber: string | null
  status: LuggageStatus
  exception: string | null
  lastUpdate: string | null
  manualStatus: string | null
  issueNote: string | null
  notes: string | null
}

export async function buildGroupView(bookingId: string) {
  const sb = getSupabase()
  if (!sb) return { error: "Supabase not configured", status: 503 as const }

  const { data: legs, error } = await sb
    .from("shipments")
    .select("*")
    .eq("booking_id", bookingId)
    .order("leg_index", { ascending: true })
  if (error) return { error: error.message, status: 500 as const }
  if (!legs || legs.length === 0) return { error: "booking not found", status: 404 as const }

  const legRows = legs as ShipmentRecord[]
  const first = legRows[0]
  const luggage = await listGroupLuggage(bookingId)

  // 追跡番号 → 明細 の索引 (全区間分)
  const detailByNumber = new Map<string, TrackingDetailEntry>()
  for (const leg of legRows) {
    for (const d of (leg.yamato_tracking_detail as TrackingDetailEntry[] | null) ?? []) {
      if (d?.number) detailByNumber.set(d.number, d)
    }
  }
  const legByIndex = new Map(legRows.map((l) => [l.leg_index, l]))

  const luggageViews: LuggageView[] = luggage.map((lug) => {
    const leg = legByIndex.get(lug.leg_index) ?? first
    const derived = deriveLuggageStatus(lug, leg, detailByNumber)
    return {
      id: lug.id,
      legIndex: lug.leg_index,
      luggageNo: lug.luggage_no,
      guestName: lug.guest_name,
      trackingNumber: derived.trackingNumber,
      status: derived.status,
      exception: derived.exception,
      lastUpdate: derived.lastUpdate,
      manualStatus: lug.manual_status,
      issueNote: lug.issue_note,
      notes: lug.notes,
    }
  })

  const statuses = luggageViews.map((l) => l.status)
  return {
    status: 200 as const,
    payload: {
      bookingId,
      bookingType: first.booking_type ?? "fit",
      groupName: first.group_name,
      agency: first.agency,
      tourNumber: first.tour_number,
      leaderName: first.tour_leader_name,
      leaderPhone: first.tour_leader_phone,
      leaderWhatsapp: first.tour_leader_whatsapp,
      travelerCount: first.traveler_count,
      guestLanguage: first.guest_language,
      legs: legRows.map((l) => ({
        legIndex: l.leg_index,
        fromHotel: l.from_hotel,
        toHotel: l.to_hotel,
        shipmentDate: l.shipment_date,
        expectedArrival: l.expected_arrival,
        status: l.status,
        suitcaseCount: l.suitcase_count,
        carrier: l.carrier,
        trackingCount: (l.yamato_tracking ?? []).length,
      })),
      luggage: luggageViews,
      summary: summarize(statuses),
      groupStatus: deriveGroupStatus(statuses),
    },
  }
}

export type GroupViewPayload = Extract<Awaited<ReturnType<typeof buildGroupView>>, { status: 200 }>["payload"]
