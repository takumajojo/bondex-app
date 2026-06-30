import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * Auth gate for /operator and /api/itinerary/parse.
 *
 * 環境変数 OPERATOR_PASSWORD で保護。
 *  - cookie `bondex_op_auth` が一致 → 通過
 *  - Authorization: Bearer <password> → 通過 (CLI/curl 用)
 *  - 不一致 (ページ) → /operator/login にリダイレクト
 *  - 不一致 (API) → 401
 *
 * 本番で OPERATOR_PASSWORD 未設定だと 503 を返す (fail closed)。
 * 開発環境では未設定でもゲートを通す (ローカル動作確認のため)。
 */

const COOKIE_NAME = "bondex_op_auth"

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname
  const expected = process.env.OPERATOR_PASSWORD

  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "OPERATOR_PASSWORD is not configured" },
        { status: 503 },
      )
    }
    return NextResponse.next()
  }

  const cookieValue = req.cookies.get(COOKIE_NAME)?.value
  if (cookieValue === expected) return NextResponse.next()

  const authHeader = req.headers.get("authorization")
  if (authHeader === `Bearer ${expected}`) return NextResponse.next()

  if (path.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const loginUrl = new URL("/operator/login", req.url)
  loginUrl.searchParams.set("next", path)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  // /operator/login は除外して無限ループを防ぐ
  matcher: [
    "/operator",
    "/operator/dashboard",
    "/api/itinerary/parse",
    "/api/address/verify",
    "/api/voucher/generate",
    "/api/shipandco/create",
    "/api/places/search",
    "/api/shipments",
    "/api/invoices/generate",
    "/api/agencies",
    "/api/voucher/regenerate",
    "/operator/claims",
    "/api/claims",
    "/api/contracts/generate",
    // /agency/* と /track/* と /api/track/* は public (代理店は Supabase Auth で、track は token-free)
  ],
}
