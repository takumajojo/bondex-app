import { NextRequest, NextResponse } from "next/server"
import { b2cGuard, str } from "@/lib/b2c/api-common"
import { searchPlaces } from "@/lib/places-search"
import { facilityStatuses } from "@/lib/b2c/booking-service"
import { placesMockEnabled } from "@/lib/places-mock"

export const runtime = "nodejs"

/**
 * POST /api/b2c/places { token, query, lang } — ホテルの候補（Google Places）に、BondEx の施設の確認の状態を付けて返す。
 * 受けないホテル（unsupported）は候補から外す。有効な入口の token が無いと使えない（有料の API の乱用を防ぐ）。
 */
export async function POST(req: NextRequest) {
  const g = await b2cGuard(req, "b2c-places")
  if (!g.ok) return g.res
  const query = str(g.body.query).slice(0, 100)
  const lang = g.body.lang === "ja" ? "ja" : "en"
  const result = await searchPlaces(query, lang)
  if (!result.ok) return NextResponse.json({ error: "search_failed", candidates: [] }, { status: 502 })
  const statuses = await facilityStatuses(result.candidates.map((c) => c.placeId))
  const candidates = result.candidates
    .map((c) => ({ ...c, status: statuses.get(c.placeId) ?? "unknown" }))
    .filter((c) => c.status !== "unsupported")
  // staging の架空のホテルを返している時は mock: true を付ける (画面・試験で見分ける。本番では付かない)
  return NextResponse.json(placesMockEnabled() ? { candidates, mock: true } : { candidates })
}
