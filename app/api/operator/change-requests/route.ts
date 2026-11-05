import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { canSeeB2cPii, isB2cBookingId } from "@/lib/b2c/pii-guard"
import { requireOperator } from "@/lib/operator-authz"

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
  const denied = await requireOperator(req) // ハンドラーでも認可（middleware と同じ条件・lib/operator-authz.ts）
  if (denied) return denied

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
  // B2C の区間の変更の中身（名前などが入りうる fields・自由記入）は、個人のパスキーの運営者にだけ（lib/b2c/pii-guard.ts）。
  // 他の運営者には、件数と状態が分かる項目だけを返す。
  const canSee = await canSeeB2cPii(req)
  const KEEP = new Set(["id", "shipment_id", "booking_id", "leg_index", "status", "kind", "stage", "requested_by", "created_at", "decided_at", "needs_sagawa"])
  const requests = (data ?? []).map((r) =>
    canSee || !isB2cBookingId(r.booking_id) ? r : { ...Object.fromEntries(Object.entries(r).filter(([k]) => KEEP.has(k))), b2c_pii_hidden: true },
  )
  return NextResponse.json({ requests })
}
