import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { rateLimit } from "@/lib/rate-limit"
import {
  VoucherDocument,
  OperationsDocument,
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
}

interface RequestBody {
  type?: unknown
  representativeLabel?: unknown
  tourCompany?: unknown
  travelerCount?: unknown
  bookingId?: unknown
  shipments?: unknown
  contactPersonName?: unknown
  contactPersonPhone?: unknown
  companyName?: unknown
  companyAddress?: unknown
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : ""
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
  }
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "voucher-generate")
  if (!limit.ok) return limit.response

  const type = req.nextUrl.searchParams.get("type")
  if (type !== "voucher" && type !== "ops") {
    return NextResponse.json(
      { error: "type must be 'voucher' or 'ops'" },
      { status: 400 },
    )
  }

  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
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

  const input: VoucherInput = {
    bookingId,
    issuedDate: formatIssuedDate(),
    representativeLabel,
    tourCompany,
    travelerCount,
    shipments,
    totalAmount,
    supportPhone: SUPPORT_DEFAULTS.phone,
    supportEmail: SUPPORT_DEFAULTS.email,
    contactPersonName,
    contactPersonPhone,
    companyName,
    companyAddress,
  }

  try {
    const doc =
      type === "voucher" ? <VoucherDocument data={input} /> : <OperationsDocument data={input} />
    const buf = await renderToBuffer(doc)
    const fileName =
      type === "voucher" ? `bondex-voucher-${bookingId}.pdf` : `bondex-ops-${bookingId}.pdf`

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
