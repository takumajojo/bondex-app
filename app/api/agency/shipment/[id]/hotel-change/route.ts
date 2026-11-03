import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { getSupabase } from "@/lib/supabase"
import { changeBlockedReason } from "@/lib/agency-change-gate"
import { agencyHotelChangeLock, CHANGE_REQUEST_ACCEPTED_MESSAGE } from "@/lib/agency-self-service"
import { isPickupLockError, liveRequestFor, submitAgencyChange } from "@/lib/pickup-request/agency-change"
import { hotelChangeFields, verifyChangeHotel } from "@/lib/pickup-request/change"
import { sendBookingUpdateEmail } from "@/lib/booking-update-email"
import { notifyBondEx } from "@/lib/notify"
import { alertSagawaChange } from "@/lib/sagawa-alert"

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
 *   変更申請            … 佐川へ集荷依頼済み、または締切 (集荷前日 18:30 JST) の後は、直接変えずに変更申請として
 *                         受け付ける (202・2026-11-04 段階C)。正式な情報は佐川・BondEx の確認後に反映する。
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
      "id, booking_id, leg_index, agency, status, booking_type, suitcase_count, shipment_date, change_deadline_at, label_sent_at, tracking_numbers, label_url, pickup_requested_at, to_hotel, to_hotel_ja, from_hotel, from_hotel_ja, guest_hotel_notified_at, pickup_hotel_notified_at",
    )
    .eq("id", shipmentId)
    .maybeSingle()
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 })
  // 自社の予約のみ (存在秘匿のため不一致は 404)
  if (!ship || ship.agency !== auth.agency.name) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  // ロックゲート (送り状が実在 / 追跡番号あり / 集荷済み以降は BondEx へ連絡)。集荷依頼済み・締切後は変更申請。
  // 2026-09-24〜 依頼直後から "issued" (手配済) になるため status だけでは判定しない。
  // 判定はポータルの表示と同じ関数 (agencyHotelChangeLock) を使い、送信中の依頼 (印がまだ無い) も DB の記録で見る。
  let live: Awaited<ReturnType<typeof liveRequestFor>> = null
  try {
    live = await liveRequestFor(sb, shipmentId)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
  const lock = live && ["requested", "pending", "issued"].includes(ship.status as string) && !(ship as { label_url?: string | null }).label_url
    ? "request"
    : agencyHotelChangeLock({
        status: ship.status as string,
        tracking_numbers: ship.tracking_numbers as string[] | null,
        label_url: (ship as { label_url?: string | null }).label_url ?? null,
        pickup_requested_at: (ship as { pickup_requested_at?: string | null }).pickup_requested_at ?? null,
        shipment_date: ship.shipment_date as string | null,
      })
  if (lock === "locked") {
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

  // 変更申請 (集荷依頼済み・締切後)。place_id は Google で確かめ、都道府県・市区は Google の値を使う。
  if (lock === "request") {
    const { kind, fields } = hotelChangeFields({ side, newHotel, newHotelJa, newPlaceId, newCity, newPrefecture })
    const pre = side === "guest" ? "to" : "from"
    const v = await verifyChangeHotel(newPlaceId, process.env.GOOGLE_MAPS_API_KEY)
    if (!v.ok) {
      return NextResponse.json(
        { error: "PLACE_UNVERIFIED", message: en ? "We couldn't confirm the selected hotel. Please search and select it again." : v.reason },
        { status: v.status },
      )
    }
    if (v.prefecture) fields[`${pre}_prefecture`] = v.prefecture
    if (v.city) fields[`${pre}_city`] = v.city
    const r = await submitAgencyChange({
      shipmentId, kind, fields, reason: "代理店からのホテル変更",
      agencyName: auth.agency.name,
      actor: auth.agency.contact_email ? `${auth.agency.name} <${auth.agency.contact_email}>` : auth.agency.name,
      en,
    })
    if (!r.ok) return NextResponse.json({ error: r.code, message: r.message }, { status: r.status })
    const legRefReq = `${ship.booking_id}-L${(ship.leg_index as number) + 1}`
    const sideLabelReq = side === "guest" ? "お届け先" : "発送元"
    await notifyBondEx({
      kind: "change",
      title: `${legRefReq}（${ship.agency}）${sideLabelReq}ホテルの変更申請（${live ? "佐川へ集荷依頼済み・世田谷へ連絡が必要" : "締切後・承認が必要"}）`,
      lines: [`${sideLabelReq}: ${(side === "guest" ? ship.to_hotel_ja || ship.to_hotel : ship.from_hotel_ja || ship.from_hotel) as string} → ${newHotelJa}`],
      link: `/operator/bookings/${ship.booking_id}`,
      linkLabel: "申請を確認する",
    })
    return NextResponse.json(
      { ok: true, pending: true, requested: true, message: en ? CHANGE_REQUEST_ACCEPTED_MESSAGE.en : CHANGE_REQUEST_ACCEPTED_MESSAGE.ja },
      { status: 202 },
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
    // 確認の後に佐川へ集荷依頼が入った (DB のトリガーが止めた) → もう一度操作すれば変更申請になる
    if (isPickupLockError(msg)) {
      return NextResponse.json(
        {
          error: "PICKUP_REQUESTED",
          message: en
            ? "Pickup was just arranged with the courier. Please try again — it will be sent as a change request."
            : "直前に佐川へ集荷を手配しました。もう一度操作すると、変更申請として受け付けます。",
        },
        { status: 409 },
      )
    }
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

  // 変更を代理店へメール通知し、最新バウチャーPDF(howto同梱)を添付 (2026-09-30〜)。best-effort。
  await sendBookingUpdateEmail(ship.booking_id as string, [`${sideLabel}ホテル: ${oldHotelJa || oldHotel} → ${newHotelJa}`])

  // 佐川へ集荷依頼済みの区間は上のロック (PICKUP_REQUESTED) で変更できない (2026-11-04〜)。ロックの確認から
  // 更新までの間に運営が依頼済みを記録した場合に備え、運用への通知は残す (2026-11-03 監査 P1-3)。
  await alertSagawaChange({
    shipment: {
      pickup_requested_at: (ship as { pickup_requested_at?: string | null }).pickup_requested_at ?? null,
      tracking_numbers: ship.tracking_numbers,
      booking_id: ship.booking_id as string,
      agency: ship.agency as string,
    },
    legRef,
    changeSummary: `${sideLabel}ホテル: ${oldHotelJa || oldHotel} → ${newHotelJa}（代理店のセルフ変更）`,
  })

  return NextResponse.json({ ok: true, changeId })
}
