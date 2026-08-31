import { NextRequest, NextResponse } from "next/server"
import { generateRegistrationOptions } from "@simplewebauthn/server"
import { rateLimit } from "@/lib/rate-limit"
import { rpFrom, listPasskeys, operatorPasswordOk, operatorEmailAllowed } from "@/lib/operator-webauthn"
import {
  issueChallengeToken,
  verifyEmailCodeToken,
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
  const emailOk =
    email !== "" &&
    code !== "" &&
    operatorEmailAllowed(email) &&
    (await verifyEmailCodeToken(req.cookies.get(OPERATOR_EMAIL_CODE_COOKIE)?.value, email, code))
  if (!emailOk && !operatorPasswordOk(body.password)) {
    return NextResponse.json(
      { error: "認証コードが正しくないか、有効期限が切れています。もう一度コードを送信してください。" },
      { status: 401 },
    )
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
