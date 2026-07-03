import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import QRCode from "qrcode"
import { rateLimit } from "@/lib/rate-limit"
import { buildVoucherFileName } from "@/lib/utils"
import {
  VoucherDocument,
  OperationsDocument,
  HowToShipDocument,
  SUPPORT_DEFAULTS,
  generateBookingId,
  formatIssuedDate,
  type VoucherInput,
  type VoucherShipment,
} from "@/lib/voucher-pdf"

export const runtime = "nodejs"
export const maxDuration = 60

const FLAT_RATE_YEN = 5000

interface RequestShipment {
  shipmentDate: unknown
  expectedArrival: unknown
  from: { hotel?: unknown; address?: unknown; city?: unknown } | unknown
  to: { hotel?: unknown; address?: unknown; city?: unknown } | unknown
  recipient: unknown
  suitcaseCount: unknown
  dropOffTime?: unknown
  pickUpNote?: unknown
  specialNote?: unknown
  destinationNights?: unknown
  bookingName?: unknown
  fromCheckIn?: unknown
  toCheckOut?: unknown
}

interface RequestBody {
  type?: unknown
  representativeLabel?: unknown
  groupName?: unknown
  tourCompany?: unknown
  tourNumber?: unknown
  travelerCount?: unknown
  bookingId?: unknown
  shipments?: unknown
  contactPersonName?: unknown
  contactPersonPhone?: unknown
  companyName?: unknown
  companyAddress?: unknown
  showContact?: unknown
  contactDisplayMode?: unknown
  guestLanguage?: unknown
}

const CONTACT_MODES = ["bondex_support", "travel_agency", "tour_operator", "hidden"] as const
type ContactMode = (typeof CONTACT_MODES)[number]

function asContactMode(v: unknown): ContactMode | undefined {
  return CONTACT_MODES.includes(v as ContactMode) ? (v as ContactMode) : undefined
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : ""
}

/**
 * 問い合わせ QR: BONDEX_WHATSAPP_URL (例: https://wa.me/81XXXXXXXXXX) が
 * 設定されていれば WhatsApp、未設定なら mailto:support@ にフォールバック。
 * WhatsApp 番号が決まったら Vercel の環境変数を設定するだけで切り替わる。
 */
async function buildSupportQr(): Promise<{ uri?: string; kind: "whatsapp" | "email" }> {
  const wa = process.env.BONDEX_WHATSAPP_URL?.trim()
  const target = wa || `mailto:${SUPPORT_DEFAULTS.email}`
  try {
    const uri = await QRCode.toDataURL(target, {
      margin: 0,
      width: 200,
      color: { dark: "#16161a", light: "#FFFFFF" },
    })
    return { uri, kind: wa ? "whatsapp" : "email" }
  } catch {
    return { uri: undefined, kind: wa ? "whatsapp" : "email" }
  }
}

function normalizeShipment(s: RequestShipment): VoucherShipment | null {
  const from = (s.from as { hotel?: string; address?: string; city?: string }) ?? {}
  const to = (s.to as { hotel?: string; address?: string; city?: string }) ?? {}
  const suitcaseCount = Math.max(1, Math.floor(Number(s.suitcaseCount) || 1))
  if (!from.hotel || !to.hotel) return null
  const destinationNights =
    typeof s.destinationNights === "number" && s.destinationNights > 0
      ? Math.floor(s.destinationNights)
      : undefined
  return {
    shipmentDate: asString(s.shipmentDate),
    expectedArrival: asString(s.expectedArrival),
    from: {
      hotel: asString(from.hotel),
      address: asString(from.address),
      city: asString(from.city),
    },
    to: {
      hotel: asString(to.hotel),
      address: asString(to.address),
      city: asString(to.city),
    },
    recipient: asString(s.recipient),
    suitcaseCount,
    dropOffTime: asString(s.dropOffTime).trim() || undefined,
    pickUpNote: asString(s.pickUpNote).trim() || undefined,
    specialNote: asString(s.specialNote).trim() || undefined,
    destinationNights,
    bookingName: asString(s.bookingName).trim() || undefined,
    fromCheckIn: asString(s.fromCheckIn).trim() || undefined,
    toCheckOut: asString(s.toCheckOut).trim() || undefined,
  }
}

