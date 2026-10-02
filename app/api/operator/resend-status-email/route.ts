import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { statusDataFromRow, sendAgencyStatusEmail } from "@/lib/agency-status-notify"
import { agencyRecipientEmails } from "@/lib/agency-contacts"

export const runtime = "nodejs"
export const maxDuration = 30

/**
 * 既存案件のステータス通知メール（集荷完了 / 配達完了）を、実際の宛先
 * （代理店の主メール + 追加メール全件）へ support@bondex.express から再送する運営用の口。
 *
 * middleware により /api/operator/* は既定で運営ログイン必須（PUBLIC_EXACT 未登録）。
 * = ログイン済み運営のみ実行可。外部DMCへ実送信するため公開にはしない。
 *
 * 集荷時刻・個数は DB（picked_up_at / suitcase_count）を読んでメールに表示する。
 * これらは「渡した時のみ表示」の任意項目（通常の自動通知では非表示のまま）。
 *
 *   GET /api/operator/resend-status-email?bookingId=BDX-XXXX&kind=picked_up
 *   kind: picked_up | delivered（既定 picked_up）
 */

/** timestamptz → "YYYY-MM-DD HH:mm (JST)"。無ければ null。 */
function formatJst(ts: string | null | undefined): string | null {
  if (!ts) return null
  const d = new Date(ts)
  if (isNaN(d.getTime())) return null
  const s = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d) // 例 "2026-10-02 12:24"
  return `${s} (JST)`
}

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "resend-status-email")
  if (!limit.ok) return limit.response

  const bookingId = (req.nextUrl.searchParams.get("bookingId") || "").trim()
  const kindRaw = req.nextUrl.searchParams.get("kind") || "picked_up"
  const kind: "picked_up" | "delivered" = kindRaw === "delivered" ? "delivered" : "picked_up"
  if (!bookingId) {
    return NextResponse.json({ error: "bookingId required" }, { status: 400 })
  }

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })

  // 対象予約の全区間（leg）を取得
  const { data: legs, error } = await sb
    .from("shipments")
    .select("agency, booking_id, leg_index, tour_number, representative, from_hotel, to_hotel, shipment_date, tracking_numbers, suitcase_count, picked_up_at, status")
    .eq("booking_id", bookingId)
    .order("leg_index", { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!legs || legs.length === 0) {
    return NextResponse.json({ error: `booking not found: ${bookingId}` }, { status: 404 })
  }

  // 代理店情報（言語・担当者）と宛先（主+追加の全件）
  const agencyName = legs[0].agency as string | null
  const { data: ag } = await sb
    .from("agencies")
    .select("contact_person, locale")
    .eq("name", agencyName ?? "")
    .maybeSingle()
  const english = ag?.locale === "en"
  const contactPerson = (ag?.contact_person as string | null) ?? null
  const recipients = await agencyRecipientEmails(sb, agencyName)
  if (recipients.length === 0) {
    return NextResponse.json({ error: "no recipient emails for agency", agency: agencyName }, { status: 400 })
  }

  const legCount = legs.length
  const results: { leg: number; sent: boolean }[] = []
  for (const row of legs) {
    const data = {
      ...statusDataFromRow(row, contactPerson),
      legCount,
      pickedUpAt: formatJst(row.picked_up_at as string | null),
      suitcaseCount: (row.suitcase_count as number | null) ?? null,
    }
    const sent = await sendAgencyStatusEmail(kind, data, recipients, english)
    results.push({ leg: row.leg_index as number, sent })
  }

  return NextResponse.json({
    bookingId,
    kind,
    agency: agencyName,
    recipients,
    legs: results,
    ok: results.every((r) => r.sent),
  })
}
