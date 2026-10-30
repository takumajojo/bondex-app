import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { verifyOperatorSession, OPERATOR_SESSION_COOKIE } from "@/lib/operator-session"
import { routeLeadTime, type LeadTimeEndpoint } from "@/lib/lead-time-check"

export const runtime = "nodejs"

/**
 * 佐川の最短お届け日の照会 (予約入力画面用)。
 *
 *   GET /api/lead-time?from=<placeId|zip>&to=<placeId|zip>&shipmentDate=YYYY-MM-DD
 *   認証: 代理店 (Authorization: Bearer <Supabase access token>) または operator セッション
 *
 * 返り値: { days, earliestArrival, source, fromOffice, toOffice } / 不明なら { days: null }
 * 7桁の数字 (ハイフン可) は郵便番号、それ以外は Google Places の place_id とみなす。
 * 佐川への実照会は lib/sagawa-lead-time の resolveSagawaLeadTime 経由のみ (8秒タイムアウト・失敗時 null)。
 * middleware の公開許可リストに入れ、認証はこのルート内で行う (代理店JWT と operator の両対応のため)。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function toEndpoint(raw: string): LeadTimeEndpoint {
  const v = raw.trim()
  return /^\d{3}-?\d{4}$/.test(v) ? { zip: v } : { placeId: v }
}

async function isOperator(req: NextRequest): Promise<boolean> {
  if (await verifyOperatorSession(req.cookies.get(OPERATOR_SESSION_COOKIE)?.value)) return true
  const pw = process.env.OPERATOR_PASSWORD
  if (pw && req.headers.get("authorization") === `Bearer ${pw}`) return true
  // 開発環境で OPERATOR_PASSWORD 未設定なら middleware と同じく素通し
  return !pw && process.env.NODE_ENV !== "production"
}

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "lead-time")
  if (!limit.ok) return limit.response

  if (!(await isOperator(req)) && !(await resolveAgencyFromRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const sp = req.nextUrl.searchParams
  const from = sp.get("from") ?? ""
  const to = sp.get("to") ?? ""
  const shipmentDate = sp.get("shipmentDate") ?? ""
  if (!from.trim() || !to.trim() || !DATE_RE.test(shipmentDate)) {
    return NextResponse.json({ error: "from, to and shipmentDate (YYYY-MM-DD) are required" }, { status: 400 })
  }

  const lt = await routeLeadTime(toEndpoint(from), toEndpoint(to), shipmentDate)
  if (!lt) return NextResponse.json({ days: null })
  return NextResponse.json({
    days: lt.days,
    earliestArrival: lt.earliestArrival,
    source: lt.source,
    fromOffice: lt.fromOffice,
    toOffice: lt.toOffice,
  })
}
