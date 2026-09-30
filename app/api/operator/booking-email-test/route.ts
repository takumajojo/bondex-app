import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { sendMail } from "@/lib/mailer"
import { operatorEmailAllowed } from "@/lib/operator-webauthn"
import { renderBookingRequestEmail } from "@/lib/agency-notify"
import { voucherAttachment } from "@/lib/voucher-attachment"

export const runtime = "nodejs"
export const maxDuration = 30

/**
 * 新規受付メール(sendBookingRequestEmail)の「見本」を、許可された運営メール宛にだけ実送信するテスト口。
 * status-email-test と同じく operatorEmailAllowed で宛先を絞る(公開ルートでも許可運営メール以外へは送れない)。
 * 実予約は作らない・DB/配送API/課金/Webhook などの副作用は一切なし(サンプル入力をレンダリングして送るだけ)。
 *
 *   GET /api/operator/booking-email-test?to=<許可運営メール>&lang=ja
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "mail-test")
  if (!limit.ok) return limit.response

  const to = (req.nextUrl.searchParams.get("to") || "").trim()
  const lang = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "ja"

  if (!to || !operatorEmailAllowed(to)) {
    return NextResponse.json(
      { error: "to must be an allowed operator email (安全のため許可運営メール宛のみ送信可)" },
      { status: 403 },
    )
  }

  const { subject, text, html } = renderBookingRequestEmail({
    agencyName: "Japan Links Travel",
    bookingId: "BDX-7Q2KPG",
    tourNumber: "T4421",
    representative: "Paul Woolterton",
    isDomestic: true,
    earliestShipDate: "2026-10-15",
    needsLabelWait: false,
    legCount: 2,
    locale: lang,
    waybillNotNeeded: true,
    legs: [
      { legIndex: 0, shipmentDate: "2026-10-15", expectedArrival: "2026-10-17", fromHotel: "ANA InterContinental Tokyo", toHotel: "Richmond Hotel Premier Kyoto Shijo", suitcaseCount: 3 },
      { legIndex: 1, shipmentDate: "2026-10-18", expectedArrival: "2026-10-20", fromHotel: "Richmond Hotel Premier Kyoto Shijo", toHotel: "Hotel Granvia Osaka", suitcaseCount: 3 },
    ],
  })

  // 任意: ?voucher=<実在の予約ID> を渡すと、その予約のバウチャーPDF(howto同梱)を添付して
  // 添付経路を検証できる。許可運営メール宛のみ送るため漏洩なし。
  const voucherBooking = (req.nextUrl.searchParams.get("voucher") || "").trim()
  const att = voucherBooking && /^BDX-[\dA-Z]+(-[\dA-Z]+)?$/i.test(voucherBooking)
    ? await voucherAttachment(voucherBooking)
    : null

  const result = await sendMail({
    to,
    subject: `[見本] ${subject}`,
    text,
    html,
    attachments: att ? [att] : undefined,
    replyTo: "support@bondex.express",
  })
  return NextResponse.json({ to, lang, attached: att ? att.filename : null, result })
}
