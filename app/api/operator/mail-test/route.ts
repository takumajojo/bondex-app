import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { sendMail } from "@/lib/mailer"

export const runtime = "nodejs"
export const maxDuration = 30

/**
 * メール送信の設定診断・疎通テスト(運営専用・middleware operator ゲート配下)。
 * GET /api/operator/mail-test            → 設定状況のみ返す
 * GET /api/operator/mail-test?to=xxx     → 実際に1通送ってみて結果(エラー含む)を返す
 * 機密値(SMTP_USER/PASS/APIキー)は返さない。
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "mail-test")
  if (!limit.ok) return limit.response

  const config = {
    smtpConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    resendConfigured: !!process.env.RESEND_API_KEY,
    smtpHost: process.env.SMTP_HOST || null,
    smtpPort: process.env.SMTP_PORT || null,
    smtpUserSet: !!process.env.SMTP_USER,
    smtpPassSet: !!process.env.SMTP_PASS,
    smtpFrom: process.env.SMTP_FROM || null,
    alertEmailSet: !!process.env.ALERT_EMAIL,
  }

  const to = req.nextUrl.searchParams.get("to")?.trim() || ""
  if (!to) return NextResponse.json({ config })

  const result = await sendMail({
    to,
    subject: "【BondEx】メール送信テスト",
    text: "これは BondEx のメール送信疎通テストです。このメールが届けば設定は正常です。",
  })
  return NextResponse.json({ config, to, result })
}
