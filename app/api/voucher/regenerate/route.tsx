import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import QRCode from "qrcode"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { buildVoucherFileName } from "@/lib/utils"
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
        "booking_id, leg_index, agency, representative, traveler_count, booking_name, tour_number, group_name, shipment_date, expected_arrival, from_hotel, from_city, from_check_in, to_hotel, to_city, to_check_out, recipient, suitcase_count, amount_yen, notes, guest_language",
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

    const representativeLabel = data[0].representative ?? ""
    const tourNumber = data[0].tour_number || undefined
    // group_name はブッキング時に「団体名も表示する」を選んだ場合のみ保存されている想定。
    // 値があれば = 表示オプトイン済みとみなし、そのまま representative に併記する。
    const groupName = data[0].group_name || undefined

    // react-pdf は canvas/JS を実行できないため、事前に画像化しておく (generate route と同様)。
    let trackingQrDataUri: string | undefined
    let partnerQrDataUri: string | undefined
    let supportQrDataUri: string | undefined
    const waUrl = process.env.BONDEX_WHATSAPP_URL?.trim()
    try {
      supportQrDataUri = await QRCode.toDataURL(waUrl || `mailto:${SUPPORT_DEFAULTS.email}`, {
        margin: 0,
        width: 200,
        color: { dark: "#16161a", light: "#FFFFFF" },
      })
      trackingQrDataUri = await QRCode.toDataURL(`https://bondex.express/track/${bookingId}`, {
        margin: 0,
        width: 200,
        color: { dark: "#1A1A1A", light: "#FFFFFF" },
      })
      partnerQrDataUri = await QRCode.toDataURL("https://bondex.express/partner", {
        margin: 0,
        width: 200,
        color: { dark: "#16161a", light: "#FFFFFF" },
      })
    } catch (err) {
      console.error("[voucher/regenerate] QR generation failed:", err)
    }

    const input: VoucherInput = {
      bookingId,
      issuedDate: formatIssuedDate(),
      representativeLabel,
      groupName,
      tourCompany: agencyName ?? "",
      tourNumber,
      travelerCount: data[0].traveler_count ?? 1,
      totalAmount: data.reduce((sum, s) => sum + (s.amount_yen ?? 0), 0),
      supportPhone: SUPPORT_DEFAULTS.phone,
      supportEmail: SUPPORT_DEFAULTS.email,
      contactPersonName: agencyRow?.contact_person ?? "",
      contactPersonPhone: agencyRow?.contact_phone ?? "",
      companyName: SUPPORT_DEFAULTS.companyName,
      companyAddress: SUPPORT_DEFAULTS.companyAddress,
      trackingQrDataUri,
      partnerQrDataUri,
      supportQrDataUri,
      supportQrKind: waUrl ? "whatsapp" : "email",
      // 発行時の言語で再発行する (sql/008 で保存。旧データは null = en)
      guestLanguage: data[0].guest_language === "zh" ? "zh" : "en",
      // showContact / contactDisplayMode: 発行時の設定は operator のブラウザ localStorage に
      // のみ保存され Supabase 側の shipments には残らないため、再発行時点では判別不能。
      // 未指定 (undefined) にしておけば VoucherInput 側のデフォルト (bondex_support) が適用される。
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
    const fileName = buildVoucherFileName({
      bookingId,
      tourNumber,
      representativeLabel,
      kind: "voucher",
    })
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Booking-Id": bookingId,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
