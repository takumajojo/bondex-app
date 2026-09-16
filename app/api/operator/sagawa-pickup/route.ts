import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"

export const runtime = "nodejs"

/**
 * 佐川への集荷依頼を「連絡済み」にする (2026-09-16 谷口さん)。middleware で operator 認証済み。
 *   POST /api/operator/sagawa-pickup   { shipmentId, undo?: true }
 *     → pickup_requested_at を now (undo=true なら null) にする。今日のTODOから消える/戻る。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "sagawa-pickup")
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

  const { error } = await sb
    .from("shipments")
    .update({ pickup_requested_at: body.undo === true ? null : new Date().toISOString() })
    .eq("id", shipmentId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
