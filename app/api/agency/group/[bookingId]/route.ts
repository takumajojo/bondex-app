import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { updateGroupLuggage, listGroupLuggage } from "@/lib/group-luggage-db"
import { buildGroupView } from "@/lib/group-view"

export const runtime = "nodejs"

/**
 * 団体ダッシュボード API (代理店用・Supabase JWT で自社予約のみ)。
 *
 *   GET   /api/agency/group/[bookingId]  — 自社の団体ビュー
 *   PATCH /api/agency/group/[bookingId]  — 個荷の限定更新 { id, guestName?, notes? }
 *     (追跡番号の付け替え・手動ステータスは運営のみ)
 */

const BOOKING_RE = /^BDX-[\dA-Z]+(-[\dA-Z]+)?$/i

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const limit = rateLimit(req, "agency-group-get")
  if (!limit.ok) return limit.response
  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { bookingId } = await params
  if (!BOOKING_RE.test(bookingId)) return NextResponse.json({ error: "invalid bookingId" }, { status: 400 })

  const r = await buildGroupView(bookingId.toUpperCase())
  if (r.status !== 200) return NextResponse.json({ error: r.error }, { status: r.status })
  // 自社の予約のみ (他社の booking_id を叩かれても見せない)
  if (r.payload.agency !== auth.agency.name) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  return NextResponse.json(r.payload)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const limit = rateLimit(req, "agency-group-patch")
  if (!limit.ok) return limit.response
  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { bookingId } = await params
  if (!BOOKING_RE.test(bookingId)) return NextResponse.json({ error: "invalid bookingId" }, { status: 400 })
  const bid = bookingId.toUpperCase()

  // 所有権チェック: この予約が自社のものか
  const view = await buildGroupView(bid)
  if (view.status !== 200 || view.payload.agency !== auth.agency.name) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const id = typeof body.id === "string" ? body.id : ""
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
  // id がこの予約の個荷であることを確認 (他予約の荷物を書き換えさせない)
  const own = (await listGroupLuggage(bid)).some((l) => l.id === id)
  if (!own) return NextResponse.json({ error: "not found" }, { status: 404 })

  const patch: Record<string, unknown> = {}
  if (typeof body.guestName === "string") patch.guest_name = body.guestName.trim().slice(0, 80)
  if (body.notes !== undefined) {
    patch.notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) || null : null
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "no fields" }, { status: 400 })

  const r = await updateGroupLuggage(id, patch)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true })
}
