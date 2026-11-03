import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import {
  bizLogiAvailability,
  loadPickupShipment,
  markManualRequested,
  previewForShipment,
  resolvePickupRequest,
  sendForShipment,
} from "@/lib/pickup-request/service"
import { supabasePickupStore, liveRequestByShipment, PickupStoreError, isPickupTableMissing } from "@/lib/pickup-request/store"
import { RESOLVE_TRANSITIONS, type ResolveAction } from "@/lib/pickup-request/state"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 佐川への集荷依頼 (2026-11-03 Biz-Logi 導入 Phase 1-a)。middleware で operator 認証済み。
 *
 *   GET  ?shipmentId=…                 → 区間の集荷依頼の記録と、Biz-Logi が使えるか
 *   POST { action: "bizlogi_preview", shipmentId }                         確認機能 (無課金) で送信内容を確認
 *   POST { action: "bizlogi_send", shipmentId, fingerprint, actor, confirmNoManual: true }  集荷依頼を送信
 *   POST { action: "manual_mark", shipmentId, actor, note? }               佐川指定 Excel で依頼したことを記録
 *   POST { action: "resolve", requestId, resolveAction, actor, shippingNumber?, note? }  運営の確認結果を記録
 *
 * actor = 操作した運営担当者名 (運営ログインは共有のため入力してもらう)。
 * 送信はボタン操作からだけ。自動送信・自動再送はしない。
 */

const actorOf = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : ""
  return s && s.length <= 40 ? s : null
}

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "pickup-request")
  if (!limit.ok) return limit.response
  const shipmentId = req.nextUrl.searchParams.get("shipmentId")?.trim() || ""
  if (!shipmentId) return NextResponse.json({ error: "shipmentId required" }, { status: 400 })
  try {
    const rows = await supabasePickupStore().listForShipments([shipmentId])
    const live = liveRequestByShipment(rows).get(shipmentId) ?? null
    return NextResponse.json({ requests: rows, live, bizlogi: bizLogiAvailability() })
  } catch (e) {
    // sql/062 未適用の環境: 画面は従来の「集荷手配済み」チェックで運用できるよう、記録なしとして返す
    if (isPickupTableMissing(e)) {
      return NextResponse.json({ requests: [], live: null, legacy: true, bizlogi: { available: false, reason: "集荷依頼の記録 (sql/062) が未適用です" } })
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "pickup-request")
  if (!limit.ok) return limit.response
  if (!getSupabase()) return NextResponse.json({ error: "Supabase unavailable" }, { status: 503 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const action = typeof body.action === "string" ? body.action : ""

  try {
    const store = supabasePickupStore()

    if (action === "resolve") {
      const requestId = typeof body.requestId === "string" ? body.requestId.trim() : ""
      const resolveAction = body.resolveAction as ResolveAction
      const actor = actorOf(body.actor)
      if (!requestId || !RESOLVE_TRANSITIONS[resolveAction]) return NextResponse.json({ error: "requestId / resolveAction が不正です" }, { status: 400 })
      if (!actor) return NextResponse.json({ error: "担当者名を入力してください" }, { status: 400 })
      const r = await resolvePickupRequest(
        requestId,
        resolveAction,
        {
          actor,
          shippingNumber: typeof body.shippingNumber === "string" ? body.shippingNumber : null,
          note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
        },
        store,
      )
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.reason }, { status: 409 })
    }

    const shipmentId = typeof body.shipmentId === "string" ? body.shipmentId.trim() : ""
    if (!shipmentId) return NextResponse.json({ error: "shipmentId required" }, { status: 400 })
    const row = await loadPickupShipment(shipmentId)
    if (!row) return NextResponse.json({ error: "区間が見つかりません" }, { status: 404 })

    if (action === "manual_mark") {
      const actor = actorOf(body.actor)
      if (!actor) return NextResponse.json({ error: "担当者名を入力してください" }, { status: 400 })
      const r = await markManualRequested(row, actor, store, typeof body.note === "string" ? body.note.slice(0, 500) : null)
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.reason }, { status: 409 })
    }

    if (action === "bizlogi_preview" || action === "bizlogi_send") {
      const avail = bizLogiAvailability()
      if (!avail.available) return NextResponse.json({ error: `Biz-Logi は使えません: ${avail.reason}` }, { status: 503 })
      // 送信前に、既に有効な依頼が無いかを先に知らせる (最終判定は送信時の DB 確保)
      const live = liveRequestByShipment(await store.listForShipments([shipmentId])).get(shipmentId)
      if (live) return NextResponse.json({ error: `この区間には既に集荷依頼の記録があります (${live.channel}・${live.state})` }, { status: 409 })

      if (action === "bizlogi_preview") {
        const p = await previewForShipment(row)
        return NextResponse.json({ ...p, environment: avail.environment, live: avail.live })
      }

      const actor = actorOf(body.actor)
      if (!actor) return NextResponse.json({ error: "担当者名を入力してください" }, { status: 400 })
      if (body.confirmNoManual !== true) {
        return NextResponse.json({ error: "佐川指定 Excel で依頼していないことを確認してください" }, { status: 400 })
      }
      const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : ""
      if (!fingerprint) return NextResponse.json({ error: "先に送信内容の確認をしてください" }, { status: 400 })
      const outcome = await sendForShipment(row, { actor, expectedFingerprint: fingerprint }, store)
      const status = outcome.outcome === "accepted" ? 200 : outcome.outcome === "blocked" ? 409 : outcome.outcome === "failed" ? 422 : 202
      return NextResponse.json(outcome, { status })
    }

    return NextResponse.json({ error: "不明な action です" }, { status: 400 })
  } catch (e) {
    const status = e instanceof PickupStoreError ? 503 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status })
  }
}
