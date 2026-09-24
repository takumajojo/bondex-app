import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { getSupabase } from "@/lib/supabase"
import { isChangeDeadlinePassed } from "@/lib/change-deadline"
import { changeBlockedReason } from "@/lib/agency-change-gate"
import { legLockedForAgency } from "@/lib/agency-self-service"
import { notifyBondEx } from "@/lib/notify"

export const runtime = "nodejs"
export const maxDuration = 20

/**
 * POST /api/agency/shipment/[id]/hotel-change — 代理店セルフのホテル変更 (お届け先=guest / 発送元=pickup)。
 *   body: { side, newHotel, newHotelJa, newPlaceId, newCity?, newPrefecture? }
 *   Authorization: Bearer <Supabase access token>
 *
 * 運営版(app/api/operator/shipment/[id]/hotel-change)より厳しいゲート:
 *   自社の予約のみ      … agency 名一致 (不一致は 404)
 *   未発行のみ          … status ∈ {requested, pending}。発行済み以降は 409 LOCKED → BondExへ連絡。
 *   締切超過は不可       … now > change_deadline_at は 409 DEADLINE_PASSED → BondExへ連絡 (override は運営のみ)。
 *   place_id 必須        … Google Places から取得 (手入力のみでは保存不可)。
 * 更新+履歴は RPC apply_hotel_change を p_require_unissued=true で呼ぶ
 * (事前チェックと RPC の間に cron が発行する競合を行ロック下で原子的に遮断)。
 * 変更は必ず BondEx へ通知 (運営が物理手配・ホテル連絡・伝票を担うため)。
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limit = rateLimit(req, "agency-hotel-change")
  if (!limit.ok) return limit.response

  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const en = auth.agency.locale === "en"

  const { id } = await ctx.params
  const shipmentId = (id || "").trim()
  if (!shipmentId) return NextResponse.json({ error: "id required" }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const side = body.side === "pickup" || body.side === "guest" ? body.side : null
  const newHotel = typeof body.newHotel === "string" ? body.newHotel.trim() : ""
  const newHotelJa = typeof body.newHotelJa === "string" ? body.newHotelJa.trim() : ""
  const newPlaceId = typeof body.newPlaceId === "string" ? body.newPlaceId.trim() : ""
  const newCity = typeof body.newCity === "string" ? body.newCity.trim() : null
  const newPrefecture = typeof body.newPrefecture === "string" ? body.newPrefecture.trim() : null

  if (!side) return NextResponse.json({ error: "side は guest / pickup" }, { status: 400 })
  if (!newHotel || !newHotelJa) {
    return NextResponse.json(
      { error: en ? "Enter both the English and Japanese hotel names." : "英名・和名の両方を入力してください" },
      { status: 400 },
    )
  }
  if (!newPlaceId) {
    return NextResponse.json(
      {
        error: en
          ? "Pick a hotel from Google Places (manual entry alone can't be saved)."
          : "Google Places から選択して place_id を取得してください（ホテル名の手入力のみでは保存できません）",
      },
      { status: 400 },
    )
  }

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })

  const { data: ship, error: fErr } = await sb
    .from("shipments")
    .select(
      "id, booking_id, leg_index, agency, status, booking_type, suitcase_count, shipment_date, change_deadline_at, label_sent_at, yamato_tracking, yamato_label_url, to_hotel, to_hotel_ja, from_hotel, from_hotel_ja, guest_hotel_notified_at, pickup_hotel_notified_at",
    )
    .eq("id", shipmentId)
    .maybeSingle()
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 })
  // 自社の予約のみ (存在秘匿のため不一致は 404)
  if (!ship || ship.agency !== auth.agency.name) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  // ロックゲート (送り状が実在 / 追跡番号あり / 集荷済み以降は BondEx へ連絡)。
  // 2026-09-24〜 依頼直後から "issued" (手配済) になるため status だけでは判定しない。
  if (legLockedForAgency({ status: ship.status as string, yamato_tracking: ship.yamato_tracking as string[] | null, yamato_label_url: (ship as { yamato_label_url?: string | null }).yamato_label_url ?? null })) {
    return NextResponse.json(
      {
        error: "LOCKED",
        message: en
          ? "This leg has already been handed to the courier and can't be changed here. Please contact BondEx."
          : "この区間は配送業者への手配が済んでいるため、こちらから変更できません。BondEx までご連絡ください。",
      },
      { status: 409 },
    )
  }

  // 団体大口ゲート (団体×30個以上は発送7日以内すべて不可)
  const gate = changeBlockedReason("hotel", {
    bookingType: ship.booking_type as string | null,
    suitcaseCount: ship.suitcase_count as number | null,
    shipmentDate: ship.shipment_date as string | null,
  })
  if (gate === "group_large_lock") {
    return NextResponse.json(
      {
        error: "GROUP_LARGE_LOCK",
        message: en
          ? "Large group bookings (30+ pieces) can't be changed here within a week of shipment. Please contact BondEx."
          : "団体（30個以上）は発送1週間以内の変更ができません。BondEx までご連絡ください。",
      },
      { status: 409 },
    )
  }

  // 締切ゲート (代理店は override 不可・運営のみ理由入力で可)
  if (isChangeDeadlinePassed(ship.change_deadline_at as string | null)) {
    return NextResponse.json(
      {
        error: "DEADLINE_PASSED",
        message: en
          ? "The change deadline has passed, so it can't be changed here. Please contact BondEx."
          : "変更締切を過ぎているため、こちらから変更できません。BondEx までご連絡ください。",
      },
      { status: 409 },
    )
  }

  const oldSlipTask = !!ship.label_sent_at
  const oldHotelCancelTask =
    side === "guest" ? !!ship.guest_hotel_notified_at : !!ship.pickup_hotel_notified_at
  const oldHotel = (side === "guest" ? ship.to_hotel : ship.from_hotel) as string
  const oldHotelJa = (side === "guest" ? ship.to_hotel_ja : ship.from_hotel_ja) as string | null

  const { data: changeId, error: rpcErr } = await sb.rpc("apply_hotel_change", {
    p_shipment_id: shipmentId,
    p_side: side,
    p_new_hotel: newHotel,
    p_new_hotel_ja: newHotelJa,
    p_new_place_id: newPlaceId,
    p_new_city: newCity,
    p_new_prefecture: newPrefecture,
    p_over_deadline: false,
    p_reason: null,
    p_old_slip_task: oldSlipTask,
    p_changed_by: `agency:${auth.agency.contact_email ?? auth.agency.name}`,
    p_agency: auth.agency.name,
    p_require_unissued: true,
  })
  if (rpcErr) {
    const msg = rpcErr.message || ""
    // 発行競合 (RPC の行ロック下で捕捉) は LOCKED として案内
    if (msg.includes("unissued_required") || msg.includes("physical_gate")) {
      return NextResponse.json(
        {
          error: "LOCKED",
          message: en
            ? "This leg has just entered issuing and can't be changed here. Please contact BondEx."
            : "この区間は発行処理に入ったため、こちらから変更できません。BondEx までご連絡ください。",
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: msg || "change failed" }, { status: 500 })
  }

  const legRef = `${ship.booking_id}-L${(ship.leg_index as number) + 1}`
  const sideLabel = side === "guest" ? "お届け先" : "発送元"
  await notifyBondEx({
    kind: "change",
    title: `${legRef}（${ship.agency}）${sideLabel}ホテルを変更`,
    lines: [
      `${sideLabel}: ${oldHotelJa || oldHotel} → ${newHotelJa}`,
      `代理店のセルフ変更（未発行・締切内）`,
      oldHotelCancelTask ? `⚠ 旧ホテルへ連絡済み → 受入キャンセルの連絡が必要` : "",
      oldSlipTask ? `⚠ 送り状(紙)が郵送済み → 旧伝票破棄の連絡が必要` : "",
    ],
    link: `/operator/bookings/${ship.booking_id}`,
    linkLabel: "予約詳細で確認",
  })

  return NextResponse.json({ ok: true, changeId })
}
