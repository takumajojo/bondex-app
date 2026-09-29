import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"

export const runtime = "nodejs"

/**
 * GET /api/operator/change-requests
 *   運営専用 (middleware で認証)。変更申請の一覧。
 *   query:
 *     status?   = pending(既定) | approved | rejected | all
 *     booking_id? = 予約単位で絞り込み (予約詳細ページ用)
 *
 * 返り値: { requests: ChangeRequestRow[] }  新しい順。
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "change-requests-list")
  if (!limit.ok) return limit.response

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })

  const { searchParams } = new URL(req.url)
  const status = (searchParams.get("status") || "pending").trim()
  const bookingId = (searchParams.get("booking_id") || "").trim()

  let q = sb.from("shipment_change_requests").select("*").order("created_at", { ascending: false })
  if (status !== "all") q = q.eq("status", status)
  if (bookingId) q = q.eq("booking_id", bookingId)

  const { data, error } = await q.limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data ?? [] })
}
