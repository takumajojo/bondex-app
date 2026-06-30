import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import {
  listClaims,
  createClaim,
  updateClaim,
  type ClaimCategory,
  type ClaimStatus,
  type ReportedBy,
  type ClaimInsert,
} from "@/lib/claims-db"
import { isSupabaseConfigured } from "@/lib/supabase"

export const runtime = "nodejs"
export const maxDuration = 30

const CATEGORIES: ClaimCategory[] = ["damage", "loss", "delay", "wrong_delivery", "other"]
const STATUSES: ClaimStatus[] = ["open", "investigating", "resolved", "closed", "rejected"]
const REPORTED_BY: ReportedBy[] = ["agency", "traveler", "hotel", "bondex", "yamato"]

/**
 * GET /api/claims — クレーム一覧
 * POST /api/claims — 新規クレーム作成
 * PATCH /api/claims — 既存クレーム更新
 */

export async function GET(req: NextRequest) {
  try {
    const limit = rateLimit(req, "claims-list")
    if (!limit.ok) return limit.response
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ configured: false, claims: [] })
    }
    const sp = req.nextUrl.searchParams
    const items = await listClaims({
      status: (sp.get("status") as ClaimStatus) || undefined,
      bookingId: sp.get("booking_id") || undefined,
    })
    return NextResponse.json({ configured: true, claims: items })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ configured: false, claims: [], error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const limit = rateLimit(req, "claims-create")
    if (!limit.ok) return limit.response
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
    }
    const body = (await req.json()) as Record<string, unknown>

    const category = body.category as ClaimCategory
    if (!CATEGORIES.includes(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 })
    }
    const description = typeof body.description === "string" ? body.description.trim() : ""
    if (!description) {
      return NextResponse.json({ error: "description is required" }, { status: 400 })
    }

    const result = await createClaim({
      shipment_id: typeof body.shipment_id === "string" ? body.shipment_id : null,
      booking_id: typeof body.booking_id === "string" ? body.booking_id : null,
      leg_index: typeof body.leg_index === "number" ? body.leg_index : null,
      category,
      reported_by:
        typeof body.reported_by === "string" && REPORTED_BY.includes(body.reported_by as ReportedBy)
          ? (body.reported_by as ReportedBy)
          : null,
      reporter_name: typeof body.reporter_name === "string" ? body.reporter_name : null,
      reporter_contact: typeof body.reporter_contact === "string" ? body.reporter_contact : null,
      description,
      resolution: typeof body.resolution === "string" ? body.resolution : null,
      claim_amount_yen: typeof body.claim_amount_yen === "number" ? body.claim_amount_yen : null,
      yamato_case_number: typeof body.yamato_case_number === "string" ? body.yamato_case_number : null,
      status:
        typeof body.status === "string" && STATUSES.includes(body.status as ClaimStatus)
          ? (body.status as ClaimStatus)
          : "open",
      occurred_at: typeof body.occurred_at === "string" ? body.occurred_at : null,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
    return NextResponse.json({ ok: true, id: result.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const limit = rateLimit(req, "claims-update")
    if (!limit.ok) return limit.response
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
    }
    const body = (await req.json()) as Record<string, unknown>
    const id = typeof body.id === "string" ? body.id : ""
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

    // 受け取れるフィールドだけホワイトリスト的に通す
    const patch: Record<string, unknown> = {}
    if (typeof body.status === "string" && STATUSES.includes(body.status as ClaimStatus)) {
      patch.status = body.status
    }
    if (typeof body.resolution === "string") patch.resolution = body.resolution
    if (typeof body.description === "string") patch.description = body.description
    if (typeof body.claim_amount_yen === "number") patch.claim_amount_yen = body.claim_amount_yen
    if (typeof body.yamato_case_number === "string")
      patch.yamato_case_number = body.yamato_case_number
    if (typeof body.reporter_contact === "string") patch.reporter_contact = body.reporter_contact

    const result = await updateClaim(id, patch as Partial<ClaimInsert>)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
