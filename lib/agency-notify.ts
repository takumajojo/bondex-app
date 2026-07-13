/**
 * 代理店への発行依頼(登録)受付メール。
 *
 * 代理店が /agency/new で発行依頼を登録した時に送る。出荷が 1ヶ月以上先の場合は
 * 「ヤマトの送り状は出荷1ヶ月前から発行可能なので、1ヶ月前になったらまとめてご連絡します」
 * という案内を本文に含める(needsLabelWait=true)。
 *
 * 送信は Resend。RESEND_API_KEY 未設定なら送らず { sent:false } を返す(登録自体は成功させる)。
 * 宛先は代理店の contact_email + BondEx 運用アドレス(控え)。
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails"
const FROM = process.env.ALERT_FROM_EMAIL || "BondEx <no-reply@bondex.express>"
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

function buildEmail(input: BookingRequestEmailInput): { subject: string; lines: string[] } {
  const ref = input.tourNumber
    ? `${input.bookingId} / ${input.locale === "ja" ? "貴社番号" : "Your ref"}: ${input.tourNumber}`
    : input.bookingId
  if (input.locale === "ja") {
    const lines = [
      `${input.agencyName} 御中`,
      `発行依頼を受け付けました。予約番号: ${ref}(${input.legCount}区間)。`,
      input.needsLabelWait
        ? `ヤマトの送り状は出荷予定日の1ヶ月前から発行可能です。最短の出荷予定日は ${input.earliestShipDate} のため、1ヶ月前になりましたら書類一式（バウチャー・ヤマト伝票）をまとめてご用意し、Google Drive フォルダのリンクをポータルよりご案内します。`
        : `書類一式（バウチャー・ヤマト伝票）の準備ができ次第、Google Drive フォルダのリンクをポータルよりご案内します。`,
      `ご不明点は support@bondex.express までご連絡ください。`,
    ]
    return { subject: `【BondEx】発行依頼を受け付けました（${input.bookingId}）`, lines }
  }
  const lines = [
    `Dear ${input.agencyName},`,
    `We have received your issuance request. Booking: ${ref} (${input.legCount} leg${input.legCount > 1 ? "s" : ""}).`,
    input.needsLabelWait
      ? `Yamato shipping labels can only be created within one month of the shipment date. Your earliest shipment date is ${input.earliestShipDate}, so once it is within a month we will prepare all documents (voucher and Yamato labels) together and share a Google Drive folder link in your portal.`
      : `As soon as the documents (voucher and Yamato labels) are ready, we will share a Google Drive folder link in your portal.`,
    `For any questions, contact support@bondex.express.`,
  ]
  return { subject: `[BondEx] Issuance request received (${input.bookingId})`, lines }
}

export async function sendBookingRequestEmail(
  input: BookingRequestEmailInput,
): Promise<{ sent: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY
  const { subject, lines } = buildEmail(input)
  // 取りこぼし防止でログには必ず残す
  console.error(`[agency-notify] ${subject} :: ${lines.join(" | ")}`)
  if (!key) return { sent: false, error: "RESEND_API_KEY unset" }

  const to: string[] = []
  if (input.agencyEmail) to.push(input.agencyEmail)
  to.push(BONDEX_OPS_EMAIL)
  if (to.length === 0) return { sent: false, error: "no recipient" }

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px">
      <h2 style="color:#C8102E;font-size:18px">${subject}</h2>
      ${lines.map((l) => `<p style="margin:8px 0;font-size:14px;color:#111;line-height:1.7">${l}</p>`).join("")}
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee"/>
      <p style="font-size:12px;color:#888">BondEx — bondex.express</p>
    </div>`
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    })
    if (!res.ok) {
      const b = await res.text().catch(() => "")
      return { sent: false, error: `Resend HTTP ${res.status}: ${b.slice(0, 200)}` }
    }
    return { sent: true }
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) }
  }
}
