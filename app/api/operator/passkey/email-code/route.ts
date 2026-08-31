import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { sendMail, mailerConfigured } from "@/lib/mailer"
import { operatorEmailAllowed } from "@/lib/operator-webauthn"
import { issueEmailCodeToken, OPERATOR_EMAIL_CODE_COOKIE } from "@/lib/operator-session"

export const runtime = "nodejs"

/**
 * パスキー登録の本人確認コードをメール送信する (2026-08-31 谷口さん指示: メアドと指紋で)。
 * - 許可リスト外のメールにも「送信しました」と同じ応答を返す (アカウント列挙の防止)。
 *   実際のコードは許可されたアドレスにしか送らない。
 * - コードは cookie に載せず HMAC 署名のみ保存 (盗聴・cookie窃取に耐える)。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "operator-email-code")
  if (!limit.ok) return limit.response

  let body: { email?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const email = typeof body.email === "string" ? body.email.trim() : ""
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 })
  }
  if (!mailerConfigured()) {
    return NextResponse.json(
      { error: "メール送信が未設定です (SMTP / RESEND_API_KEY)。BondEx 開発者にご連絡ください。" },
      { status: 503 },
    )
  }

  // 6桁コード生成 (暗号乱数)
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  const code = String(buf[0] % 1_000_000).padStart(6, "0")

  const allowed = operatorEmailAllowed(email)
  if (allowed) {
    const r = await sendMail({
      to: email,
      subject: `【BondEx 運営】認証コード ${code}`,
      text: [
        "BondEx 管理画面の端末登録用の認証コードです。",
        "",
        `認証コード: ${code}`,
        "",
        "有効期限は10分です。心当たりがない場合はこのメールを無視してください。",
      ].join("\n"),
    })
    if (!r.sent) {
      return NextResponse.json(
        { error: "メールを送信できませんでした。時間をおいて再度お試しください。" },
        { status: 502 },
      )
    }
  }

  // 許可外でも同じ応答 + 無効な署名cookie (コードを知り得ないので検証は必ず失敗する)
  const token = await issueEmailCodeToken(email, allowed ? code : `denied-${code}`)
  if (!token) {
    return NextResponse.json({ error: "サーバー設定が不完全です" }, { status: 503 })
  }
  const res = NextResponse.json({ ok: true, sent: true })
  res.cookies.set({
    name: OPERATOR_EMAIL_CODE_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  })
  return res
}
