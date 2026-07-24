import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { saveShipment, deleteBooking } from "@/lib/shipments-db"
import { generateBookingId } from "@/lib/voucher-pdf"
import { normalizeGuestLanguage } from "@/lib/guest-language"
import { sendBookingRequestEmail } from "@/lib/agency-notify"
import { ALL_TIME_SLOTS } from "@/lib/carrier"

export const runtime = "nodejs"
export const maxDuration = 60 // 即発行 (Ship&co) + Drive 格納で数秒かかるため延長

/**
 * 代理店の「発行依頼(登録)」。
 *
 *   POST /api/agency/booking
 *   Authorization: Bearer <Supabase access token>
 *
 * 旅程を登録するだけで、バウチャーもヤマト送り状も発行しない(Ship&co 従量課金を回避)。
 * status='requested' で shipments に保存し、発行主体(agency)は認証した自社名に強制固定
 * (他社なりすまし防止)。出荷が 1ヶ月以上先なら「1ヶ月前になったらまとめて連絡」する
 * 案内メールを自動送信する。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

const DELIVERY_SLOT_SET = new Set<string>(ALL_TIME_SLOTS)

interface LegInput {
  fromHotel: string
  fromPlaceId: string
  fromCity: string
  toHotel: string
  toPlaceId: string
  toCity: string
  shipmentDate: string
  expectedArrival: string
  fromCheckIn: string
  toCheckOut: string
  deliveryTime: string
  recipient: string
  suitcaseCount: number
  notes: string
}

function parseLeg(raw: unknown): LegInput | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "invalid leg" }
  const o = raw as Record<string, unknown>
  const fromHotel = s(o.fromHotel)
  const toHotel = s(o.toHotel)
  const shipmentDate = s(o.shipmentDate)
  const expectedArrival = s(o.expectedArrival) || shipmentDate
  const recipient = s(o.recipient)
  const notes = s(o.notes)
  const suitcaseCount = Math.floor(Number(o.suitcaseCount))
  if (!fromHotel || !toHotel) return { error: "発送元・お届け先ホテルをご入力ください。" }
  if (!DATE_RE.test(shipmentDate)) return { error: "発送日を正しくご入力ください。" }
  if (!DATE_RE.test(expectedArrival)) return { error: "到着日を正しくご入力ください。" }
  if (expectedArrival < shipmentDate) return { error: "到着日は発送日以降にしてください。" }
  if (!Number.isFinite(suitcaseCount) || suitcaseCount < 1 || suitcaseCount > 50) {
    return { error: "個数は 1〜50 でご入力ください。" }
  }
  const rawDelivery = s(o.deliveryTime)
  const deliveryTime = DELIVERY_SLOT_SET.has(rawDelivery) ? rawDelivery : ""
  const fromCheckIn = DATE_RE.test(s(o.fromCheckIn)) ? s(o.fromCheckIn) : ""
  const toCheckOut = DATE_RE.test(s(o.toCheckOut)) ? s(o.toCheckOut) : ""
  return {
    fromHotel,
    fromPlaceId: s(o.fromPlaceId),
    fromCity: s(o.fromCity),
    toHotel,
    toPlaceId: s(o.toPlaceId),
    toCity: s(o.toCity),
    shipmentDate,
    expectedArrival,
    fromCheckIn,
    toCheckOut,
    deliveryTime,
    recipient,
    suitcaseCount,
    notes,
  }
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "agency-booking")
  if (!limit.ok) return limit.response

  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // 承認待ち・停止中は登録不可
  if (auth.agency.status === "pending") {
    return NextResponse.json({ error: "アカウントは承認待ちです。承認後にご利用いただけます。" }, { status: 403 })
  }
  if (auth.agency.status === "suspended") {
    return NextResponse.json({ error: "アカウントは停止中です。BondEx サポートにご連絡ください。" }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const representative = s(body.representative)
  const tourNumber = s(body.tourNumber)
  const bookingName = s(body.bookingName)
  const groupName = s(body.groupName)
  const guestLanguage = normalizeGuestLanguage(body.guestLanguage)
  const travelerCount = Math.max(1, Math.floor(Number(body.travelerCount) || 1))
  if (!representative) {
    return NextResponse.json({ error: "代表者名をご入力ください。" }, { status: 400 })
  }
  const rawLegs = Array.isArray(body.legs) ? body.legs : []
  if (rawLegs.length === 0) {
    return NextResponse.json({ error: "区間を 1 つ以上ご入力ください。" }, { status: 400 })
  }
  if (rawLegs.length > 10) {
    return NextResponse.json({ error: "区間は 10 件までです。" }, { status: 400 })
  }
  const legs: LegInput[] = []
  for (const raw of rawLegs) {
    const parsed = parseLeg(raw)
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    legs.push(parsed)
  }

  const bookingId = generateBookingId()
  const agencyName = auth.agency.name // 自社名に強制固定

  // 全区間を requested で保存(発行はしない)。保存失敗は握り潰さず、掃除して 500 を返す。
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]
    const saved = await saveShipment({
      booking_id: bookingId,
      leg_index: i,
      agency: agencyName,
      representative,
      traveler_count: travelerCount,
      booking_name: bookingName || null,
      group_name: groupName || null,
      tour_number: tourNumber || null,
      shipment_date: leg.shipmentDate,
      expected_arrival: leg.expectedArrival,
      from_check_in: leg.fromCheckIn || null,
      to_check_out: leg.toCheckOut || null,
      delivery_time: leg.deliveryTime || null,
      from_hotel: leg.fromHotel,
      from_city: leg.fromCity || null,
      from_place_id: leg.fromPlaceId || null,
      to_hotel: leg.toHotel,
      to_city: leg.toCity || null,
      to_place_id: leg.toPlaceId || null,
      recipient: leg.recipient || leg.toHotel,
      suitcase_count: leg.suitcaseCount,
      amount_yen: 0, // 依頼段階では未確定
      status: "requested",
      notes: leg.notes || null,
      guest_language: guestLanguage,
    })
    if (!saved.ok) {
      // 途中失敗 → この予約の保存済み区間を掃除して失敗を返す (中途半端な予約を残さない)
      try {
        await deleteBooking(bookingId)
      } catch {
        /* best-effort */
      }
      return NextResponse.json(
        { error: `発行依頼の登録に失敗しました (${saved.error ?? "unknown"})` },
        { status: 500 },
      )
    }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysUntilShip = (d: string) =>
    Math.round((new Date(`${d}T00:00:00`).getTime() - today.getTime()) / 86_400_000)

  // ── 1ヶ月以内(≤30日)の区間は即発行して即DL。直ランオペ=1ヶ月超は 'requested' のまま
  //    (発行窓の外なので発行しない)。発行は運営と同じ /api/shipandco/create を
  //    サーバー内から OPERATOR_PASSWORD で呼び、検証済みの発行ロジックを再利用する。
  const origin = req.nextUrl.origin
  const opPw = process.env.OPERATOR_PASSWORD
  const legOut: Array<{ legIndex: number; issued: boolean; labelUrl?: string }> = []
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]
    if (daysUntilShip(leg.shipmentDate) > 30 || !opPw) {
      legOut.push({ legIndex: i, issued: false })
      continue
    }
    try {
      const res = await fetch(`${origin}/api/shipandco/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opPw}` },
        body: JSON.stringify({
          refNumber: `${bookingId}-L${i + 1}`,
          bookingId,
          legIndex: i,
          carrier: "sagawa",
          shipmentDate: leg.shipmentDate,
          deliveryDate: leg.expectedArrival,
          deliveryTime: leg.deliveryTime || "before-noon",
          suitcaseCount: leg.suitcaseCount,
          from: { hotel: leg.fromHotel, recipient: leg.recipient || leg.toHotel, placeId: leg.fromPlaceId, city: leg.fromCity },
          to: { hotel: leg.toHotel, recipient: leg.recipient || leg.toHotel, placeId: leg.toPlaceId, city: leg.toCity },
          agency: agencyName,
          representative,
          travelerCount,
          bookingName,
          fromCheckIn: leg.fromCheckIn,
          toCheckOut: leg.toCheckOut,
          specialNote: leg.notes,
          tourNumber,
          groupName,
          guestLanguage,
        }),
      })
      const d = (await res.json().catch(() => ({}))) as { label?: string }
      legOut.push({ legIndex: i, issued: Boolean(res.ok && d.label), labelUrl: d.label })
    } catch {
      legOut.push({ legIndex: i, issued: false })
    }
  }
  const allIssued = legOut.length > 0 && legOut.every((r) => r.issued)
  const anyIssued = legOut.some((r) => r.issued)
  const needsLabelWait = !allIssued // 未発行(1ヶ月超 or 発行不可)の区間がある

  // 書類は共有ドライブにも保管 (best-effort・失敗しても画面から DL は可能)。
  // 未発行 (1ヶ月超) でもバウチャーだけは今この時点で確定するので必ず流す。
  // 代理店はファイナルドキュメント作成・社内のツアーファイル保管でバウチャーを
  // 予約完了時点で必要とするため (2026-07 My Japan Planner 堀部さんの要望)。
  // 送り状は 1ヶ月前の発行後、drive-sync が再実行されて同じフォルダに追加される。
  if (opPw) {
    try {
      await fetch(`${origin}/api/operator/drive-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opPw}` },
        body: JSON.stringify({ bookingId }),
      })
    } catch {
      /* Drive 格納失敗は無視 */
    }
  }

  // 待ち(未発行)がある場合のみ「1ヶ月前になったら連絡」の案内メール。全発行済みなら不要。
  let noticeEmailSent = false
  if (needsLabelWait) {
    const earliestShipDate = legs.reduce(
      (min, l) => (l.shipmentDate < min ? l.shipmentDate : min),
      legs[0].shipmentDate,
    )
    const locale: "ja" | "en" = auth.agency.is_domestic === false ? "en" : "ja"
    const mail = await sendBookingRequestEmail({
      agencyEmail: auth.agency.contact_email,
      agencyName,
      bookingId,
      tourNumber: tourNumber || null,
      earliestShipDate,
      needsLabelWait: true,
      legCount: legs.length,
      locale,
    })
    noticeEmailSent = mail.sent
  }

  return NextResponse.json({
    ok: true,
    bookingId,
    legCount: legs.length,
    needsLabelWait,
    allIssued,
    anyIssued,
    labels: legOut
      .filter((r) => r.issued && r.labelUrl)
      .map((r) => ({ legIndex: r.legIndex, url: r.labelUrl })),
    noticeEmailSent,
  })
}
