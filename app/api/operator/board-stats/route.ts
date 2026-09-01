import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { countBoardViews, listHotelContactDue } from "@/lib/shipments-db"

export const runtime = "nodejs"

/**
 * 運営ダッシュボード「要対応」の件数 (サーバー側 count)。
 *
 * 2026-08-31 監査対応: 従来は最新500行のスナップショットをクライアントで集計しており、
 * 総行数が500を超えると古い行の課金失敗・郵送待ちが件数ごと静かに消えていた。
 * count クエリは全件が対象なので、件数がどれだけ増えても正確。
 * 認証は middleware の operator ゲート (既定deny) に乗る。
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "operator-board-stats")
  if (!limit.ok) return limit.response

  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10) // JST
  const counts = await countBoardViews(today)
  if (!counts) {
    return NextResponse.json({ error: "集計に失敗しました" }, { status: 500 })
  }
  // ホテル連絡の期限件数 (発送2営業日前判定。区間数でなく「連絡タスク数」で数える)
  const hotelDue = await listHotelContactDue(today)
  const hotelContact = hotelDue.reduce((acc, r) => acc + r.routes.length, 0)
  const hotelContactUrgent = hotelDue.reduce(
    (acc, r) => acc + r.routes.filter((x) => x.urgency !== "due").length,
    0,
  )
  return NextResponse.json({
    ok: true,
    today,
    counts: { ...counts, "hotel-contact": hotelContact },
    hotelContactUrgent,
  })
}
