import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { saveShipment } from "@/lib/shipments-db"
import { generateBookingId } from "@/lib/voucher-pdf"
import { normalizeGuestLanguage } from "@/lib/guest-language"
import { sendBookingRequestEmail } from "@/lib/agency-notify"

export const runtime = "nodejs"

/**
 * 代理店の「発行依頼(登録)」。
 *
 *   POST /api/agency/booking
 *   Authorization: Bearer <Supabase access token>
 *
 * 旅程を登録するだけで、バウチャーもヤマト送り状も発行しない(Ship&co 従量課金を回避)。
 * status='requested' で shipments に保存し、発行主体(agency)は認証した自社名に強制固定
 * (他社なりすまし防止)。出荷が 1ヶ月以上先なら「1ヶ月前になったらまとめて連絡」する
 * 案内メールを自動送信する。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

interface LegInput {
  fromHotel: string
  toHotel: string
  shipmentDate: string
  expectedArrival: string
  recipient: string
  suitcaseCount: number
  notes: string
}

function parseLeg(raw: unknown): LegInput | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "invalid leg" }
  const o = raw as Record<string, unknown>
  const fromHotel = s(o.fromHotel)
  const toHotel = s(o.toHotel)
  const shipmentDate = s(o.shipmentDate)
  const expectedArrival = s(o.expectedArrival) || shipmentDate
  const recipient = s(o.recipient)
  const notes = s(o.notes)
  const suitcaseCount = Math.floor(Number(o.suitcaseCount))
  if (!fromHotel || !toHotel) return { error: "発送元・お届け先ホテルをご入力ください。" }
  if (!DATE_RE.test(shipmentDate)) return { error: "発送日を正しくご入力ください。" }
  if (!DATE_RE.test(expectedArrival)) return { error: "到着日を正しくご入力ください。" }
  if (expectedArrival < shipmentDate) return { error: "到着日は発送日以降にしてください。" }
  if (!Number.isFinite(suitcaseCount) || suitcaseCount < 1 || suitcaseCount > 50) {
    return { error: "個数は 1〜50 でご入力ください。" }
  }
  return { fromHotel, toHotel, shipmentDate, expectedArrival, recipient, suitcaseCount, notes }
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "agency-booking")
  if (!limit.ok) return limit.response

  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // 承認待ち・停止中は登録不可
  if (auth.agency.status === "pending") {
    return NextResponse.json({ error: "アカウントは承認待ちです。承認後にご利用いただけます。" }, { status: 403 })
  }
  if (auth.agency.status === "suspended") {
    return NextResponse.json({ error: "アカウントは停止中です。BondEx サポートにご連絡ください。" }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const representative = s(body.representative)
  const tourNumber = s(body.tourNumber)
  const bookingName = s(body.bookingName)
  const guestLanguage = normalizeGuestLanguage(body.guestLanguage)
  const travelerCount = Math.max(1, Math.floor(Number(body.travelerCount) || 1))
  if (!representative) {
    return NextResponse.json({ error: "代表者名をご入力ください。" }, { status: 400 })
  }
  const rawLegs = Array.isArray(body.legs) ? body.legs : []
  if (rawLegs.length === 0) {
    return NextResponse.json({ error: "区間を 1 つ以上ご入力ください。" }, { status: 400 })
  }
  if (rawLegs.length > 10) {
    return NextResponse.json({ error: "区間は 10 件までです。" }, { status: 400 })
  }
  const legs: LegInput[] = []
  for (const raw of rawLegs) {
    const parsed = parseLeg(raw)
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    legs.push(parsed)
  }

  const bookingId = generateBookingId()
  const agencyName = auth.agency.name // 自社名に強制固定

  // 全区間を requested で保存(発行はしない)
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]
    await saveShipment({
      booking_id: bookingId,
      leg_index: i,
      agency: agencyName,
      representative,
      traveler_count: travelerCount,
      booking_name: bookingName || null,
      tour_number: tourNumber || null,
      shipment_date: leg.shipmentDate,
      expected_arrival: leg.expectedArrival,
      from_hotel: leg.fromHotel,
      to_hotel: leg.toHotel,
      recipient: leg.recipient || leg.toHotel,
      suitcase_count: leg.suitcaseCount,
      amount_yen: 0, // 依頼段階では未確定
      status: "requested",
      notes: leg.notes || null,
      guest_language: guestLanguage,
    })
  }

  // 最短の出荷予定日で 1ヶ月案内の要否を判定(ヤマトは出荷1ヶ月前から送り状発行可)
  const earliestShipDate = legs.reduce(
    (min, l) => (l.shipmentDate < min ? l.shipmentDate : min),
    legs[0].shipmentDate,
  )
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const shipMs = new Date(`${earliestShipDate}T00:00:00`).getTime()
  const daysUntil = Math.round((shipMs - today.getTime()) / 86_400_000)
  const needsLabelWait = daysUntil > 30

  const locale: "ja" | "en" = auth.agency.is_domestic === false ? "en" : "ja"
  const mail = await sendBookingRequestEmail({
    agencyEmail: auth.agency.contact_email,
    agencyName,
    bookingId,
    tourNumber: tourNumber || null,
    earliestShipDate,
    needsLabelWait,
    legCount: legs.length,
    locale,
  })

  return NextResponse.json({
    ok: true,
    bookingId,
    legCount: legs.length,
    needsLabelWait,
    noticeEmailSent: mail.sent,
  })
}
