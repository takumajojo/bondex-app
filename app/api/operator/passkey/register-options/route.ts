import { attemptEmailCode, attemptMessage } from "@/lib/operator-email-challenge"
import { NextRequest, NextResponse } from "next/server"
import { generateRegistrationOptions } from "@simplewebauthn/server"
import { rateLimit } from "@/lib/rate-limit"
import { rpFrom, listPasskeys, operatorPasswordOk, operatorEmailAllowed } from "@/lib/operator-webauthn"
import {
  issueChallengeToken,
  OPERATOR_CHALLENGE_COOKIE,
  OPERATOR_EMAIL_CODE_COOKIE,
} from "@/lib/operator-session"

export const runtime = "nodejs"

/**
 * パスキー登録の第1段: 登録オプションを発行する。
 * 本人確認は「許可メールアドレス + メールで届く6桁コード」(2026-08-31 谷口さん指示)。
 * 運営パスワードでも通る (後方互換・機械用) が、UI はメール方式のみを出す。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "operator-auth")
  if (!limit.ok) return limit.response

  let body: { password?: unknown; email?: unknown; code?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const email = typeof body.email === "string" ? body.email.trim() : ""
  const code = typeof body.code === "string" ? body.code.trim() : ""
  // メールのコード (第1段: 確認だけ (verified))。試行の回数・無効化・1回限りは DB で数える (sql/077・lib/operator-email-challenge.ts)。
  // 運営のパスワードで入る従来の経路は変えない (パスワードがあればメールのコードは数えない)。
  const passwordOk = operatorPasswordOk(body.password)
  const attempt =
    !passwordOk && email !== "" && code !== "" && operatorEmailAllowed(email)
      ? await attemptEmailCode(req.cookies.get(OPERATOR_EMAIL_CODE_COOKIE)?.value, email, code, false)
      : null
  const emailOk = attempt === "ok"
  if (!emailOk && !passwordOk) {
    return NextResponse.json({ error: attemptMessage(attempt ?? "wrong") }, { status: attempt === "unavailable" ? 503 : 401 })
  }

  const { rpID } = rpFrom(req)
  const existing = await listPasskeys()
  const options = await generateRegistrationOptions({
    rpName: "BondEx Operator",
    rpID,
    userName: "bondex-operator",
    userDisplayName: "BondEx 運営",
    // 同じ端末の二重登録を防ぐ
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? undefined) as
        | ("usb" | "ble" | "nfc" | "internal" | "hybrid")[]
        | undefined,
    })),
    authenticatorSelection: {
      // platform = 端末内蔵 (Touch ID / Face ID)。USBキー等は用途外なので絞る
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required", // 生体 or 端末PINを必須にする
    },
  })

  const challengeToken = await issueChallengeToken(options.challenge)
  if (!challengeToken) {
    return NextResponse.json({ error: "OPERATOR_PASSWORD not configured" }, { status: 503 })
  }
  const res = NextResponse.json({ ok: true, options })
  res.cookies.set({
    name: OPERATOR_CHALLENGE_COOKIE,
    value: challengeToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 300,
  })
  return res
}
