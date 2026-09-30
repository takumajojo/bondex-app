import { sendMail, mailerConfigured } from "./mailer"
import { getSupabase } from "./supabase"
import { voucherAttachment } from "./voucher-attachment"
import { htmlShell, noteBoxHtml, esc } from "./agency-notify"

const OPS_EMAIL = process.env.ALERT_EMAIL || "support@bondex.express"
const AMBER = "#B45309"
const GREEN = "#2E7D32"

/**
 * 予約内容の変更時に、代理店へ「更新のお知らせ + 最新バウチャーPDF(How to ship同梱)」を送る。
 * 2026-09-30〜: 佐川伝票が不要になったため、変更のたびに最新バウチャーをメール添付する
 * (以前のバウチャーは破棄してもらう)。best-effort・送信/変更処理は止めない。
 *
 * 代理店の連絡先・言語は shipments.agency → agencies から解決するので、呼び出し側は
 * bookingId と変更点(changes)だけ渡せばよい。
 */
export async function sendBookingUpdateEmail(bookingId: string, changes: string[]): Promise<{ sent: boolean }> {
  try {
    if (!mailerConfigured()) return { sent: false }
    const sb = getSupabase()
    if (!sb) return { sent: false }

    const { data: ship } = await sb
      .from("shipments")
      .select("agency, tour_number")
      .eq("booking_id", bookingId)
      .order("leg_index", { ascending: true })
      .limit(1)
      .maybeSingle()
    const agencyNameFromShip = (ship?.agency as string | null) ?? ""
    if (!agencyNameFromShip) return { sent: false }

    const { data: ag } = await sb
      .from("agencies")
      .select("name, contact_email, locale")
      .eq("name", agencyNameFromShip)
      .maybeSingle()
    const agencyName = (ag?.name as string | null) ?? agencyNameFromShip
    const agencyEmail = (ag?.contact_email as string | null) ?? null
    const ja = (ag?.locale as string | null) !== "en"

    const att = await voucherAttachment(bookingId, { expectedAgency: agencyName })

    const ref = ship?.tour_number ? `${bookingId} / ${ja ? "貴社番号" : "Your ref"}: ${ship.tour_number}` : bookingId
    const subject = ja
      ? `【BondEx】予約内容を更新しました（${bookingId}）｜最新バウチャーを添付`
      : `[BondEx] Booking updated (${bookingId}) — latest voucher attached`
    const title = ja ? "予約内容を更新しました" : "Booking updated"
    const greeting = ja ? `${agencyName} 御中` : `Dear ${agencyName},`
    const lead = ja
      ? `ご予約（${ref}）の内容を更新しました。最新のバウチャーを添付します。`
      : `Your booking (${ref}) has been updated. The latest voucher is attached.`

    const changesList = changes.filter(Boolean)
    const changesHtml = changesList.length
      ? `<div style="font-size:12px;font-weight:700;color:#64748B;margin-top:16px;">${esc(ja ? "変更内容" : "What changed")}</div>` +
        `<ul style="margin:8px 0 0 0;padding-left:18px;color:#0F172A;font-size:13px;line-height:1.9;">${changesList.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`
      : ""
    const voucherNote = att
      ? noteBoxHtml(GREEN, ja ? "最新のバウチャー（PDF）を添付しました" : "Latest voucher (PDF) attached", ja
          ? "以前のバウチャーは破棄し、こちらの最新版をお客様（添乗員様）へお渡しください（How to ship ガイド同梱）。"
          : "Please discard the previous voucher and hand this latest version to your guest (the How-to-ship guide is included).")
      : noteBoxHtml(AMBER, ja ? "最新のバウチャーについて" : "Latest voucher", ja
          ? "最新のバウチャーは代理店ポータルからダウンロードいただけます。"
          : "You can download the latest voucher from the agency portal.")

    const html = htmlShell(subject, AMBER, title, greeting, lead, changesHtml + voucherNote, ja ? "ja" : "en")
    const text = [
      greeting,
      lead,
      "",
      ...(changesList.length ? [ja ? "■ 変更内容" : "■ What changed", ...changesList.map((c) => `・${c}`), ""] : []),
      att
        ? ja
          ? "最新のバウチャー（PDF・How to ship同梱）を添付しました。以前のものは破棄し、こちらをお客様へお渡しください。"
          : "The latest voucher (PDF, incl. How-to-ship) is attached. Please discard the previous one and hand this to your guest."
        : ja
          ? "最新のバウチャーは代理店ポータルからダウンロードいただけます。"
          : "You can download the latest voucher from the agency portal.",
      "",
      "— BondEx ／ bondex.express ｜ support@bondex.express",
    ].join("\n")

    const recipients: string[] = []
    if (agencyEmail) recipients.push(agencyEmail)
    recipients.push(OPS_EMAIL)
    let anySent = false
    for (const to of recipients) {
      const r = await sendMail({ to, subject, text, html, attachments: att ? [att] : undefined, replyTo: "support@bondex.express" })
      if (r.sent) anySent = true
    }
    return { sent: anySent }
  } catch (e) {
    console.error("[booking-update-email] 失敗:", bookingId, e instanceof Error ? e.message : e)
    return { sent: false }
  }
}
