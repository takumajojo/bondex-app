import { attemptEmailCode, attemptMessage } from "@/lib/operator-email-challenge"
import { NextRequest, NextResponse } from "next/server"
import { verifyRegistrationResponse } from "@simplewebauthn/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { rpFrom, encodePublicKey, operatorPasswordOk, operatorEmailAllowed, deviceLabelFromUA } from "@/lib/operator-webauthn"
import {
  issueOperatorSession,
  verifyChallengeToken,
  OPERATOR_CHALLENGE_COOKIE,
  OPERATOR_EMAIL_CODE_COOKIE,
  OPERATOR_SESSION_COOKIE,
  OPERATOR_SESSION_TTL_SEC,
} from "@/lib/operator-session"

export const runtime = "nodejs"

/** パスキー登録の第2段: 端末が作った資格情報を検証して保存し、そのまま入場させる。 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "operator-auth")
  if (!limit.ok) return limit.response

  let body: { password?: unknown; email?: unknown; code?: unknown; attestation?: unknown; label?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const email = typeof body.email === "string" ? body.email.trim() : ""
  const code = typeof body.code === "string" ? body.code.trim() : ""
  // メールのコード (第2段: 使い切る (used・以後は使えない))。試行の回数・無効化・1回限りは DB で数える (sql/077・lib/operator-email-challenge.ts)。
  // 運営のパスワードで入る従来の経路は変えない (パスワードがあればメールのコードは数えない)。
  const passwordOk = operatorPasswordOk(body.password)
  const attempt =
    !passwordOk && email !== "" && code !== "" && operatorEmailAllowed(email)
      ? await attemptEmailCode(req.cookies.get(OPERATOR_EMAIL_CODE_COOKIE)?.value, email, code, true)
      : null
  const emailOk = attempt === "ok"
  if (!emailOk && !passwordOk) {
    return NextResponse.json({ error: attemptMessage(attempt ?? "wrong") }, { status: attempt === "unavailable" ? 503 : 401 })
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
  // 端末名は手入力を廃止し User-Agent から自動判定 (メール認証ならメールも添える)
  const autoLabel = deviceLabelFromUA(req.headers.get("user-agent"))
  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.slice(0, 60)
      : emailOk
        ? `${autoLabel} — ${email}`.slice(0, 60)
        : autoLabel
  const row: Record<string, unknown> = {
    credential_id: cred.id,
    public_key: encodePublicKey(cred.publicKey),
    counter: cred.counter,
    transports: cred.transports ?? null,
    label,
  }
  // メールのワンタイムコードで本人を確かめた登録だけ、運営者 ID (メールアドレス) を結びつける。
  // B2C の手作業はこの ID のあるパスキーでしか行えない (docs/b2c/B2C_MVP_SCHEMA_v1.md 7章)。
  // operator_email の列は sql/061 で足す。列がまだ無い DB では、従来どおりの行だけを保存する。
  let { error } = await sb
    .from("operator_passkeys")
    .insert(emailOk ? { ...row, operator_email: email.toLowerCase() } : row)
  if (error && emailOk && /operator_email/.test(error.message) && /does not exist|column/i.test(error.message)) {
    ;({ error } = await sb.from("operator_passkeys").insert(row))
  }
  if (error) {
    return NextResponse.json({ error: `保存に失敗しました: ${error.message}` }, { status: 500 })
  }

  const token = await issueOperatorSession(cred.id)
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
  res.cookies.set({ name: OPERATOR_EMAIL_CODE_COOKIE, value: "", path: "/", maxAge: 0 })
  return res
}
