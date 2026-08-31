import { NextRequest, NextResponse } from "next/server"
import { verifyAuthenticationResponse } from "@simplewebauthn/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { rpFrom, listPasskeys, decodePublicKey } from "@/lib/operator-webauthn"
import {
  issueOperatorSession,
  verifyChallengeToken,
  OPERATOR_CHALLENGE_COOKIE,
  OPERATOR_SESSION_COOKIE,
  OPERATOR_SESSION_TTL_SEC,
} from "@/lib/operator-session"

export const runtime = "nodejs"

/** パスキーログインの第2段: 生体認証の結果を検証してセッションを発行する。 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "operator-auth")
  if (!limit.ok) return limit.response

  let body: { assertion?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const challenge = await verifyChallengeToken(req.cookies.get(OPERATOR_CHALLENGE_COOKIE)?.value)
  if (!challenge) {
    return NextResponse.json(
      { error: "チャレンジの有効期限が切れました。もう一度お試しください。" },
      { status: 400 },
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assertion = body.assertion as any
  const credId: string = assertion?.id ?? ""
  const creds = await listPasskeys()
  const cred = creds.find((c) => c.credential_id === credId)
  if (!cred) {
    return NextResponse.json({ error: "この端末のパスキーは登録されていません" }, { status: 401 })
  }

  const { rpID, origin } = rpFrom(req)
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: cred.credential_id,
        publicKey: decodePublicKey(cred.public_key),
        counter: cred.counter,
        transports: (cred.transports ?? undefined) as
          | ("usb" | "ble" | "nfc" | "internal" | "hybrid")[]
          | undefined,
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: `認証に失敗しました: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 401 },
    )
  }
  if (!verification.verified) {
    return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 })
  }

  // counter 更新 (クローン検知の材料)。失敗しても入場は通す (best-effort)
  const sb = getSupabase()
  if (sb) {
    await sb
      .from("operator_passkeys")
      .update({
        counter: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString(),
      })
      .eq("credential_id", cred.credential_id)
  }

  const token = await issueOperatorSession()
  if (!token) {
    return NextResponse.json({ error: "OPERATOR_PASSWORD not configured" }, { status: 503 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: OPERATOR_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: OPERATOR_SESSION_TTL_SEC,
  })
  res.cookies.set({ name: OPERATOR_CHALLENGE_COOKIE, value: "", path: "/", maxAge: 0 })
  return res
}
