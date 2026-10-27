import { NextRequest, NextResponse } from "next/server"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { agencyRecipientEmails } from "@/lib/agency-contacts"
import { sendMail } from "@/lib/mailer"
import { voucherAttachment } from "@/lib/voucher-attachment"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 新規依頼の完了後、谷口さんが内容を確認して「依頼主へ」バウチャー PDF を送付する口
 * (BondEx 運用のみ — middleware で認証済み。2026-10-21 谷口さん指示)。
 *
 * 2026-10-27 改修: バウチャー PDF は **サーバ側で bookingId から再生成**する (voucherAttachment)。
 *   旧実装はブラウザが表示中の PDF(blob)を base64 にしてアップロードしていたが、
 *   その送信リクエストがサイズ/接続断でネットワーク層から失敗し、画面に生の "Load failed" が
 *   出て送れないことがあった。受付メール(app/api/agency/booking)と同じサーバ生成経路に一本化し、
 *   クライアントからの pdfBase64 送信を廃止。宛先はその代理店の登録メール全員、控えは support@ に BCC。
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

  // 代理店名: 明示指定が無ければ予約レコードから解決する (送付先=代理店の登録メール)。
  let agency = body.agency?.trim() || ""
  if (!agency) {
    const { data: row } = await sb
      .from("shipments")
      .select("agency")
      .eq("booking_id", bookingId)
      .limit(1)
      .maybeSingle()
    agency = (row?.agency as string | null)?.trim() || ""
  }
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

  const attachments = [{ filename: att.filename, contentBase64: att.contentBase64 }]
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
