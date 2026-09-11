import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { sendMail } from "@/lib/mailer"
import { operatorEmailAllowed } from "@/lib/operator-webauthn"
import { buildAgencyStatusEmail, type StatusEmailKind } from "@/lib/agency-status-email"

export const runtime = "nodejs"
export const maxDuration = 30

/**
 * 配送ステータス通知メールの「見本」を、許可された運営メール宛にだけ実送信するテスト口。
 * 認証コード送信 (passkey/email-code) と同じく operatorEmailAllowed で宛先を絞るため、
 * 公開ルートでも許可運営メール以外へは一切送れない (スパム不可・安全)。
 *
 *   GET /api/operator/status-email-test?to=<許可運営メール>&kind=picked_up&lang=ja
 *   kind: issued | picked_up | delivered | delay
 */
const KINDS: StatusEmailKind[] = ["issued", "picked_up", "delivered", "delay"]

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "mail-test")
  if (!limit.ok) return limit.response

  const to = (req.nextUrl.searchParams.get("to") || "").trim()
  const kindRaw = req.nextUrl.searchParams.get("kind") || "picked_up"
  const kind: StatusEmailKind = KINDS.includes(kindRaw as StatusEmailKind)
    ? (kindRaw as StatusEmailKind)
    : "picked_up"
  const lang = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "ja"

  if (!to || !operatorEmailAllowed(to)) {
    return NextResponse.json(
      { error: "to must be an allowed operator email (安全のため許可運営メール宛のみ送信可)" },
      { status: 403 },
    )
  }

  const sample = {
    agencyName: "Japan Links Travel",
    contactPerson: "山田 太郎",
    bookingId: "BDX-7Q2KPG",
    legIndex: 0,
    legCount: 2,
    tourNumber: "T4421",
    representative: "Paul Woolterton",
    fromHotel: "ANA InterContinental Tokyo",
    toHotel: "Richmond Hotel Premier Kyoto Shijo",
    shipmentDate: "2026-09-18",
    expectedArrival: "2026-09-20",
    trackingNumbers: ["4567-8901-2345"],
    trackUrl: "https://bondex.express/track/BDX-7Q2KPG",
  }

  const mail = buildAgencyStatusEmail(kind, sample, lang)
  const result = await sendMail({
    to,
    subject: `[見本] ${mail.subject}`,
    text: mail.text,
    html: mail.html,
    replyTo: "support@bondex.express",
  })
  return NextResponse.json({ to, kind, lang, result })
}
