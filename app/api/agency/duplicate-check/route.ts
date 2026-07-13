import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { findDuplicateBookings } from "@/lib/shipments-db"

export const runtime = "nodejs"

/**
 * 代理店の二重依頼チェック (自社内)。
 *
 *   POST /api/agency/duplicate-check   { names: string[], dates: string[] }
 *   Authorization: Bearer <Supabase access token>
 *   → { matches: [...] }
 *
 * 同じ代表者/受取人名 + 同じ発送日の、自社の既存予約 (キャンセル除く) を返す。
 * 登録を止めるものではなく「それでも登録するか」を確認させる警告用。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "agency-dup-check")
  if (!limit.ok) return limit.response

  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized", matches: [] }, { status: 401 })

  let body: { names?: unknown; dates?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON", matches: [] }, { status: 400 })
  }
  const names = Array.isArray(body.names)
    ? body.names.filter((n): n is string => typeof n === "string").slice(0, 10)
    : []
  const dates = Array.isArray(body.dates)
    ? body.dates.filter((d): d is string => typeof d === "string").slice(0, 10)
    : []

  try {
    const matches = await findDuplicateBookings({ names, dates, agency: auth.agency.name })
    return NextResponse.json({ matches })
  } catch (err) {
    console.error("[agency-dup-check] failed:", err instanceof Error ? err.message : err)
    return NextResponse.json({ matches: [] })
  }
}
