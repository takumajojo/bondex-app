import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * 運営(operator)ゲート — 既定deny(default-deny)。
 *
 * matcher で /operator/* と /api/* の全リクエストを middleware に通し、
 * 下の「公開ルート許可リスト」に該当しないものは すべて OPERATOR_PASSWORD 認証を要求する。
 * これにより「新しい運営ルートを追加したのに許可リストへ入れ忘れて無認証公開になる」事故を防ぐ
 * (新ルートは既定で保護される。公開したいものだけ明示的に許可リストへ足す)。
 *
 * 認証方式:
 *  - cookie `bondex_op_auth` が OPERATOR_PASSWORD と一致 → 通過
 *  - Authorization: Bearer <OPERATOR_PASSWORD> → 通過 (CLI/curl・サーバ内 self-call 用)
 *  - 不一致 (ページ) → /operator/login にリダイレクト / (API) → 401
 * 本番で OPERATOR_PASSWORD 未設定なら 503 (fail closed)。開発は素通し。
 */

const COOKIE_NAME = "bondex_op_auth"

// operator 認証が不要な公開ルート。これ以外の /operator/* と /api/* は既定で認証必須。
//  - /api/agency/*  代理店の Supabase JWT で各ルートが自前認証
//  - /api/track/*   公開追跡 (token-free)
//  - /api/stripe/*  代理店 JWT
//  - /api/cron/*    CRON_SECRET で自前認証
//  - /api/demo/*    登録前デモ (公開)
// ※ /api/photos/* と /api/analyze-luggage はレガシー(プロト /wireframes 用)。未認証アップロードXSS/
//    有料API濫用の懸念があり本番導線外のため、公開から外して既定(operator認証必須)に戻した(2026-08-24)。
const PUBLIC_PREFIXES = [
  "/api/agency/",
  "/api/track/",
  "/api/stripe/",
  "/api/cron/",
  "/api/demo/",
]
const PUBLIC_EXACT = new Set<string>([
  "/operator/login", // ログイン画面自体は公開(無限ループ防止)
  "/api/operator/auth", // ログイン処理
  "/api/operator/logout",
  "/api/contact", // LPの問い合わせ
  "/api/howto", // 公開ガイドPDF
  "/api/email", // レガシー(プロト用)
  "/api/places", // レガシー(プロト用)
  "/api/places/staticmap", // レガシー(プロト用)
])

function isPublicPath(path: string): boolean {
  if (PUBLIC_EXACT.has(path)) return true
  return PUBLIC_PREFIXES.some((p) => path.startsWith(p))
}

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname

  // 公開ルートは素通し。それ以外の /operator/* と /api/* は既定で operator 認証必須(default-deny)。
  if (isPublicPath(path)) return NextResponse.next()

  const expected = process.env.OPERATOR_PASSWORD
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "OPERATOR_PASSWORD is not configured" }, { status: 503 })
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
  loginUrl.searchParams.set("next", path) // path は必ず /operator/* なのでオープンリダイレクトにならない
  return NextResponse.redirect(loginUrl)
}

export const config = {
  // /operator/* と /api/* の全リクエストを通す(公開判定は middleware 内の許可リストで行う)。
  matcher: ["/operator/:path*", "/api/:path*"],
}
