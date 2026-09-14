import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { sendOpsAlert } from "@/lib/ops-alert"
import { isChangeDeadlinePassed } from "@/lib/change-deadline"

export const runtime = "nodejs"
export const maxDuration = 20

/**
 * POST /api/operator/shipment/[id]/hotel-change
 *   配送依頼のホテル変更 (お届け先=guest / 発送元=pickup)。
 *   body: {
 *     side: "guest"|"pickup",
 *     newHotel, newHotelJa,           // 英名・和名 (両方必須)
 *     newPlaceId,                     // Google place_id (必須・手入力のみ不可)
 *     newCity?, newPrefecture?,
 *     reason?,                        // 締切超過override時は必須
 *   }
 *   ゲート:
 *     物理  = yamato_tracking 有り / status∈{picked_up,in_transit,delivered} → ハードブロック
 *     準物理 = label_sent_at 有り → 変更可・旧伝票破棄タスク生成 (old_slip_task=true)
 *     ポリシー= now>change_deadline_at → 理由必須で override 可 (over_deadline=true)
 *   更新と履歴INSERTは RPC apply_hotel_change で単一トランザクション実行。
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limit = rateLimit(req, "hotel-change")
  if (!limit.ok) return limit.response

  const { id } = await ctx.params
  const shipmentId = (id || "").trim()
  if (!shipmentId) return NextResponse.json({ error: "shipment id required" }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }

  const side = body.side === "pickup" || body.side === "guest" ? body.side : null
  const newHotel = typeof body.newHotel === "string" ? body.newHotel.trim() : ""
  const newHotelJa = typeof body.newHotelJa === "string" ? body.newHotelJa.trim() : ""
  const newPlaceId = typeof body.newPlaceId === "string" ? body.newPlaceId.trim() : ""
  const newCity = typeof body.newCity === "string" ? body.newCity.trim() : null
  const newPrefecture = typeof body.newPrefecture === "string" ? body.newPrefecture.trim() : null
  const reason = typeof body.reason === "string" ? body.reason.trim() : ""
  const changedBy = typeof body.changedBy === "string" && body.changedBy.trim() ? body.changedBy.trim() : "operator"

  if (!side) return NextResponse.json({ error: "side は guest / pickup のいずれか" }, { status: 400 })
  // 英名・和名の両方必須 (片方だけの更新は不可)。
  if (!newHotel || !newHotelJa) {
    return NextResponse.json({ error: "英名・和名の両方を入力してください" }, { status: 400 })
  }
  // 手入力のみでの保存は不可 (Google Places から place_id を取得すること)。
  if (!newPlaceId) {
    return NextResponse.json(
      { error: "Google Places から選択して place_id を取得してください（ホテル名の手入力のみでは保存できません）" },
      { status: 400 },
    )
  }

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })

  // 現在の状態を取得 (ゲート判定・履歴用)。
  const { data: ship, error: fetchErr } = await sb
    .from("shipments")
    .select(
      "id, booking_id, leg_index, agency, status, shipment_date, change_deadline_at, label_sent_at, yamato_tracking, to_hotel, to_hotel_ja, from_hotel, from_hotel_ja",
    )
    .eq("id", shipmentId)
    .maybeSingle()
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!ship) return NextResponse.json({ error: "shipment not found" }, { status: 404 })

  // 物理ゲート (override 不可)
  const tracking = (ship.yamato_tracking as string[] | null) ?? []
  const issued = Array.isArray(tracking) && tracking.length > 0
  const pickedUp = ["picked_up", "in_transit", "delivered"].includes(ship.status as string)
  if (issued || pickedUp) {
    return NextResponse.json(
      {
        error: "physical_gate",
        message: "追跡番号発行済み/集荷済みのため変更できません。ラベル取消→再発行が必要です。",
      },
      { status: 409 },
    )
  }

  // ポリシーゲート (締切超過は理由必須で override 可)
  const overDeadline = isChangeDeadlinePassed(ship.change_deadline_at as string | null)
  if (overDeadline && !reason) {
    return NextResponse.json(
      { error: "over_deadline_reason_required", message: "変更締切を過ぎています。変更理由の入力が必須です。" },
      { status: 400 },
    )
  }

  // 準物理ゲート (送り状郵送済み → 旧伝票破棄タスクを生成)
  const oldSlipTask = !!ship.label_sent_at

  // 単一トランザクションで 更新 + 履歴INSERT
  const { data: changeId, error: rpcErr } = await sb.rpc("apply_hotel_change", {
    p_shipment_id: shipmentId,
    p_side: side,
    p_new_hotel: newHotel,
    p_new_hotel_ja: newHotelJa,
    p_new_place_id: newPlaceId,
    p_new_city: newCity,
    p_new_prefecture: newPrefecture,
    p_over_deadline: overDeadline,
    p_reason: reason || null,
    p_old_slip_task: oldSlipTask,
    p_changed_by: changedBy,
    p_agency: (ship.agency as string) ?? null,
  })
  if (rpcErr) {
    // RPC 側ゲート (物理/理由必須) が発火した場合もここに来る。
    const msg = rpcErr.message || "変更に失敗しました"
    const status = /physical_gate/.test(msg) ? 409 : /over_deadline_reason_required/.test(msg) ? 400 : 500
    return NextResponse.json({ error: "rpc_failed", message: msg }, { status })
  }

  // 旧伝票破棄タスク (準物理ゲート) → 運用アラート (best-effort)
  if (oldSlipTask) {
    const legRef = `${ship.booking_id}-L${(ship.leg_index as number) + 1}`
    const sideJa = side === "guest" ? "お届け先" : "発送元"
    await sendOpsAlert({
      subject: `【旧伝票破棄タスク】${legRef} ${sideJa}ホテル変更`,
      lines: [
        `予約: ${legRef} (代理店: ${ship.agency})`,
        `${sideJa}ホテルを変更しましたが、送り状(紙)が郵送済みです。`,
        `旧伝票の破棄をホテル/関係先へ連絡してください。`,
        `新ホテル: ${newHotelJa}（${newHotel}）`,
      ],
      agencyEmail: null,
    })
  }

  return NextResponse.json({
    ok: true,
    changeId,
    side,
    overDeadline,
    oldSlipTask,
    newHotel,
    newHotelJa,
    newPlaceId,
  })
}
