import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { listHotelContactDue } from "@/lib/shipments-db"

export const runtime = "nodejs"

/** ホテル連絡の期限が来ている区間の id 一覧 (ダッシュボードのタイル絞り込み用)。 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "operator-board-stats")
  if (!limit.ok) return limit.response
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  const due = await listHotelContactDue(today)
  return NextResponse.json({ ok: true, ids: due.map((r) => r.id) })
}
