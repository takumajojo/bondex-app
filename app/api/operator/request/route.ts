import { NextRequest, NextResponse } from "next/server"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"

export const runtime = "nodejs"

/**
 * 代理店が登録した「発行依頼」(status='requested') を運営が発行画面に読み込むための取得 API。
 *
 *   GET /api/operator/request?booking_id=BDX-260721-XXXX
 *
 * middleware の OPERATOR_PASSWORD ゲート対象 (config.matcher に登録済み)。
 * 全区間 (leg) を leg_index 昇順で返し、/operator が EditableItinerary に復元して
 * 既存の発行パイプライン (バウチャー + Ship&co + 検証) をそのまま再利用する。
 * booking_id を維持して発行するため、upsert で同じ予約が update される (重複しない)。
 */
export async function GET(req: NextRequest) {
  const bookingId = req.nextUrl.searchParams.get("booking_id")?.trim() || ""
  if (!/^BDX-[\dA-Z]+-[\dA-Z]+$/i.test(bookingId)) {
    return NextResponse.json({ error: "Invalid booking_id" }, { status: 400 })
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  }
  const sb = getSupabase()
  if (!sb) {
    return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })
  }

  const { data, error } = await sb
    .from("shipments")
    .select(
      "booking_id, leg_index, agency, status, representative, booking_name, group_name, traveler_count, tour_number, carrier, guest_language, shipment_date, expected_arrival, delivery_time, from_hotel, from_city, from_place_id, from_check_in, to_hotel, to_city, to_place_id, to_check_out, recipient, suitcase_count, notes",
    )
    .eq("booking_id", bookingId)
    .order("leg_index", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ booking: data })
}