/**
 * How to ship ガイドの単体ダウンロード (GET)。
 * 予約データ不要の静的 1 枚ものなので、operator 画面のリンクから直接開ける。
 *   GET /api/voucher/generate?type=howto&lang=en|zh
 */
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type")
  if (type !== "howto") {
    return NextResponse.json({ error: "GET supports type=howto only" }, { status: 400 })
  }
  const lang = req.nextUrl.searchParams.get("lang") === "zh" ? "zh" : "en"
  try {
    const supportQr = await buildSupportQr()
    const buf = await renderToBuffer(
      <HowToShipDocument language={lang} supportQrDataUri={supportQr.uri} supportQrKind={supportQr.kind} />,
    )
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="BondEx_HowToShip_${lang.toUpperCase()}.pdf"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "PDF render error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "voucher-generate")
  if (!limit.ok) return limit.response

  const type = req.nextUrl.searchParams.get("type")
  if (type !== "voucher" && type !== "ops" && type !== "howto") {
    return NextResponse.json(
      { error: "type must be 'voucher', 'ops' or 'howto'" },
      { status: 400 },
    )
  }

  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // How to ship ガイドは予約データ不要の静的 1 枚もの (言語のみ指定)
  if (type === "howto") {
    const lang = body.guestLanguage === "zh" ? "zh" : "en"
    try {
      const supportQr = await buildSupportQr()
      const buf = await renderToBuffer(
        <HowToShipDocument language={lang} supportQrDataUri={supportQr.uri} supportQrKind={supportQr.kind} />,
      )
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="BondEx_HowToShip_${lang.toUpperCase()}.pdf"`,
          "Cache-Control": "no-store",
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "PDF render error"
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  const representativeLabel = asString(body.representativeLabel).trim()
  const tourCompany = asString(body.tourCompany).trim()
  const travelerCount = Math.max(1, Math.floor(Number(body.travelerCount) || 1))
  const rawShipments = Array.isArray(body.shipments) ? body.shipments : []
  const shipments = rawShipments
    .map((s) => normalizeShipment(s as RequestShipment))
    .filter((s): s is VoucherShipment => s !== null)

  if (!representativeLabel || !tourCompany || shipments.length === 0) {
    return NextResponse.json(
      {
        error:
          "representativeLabel, tourCompany, and at least one shipment are required",
      },
      { status: 400 },
    )
  }

  const bookingId = asString(body.bookingId).trim() || generateBookingId()
  const totalAmount = shipments.reduce(
    (sum, s) => sum + s.suitcaseCount * FLAT_RATE_YEN,
    0,
  )

  const contactPersonName =
    asString(body.contactPersonName).trim() || SUPPORT_DEFAULTS.contactPersonName
  const contactPersonPhone = asString(body.contactPersonPhone).trim() || SUPPORT_DEFAULTS.phone
  const companyName = asString(body.companyName).trim() || SUPPORT_DEFAULTS.companyName
  const companyAddress = asString(body.companyAddress).trim() || SUPPORT_DEFAULTS.companyAddress

  const groupName = asString(body.groupName).trim() || undefined
  const tourNumber = asString(body.tourNumber).trim() || undefined

  // Voucher のみ QR を埋め込む — ops シートは内部用途で不要。
  // react-pdf は canvas/JS を実行できないため、事前に画像化しておく。
  let trackingQrDataUri: string | undefined
  let partnerQrDataUri: string | undefined
  let supportQr: { uri?: string; kind: "whatsapp" | "email" } = { kind: "email" }
  if (type === "voucher") {
    supportQr = await buildSupportQr()
    try {
      trackingQrDataUri = await QRCode.toDataURL(`https://bondex.express/track/${bookingId}`, {
        margin: 0,
        width: 200,
        color: { dark: "#1A1A1A", light: "#FFFFFF" },
      })
      // ページ2 営業バナー用のパートナー募集 QR
      partnerQrDataUri = await QRCode.toDataURL("https://bondex.express/partner", {
        margin: 0,
        width: 200,
        color: { dark: "#16161a", light: "#FFFFFF" },
      })
    } catch (err) {
      // QR 生成失敗は致命的ではない — voucher 自体は URL テキストで代替可能なので握り潰す
      console.error("[voucher/generate] QR generation failed:", err)
    }
  }

  const input: VoucherInput = {
    bookingId,
    issuedDate: formatIssuedDate(),
    representativeLabel,
    groupName,
    tourCompany,
    tourNumber,
    travelerCount,
    shipments,
    totalAmount,
    supportPhone: SUPPORT_DEFAULTS.phone,
    supportEmail: SUPPORT_DEFAULTS.email,
    contactPersonName,
    contactPersonPhone,
    companyName,
    companyAddress,
    trackingQrDataUri,
    partnerQrDataUri,
    supportQrDataUri: supportQr.uri,
    supportQrKind: supportQr.kind,
    showContact: body.showContact !== false,
    contactDisplayMode: asContactMode(body.contactDisplayMode),
    guestLanguage: body.guestLanguage === "zh" ? "zh" : "en",
  }

  try {
    const doc =
      type === "voucher" ? <VoucherDocument data={input} /> : <OperationsDocument data={input} />
    const buf = await renderToBuffer(doc)
    const fileName = buildVoucherFileName({
      bookingId,
      tourNumber,
      representativeLabel,
      kind: type,
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
    const msg = err instanceof Error ? err.message : "PDF render error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
