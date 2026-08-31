import { NextRequest, NextResponse } from "next/server"
import { generateAuthenticationOptions } from "@simplewebauthn/server"
import { rateLimit } from "@/lib/rate-limit"
import { rpFrom, listPasskeys } from "@/lib/operator-webauthn"
import { issueChallengeToken, OPERATOR_CHALLENGE_COOKIE } from "@/lib/operator-session"

export const runtime = "nodejs"

/**
 * パスキーログインの第1段: 認証オプションを発行する。
 * registered=false のときはフロントが「まずパスワードで端末登録」導線を出す。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "operator-auth")
  if (!limit.ok) return limit.response

  const { rpID } = rpFrom(req)
  const creds = await listPasskeys()
  if (creds.length === 0) {
    return NextResponse.json({ ok: true, registered: false })
  }
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: creds.map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? undefined) as
        | ("usb" | "ble" | "nfc" | "internal" | "hybrid")[]
        | undefined,
    })),
  })
  const challengeToken = await issueChallengeToken(options.challenge)
  if (!challengeToken) {
    return NextResponse.json({ error: "OPERATOR_PASSWORD not configured" }, { status: 503 })
  }
  const res = NextResponse.json({ ok: true, registered: true, options })
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
