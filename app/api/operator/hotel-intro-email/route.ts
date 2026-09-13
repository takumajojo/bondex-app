import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getShipment, setHotelContactRoute } from "@/lib/shipments-db"
import { parseHotelContactInfo } from "@/lib/hotel-contact-info"
import { buildHotelIntroEmail } from "@/lib/hotel-intro-email"
import { sendMail } from "@/lib/mailer"

export const runtime = "nodejs"
export const maxDuration = 20

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function hotelNameFor(
  ship: { from_hotel: string; from_hotel_ja: string | null; to_hotel: string; to_hotel_ja: string | null },
  route: "pickup" | "guest",
): string {
  return route === "pickup" ? ship.from_hotel_ja || ship.from_hotel : ship.to_hotel_ja || ship.to_hotel
}

/**
 * GET /api/operator/hotel-intro-email?shipmentId=&route=pickup|guest
 *   紹介メールのプレビュー (送信はしない)。宛先(登録済みメール)と本文を返す。
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "hotel-intro-email")
  if (!limit.ok) return limit.response

  const shipmentId = (req.nextUrl.searchParams.get("shipmentId") || "").trim()
  const route = req.nextUrl.searchParams.get("route")
  if (!shipmentId || (route !== "pickup" && route !== "guest")) {
    return NextResponse.json({ error: "shipmentId and valid route required" }, { status: 400 })
  }
  const ship = await getShipment(shipmentId)
  if (!ship) return NextResponse.json({ error: "shipment not found" }, { status: 404 })

  const info = parseHotelContactInfo(ship.hotel_contact_info)[route]
  const hotelName = hotelNameFor(ship, route)
  const mail = buildHotelIntroEmail({ hotelName })
  return NextResponse.json({
    to: info.futureEmail || "",
    hasEmail: EMAIL_RE.test(info.futureEmail),
    alreadySentAt: info.introEmailSentAt,
    hotelName,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  })
}

/**
 * POST /api/operator/hotel-intro-email
 *   body: { shipmentId, route }
 *   登録済みの futureEmail 宛に紹介メールを送信し、introEmailSentAt を記録する。
 *   社外(ホテル)宛の送信は運用担当が明示的に叩く (自動送信はしない)。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "hotel-intro-email")
  if (!limit.ok) return limit.response

  let body: { shipmentId?: unknown; route?: unknown }
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

  const ship = await getShipment(shipmentId)
  if (!ship) return NextResponse.json({ error: "shipment not found" }, { status: 404 })

  const info = parseHotelContactInfo(ship.hotel_contact_info)[route]
  const to = info.futureEmail.trim()
  if (!EMAIL_RE.test(to)) {
    return NextResponse.json(
      { error: "今後連絡用のメールアドレスが未登録/不正です。先に登録してください。" },
      { status: 400 },
    )
  }

  const hotelName = hotelNameFor(ship, route)
  const mail = buildHotelIntroEmail({ hotelName })
  const r = await sendMail({
    to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    replyTo: "support@bondex.express",
  })
  if (!r.sent) {
    return NextResponse.json({ error: `送信に失敗しました: ${r.error ?? "unknown"}` }, { status: 502 })
  }

  const sentAt = new Date().toISOString()
  await setHotelContactRoute(shipmentId, route, { introEmailSentAt: sentAt })
  return NextResponse.json({ sent: true, to, via: r.via, sentAt })
}
