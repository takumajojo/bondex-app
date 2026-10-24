import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"

export const runtime = "nodejs"

/**
 * 佐川への「集荷取消」連絡を済みにする (2026-10-24 谷口さん)。middleware で operator 認証済み。
 *   POST /api/operator/sagawa-pickup-cancel   { shipmentId, undo?: true }
 *     → pickup_cancel_notified_at を now (undo=true なら null) にする。今日のTODOから消える/戻る。
 *   対象はキャンセル済みの区間のみ (誤って有効な区間に記録しないため)。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "sagawa-pickup-cancel")
  if (!limit.ok) return limit.response
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase unavailable" }, { status: 503 })

  let body: { shipmentId?: unknown; undo?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const shipmentId = typeof body.shipmentId === "string" ? body.shipmentId.trim() : ""
  if (!shipmentId) return NextResponse.json({ error: "shipmentId required" }, { status: 400 })

  const { data, error } = await sb
    .from("shipments")
    .update({ pickup_cancel_notified_at: body.undo === true ? null : new Date().toISOString() })
    .eq("id", shipmentId)
    .eq("status", "cancelled")
    .select("id")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "キャンセル済みの区間が見つかりません" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
