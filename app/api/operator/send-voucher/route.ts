import { NextRequest, NextResponse } from "next/server"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { agencyRecipientEmails } from "@/lib/agency-contacts"
import { sendMail } from "@/lib/mailer"
import { voucherAttachment } from "@/lib/voucher-attachment"
import { renderBookingRequestEmail } from "@/lib/agency-notify"
import { endpointLabel } from "@/lib/residence"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 新規依頼の完了後、谷口さんが内容を確認して「依頼主へ」バウチャー PDF を送付する口
 * (BondEx 運用のみ — middleware で認証済み。2026-10-21 谷口さん指示)。
 *
 * バウチャー PDF はサーバ側で bookingId から再生成する (voucherAttachment・How to ガイド同梱)。
 * 宛先はその代理店の登録メール全員、控えは support@ に BCC。
 *
 * 2026-11-05 改修: 送付メールの本文を、代理店セルフ予約の「受付(予約完了)メール」と完全に
 *   同一化する。renderBookingRequestEmail(受付メールと同一の関数)で件名/本文/HTMLを生成し、
 *   区間ごとの予定表・概算金額・バウチャー添付まで予約完了時と揃える
 *   (従来はこの口だけ簡易文面で不整合だった)。
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  }
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })

  const body = (await req.json().catch(() => ({}))) as {
    agency?: string
    bookingId?: string
  }
  const bookingId = body.bookingId?.trim() || ""
  if (!bookingId) {
    return NextResponse.json({ error: "bookingId is required" }, { status: 400 })
  }

  // 予約の全区間を読む (受付メールと同じ「区間ごとの予定表」を組むため)。
  const { data: legRows } = await sb
    .from("shipments")
    .select(
      "leg_index, shipment_date, expected_arrival, from_hotel, from_residence, to_hotel, to_residence, suitcase_count, representative, tour_number, booking_type, agency",
    )
    .eq("booking_id", bookingId)
    .order("leg_index", { ascending: true })
  if (!legRows || legRows.length === 0) {
    return NextResponse.json({ ok: false, reason: "not_found", error: "予約が見つかりません" }, { status: 404 })
  }

  // 代理店名: 明示指定が無ければ予約レコードから解決する (送付先=代理店の登録メール)。
  const agency = body.agency?.trim() || (legRows[0].agency as string | null)?.trim() || ""
  if (!agency) {
    return NextResponse.json({ ok: false, reason: "no_agency", error: "依頼元の代理店が特定できません" }, { status: 400 })
  }

  // バウチャー PDF をサーバ側で再生成 (How to ガイド同梱)。生成できなければ送らない。
  const att = await voucherAttachment(bookingId, { expectedAgency: agency })
  if (!att) {
    return NextResponse.json(
      { ok: false, reason: "voucher_generation_failed", error: "バウチャーPDFの生成に失敗しました" },
      { status: 500 },
    )
  }
  // 原因切り分け用のサイズ計測 (base64 文字数 ≒ 実バイトの 4/3)。
  console.log(
    `[send-voucher] ${bookingId} voucher PDF: base64=${att.contentBase64.length} chars (~${Math.round((att.contentBase64.length * 3) / 4 / 1024)} KB)`,
  )

  const recipients = await agencyRecipientEmails(sb, agency)
  if (recipients.length === 0) {
    return NextResponse.json({ ok: false, reason: "no_agency_email" }, { status: 400 })
  }

  // 代理店メタ (言語・国内区分・契約単価) — 受付メールと同じ概算金額・文面にするため。
  const { data: ag } = await sb
    .from("agencies")
    .select("locale, is_domestic, unit_price_yen")
    .eq("name", agency)
    .maybeSingle()
  const locale: "ja" | "en" = (ag?.locale as string | null) === "en" ? "en" : "ja"

  const legs = legRows.map((r) => ({
    legIndex: (r.leg_index as number | null) ?? 0,
    shipmentDate: (r.shipment_date as string | null) ?? "",
    expectedArrival: (r.expected_arrival as string | null) ?? (r.shipment_date as string | null) ?? "",
    fromHotel: endpointLabel(r.from_hotel, r.from_residence),
    toHotel: endpointLabel(r.to_hotel, r.to_residence),
    suitcaseCount: (r.suitcase_count as number | null) ?? 0,
  }))
  const earliestShipDate = legs.map((l) => l.shipmentDate).filter(Boolean).sort()[0] ?? ""
  const first = legRows[0]

  // 受付(予約完了)メールと同一テンプレートで生成 (件名/本文/HTML・区間予定表・概算金額)。
  const { subject, text, html } = renderBookingRequestEmail({
    agencyEmail: null, // 宛先は下で登録メール全員へ送るため、ここでは発火させない。
    agencyName: agency,
    bookingId,
    tourNumber: (first.tour_number as string | null) ?? null,
    representative: (first.representative as string | null) ?? null,
    isDomestic: (ag?.is_domestic as boolean | null) ?? null,
    agencyUnitPriceYen: (ag?.unit_price_yen as number | null) ?? null,
    bookingType: (first.booking_type as string | null) === "group" ? "group" : "fit",
    earliestShipDate,
    needsLabelWait: false,
    legCount: legs.length,
    locale,
    waybillNotNeeded: true,
    legs,
  })

  const attachments = [{ filename: att.filename, contentBase64: att.contentBase64 }]
  const sentTo: string[] = []
  let firstError: string | undefined
  for (let i = 0; i < recipients.length; i++) {
    const r = await sendMail({
      to: recipients[i],
      subject,
      text,
      html,
      attachments,
      replyTo: "support@bondex.express",
      // 1通目だけ support@ に控え (運用確認用・多重 BCC を避ける)。
      bcc: i === 0 ? "support@bondex.express" : undefined,
    })
    if (r.sent) sentTo.push(recipients[i])
    else firstError = r.error
  }
  if (sentTo.length === 0) {
    return NextResponse.json({ ok: false, reason: "send_failed", error: firstError }, { status: 500 })
  }
  return NextResponse.json({ ok: true, sentTo })
}
