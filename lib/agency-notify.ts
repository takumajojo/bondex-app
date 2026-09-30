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

import { sendMail, mailerConfigured, type MailAttachment } from "./mailer"

const BONDEX_OPS_EMAIL = process.env.ALERT_EMAIL || "support@bondex.express"

// ── リッチ HTML 版の共通スタイル (集荷/配達完了メール lib/agency-status-email.ts と同じデザイン言語) ──
const H_BRAND = "#C8102E"
const H_GREEN = "#2E7D32"
const H_INK = "#0F172A"
const H_MUTED = "#64748B"
const H_HAIR = "#E5E7EB"
const H_LOGO = "https://bondex.express/bondex-logo.png"
const H_SUPPORT = "support@bondex.express"

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string))
}

export interface BookingRequestEmailInput {
  agencyEmail?: string | null
  agencyName: string
  bookingId: string
  tourNumber?: string | null
  earliestShipDate: string // YYYY-MM-DD
  needsLabelWait: boolean // 出荷が 1ヶ月超先 → 1ヶ月案内を含める (従来運用のみ)
  legCount: number
  locale: "ja" | "en"
  /** お客様（代表者）名。受付メールに「お客様名」を明記するため。 */
  representative?: string | null
  /** 2026-09-24〜 の運用 (送り状は集荷員が持参)。true なら「バウチャーをそのままお渡し」+ 区間ごとの予定表を本文にする。 */
  waybillNotNeeded?: boolean
  /** 区間ごとの予定表 (waybillNotNeeded のとき使う)。suitcaseCount=個数。 */
  legs?: Array<{ legIndex: number; shipmentDate: string; expectedArrival: string; fromHotel: string; toHotel: string; suitcaseCount?: number }>
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
      ? `区間${l.legIndex + 1}: ${l.fromHotel} → ${l.toHotel}\n  ・個数: ${l.suitcaseCount != null ? `${l.suitcaseCount}個` : "—"}\n  ・修正の締切: ${fmtDate(ymdMinus1(l.shipmentDate), "ja")} 17:00 まで\n  ・集荷: ${fmtDate(l.shipmentDate, "ja")} 11:00 以降（集荷員が送り状を持参）\n  ・お届け予定: ${fmtDate(l.expectedArrival, "ja")}`
      : `Leg ${l.legIndex + 1}: ${l.fromHotel} → ${l.toHotel}\n  - Pieces: ${l.suitcaseCount != null ? l.suitcaseCount : "—"}\n  - Changes accepted until: ${fmtDate(ymdMinus1(l.shipmentDate), "en")}, 17:00\n  - Pickup: ${fmtDate(l.shipmentDate, "en")}, from 11:00 (the courier brings the shipping labels)\n  - Expected delivery: ${fmtDate(l.expectedArrival, "en")}`,
  )
  if (ja) {
    return {
      subject: `【BondEx】ご依頼を受け付けました（${input.bookingId}）｜バウチャーはそのままお客様へお渡しください`,
      lines: [
        `${input.agencyName} 御中`,
        `配送のご依頼を受け付けました。予約番号: ${ref}（${input.legCount}区間）。`,
        ...(input.representative ? [`お客様（代表者）: ${input.representative} 様`] : []),
      ],
      callout: [
        `■ バウチャーはそのままお客様へ`,
        `バウチャーは代理店ポータルからダウンロードいただけます（共有 Google Drive にも保管しています）。お客様（添乗員様）にはバウチャーをお渡しいただくだけで結構です。送り状のご用意は不要です（集荷員が持参・貼付します）。`,
        ``,
        `■ この後の流れ（区間ごと）`,
        ...schedule,
        ``,
        `■ 料金について`,
        `ご請求金額は集荷完了時に確定します（お預かり個数 × 単価）。集荷までは個数の変更が可能ですので、変更がある場合は各区間の配送前日 17:00 までにお知らせください。`,
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
    lines: [
      `Dear ${input.agencyName},`,
      `We have received your luggage forwarding request. Booking: ${ref} (${input.legCount} leg${input.legCount > 1 ? "s" : ""}).`,
      ...(input.representative ? [`Guest (lead): ${input.representative}`] : []),
    ],
    callout: [
      `■ Hand the voucher to your guest`,
      `Download the voucher from the agency portal (a copy is also kept in the shared Google Drive). Your guest (tour leader) only needs the voucher. No shipping labels are needed — the courier brings and attaches them at pickup.`,
      ``,
      `■ What happens next (per leg)`,
      ...schedule,
      ``,
      `■ About the charge`,
      `The amount is confirmed at pickup (pieces × unit price). You can still change the piece count until 17:00 on the day before each shipment — please let us know if anything changes.`,
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

// ── リッチ HTML 本文の部品 ─────────────────────────────────────────────
function htmlShell(subject: string, accent: string, title: string, greeting: string, lead: string, bodyHtml: string, locale: "ja" | "en"): string {
  const operatedBy = locale === "en" ? "Operated by JOJO Inc." : "運営：株式会社JOJO"
  const greetingSafe = esc(greeting)
  const leadSafe = esc(lead).replace(/\n/g, "<br>")
  return `<!DOCTYPE html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#F1F5F9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid ${H_HAIR};border-radius:12px;overflow:hidden;">
        <tr><td style="padding:22px 28px 0 28px;"><img src="${H_LOGO}" alt="BondEx" width="116" style="display:block;width:116px;height:auto;"></td></tr>
        <tr><td style="padding:14px 28px 0 28px;"><div style="height:3px;width:100%;background:${accent};border-radius:2px;"></div></td></tr>
        <tr><td style="padding:18px 28px 0 28px;"><div style="font-size:19px;font-weight:700;color:${H_INK};line-height:1.4;">${esc(title)}</div></td></tr>
        <tr><td style="padding:12px 28px 0 28px;">
          <div style="font-size:13px;color:${H_INK};line-height:1.5;">${greetingSafe}</div>
          <div style="font-size:13.5px;color:#334155;line-height:1.8;margin-top:8px;">${leadSafe}</div>
        </td></tr>
        <tr><td style="padding:2px 28px 0 28px;">${bodyHtml}</td></tr>
        <tr><td style="padding:22px 28px 24px 28px;">
          <div style="border-top:1px solid ${H_HAIR};padding-top:14px;">
            <div style="font-size:12px;font-weight:700;color:${H_INK};">BondEx</div>
            <div style="font-size:11px;color:${H_MUTED};line-height:1.6;">${esc(operatedBy)}<br>${H_SUPPORT}</div>
          </div>
        </td></tr>
      </table>
      <div style="font-size:10.5px;color:#94A3B8;margin-top:12px;">© ${new Date().getFullYear()} 株式会社JOJO / BondEx</div>
    </td></tr>
  </table>
</body></html>`
}

function infoRowHtml(label: string, value: string): string {
  if (!value) return ""
  return `<tr><td style="padding:7px 0;color:${H_MUTED};font-size:12px;white-space:nowrap;vertical-align:top;width:132px;">${esc(label)}</td><td style="padding:7px 0;color:${H_INK};font-size:13px;font-weight:600;vertical-align:top;">${esc(value)}</td></tr>`
}

function legCardHtml(l: { legIndex: number; shipmentDate: string; expectedArrival: string; fromHotel: string; toHotel: string; suitcaseCount?: number }, ja: boolean): string {
  const items: [string, string][] = ja
    ? [
        ["個数", l.suitcaseCount != null ? `${l.suitcaseCount}個` : "—"],
        ["修正の締切", `${fmtDate(ymdMinus1(l.shipmentDate), "ja")} 17:00 まで`],
        ["集荷", `${fmtDate(l.shipmentDate, "ja")} 11:00 以降（集荷員が送り状を持参）`],
        ["お届け予定", fmtDate(l.expectedArrival, "ja")],
      ]
    : [
        ["Pieces", l.suitcaseCount != null ? String(l.suitcaseCount) : "—"],
        ["Changes until", `${fmtDate(ymdMinus1(l.shipmentDate), "en")}, 17:00`],
        ["Pickup", `${fmtDate(l.shipmentDate, "en")}, from 11:00 (courier brings labels)`],
        ["Delivery", fmtDate(l.expectedArrival, "en")],
      ]
  const trs = items
    .map(([k, v]) => `<tr><td style="padding:3px 0;color:${H_MUTED};font-size:12px;vertical-align:top;width:104px;white-space:nowrap;">${esc(k)}</td><td style="padding:3px 0;color:${H_INK};font-size:12.5px;font-weight:600;vertical-align:top;">${esc(v)}</td></tr>`)
    .join("")
  const legTitle = ja ? `区間${l.legIndex + 1}` : `Leg ${l.legIndex + 1}`
  return `<div style="border:1px solid ${H_HAIR};border-radius:8px;padding:12px 14px;margin-top:10px;">
    <div style="font-size:13px;font-weight:700;color:${H_INK};line-height:1.7;">${esc(legTitle)}: ${esc(l.fromHotel)} <span style="color:${H_MUTED};font-weight:400;">→</span> ${esc(l.toHotel)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">${trs}</table>
  </div>`
}

function noteBoxHtml(accent: string, heading: string, body: string): string {
  const safe = esc(body).replace(/\n/g, "<br>")
  return `<div style="background:#F8FAFC;border-left:3px solid ${accent};border-radius:4px;padding:12px 14px;color:${H_INK};font-size:12.5px;line-height:1.75;margin-top:14px;">${heading ? `<div style="font-weight:700;margin-bottom:4px;">${esc(heading)}</div>` : ""}${safe}</div>`
}

/** 受付メールのリッチ HTML を生成 (集荷/配達完了メールと同じ体裁)。 */
function buildBookingHtml(input: BookingRequestEmailInput, subject: string): string {
  const ja = input.locale === "ja"
  const ref = input.tourNumber ? `${input.bookingId} / ${ja ? "貴社番号" : "Your ref"}: ${input.tourNumber}` : input.bookingId
  const greeting = ja ? `${input.agencyName} 御中` : `Dear ${input.agencyName},`

  if (input.waybillNotNeeded) {
    const lead = ja
      ? "配送のご依頼を受け付けました。バウチャーはそのままお客様（添乗員様）へお渡しください。"
      : "We have received your luggage forwarding request. Please hand the voucher to your guest as-is."
    const legs = input.legs ?? []
    const infoTable = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${H_HAIR};border-bottom:1px solid ${H_HAIR};margin-top:4px;">
      ${infoRowHtml(ja ? "予約番号" : "Booking no.", `${ref}${ja ? `（${input.legCount}区間）` : ` (${input.legCount} leg${input.legCount > 1 ? "s" : ""})`}`)}
      ${input.representative ? infoRowHtml(ja ? "お客様（代表者）" : "Guest (lead)", ja ? `${input.representative} 様` : input.representative) : ""}
    </table>`
    const sectionTitle = ja ? "この後の流れ（区間ごと）" : "What happens next (per leg)"
    const legSection = `<div style="font-size:12px;font-weight:700;color:${H_MUTED};margin-top:18px;">${esc(sectionTitle)}</div>${legs.map((l) => legCardHtml(l, ja)).join("")}`
    const voucherNote = noteBoxHtml(H_BRAND, ja ? "バウチャーはそのままお客様へ" : "Hand the voucher to your guest", ja
      ? "バウチャーは代理店ポータル（共有 Google Drive にも保管）からダウンロードいただけます。送り状のご用意は不要です（集荷員が持参・貼付します）。"
      : "Download the voucher from the agency portal (also in the shared Google Drive). No shipping labels are needed — the courier brings and attaches them at pickup.")
    const feeNote = noteBoxHtml(H_BRAND, ja ? "料金について" : "About the charge", ja
      ? "ご請求金額は集荷完了時に確定します（お預かり個数 × 単価）。集荷までは個数の変更が可能ですので、変更がある場合は各区間の配送前日 17:00 までにお知らせください。"
      : "The amount is confirmed at pickup (pieces × unit price). You can still change the piece count until 17:00 on the day before each shipment — please let us know if anything changes.")
    const guestNote = noteBoxHtml(H_GREEN, ja ? "お客様へのひと言" : "One line to tell your guest", ja
      ? "「当日は集荷員が伝票を持って伺います。チェックアウトまでにフロントへお荷物をお預けください。」とお伝えください。"
      : "\"On the day, the courier comes with the labels. Please leave your luggage at reception by check-out.\"")
    return htmlShell(subject, H_BRAND, ja ? "ご依頼を受け付けました" : "Request received", greeting, lead, infoTable + legSection + voucherNote + feeNote + guestNote, input.locale)
  }

  // 従来運用 (needsLabelWait): 区間表なし。案内文をノートボックスで表示。
  const { lines, callout } = buildEmail(input)
  const lead = lines.slice(1).join("\n")
  const body = noteBoxHtml(H_BRAND, "", callout.filter(Boolean).join("\n"))
  return htmlShell(subject, H_BRAND, ja ? "発行依頼を受け付けました" : "Request received", greeting, lead, body, input.locale)
}

/** 受付メールの件名・本文(text+html)をレンダリングする (送信はしない)。安全なテスト送信口からも再利用する。 */
export function renderBookingRequestEmail(input: BookingRequestEmailInput): { subject: string; text: string; html: string } {
  const { subject, lines, callout } = buildEmail(input)
  const text = [...lines, "", ...callout, "", "— BondEx ／ bondex.express ｜ support@bondex.express"].join("\n")
  const html = buildBookingHtml(input, subject)
  return { subject, text, html }
}

export async function sendBookingRequestEmail(
  input: BookingRequestEmailInput,
  attachments?: MailAttachment[],
): Promise<{ sent: boolean; error?: string }> {
  const { subject, text, html } = renderBookingRequestEmail(input)
  // 取りこぼし防止でログには必ず残す
  console.error(`[agency-notify] ${subject} :: ${text.replace(/\n/g, " | ")}`)
  if (!mailerConfigured()) return { sent: false, error: "mailer unset" }

  const recipients: string[] = []
  if (input.agencyEmail) recipients.push(input.agencyEmail)
  recipients.push(BONDEX_OPS_EMAIL)

  // 宛先ごとに送る(片方失敗でも他方に届く)。差出人は mailer 既定(ALERT_FROM_EMAIL=support@)。
  let anySent = false
  const errs: string[] = []
  for (const to of recipients) {
    const r = await sendMail({ to, subject, text, html, attachments, replyTo: "support@bondex.express" })
    if (r.sent) anySent = true
    else errs.push(`${to}: ${r.error}`)
  }
  return anySent ? { sent: true } : { sent: false, error: errs.join("; ") }
}
