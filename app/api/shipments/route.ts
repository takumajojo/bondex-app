import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import {
  listShipments,
  updateShipmentStatus,
  updateShipmentFields,
  setBookingDriveUrl,
  deleteBooking,
  type ShipmentStatus,
} from "@/lib/shipments-db"
import { isSupabaseConfigured } from "@/lib/supabase"

export const runtime = "nodejs"
export const maxDuration = 30

const VALID_STATUSES: ShipmentStatus[] = [
  "requested",
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
  try {
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
      search: sp.get("search") || undefined,
      limit: sp.get("limit") ? Math.min(500, Number(sp.get("limit"))) : 100,
    })
    return NextResponse.json({ configured: true, shipments: data })
  } catch (err) {
    // どんなエラーでも JSON で返す (フロントの parse 失敗を防ぐ)
    const msg = err instanceof Error ? err.message : "Internal error"
    console.error("[api/shipments] GET failed:", msg)
    return NextResponse.json(
      { error: msg, shipments: [], configured: false },
      { status: 500 },
    )
  }
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * PATCH /api/shipments — ステータス / 運用フィールドの更新
 *   body: { id: string, status?: ShipmentStatus,
 *           shipmentDate?: "YYYY-MM-DD", expectedArrival?: "YYYY-MM-DD",
 *           suitcaseCount?: number, notes?: string }
 * 注: ホテル・氏名は編集不可 (発行済み送り状と食い違う事故を防ぐため、
 *     その場合は削除して再発行する運用)。
 */
export async function PATCH(req: NextRequest) {
  const limit = rateLimit(req, "shipments-update")
  if (!limit.ok) return limit.response

  let body: {
    id?: unknown
    status?: unknown
    shipmentDate?: unknown
    expectedArrival?: unknown
    suitcaseCount?: unknown
    notes?: unknown
    bookingId?: unknown
    driveUrl?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // 予約単位の Drive URL 登録 (id 不要・booking_id で全区間更新)
  if (body.driveUrl !== undefined) {
    const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim() : ""
    if (!/^BDX-[\dA-Z]+-[\dA-Z]+$/i.test(bookingId)) {
      return NextResponse.json({ error: "invalid bookingId" }, { status: 400 })
    }
    const raw = body.driveUrl
    let driveUrl: string | null
    if (raw === null || raw === "") {
      driveUrl = null
    } else if (typeof raw === "string" && /^https:\/\/(drive|docs)\.google\.com\//.test(raw.trim())) {
      driveUrl = raw.trim()
    } else {
      return NextResponse.json({ error: "driveUrl must be a Google Drive https URL" }, { status: 400 })
    }
    const r = await setBookingDriveUrl(bookingId, driveUrl)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
    return NextResponse.json({ ok: true, updated: r.updated })
  }

  const id = typeof body.id === "string" ? body.id : ""
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  const patch: Parameters<typeof updateShipmentFields>[1] = {}

  if (body.status !== undefined) {
    const status = body.status as ShipmentStatus
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 })
    }
    patch.status = status
  }
  if (body.shipmentDate !== undefined) {
    if (typeof body.shipmentDate !== "string" || !YMD_RE.test(body.shipmentDate)) {
      return NextResponse.json({ error: "invalid shipmentDate" }, { status: 400 })
    }
    patch.shipment_date = body.shipmentDate
  }
  if (body.expectedArrival !== undefined) {
    if (typeof body.expectedArrival !== "string" || !YMD_RE.test(body.expectedArrival)) {
      return NextResponse.json({ error: "invalid expectedArrival" }, { status: 400 })
    }
    patch.expected_arrival = body.expectedArrival
  }
  // 発送日 > 到着日 の逆転は保存を拒否 (現場事故防止)
  if (patch.shipment_date && patch.expected_arrival && patch.shipment_date > patch.expected_arrival) {
    return NextResponse.json({ error: "expectedArrival must be on/after shipmentDate" }, { status: 400 })
  }
  if (body.suitcaseCount !== undefined) {
    const n = Math.floor(Number(body.suitcaseCount))
    if (!Number.isFinite(n) || n < 1 || n > 99) {
      return NextResponse.json({ error: "invalid suitcaseCount" }, { status: 400 })
    }
    patch.suitcase_count = n
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string" || body.notes.length > 500) {
      return NextResponse.json({ error: "invalid notes" }, { status: 400 })
    }
    patch.notes = body.notes.trim() || null
  }

  // status のみの旧形式互換
  const r =
    Object.keys(patch).length === 1 && patch.status
      ? await updateShipmentStatus(id, patch.status)
      : await updateShipmentFields(id, patch)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/shipments — 予約単位の削除 (誤作成のクリーンアップ)
 *   body: { bookingId: string, confirm: "DELETE" }
 * 物理削除。発行済み送り状は消えないため、UI 側で Ship&co での破棄を必ず案内する。
 */
export async function DELETE(req: NextRequest) {
  const limit = rateLimit(req, "shipments-delete")
  if (!limit.ok) return limit.response

  let body: { bookingId?: unknown; confirm?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim() : ""
  if (!/^BDX-[\dA-Z]+-[\dA-Z]+$/i.test(bookingId)) {
    return NextResponse.json({ error: "invalid bookingId" }, { status: 400 })
  }
  // 誤操作防止: クライアントは明示的に confirm: "DELETE" を送る必要がある
  if (body.confirm !== "DELETE") {
    return NextResponse.json({ error: "confirm required" }, { status: 400 })
  }
  const r = await deleteBooking(bookingId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true, deleted: r.deleted })
}
