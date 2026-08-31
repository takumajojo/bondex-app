import { NextRequest, NextResponse } from "next/server"
import { generateRegistrationOptions } from "@simplewebauthn/server"
import { rateLimit } from "@/lib/rate-limit"
import { rpFrom, listPasskeys, operatorPasswordOk } from "@/lib/operator-webauthn"
import { issueChallengeToken, OPERATOR_CHALLENGE_COOKIE } from "@/lib/operator-session"

export const runtime = "nodejs"

/**
 * パスキー登録の第1段: 登録オプションを発行する。
 * 端末登録は「パスワードによる本人確認」を毎回要求する (middleware の公開ルートに
 * 載っているため、このパスワード検証が唯一のゲート)。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "operator-auth")
  if (!limit.ok) return limit.response

  let body: { password?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!operatorPasswordOk(body.password)) {
    return NextResponse.json({ error: "パスワードが一致しません" }, { status: 401 })
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
