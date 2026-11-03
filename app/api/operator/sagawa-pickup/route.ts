import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { loadPickupShipment, markManualRequested, resolvePickupRequest } from "@/lib/pickup-request/service"
import { supabasePickupStore, liveRequestByShipment, PickupStoreError, isPickupTableMissing } from "@/lib/pickup-request/store"

export const runtime = "nodejs"

/**
 * 佐川への集荷依頼を「連絡済み (手動・佐川指定 Excel)」にする (2026-09-16 谷口さん)。middleware で operator 認証済み。
 *   POST /api/operator/sagawa-pickup   { shipmentId, undo?: true, actor? }
 *
 * 2026-11-03〜 集荷依頼の記録 (pickup_requests・sql/067) に手動依頼として記録する。
 * Biz-Logi で依頼済み・結果不明などの区間には重ねて記録できない (二重依頼の防止)。
 * undo は手動の記録だけを無効にできる (Biz-Logi の受付は世田谷営業所への取消連絡が必要)。
 * sql/067 未適用の環境では従来どおり pickup_requested_at だけを更新する。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "sagawa-pickup")
  if (!limit.ok) return limit.response
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase unavailable" }, { status: 503 })

  let body: { shipmentId?: unknown; undo?: unknown; actor?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const shipmentId = typeof body.shipmentId === "string" ? body.shipmentId.trim() : ""
  if (!shipmentId) return NextResponse.json({ error: "shipmentId required" }, { status: 400 })
  const actorRaw = typeof body.actor === "string" ? body.actor.trim().slice(0, 40) : ""
  const actor = actorRaw || "運営 (担当者名未入力)"

  try {
    const store = supabasePickupStore()
    const rows = await store.listForShipments([shipmentId])
    const live = liveRequestByShipment(rows).get(shipmentId)

    if (body.undo === true) {
      if (!live) return NextResponse.json({ ok: true })
      if (live.channel !== "manual" || live.state !== "accepted") {
        return NextResponse.json(
          { error: "この依頼は手動の記録ではないため取り消せません。運営画面の「佐川へ集荷依頼」から対応してください" },
          { status: 409 },
        )
      }
      const r = await resolvePickupRequest(live.id, "confirm_none", { actor, note: "依頼済みの記録を取り消し" }, store)
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.reason }, { status: 409 })
    }

    const row = await loadPickupShipment(shipmentId)
    if (!row) return NextResponse.json({ error: "区間が見つかりません" }, { status: 404 })
    if (live) return NextResponse.json({ ok: true, alreadyRecorded: true, channel: live.channel, state: live.state })
    const r = await markManualRequested(row, actor, store)
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.reason }, { status: 409 })
  } catch (e) {
    // sql/067 未適用 (pickup_requests が無い) の環境だけ、従来の印の更新に戻す
    const msg = e instanceof Error ? e.message : String(e)
    if (!(e instanceof PickupStoreError) || !isPickupTableMissing(e)) {
      return NextResponse.json({ error: msg }, { status: 500 })
    }
    const { error } = await sb
      .from("shipments")
      .update({ pickup_requested_at: body.undo === true ? null : new Date().toISOString() })
      .eq("id", shipmentId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, legacy: true })
  }
}
