import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { bulkInsertLuggage, updateGroupLuggage } from "@/lib/group-luggage-db"
import { buildGroupView } from "@/lib/group-view"

export const runtime = "nodejs"

/**
 * 団体ダッシュボード API (運営用・middleware で operator 認証必須)。
 *
 *   GET   /api/groups/[bookingId]  — 団体メタ + 区間 + 個荷(導出ステータス付き) + サマリ
 *   PATCH /api/groups/[bookingId]  — 個荷1件の更新 { id, guestName?, trackingNumber?, manualStatus?, issueNote?, notes? }
 *   POST  /api/groups/[bookingId]  — 個荷の一括追加 { legIndex, names: string[] }
 */

const BOOKING_RE = /^BDX-[\dA-Z]+(-[\dA-Z]+)?$/i

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const limit = rateLimit(req, "groups-get")
  if (!limit.ok) return limit.response
  const { bookingId } = await params
  if (!BOOKING_RE.test(bookingId)) return NextResponse.json({ error: "invalid bookingId" }, { status: 400 })
  const r = await buildGroupView(bookingId.toUpperCase())
  if (r.status !== 200) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r.payload)
}

const MANUAL_STATUSES = ["pending", "issued", "picked_up", "in_transit", "delivered", "issue"] as const

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const limit = rateLimit(req, "groups-patch")
  if (!limit.ok) return limit.response
  const { bookingId } = await params
  if (!BOOKING_RE.test(bookingId)) return NextResponse.json({ error: "invalid bookingId" }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const id = typeof body.id === "string" ? body.id : ""
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (typeof body.guestName === "string") patch.guest_name = body.guestName.trim().slice(0, 80)
  if (body.trackingNumber !== undefined) {
    const tn = typeof body.trackingNumber === "string" ? body.trackingNumber.trim().slice(0, 40) : ""
    patch.tracking_number = tn || null
  }
  if (body.manualStatus !== undefined) {
    const ms = typeof body.manualStatus === "string" ? body.manualStatus : ""
    if (ms && !(MANUAL_STATUSES as readonly string[]).includes(ms)) {
      return NextResponse.json({ error: "invalid manualStatus" }, { status: 400 })
    }
    patch.manual_status = ms || null
  }
  if (body.issueNote !== undefined) {
    patch.issue_note = typeof body.issueNote === "string" ? body.issueNote.trim().slice(0, 500) || null : null
  }
  if (body.notes !== undefined) {
    patch.notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) || null : null
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "no fields" }, { status: 400 })

  const r = await updateGroupLuggage(id, patch)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const limit = rateLimit(req, "groups-post")
  if (!limit.ok) return limit.response
  const { bookingId } = await params
  if (!BOOKING_RE.test(bookingId)) return NextResponse.json({ error: "invalid bookingId" }, { status: 400 })

  let body: { legIndex?: unknown; names?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const legIndex = Math.max(0, Math.floor(Number(body.legIndex) || 0))
  const names = Array.isArray(body.names)
    ? body.names.filter((n): n is string => typeof n === "string").slice(0, 100)
    : []
  if (names.length === 0) return NextResponse.json({ error: "names required" }, { status: 400 })

  const r = await bulkInsertLuggage(bookingId.toUpperCase(), legIndex, names)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true, inserted: r.inserted })
}
