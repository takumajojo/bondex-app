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
  needsLabelWait: boolean // 出荷が 1ヶ月超先 → 1ヶ月案内を含める (従来運用のみ)
  legCount: number
  locale: "ja" | "en"
  /** 2026-09-24〜 の運用 (送り状は集荷員が持参)。true なら「バウチャーをそのままお渡し」+ 区間ごとの予定表を本文にする。 */
  waybillNotNeeded?: boolean
  /** 区間ごとの予定表 (waybillNotNeeded のとき使う) */
  legs?: Array<{ legIndex: number; shipmentDate: string; expectedArrival: string; fromHotel: string; toHotel: string }>
}

/** "YYYY-MM-DD" を暦日として UTC の Date にする (タイムゾーンで日付がずれないよう UTC 固定で扱う) */
function ymdToUtc(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null
}
/** "YYYY-MM-DD" → 前日 */
function ymdMinus1(ymd: string): string {
  const d = ymdToUtc(ymd)
  if (!d) return ymd
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
function fmtDate(ymd: string, locale: "ja" | "en"): string {
  const d = ymdToUtc(ymd)
  if (!d) return ymd
  const dow = d.getUTCDay()
  return locale === "ja"
    ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${["日", "月", "火", "水", "木", "金", "土"][dow]})`
    : `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow]}, ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** 新運用 (送り状は集荷員が持参) の受付メール本文。完了画面と同じ 3 点 + 区間ごとの予定表。 */
function buildEmailNoWaybill(input: BookingRequestEmailInput): { subject: string; lines: string[]; callout: string[] } {
  const ja = input.locale === "ja"
  const ref = input.tourNumber ? `${input.bookingId} / ${ja ? "貴社番号" : "Your ref"}: ${input.tourNumber}` : input.bookingId
  const legs = input.legs ?? []
  const schedule = legs.map((l) =>
    ja
      ? `区間${l.legIndex + 1}: ${l.fromHotel} → ${l.toHotel}\n  ・修正の締切: ${fmtDate(ymdMinus1(l.shipmentDate), "ja")} 17:00 まで\n  ・集荷: ${fmtDate(l.shipmentDate, "ja")} 11:00 以降（集荷員が送り状を持参）\n  ・お届け予定: ${fmtDate(l.expectedArrival, "ja")}`
      : `Leg ${l.legIndex + 1}: ${l.fromHotel} → ${l.toHotel}\n  - Changes accepted until: ${fmtDate(ymdMinus1(l.shipmentDate), "en")}, 17:00\n  - Pickup: ${fmtDate(l.shipmentDate, "en")}, from 11:00 (the courier brings the shipping labels)\n  - Expected delivery: ${fmtDate(l.expectedArrival, "en")}`,
  )
  if (ja) {
    return {
      subject: `【BondEx】ご依頼を受け付けました（${input.bookingId}）｜バウチャーはそのままお客様へお渡しください`,
      lines: [`${input.agencyName} 御中`, `配送のご依頼を受け付けました。予約番号: ${ref}（${input.legCount}区間）。`],
      callout: [
        `■ バウチャーはそのままお客様へ`,
        `バウチャーは代理店ポータルからダウンロードいただけます（共有 Google Drive にも保管しています）。お客様（添乗員様）にはバウチャーをお渡しいただくだけで結構です。送り状のご用意は不要です（集荷員が持参・貼付します）。`,
        ``,
        `■ この後の流れ（区間ごと）`,
        ...schedule,
        ``,
        `■ お客様へのひと言`,
        `「当日になりましたら、集荷員が伝票を持って集荷に伺います。チェックアウトまでにフロントへお荷物をお預けください。」とお伝えください。`,
        ``,
        `日程・個数・ホテルの変更は、各区間の配送前日 17:00 まで代理店ポータルまたはお問い合わせから承ります。`,
      ],
    }
  }
  return {
    subject: `[BondEx] Request received (${input.bookingId}) — hand the voucher to your guest`,
    lines: [`Dear ${input.agencyName},`, `We have received your luggage forwarding request. Booking: ${ref} (${input.legCount} leg${input.legCount > 1 ? "s" : ""}).`],
    callout: [
      `■ Hand the voucher to your guest`,
      `Download the voucher from the agency portal (a copy is also kept in the shared Google Drive). Your guest (tour leader) only needs the voucher. No shipping labels are needed — the courier brings and attaches them at pickup.`,
      ``,
      `■ What happens next (per leg)`,
      ...schedule,
      ``,
      `■ One line to tell your guest`,
      `"On the day, the courier will come to the hotel with the shipping labels. Please leave your luggage at the reception by check-out."`,
      ``,
      `Dates, piece counts and hotels can be changed from the portal or via Contact until 17:00 on the day before each shipment.`,
    ],
  }
}

function buildEmail(
  input: BookingRequestEmailInput,
): { subject: string; lines: string[]; callout: string[] } {
  if (input.waybillNotNeeded) return buildEmailNoWaybill(input)
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
