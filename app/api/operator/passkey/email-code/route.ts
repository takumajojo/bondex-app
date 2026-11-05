import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { sendMail, mailerConfigured } from "@/lib/mailer"
import { operatorEmailAllowed } from "@/lib/operator-webauthn"
import { OPERATOR_EMAIL_CODE_COOKIE } from "@/lib/operator-session"
import { issueEmailChallenge, newEmailCode } from "@/lib/operator-email-challenge"

export const runtime = "nodejs"

/**
 * パスキー登録の本人確認コードをメール送信する (2026-08-31 谷口さん指示: メアドと指紋で)。
 * - 許可リスト外のメールにも「送信しました」と同じ応答を返す (アカウント列挙の防止)。
 *   実際のコードは許可されたアドレスにしか送らない。
 * - コードは cookie にも DB にも載せず、DB にはコードの HMAC だけを保存する (2026-11-04 Stage 6 B2・sql/077)。
 *   試行の回数 (5回で無効)・1回限り・送り直しでの回数の引き継ぎは DB の関数が決める (lib/operator-email-challenge.ts)。
 * - 同じメールに出すコードは 60分に 5回まで。5回間違えて止まったメールには 60分出さない (許可外のメールも同じ扱い)。
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
  const code = newEmailCode()
  const allowed = operatorEmailAllowed(email)
  // 先に DB に記録する (許可外のメールも、知り得ないコードで同じように記録して応答を揃える)
  const issued = await issueEmailChallenge(email, allowed ? code : newEmailCode() + "x")
  if (!issued.ok) {
    if (issued.reason === "unavailable") {
      return NextResponse.json({ error: "認証の処理ができませんでした。時間をおいて再度お試しください。" }, { status: 503 })
    }
    return NextResponse.json(
      { error: "このメールアドレスへの認証コードの送信を一時的に止めています。60分ほど時間をおいてから、もう一度お試しください。" },
      { status: 429 },
    )
  }
  if (allowed) {
    const r = await sendMail({
      to: email,
      // 件名にはコードを入れない（ロック画面の通知・メールの一覧・ログに出るため。2026-11-06）。コードは本文にだけ
      subject: "【BondEx 運営】ログイン認証コードのお知らせ",
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

  // 許可外でも同じ応答 (記録のコードは知り得ないので照合は必ず失敗する)
  const token = issued.cookie
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
