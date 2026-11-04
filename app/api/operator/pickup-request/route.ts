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
  usageCheckForRequest,
} from "@/lib/pickup-request/service"
import { supabasePickupStore, liveRequestByShipment, PickupStoreError, isPickupTableMissing } from "@/lib/pickup-request/store"
import { RESOLVE_TRANSITIONS, type ResolveAction } from "@/lib/pickup-request/state"
import { cleanOverrides } from "@/lib/pickup-request/leg-input"
import { bizlogiEligibility } from "@/lib/pickup-request/eligibility"
import { applyChangeWithEffects } from "@/lib/pickup-request/apply-effects"
import {
  createPickupChange,
  hotelChangeFields,
  listPickupChanges,
  stepPickupChange,
  verifyChangeHotel,
  CHANGE_KINDS,
  type ChangeKind,
  type ChangeStep,
} from "@/lib/pickup-request/change"

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
 *   受付後の変更 (ホテル・問い合わせ番号。佐川の回答前は区間の情報を変えない):
 *   POST { action: "change_create", shipmentId, side: "guest"|"pickup"|null, newHotel, newHotelJa, newPlaceId, newCity?, newPrefecture?, reason, actor }
 *        または { action: "change_create", shipmentId, kind, fields, reason, actor } (日程・個数・代表者名・取消・個別再手配)
 *   POST { action: "change_step", changeId, step: "contact"|"approve"|"reject"|"withdraw", actor, note, numberPolicy?, newNumber? }
 *   POST { action: "change_apply", changeId, actor }   承認済みの変更を区間へ反映
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
    const leg = await loadPickupShipment(shipmentId)
    // 受付後の変更の記録 (sql/067 未適用の古い環境では空)
    const changes = await listPickupChanges(shipmentId).catch(() => [])
    return NextResponse.json({
      requests: rows,
      live,
      changes,
      bizlogi: bizLogiAvailability(),
      // 20個以上・団体は Biz-Logi で送らない (手動 Excel のみ)
      eligibility: leg ? bizlogiEligibility(leg) : null,
    })
  } catch (e) {
    // sql/067 未適用の環境: 画面は従来の「集荷手配済み」チェックで運用できるよう、記録なしとして返す
    if (isPickupTableMissing(e)) {
      return NextResponse.json({ requests: [], live: null, legacy: true, bizlogi: { available: false, reason: "集荷依頼の記録 (sql/067) が未適用です" } })
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
      // 変更の反映を記録するときは、区間の今の内容を新しい依頼内容として保存する
      const req0 = await store.get(requestId)
      const current = req0 ? await loadPickupShipment(req0.shipment_id) : null
      const r = await resolvePickupRequest(
        requestId,
        resolveAction,
        {
          actor,
          shippingNumber: typeof body.shippingNumber === "string" ? body.shippingNumber : null,
          note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
          current,
        },
        store,
      )
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.reason }, { status: 409 })
    }

    // 結果不明の照合 (利用実績参照 API・読み取りだけ)。状態は運営が下の resolve で確定する
    if (action === "usage_check") {
      const requestId = typeof body.requestId === "string" ? body.requestId.trim() : ""
      if (!requestId) return NextResponse.json({ error: "requestId required" }, { status: 400 })
      const avail = bizLogiAvailability()
      if (!avail.available) return NextResponse.json({ error: `Biz-Logi は使えません: ${avail.reason}` }, { status: 503 })
      const r = await usageCheckForRequest(requestId, store)
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.reason }, { status: 409 })
    }

    if (action === "change_step" || action === "change_apply") {
      const changeId = typeof body.changeId === "string" ? body.changeId.trim() : ""
      const actor = actorOf(body.actor)
      if (!changeId) return NextResponse.json({ error: "changeId required" }, { status: 400 })
      if (!actor) return NextResponse.json({ error: "担当者名を入力してください" }, { status: 400 })
      if (action === "change_apply") {
        // 反映 (DB 関数) と付随処理 (請求額・締切・代理店への変更メール)
        const r = await applyChangeWithEffects(changeId, actor)
        return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.reason }, { status: 409 })
      }

      const step = body.step as ChangeStep
      if (!["contact", "approve", "reject", "withdraw"].includes(step)) return NextResponse.json({ error: "step が不正です" }, { status: 400 })
      const policy = body.numberPolicy === "kept" || body.numberPolicy === "changed" ? body.numberPolicy : null
      const r = await stepPickupChange({
        changeId,
        step,
        actor,
        note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
        numberPolicy: policy,
        newNumber: typeof body.newNumber === "string" ? body.newNumber : null,
      })
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.reason }, { status: 409 })
    }

    const shipmentId = typeof body.shipmentId === "string" ? body.shipmentId.trim() : ""
    if (!shipmentId) return NextResponse.json({ error: "shipmentId required" }, { status: 400 })

    if (action === "change_create") {
      const actor = actorOf(body.actor)
      if (!actor) return NextResponse.json({ error: "担当者名を入力してください" }, { status: 400 })
      const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 200) : null)
      // 画面 (受付後の変更) は side でホテル、side なしで番号の振り直し。API は kind + fields でほかの種類も受ける。
      const side = body.side === "guest" || body.side === "pickup" ? body.side : null
      let kind: ChangeKind
      let fields: Record<string, unknown>
      if (typeof body.kind === "string") {
        if (!(CHANGE_KINDS as string[]).includes(body.kind)) return NextResponse.json({ error: "変更の種類が正しくありません" }, { status: 400 })
        kind = body.kind as ChangeKind
        fields = body.fields && typeof body.fields === "object" && !Array.isArray(body.fields) ? (body.fields as Record<string, unknown>) : {}
      } else if (side) {
        ;({ kind, fields } = hotelChangeFields({
          side,
          newHotel: str(body.newHotel),
          newHotelJa: str(body.newHotelJa),
          newPlaceId: str(body.newPlaceId),
          newCity: str(body.newCity),
          newPrefecture: str(body.newPrefecture),
        }))
      } else {
        kind = "number"
        fields = {}
      }
      // ホテルを変える場合は、候補から選んだ place_id を Google で確かめてから登録する (手入力の place_id は通さない)
      if (kind === "hotel_guest" || kind === "hotel_pickup") {
        const pre = kind === "hotel_guest" ? "to" : "from"
        const placeId = str(fields[`${pre}_place_id`])
        if (placeId) {
          const v = await verifyChangeHotel(placeId, process.env.GOOGLE_MAPS_API_KEY)
          if (!v.ok) return NextResponse.json({ error: v.reason }, { status: v.status })
          if (v.prefecture) fields[`${pre}_prefecture`] = v.prefecture
          if (v.city) fields[`${pre}_city`] = v.city
        }
      }
      const r = await createPickupChange({
        shipmentId,
        kind,
        fields,
        reason: str(body.reason) ?? "",
        source: "operator",
        requester: "operator",
        actor,
      })
      return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.reason }, { status: 409 })
    }

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
        const p = await previewForShipment(row, cleanOverrides(body.overrides))
        return NextResponse.json({ ...p, environment: avail.environment, live: avail.live })
      }

      const actor = actorOf(body.actor)
      if (!actor) return NextResponse.json({ error: "担当者名を入力してください" }, { status: 400 })
      if (body.confirmNoManual !== true) {
        return NextResponse.json({ error: "佐川指定 Excel で依頼していないことを確認してください" }, { status: 400 })
      }
      const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : ""
      if (!fingerprint) return NextResponse.json({ error: "先に送信内容の確認をしてください" }, { status: 400 })
      const outcome = await sendForShipment(row, { actor, expectedFingerprint: fingerprint, overrides: cleanOverrides(body.overrides) }, store)
      const status = outcome.outcome === "accepted" ? 200 : outcome.outcome === "blocked" ? 409 : outcome.outcome === "failed" ? 422 : 202
      return NextResponse.json(outcome, { status })
    }

    return NextResponse.json({ error: "不明な action です" }, { status: 400 })
  } catch (e) {
    const status = e instanceof PickupStoreError ? 503 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status })
  }
}
