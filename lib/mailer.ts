import nodemailer from "nodemailer"
import { BONDEX_LOGO_BASE64, EMAIL_LOGO_CID, EMAIL_LOGO_FILENAME } from "./email-logo"

// 送信手段の共通ヘルパー。優先順位:
//  1) SMTP (SMTP_HOST/USER/PASS 設定時)。既存の jojo-tokyo.com(Google) 等から送れる。
//     任意の宛先に送れ、bondex.express のDNS認証は不要。
//  2) Resend (RESEND_API_KEY 設定時)。onboarding@resend.dev の間は登録メール宛のみ。
// どちらも未設定なら送信しない (呼び出し側は best-effort)。

export interface MailAttachment {
  filename: string
  contentBase64: string
  /** インライン画像にする場合の Content-ID (HTML から cid:<cid> で参照)。 */
  cid?: string
  /** インライン表示(本文埋め込み)にするか。既定は通常の添付。 */
  inline?: boolean
}

export interface SendResult {
  sent: boolean
  via?: "smtp" | "resend"
  error?: string
  /** 送れたか分からない（相手に届いた後に応答が切れた・時間切れ・相手の 5xx）。sent=false の時だけ意味がある。 */
  uncertain?: boolean
  /** 相手が返した HTTP / SMTP の応答の番号（分かる時） */
  status?: number
  /** Resend のエラーの名前（例: invalid_idempotent_request・concurrent_idempotent_requests） */
  code?: string
}

function smtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
}

async function sendViaSmtp(opts: {
  to: string
  subject: string
  text: string
  html?: string
  attachments?: MailAttachment[]
  replyTo?: string
  bcc?: string | string[]
  idempotencyKey?: string // SMTP は冪等キー非対応。型整合のため受けるだけ (使わない)。
  timeoutMs?: number
}): Promise<SendResult> {
  const host = process.env.SMTP_HOST!
  const user = process.env.SMTP_USER!
  const pass = process.env.SMTP_PASS!
  const port = Number(process.env.SMTP_PORT || 465)
  // 差出人は原則 support@bondex.express。SMTP_FROM で上書き可。
  // ※ Google Workspace SMTP の場合、認証アカウント (SMTP_USER) に support@bondex.express を
  //   「名前を指定して送信 (send mail as)」で登録しておく必要がある (未登録だと Gmail 側で
  //   認証アドレスに書き換えられる)。届いた差出人が support でなければこの設定を確認する。
  const from = process.env.SMTP_FROM || "BondEx <support@bondex.express>"
  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 465=SSL, 587=STARTTLS
      auth: { user, pass },
      ...(opts.timeoutMs ? { connectionTimeout: opts.timeoutMs, greetingTimeout: opts.timeoutMs, socketTimeout: opts.timeoutMs } : {}),
    })
    await transporter.sendMail({
      from,
      to: opts.to,
      bcc: opts.bcc,
      replyTo: opts.replyTo,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.contentBase64, "base64"),
        ...(a.cid ? { cid: a.cid } : {}),
        ...(a.inline || a.cid ? { contentDisposition: "inline" as const } : {}),
      })),
    })
    return { sent: true, via: "smtp" }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "smtp error"
    console.error("[mailer] SMTP 送信失敗:", opts.to, msg)
    // 接続・認証・宛先の段階で止まった、またはサーバーが明確に断った → 送れていない。それ以外（切断・時間切れ）は不明。
    const err = e as { code?: string; responseCode?: number }
    const notSent = typeof err.responseCode === "number" || ["EAUTH", "EENVELOPE", "EDNS", "ECONNECTION", "ETLS"].includes(err.code ?? "")
    return { sent: false, via: "smtp", error: msg, uncertain: !notSent, status: err.responseCode }
  }
}

async function sendViaResend(opts: {
  to: string
  subject: string
  text: string
  html?: string
  attachments?: MailAttachment[]
  replyTo?: string
  bcc?: string | string[]
  idempotencyKey?: string
  timeoutMs?: number
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY!
  // 既定は support@bondex.express (Resend で bondex.express を認証済みが前提)。ALERT_FROM_EMAIL で上書き可。
  const from = process.env.ALERT_FROM_EMAIL || "BondEx <support@bondex.express>"
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      // Idempotency-Key: 送信成功後に DB 記録前に落ちて再送されても、Resend 側で重複を排除する
      // (24時間窓)。宛先ごとに一意のキーを渡す (呼び出し側で base+宛先index を組む)。
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      },
      ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
      body: JSON.stringify({
        from,
        to: [opts.to],
        bcc: opts.bcc ? (Array.isArray(opts.bcc) ? opts.bcc : [opts.bcc]) : undefined,
        reply_to: opts.replyTo,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
        attachments: opts.attachments?.map((a) => ({
          filename: a.filename,
          content: a.contentBase64,
          ...(a.cid ? { content_id: a.cid } : {}),
        })),
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error("[mailer] Resend 送信失敗:", opts.to, res.status, body.slice(0, 300))
      let code: string | undefined
      try {
        code = (JSON.parse(body) as { name?: string }).name
      } catch {
        /* 本文が JSON でない */
      }
      // 5xx・409 は届いたか分からない。409 の concurrent_idempotent_requests は同じキーの要求が処理中（後で再試行してよい）、
      // invalid_idempotent_request は同じキーが違う内容で使用済み（前の要求が処理済み。再試行しても直らない）。
      // 429・その他の 4xx は送られていない。https://resend.com/docs/dashboard/emails/idempotency-keys（2026-11-04 確認）
      return { sent: false, via: "resend", error: `resend ${res.status}${code ? ` ${code}` : ""}`, status: res.status, code, uncertain: res.status >= 500 || res.status === 409 }
    }
    return { sent: true, via: "resend" }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "resend error"
    console.error("[mailer] Resend 例外:", opts.to, msg)
    // 名前の解決・接続の拒否は送れていない。時間切れ・切断は届いたか分からない。
    const code = (e as { cause?: { code?: string } })?.cause?.code ?? ""
    return { sent: false, via: "resend", error: msg, uncertain: !["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"].includes(code) }
  }
}

