import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import QRCode from "qrcode"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import {
  VoucherDocument,
  SUPPORT_DEFAULTS,
  formatIssuedDate,
  normalizeGuestLanguage,
  type VoucherInput,
} from "@/lib/voucher-pdf"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 発行「前」のバウチャープレビュー (確認画面用)。
 *
 *   POST /api/agency/voucher-preview
 *   Authorization: Bearer <Supabase access token>
 *   body: { representative, tourNumber, bookingName, groupName, guestLanguage,
 *           includeHowto, legs:[{fromHotel,fromCity,toHotel,toCity,shipmentDate,
 *           expectedArrival,fromCheckIn,toCheckOut,recipient,suitcaseCount,notes}] }
 *
 * DB には一切書き込まず、送り状の発行もしない。フォーム入力値からその場で
 * バウチャー PDF を組み立てて返すだけ (誤りを目視確認してから確定できるように)。
 * 代理店名・担当者は認証情報から解決するので、代理店が他社名を詐称することはできない。
 */

interface PreviewLeg {
  fromHotel?: unknown
  fromCity?: unknown
  toHotel?: unknown
  toCity?: unknown
  shipmentDate?: unknown
  expectedArrival?: unknown
  fromCheckIn?: unknown
  toCheckOut?: unknown
  recipient?: unknown
  suitcaseCount?: unknown
  notes?: unknown
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "agency-voucher-preview")
  if (!limit.ok) return limit.response

  const auth = await resolveAgencyFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: {
    representative?: unknown
    tourNumber?: unknown
    bookingName?: unknown
    groupName?: unknown
    guestLanguage?: unknown
    includeHowto?: unknown
    legs?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const rawLegs = Array.isArray(body.legs) ? (body.legs as PreviewLeg[]) : []
  if (rawLegs.length === 0) {
    return NextResponse.json({ error: "At least one leg is required" }, { status: 400 })
  }

  const agencyName = auth.agency.name
  const guestLanguage = normalizeGuestLanguage(body.guestLanguage)
  const representativeLabel = str(body.representative)
  const tourNumber = str(body.tourNumber) || undefined
  const groupName = str(body.groupName) || undefined

  // 担当者名・電話は実発行と同じ体裁にするため agencies から取得 (任意)
  let contactPersonName = ""
  let contactPersonPhone = ""
  const sb = getSupabase()
  if (sb) {
    const { data: agencyRow } = await sb
      .from("agencies")
      .select("contact_person, contact_phone")
      .eq("name", agencyName)
      .maybeSingle()
    contactPersonName = agencyRow?.contact_person ?? ""
    contactPersonPhone = agencyRow?.contact_phone ?? ""
  }

  // プレビュー用の QR (追跡番号は未発番なので PREVIEW プレースホルダ)。体裁を実発行に揃える。
  const previewId = "PREVIEW"
  let trackingQrDataUri: string | undefined
  let supportQrDataUri: string | undefined
  const waUrl = process.env.BONDEX_WHATSAPP_URL?.trim()
  try {
    supportQrDataUri = await QRCode.toDataURL(waUrl || `mailto:${SUPPORT_DEFAULTS.email}`, {
      margin: 0,
      width: 200,
      color: { dark: "#16161a", light: "#FFFFFF" },
    })
    trackingQrDataUri = await QRCode.toDataURL(`https://bondex.express/track/${previewId}`, {
      margin: 0,
      width: 200,
      color: { dark: "#1A1A1A", light: "#FFFFFF" },
    })
  } catch (err) {
    console.error("[voucher-preview] QR generation failed:", err)
  }

  const input: VoucherInput = {
    bookingId: previewId,
    issuedDate: formatIssuedDate(),
    representativeLabel,
    groupName,
    tourCompany: agencyName,
    carrier: "sagawa",
    tourNumber,
    travelerCount: 1,
    totalAmount: 0,
    supportPhone: SUPPORT_DEFAULTS.phone,
    supportEmail: SUPPORT_DEFAULTS.email,
    contactPersonName,
    contactPersonPhone,
    companyName: SUPPORT_DEFAULTS.companyName,
    companyAddress: SUPPORT_DEFAULTS.companyAddress,
    trackingQrDataUri,
    supportQrDataUri,
    supportQrKind: waUrl ? "whatsapp" : "email",
    guestLanguage,
    includeHowto: body.includeHowto !== false,
    shipments: rawLegs.map((l) => ({
      shipmentDate: str(l.shipmentDate),
      expectedArrival: str(l.expectedArrival) || str(l.shipmentDate),
      from: { hotel: str(l.fromHotel), address: "", city: str(l.fromCity) },
      to: { hotel: str(l.toHotel), address: "", city: str(l.toCity) },
      recipient: str(l.recipient) || str(l.toHotel),
      suitcaseCount: Math.max(1, Math.floor(Number(l.suitcaseCount) || 1)),
      bookingName: str(body.bookingName) || undefined,
      fromCheckIn: str(l.fromCheckIn) || undefined,
      toCheckOut: str(l.toCheckOut) || undefined,
      specialNote: str(l.notes) || undefined,
    })),
  }

  try {
    const buf = await renderToBuffer(<VoucherDocument data={input} />)
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="BondEx_voucher_preview.pdf"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "PDF render error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
