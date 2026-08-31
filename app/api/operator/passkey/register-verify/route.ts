import { NextRequest, NextResponse } from "next/server"
import { verifyRegistrationResponse } from "@simplewebauthn/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { rpFrom, encodePublicKey, operatorPasswordOk } from "@/lib/operator-webauthn"
import {
  issueOperatorSession,
  verifyChallengeToken,
  OPERATOR_CHALLENGE_COOKIE,
  OPERATOR_SESSION_COOKIE,
  OPERATOR_SESSION_TTL_SEC,
} from "@/lib/operator-session"

export const runtime = "nodejs"

/** パスキー登録の第2段: 端末が作った資格情報を検証して保存し、そのまま入場させる。 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "operator-auth")
  if (!limit.ok) return limit.response

  let body: { password?: unknown; attestation?: unknown; label?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!operatorPasswordOk(body.password)) {
    return NextResponse.json({ error: "パスワードが一致しません" }, { status: 401 })
  }
  const challenge = await verifyChallengeToken(req.cookies.get(OPERATOR_CHALLENGE_COOKIE)?.value)
  if (!challenge) {
    return NextResponse.json(
      { error: "チャレンジの有効期限が切れました。もう一度お試しください。" },
      { status: 400 },
    )
  }

  const { rpID, origin } = rpFrom(req)
  let verification
  try {
    verification = await verifyRegistrationResponse({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response: body.attestation as any,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    })
  } catch (e) {
    return NextResponse.json(
      { error: `登録を検証できませんでした: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 400 },
    )
  }
  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "登録を検証できませんでした" }, { status: 400 })
  }

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  const cred = verification.registrationInfo.credential
  const label = typeof body.label === "string" ? body.label.slice(0, 60) : null
  const { error } = await sb.from("operator_passkeys").insert({
    credential_id: cred.id,
    public_key: encodePublicKey(cred.publicKey),
    counter: cred.counter,
    transports: cred.transports ?? null,
    label,
  })
  if (error) {
    return NextResponse.json({ error: `保存に失敗しました: ${error.message}` }, { status: 500 })
  }

  const token = await issueOperatorSession()
  const res = NextResponse.json({ ok: true })
  if (token) {
    res.cookies.set({
      name: OPERATOR_SESSION_COOKIE,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: OPERATOR_SESSION_TTL_SEC,
    })
  }
  res.cookies.set({ name: OPERATOR_CHALLENGE_COOKIE, value: "", path: "/", maxAge: 0 })
  return res
}
