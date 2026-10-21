import { NextRequest, NextResponse } from "next/server"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { agencyRecipientEmails } from "@/lib/agency-contacts"
import { sendMail } from "@/lib/mailer"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 新規依頼の完了後、谷口さんが内容を確認して「依頼主へ」バウチャー PDF を送付する口
 * (BondEx 運用のみ — middleware で認証済み。2026-10-21 谷口さん指示)。
 *
 * - 宛先 = その代理店の登録メール全員 (agencies.contact_email 主 + agency_emails 追加)。
 * - 本文は簡潔なカバーノート、添付は操作画面で確認したバウチャー PDF そのもの (pdfBase64)。
 * - 送信控えは support@ に BCC (顧客メールの運用確認用・既存方針に合わせる)。
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
    fileName?: string
    pdfBase64?: string
  }
  const agency = body.agency?.trim() || ""
  const bookingId = body.bookingId?.trim() || ""
  const pdfBase64 = typeof body.pdfBase64 === "string" ? body.pdfBase64 : ""
  const fileName = body.fileName?.trim() || `bondex-voucher-${bookingId || "booking"}.pdf`
  if (!agency || !pdfBase64) {
    return NextResponse.json({ error: "agency and pdfBase64 are required" }, { status: 400 })
  }

  const recipients = await agencyRecipientEmails(sb, agency)
  if (recipients.length === 0) {
    return NextResponse.json({ ok: false, reason: "no_agency_email" }, { status: 400 })
  }

  // 代理店の言語でカバーノートを出し分け。
  const { data: ag } = await sb.from("agencies").select("locale").eq("name", agency).maybeSingle()
  const en = (ag?.locale as string | null) === "en"
  const subject = en
    ? `[BondEx] Your voucher${bookingId ? ` (${bookingId})` : ""}`
    : `【BondEx】ご依頼のバウチャー${bookingId ? `（${bookingId}）` : ""}`
  const text = en
    ? [
        `Dear ${agency},`,
        "",
        `Please find attached the voucher for your request${bookingId ? ` (${bookingId})` : ""}.`,
        "Hand the voucher to your guest as-is. No shipping labels are needed — the courier brings and attaches them at pickup.",
        "Questions? Contact support@bondex.express.",
        "",
        "— BondEx / JOJO Inc. | support@bondex.express",
      ].join("\n")
    : [
        `${agency} ご担当者様`,
        "",
        `ご依頼のバウチャー${bookingId ? `（${bookingId}）` : ""}をお送りします。添付の PDF をご確認ください。`,
        "バウチャーはそのままお客様（添乗員様）へお渡しください。送り状のご用意は不要です（集荷員が持参・貼付します）。",
        "ご不明な点は support@bondex.express までお問い合わせください。",
        "",
        "— BondEx ／ 株式会社JOJO ｜ support@bondex.express",
      ].join("\n")

  const attachments = [{ filename: fileName, contentBase64: pdfBase64 }]
  const sentTo: string[] = []
  let firstError: string | undefined
  for (let i = 0; i < recipients.length; i++) {
    const r = await sendMail({
      to: recipients[i],
      subject,
      text,
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
