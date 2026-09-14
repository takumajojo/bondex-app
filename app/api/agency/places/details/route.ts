import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { getPlaceNameByLang } from "@/lib/places-search"

export const runtime = "nodejs"

/**
 * place_id からホテルの和名・英名を取得する (代理店のホテル変更モーダル用)。
 *
 *   POST /api/agency/places/details   { placeId }
 *   Authorization: Bearer <Supabase access token>
 *   → { placeId, nameJa, nameEn }
 *
 * 市区・都道府県は検索候補(/api/agency/places/search)側で取得済みのため、ここでは名前のみ返す。
 * /api/agency/* は middleware の OPERATOR_PASSWORD 対象外なので、ここで代理店 JWT を検証する。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "agency-places-details")
  if (!limit.ok) return limit.response

  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // 承認待ち・停止中は外部課金APIを叩かせない (未承認アカウントによる quota 濫用の防止)
  if (auth.agency.status === "pending" || auth.agency.status === "suspended") {
    return NextResponse.json({ error: "Account not active" }, { status: 403 })
  }

  let body: { placeId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const placeId = typeof body.placeId === "string" ? body.placeId.trim() : ""
  if (!placeId) return NextResponse.json({ error: "placeId required" }, { status: 400 })

  const [nameJa, nameEn] = await Promise.all([
    getPlaceNameByLang(placeId, "ja"),
    getPlaceNameByLang(placeId, "en"),
  ])
  return NextResponse.json({ placeId, nameJa: nameJa ?? "", nameEn: nameEn ?? "" })
}
