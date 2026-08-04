/**
 * 配達完了通知 — 区間が delivered に進んだ時に、その予約の代理店
 * (ランドオペレーター) へ「お荷物が配達完了しました」と知らせる。
 *
 * BondEx の顧客は代理店なので宛先は agencies.contact_email。旅行者本人へは
 * 送らない (旅行者の連絡先は保持していない・代理店経由の運用)。
 * 送信は共通 mailer (SMTP優先→Resend)。未設定なら送らず {sent:false}。
 * best-effort — 失敗しても配達完了の記録自体は成立させる。
 */

import { sendMail, mailerConfigured } from "./mailer"

export interface DeliveryCompleteInput {
  agencyEmail?: string | null
  agencyName: string
  bookingId: string
  legIndex: number
  representative: string
  recipient: string
  toHotel: string
  tracking: string[] | null
  /** 代理店が国外 (英語) か。既定は日本語。 */
  english?: boolean
}

export async function sendDeliveryCompleteEmail(
  input: DeliveryCompleteInput,
): Promise<{ sent: boolean; error?: string }> {
  const legRef = `${input.bookingId}-L${input.legIndex + 1}`
  const trackingLine = (input.tracking ?? []).filter(Boolean).join(", ")
  const trackUrl = `https://bondex.express/track/${input.bookingId}`

  const subject = input.english
    ? `[BondEx] Delivered — ${legRef}`
    : `【BondEx】お荷物が配達完了しました（${legRef}）`

  const lines = input.english
    ? [
        `Dear ${input.agencyName},`,
        "",
        `The luggage for the following leg has been delivered.`,
        "",
        `Booking: ${legRef}`,
        `Traveler: ${input.representative}`,
        `Delivered to: ${input.toHotel}`,
        trackingLine ? `Tracking: ${trackingLine}` : "",
        `Status page: ${trackUrl}`,
        "",
        "— BondEx / bondex.express | support@bondex.express",
      ]
    : [
        `${input.agencyName} 御中`,
        "",
        `下記区間のお荷物が配達完了しましたのでお知らせいたします。`,
        "",
        `予約番号: ${legRef}`,
        `代表者: ${input.representative}`,
        `お届け先: ${input.toHotel}`,
        trackingLine ? `追跡番号: ${trackingLine}` : "",
        `配送状況ページ: ${trackUrl}`,
        "",
        "— BondEx ／ bondex.express ｜ support@bondex.express",
      ]

  const text = lines.filter((l) => l !== "").join("\n")
  // 取りこぼし防止でログに残す
  console.error(`[delivery-notify] ${subject} :: ${input.agencyName} / ${input.agencyEmail ?? "no-email"}`)

  if (!mailerConfigured() || !input.agencyEmail) {
    return { sent: false, error: !input.agencyEmail ? "no agency email" : "mailer unset" }
  }
  const r = await sendMail({
    to: input.agencyEmail,
    subject,
    text,
    replyTo: "support@bondex.express",
  })
  return r.sent ? { sent: true } : { sent: false, error: r.error }
}