/** メール1通を送る。SMTP優先→失敗時はResendにフォールバック。どちらも無ければ送らない。 */
export async function sendMail(opts: {
  to: string
  subject: string
  text: string
  html?: string
  attachments?: MailAttachment[]
  replyTo?: string
  bcc?: string | string[]
  /** Resend の冪等キー (24h)。送信成功→DB記録前クラッシュ時の再送で重複を防ぐ。宛先ごとに一意にする。 */
  idempotencyKey?: string
  /**
   * B2C の旅行者への通知（lib/b2c/notify.ts）用。送信手段を 1つに固定し、失敗しても別の手段で送り直さない
   * （1つ目が実は届いていた時の二重送信を防ぐ）。Resend があれば Resend だけ（冪等キーが効く）、無ければ SMTP だけ。
   * 時間切れ（timeoutMs）を付け、届いたか分からない失敗は uncertain で返す。既定（false）の動きは今までと同じ。
   */
  strict?: boolean
  timeoutMs?: number
}): Promise<SendResult> {
  if (!opts.to?.trim()) return { sent: false, error: "no recipient" }

  // 結合テスト用: MAIL_TEST_CAPTURE=1 のときは実送信せず、送信内容を記録して成功を返す
  // (本番では未設定。顧客へ実送信せずに完了メール/冪等キー/再送フローを検証するため)。
  if (process.env.MAIL_TEST_CAPTURE === "1") {
    const g = globalThis as unknown as { __capturedMails?: Array<Record<string, unknown>> }
    g.__capturedMails = g.__capturedMails ?? []
    g.__capturedMails.push({ to: opts.to, subject: opts.subject, idempotencyKey: opts.idempotencyKey, bcc: opts.bcc })
    return { sent: true, via: "resend" }
  }

  // HTML が cid:bondex-logo を参照していれば、ロゴをインライン添付として自動付与する。
  // (リモート画像 <img src=https://…> はメールクライアントでブロックされ表示されないため、
  //  CID 添付にして確実に表示する。既に同じ cid の添付があれば二重付与しない。)
  if (opts.html && opts.html.includes(`cid:${EMAIL_LOGO_CID}`)) {
    const already = (opts.attachments ?? []).some((a) => a.cid === EMAIL_LOGO_CID)
    if (!already) {
      opts = {
        ...opts,
        attachments: [
          ...(opts.attachments ?? []),
          { filename: EMAIL_LOGO_FILENAME, contentBase64: BONDEX_LOGO_BASE64, cid: EMAIL_LOGO_CID, inline: true },
        ],
      }
    }
  }

  // 差出人を support@bondex.express に統一するため Resend を優先する。
  // (Gmail SMTP は認証アカウント=taniguchi@ に差出人を書き換えるため、顧客向けには不適。)
  // Resend 未設定なら従来どおり SMTP。Resend 失敗時は取りこぼし防止に SMTP へフォールバック。
  if (opts.strict) {
    if (process.env.RESEND_API_KEY) return sendViaResend({ ...opts, timeoutMs: opts.timeoutMs ?? 15_000 })
    if (smtpConfigured()) return sendViaSmtp({ ...opts, timeoutMs: opts.timeoutMs ?? 15_000 })
    return { sent: false, error: "no mailer configured" }
  }
  if (process.env.RESEND_API_KEY) {
    const r = await sendViaResend(opts)
    if (r.sent) return r
    if (smtpConfigured()) {
      const r2 = await sendViaSmtp(opts)
      if (r2.sent) return { ...r2, error: `resend_failed(${r.error})→smtp_ok` }
      return { sent: false, error: `resend(${r.error}) / smtp(${r2.error})` }
    }
    return r
  }
  if (smtpConfigured()) return sendViaSmtp(opts)
  return { sent: false, error: "no mailer configured" }
}

export function mailerConfigured(): boolean {
  return smtpConfigured() || !!process.env.RESEND_API_KEY
}
