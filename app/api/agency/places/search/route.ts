import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { searchPlaces } from "@/lib/places-search"

export const runtime = "nodejs"

/**
 * Google Places ベースのホテル候補検索 (代理店用)。
 *
 *   POST /api/agency/places/search   { query, lang? }
 *   Authorization: Bearer <Supabase access token>
 *
 * /api/agency/* は middleware の OPERATOR_PASSWORD 対象外なので、ここで代理店 JWT を検証する。
 * 検索ロジックは運営と共通 (lib/places-search.ts)。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "agency-places-search")
  if (!limit.ok) return limit.response

  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized", candidates: [] }, { status: 401 })
  // 承認待ち・停止中は外部課金APIを叩かせない (未承認アカウントによる quota 濫用の防止)
  if (auth.agency.status === "pending" || auth.agency.status === "suspended") {
    return NextResponse.json({ error: "Account not active", candidates: [] }, { status: 403 })
  }

  let body: { query?: unknown; lang?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON", candidates: [] }, { status: 400 })
  }
  const query = typeof body.query === "string" ? body.query : ""
  const lang: "ja" | "en" = body.lang === "en" ? "en" : "ja"

  const result = await searchPlaces(query, lang)
  if (!result.ok) {
    return NextResponse.json({ error: result.error, candidates: [] }, { status: result.status })
  }
  return NextResponse.json({ candidates: result.candidates })
}
