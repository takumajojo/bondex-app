import nodemailer from "nodemailer"

// 送信手段の共通ヘルパー。優先順位:
//  1) SMTP (SMTP_HOST/USER/PASS 設定時)。既存の jojo-tokyo.com(Google) 等から送れる。
//     任意の宛先に送れ、bondex.express のDNS認証は不要。
//  2) Resend (RESEND_API_KEY 設定時)。onboarding@resend.dev の間は登録メール宛のみ。
// どちらも未設定なら送信しない (呼び出し側は best-effort)。

export interface MailAttachment {
  filename: string
  contentBase64: string
}

export interface SendResult {
  sent: boolean
  via?: "smtp" | "resend"
  error?: string
}

function smtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
}

async function sendViaSmtp(opts: {
  to: string
  subject: string
  text: string
  attachments?: MailAttachment[]
  replyTo?: string
}): Promise<SendResult> {
  const host = process.env.SMTP_HOST!
  const user = process.env.SMTP_USER!
  const pass = process.env.SMTP_PASS!
  const port = Number(process.env.SMTP_PORT || 465)
  const from = process.env.SMTP_FROM || `BondEx <${user}>`
  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 465=SSL, 587=STARTTLS
      auth: { user, pass },
    })
    await transporter.sendMail({
      from,
      to: opts.to,
      replyTo: opts.replyTo,
      subject: opts.subject,
      text: opts.text,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.contentBase64, "base64"),
      })),
    })
    return { sent: true, via: "smtp" }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "smtp error"
    console.error("[mailer] SMTP 送信失敗:", opts.to, msg)
    return { sent: false, via: "smtp", error: msg }
  }
}

async function sendViaResend(opts: {
  to: string
  subject: string
  text: string
  attachments?: MailAttachment[]
  replyTo?: string
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY!
  const from = process.env.ALERT_FROM_EMAIL || "BondEx <onboarding@resend.dev>"
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [opts.to],
        reply_to: opts.replyTo,
        subject: opts.subject,
        text: opts.text,
        attachments: opts.attachments?.map((a) => ({ filename: a.filename, content: a.contentBase64 })),
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error("[mailer] Resend 送信失敗:", opts.to, res.status, body.slice(0, 300))
      return { sent: false, via: "resend", error: `resend ${res.status}` }
    }
    return { sent: true, via: "resend" }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "resend error"
    console.error("[mailer] Resend 例外:", opts.to, msg)
    return { sent: false, via: "resend", error: msg }
  }
}

/** メール1通を送る。SMTP優先、無ければResend。どちらも無ければ送らない。 */
export async function sendMail(opts: {
  to: string
  subject: string
  text: string
  attachments?: MailAttachment[]
  replyTo?: string
}): Promise<SendResult> {
  if (!opts.to?.trim()) return { sent: false, error: "no recipient" }
  if (smtpConfigured()) return sendViaSmtp(opts)
  if (process.env.RESEND_API_KEY) return sendViaResend(opts)
  return { sent: false, error: "no mailer configured" }
}

export function mailerConfigured(): boolean {
  return smtpConfigured() || !!process.env.RESEND_API_KEY
}
