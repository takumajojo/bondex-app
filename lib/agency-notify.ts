/**
 * 代理店への発行依頼(登録)受付メール。
 *
 * 代理店が /agency/new で発行依頼を登録した時に送る。出荷が 1ヶ月以上先の場合は
 * 「送り状は出荷1ヶ月前から発行可能なので、1ヶ月前になったらまとめてご連絡します」
 * という案内を本文に含める(needsLabelWait=true)。
 *
 * 送信は Resend。RESEND_API_KEY 未設定なら送らず { sent:false } を返す(登録自体は成功させる)。
 * 宛先は代理店の contact_email + BondEx 運用アドレス(控え)。
 */

import { sendMail, mailerConfigured } from "./mailer"

const BONDEX_OPS_EMAIL = process.env.ALERT_EMAIL || "support@bondex.express"

export interface BookingRequestEmailInput {
  agencyEmail?: string | null
  agencyName: string
  bookingId: string
  tourNumber?: string | null
  earliestShipDate: string // YYYY-MM-DD
  needsLabelWait: boolean // 出荷が 1ヶ月超先 → 1ヶ月案内を含める
  legCount: number
  locale: "ja" | "en"
}

function buildEmail(
  input: BookingRequestEmailInput,
): { subject: string; lines: string[]; callout: string[] } {
  const ref = input.tourNumber
    ? `${input.bookingId} / ${input.locale === "ja" ? "貴社番号" : "Your ref"}: ${input.tourNumber}`
    : input.bookingId
  const emailShown = input.agencyEmail ? input.agencyEmail : input.locale === "ja" ? "ご登録のメールアドレス" : "your registered email"
  if (input.locale === "ja") {
    const lines = [
      `${input.agencyName} 御中`,
      `発行依頼を受け付けました。予約番号: ${ref}（${input.legCount}区間）。`,
    ]
    // 大きく強調するポイント (メールの色付きボックスに表示)
    const callout = [
      `【重要】配送伝票（送り状）は、出荷予定日の1ヶ月前からしか発行できません。`,
      input.needsLabelWait
        ? `最短の出荷予定日は ${input.earliestShipDate} です。1ヶ月前になりましたら書類一式（バウチャー・配送伝票）をご用意し、このメールアドレス（${emailShown}）宛に Google Drive フォルダを共有します。`
        : `書類一式（バウチャー・配送伝票）をご用意し、このメールアドレス（${emailShown}）宛に Google Drive フォルダを共有します。`,
      `Drive フォルダが共有されたら、その中のバウチャー・配送伝票をご利用ください。`,
    ]
    return {
      subject: `【BondEx】発行依頼を受け付けました（${input.bookingId}）｜書類は Google Drive で共有します`,
      lines,
      callout,
    }
  }
  const lines = [
    `Dear ${input.agencyName},`,
    `We have received your issuance request. Booking: ${ref} (${input.legCount} leg${input.legCount > 1 ? "s" : ""}).`,
  ]
  const callout = [
    `IMPORTANT: shipping labels can only be created from one month before the shipment date.`,
    input.needsLabelWait
      ? `Your earliest shipment date is ${input.earliestShipDate}. Once it is within a month, we will prepare all documents (voucher and shipping labels) and share a Google Drive folder with your registered email (${emailShown}).`
      : `We will prepare all documents (voucher and shipping labels) and share a Google Drive folder with your registered email (${emailShown}).`,
    `Once the Drive folder is shared, use the voucher and shipping labels inside it.`,
  ]
  return {
    subject: `[BondEx] Issuance request received (${input.bookingId}) — documents shared via Google Drive`,
    lines,
    callout,
  }
}

export async function sendBookingRequestEmail(
  input: BookingRequestEmailInput,
): Promise<{ sent: boolean; error?: string }> {
  const { subject, lines, callout } = buildEmail(input)
  // 取りこぼし防止でログには必ず残す
  console.error(`[agency-notify] ${subject} :: ${[...lines, ...callout].join(" | ")}`)
  if (!mailerConfigured()) return { sent: false, error: "mailer unset" }

  const recipients: string[] = []
  if (input.agencyEmail) recipients.push(input.agencyEmail)
  recipients.push(BONDEX_OPS_EMAIL)

  // SMTP優先→Resendフォールバック。宛先ごとに送る(片方失敗でも他方に届く)。
  const text = [...lines, "", ...callout, "", "— BondEx ／ bondex.express ｜ support@bondex.express"].join("\n")
  let anySent = false
  const errs: string[] = []
  for (const to of recipients) {
    const r = await sendMail({ to, subject, text, replyTo: "support@bondex.express" })
    if (r.sent) anySent = true
    else errs.push(`${to}: ${r.error}`)
  }
  return anySent ? { sent: true } : { sent: false, error: errs.join("; ") }
}
