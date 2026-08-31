import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { listPasskeys } from "@/lib/operator-webauthn"
import {
  issueOperatorSession,
  OPERATOR_SESSION_COOKIE,
  OPERATOR_SESSION_TTL_SEC,
} from "@/lib/operator-session"

export const runtime = "nodejs"

/**
 * 運営のパスワードログイン (2026-08-31 パスキー導入で役割を縮小)。
 *
 * - パスキーが1台でも登録済み: ブラウザからの入場は生体認証必須のため、ここは 403 を返す
 *   (パスワードは「新しい端末の登録時の本人確認」と Bearer サーバー間通信の専用に)。
 *   緊急ロックアウト時のみ Vercel で OPERATOR_ALLOW_PASSWORD=true を一時設定して復旧する。
 * - パスキー未登録 (初期状態): 従来どおりパスワードで入場できる (ブートストラップ)。
 *   発行する cookie は旧「生パスワード」ではなく署名付き12時間トークン。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "operator-auth")
  if (!limit.ok) return limit.response

  const expected = process.env.OPERATOR_PASSWORD
  if (!expected) {
    return NextResponse.json({ error: "OPERATOR_PASSWORD not configured" }, { status: 503 })
  }

  let body: { password?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const password = typeof body.password === "string" ? body.password : ""

  if (password !== expected) {
    return NextResponse.json({ error: "Password doesn't match" }, { status: 401 })
  }

  const allowPassword = process.env.OPERATOR_ALLOW_PASSWORD === "true"
  if (!allowPassword) {
    const passkeys = await listPasskeys()
    if (passkeys.length > 0) {
      return NextResponse.json(
        {
          error: "PASSKEY_REQUIRED",
          message:
            "この管理画面は生体認証 (Touch ID / Face ID) 必須です。登録済みの端末でサインインするか、この端末を登録してください。",
        },
        { status: 403 },
      )
    }
  }

  const token = await issueOperatorSession()
  if (!token) {
    return NextResponse.json({ error: "session secret unavailable" }, { status: 503 })
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
  return res
}
