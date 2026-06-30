import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import {
  VoucherDocument,
  SUPPORT_DEFAULTS,
  formatIssuedDate,
  type VoucherInput,
} from "@/lib/voucher-pdf"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 既存の発行済データから Voucher PDF を再生成する.
 *
 * GET /api/voucher/regenerate?booking_id=BDX-260630-428
 *
 * 用途:
 *   - 旅行者が voucher PDF を紛失した
 *   - ホテル側に再送付したい
 *   - 印刷ミス
 *
 * 注: Yamato 送り状の再発行はこちらでは行わない (Ship&co 側で取得).
 */
export async function GET(req: NextRequest) {
  try {
    const limit = rateLimit(req, "voucher-regenerate")
    if (!limit.ok) return limit.response

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
    }
    const sb = getSupabase()
    if (!sb) {
      return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })
    }

    const bookingId = req.nextUrl.searchParams.get("booking_id")?.trim() || ""
    if (!/^BDX-[\dA-Z]+-[\dA-Z]+$/i.test(bookingId)) {
      return NextResponse.json({ error: "Invalid booking_id" }, { status: 400 })
    }

    const { data, error } = await sb
      .from("shipments")
      .select(
        "booking_id, leg_index, agency, representative, traveler_count, booking_name, shipment_date, expected_arrival, from_hotel, from_city, from_check_in, to_hotel, to_city, to_check_out, recipient, suitcase_count, amount_yen, notes",
      )
      .eq("booking_id", bookingId)
      .order("leg_index", { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    // 代理店情報も取得
    const agencyName = data[0].agency
    const { data: agencyRow } = await sb
      .from("agencies")
      .select("contact_person, contact_phone")
      .eq("name", agencyName)
      .maybeSingle()

    const input: VoucherInput = {
      bookingId,
      issuedDate: formatIssuedDate(),
      representativeLabel: data[0].representative ?? "",
      tourCompany: agencyName ?? "",
      travelerCount: data[0].traveler_count ?? 1,
      totalAmount: data.reduce((sum, s) => sum + (s.amount_yen ?? 0), 0),
      supportPhone: SUPPORT_DEFAULTS.phone,
      supportEmail: SUPPORT_DEFAULTS.email,
      contactPersonName: agencyRow?.contact_person ?? "",
      contactPersonPhone: agencyRow?.contact_phone ?? "",
      companyName: SUPPORT_DEFAULTS.companyName,
      companyAddress: SUPPORT_DEFAULTS.companyAddress,
      shipments: data.map((s) => ({
        shipmentDate: s.shipment_date,
        expectedArrival: s.expected_arrival ?? s.shipment_date,
        from: {
          hotel: s.from_hotel ?? "",
          address: "",
          city: s.from_city ?? "",
        },
        to: {
          hotel: s.to_hotel ?? "",
          address: "",
          city: s.to_city ?? "",
        },
        recipient: s.recipient ?? "",
        suitcaseCount: s.suitcase_count ?? 0,
        bookingName: s.booking_name ?? undefined,
        fromCheckIn: s.from_check_in ?? undefined,
        toCheckOut: s.to_check_out ?? undefined,
        specialNote: s.notes ?? undefined,
      })),
    }

    const buf = await renderToBuffer(<VoucherDocument data={input} />)
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="bondex-voucher-${bookingId}.pdf"`,
        "X-Booking-Id": bookingId,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
