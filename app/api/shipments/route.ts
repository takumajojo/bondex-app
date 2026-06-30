import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import {
  listShipments,
  updateShipmentStatus,
  type ShipmentStatus,
} from "@/lib/shipments-db"
import { isSupabaseConfigured } from "@/lib/supabase"

export const runtime = "nodejs"

const VALID_STATUSES: ShipmentStatus[] = [
  "pending",
  "issued",
  "picked_up",
  "in_transit",
  "delivered",
  "failed",
  "cancelled",
]

/**
 * GET /api/shipments — ダッシュボード一覧
 *   query: agency, status, fromDate, toDate, limit
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "shipments-list")
  if (!limit.ok) return limit.response

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured", shipments: [], configured: false },
      { status: 200 },
    )
  }

  const sp = req.nextUrl.searchParams
  const data = await listShipments({
    agency: sp.get("agency") || undefined,
    status: (sp.get("status") as ShipmentStatus) || undefined,
    fromDate: sp.get("fromDate") || undefined,
    toDate: sp.get("toDate") || undefined,
    limit: sp.get("limit") ? Math.min(500, Number(sp.get("limit"))) : 100,
  })
  return NextResponse.json({ configured: true, shipments: data })
}

/**
 * PATCH /api/shipments — ステータス手動更新
 *   body: { id: string, status: ShipmentStatus }
 */
export async function PATCH(req: NextRequest) {
  const limit = rateLimit(req, "shipments-update")
  if (!limit.ok) return limit.response

  let body: { id?: unknown; status?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const id = typeof body.id === "string" ? body.id : ""
  const status = body.status as ShipmentStatus
  if (!id || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "id and valid status required" }, { status: 400 })
  }
  const r = await updateShipmentStatus(id, status)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true })
}
