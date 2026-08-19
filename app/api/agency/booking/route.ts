import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { saveShipment, deleteBooking } from "@/lib/shipments-db"
import { generateBookingId } from "@/lib/voucher-pdf"
import { normalizeGuestLanguage } from "@/lib/guest-language"
import { sendBookingRequestEmail } from "@/lib/agency-notify"
import { notifyBondEx } from "@/lib/notify"
import { ALL_TIME_SLOTS } from "@/lib/carrier"
import { cleanResidence, residenceError, RESIDENCE_FIELD_LABELS_JA, type ResidenceAddress } from "@/lib/residence"
import { itemProductName } from "@/lib/item-types"

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
  fromResidence: ResidenceAddress | null
  toHotel: string
  toPlaceId: string
  toCity: string
  toResidence: ResidenceAddress | null
  shipmentDate: string
  expectedArrival: string
  fromCheckIn: string
  toCheckOut: string
  deliveryTime: string
  recipient: string
  suitcaseCount: number
  itemType: string
  notes: string
  noteTarget: string
}

function parseLeg(raw: unknown): LegInput | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "invalid leg" }
  const o = raw as Record<string, unknown>
  const shipmentDate = s(o.shipmentDate)
  const expectedArrival = s(o.expectedArrival) || shipmentDate
  const recipient = s(o.recipient)
  const notes = s(o.notes)
  const suitcaseCount = Math.floor(Number(o.suitcaseCount))

  // 品目 → 送り状の品名(日本語)を解決。その他は自由記述必須。
  const itemTypeKey = s(o.itemType) || "suitcase"
  const itemOther = s(o.itemOther)
  if (itemTypeKey === "other" && !itemOther) {
    return { error: "品目で「その他」を選んだ場合は内容をご入力ください。" }
  }
  const itemType = itemProductName(itemTypeKey, itemOther)

  // 個人宅（ホテル以外）の判定と検証。kind='residence' のとき構造化住所を必須項目チェック。
  const fromKind = o.fromKind === "residence" ? "residence" : "hotel"
  const toKind = o.toKind === "residence" ? "residence" : "hotel"
  const fromResidence = fromKind === "residence" ? cleanResidence(o.fromResidence) : null
  const toResidence = toKind === "residence" ? cleanResidence(o.toResidence) : null
  if (fromKind === "residence") {
    if (!fromResidence) return { error: "発送元（個人宅）の住所をご入力ください。" }
    const e = residenceError(fromResidence)
    if (e) return { error: `発送元（個人宅）の${RESIDENCE_FIELD_LABELS_JA[e]}をご入力ください。` }
  }
  if (toKind === "residence") {
    if (!toResidence) return { error: "お届け先（個人宅）の住所をご入力ください。" }
    const e = residenceError(toResidence)
    if (e) return { error: `お届け先（個人宅）の${RESIDENCE_FIELD_LABELS_JA[e]}をご入力ください。` }
  }
  // 表示名: ホテル名、個人宅は氏名（from_hotel/to_hotel は NOT NULL のため必ず埋める）。
  const fromHotel = fromKind === "residence" ? (fromResidence?.name ?? "") : s(o.fromHotel)
  const toHotel = toKind === "residence" ? (toResidence?.name ?? "") : s(o.toHotel)
  if (!fromHotel || !toHotel) return { error: "発送元・お届け先をご入力ください。" }
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
  const rawNoteTarget = s(o.noteTarget)
  const noteTarget = ["from", "to", "both"].includes(rawNoteTarget) ? rawNoteTarget : ""
  return {
    fromHotel,
    fromPlaceId: fromKind === "residence" ? "" : s(o.fromPlaceId),
    fromCity: fromKind === "residence" ? `${fromResidence?.prefecture ?? ""}${fromResidence?.city ?? ""}` : s(o.fromCity),
    fromResidence,
    toHotel,
    toPlaceId: toKind === "residence" ? "" : s(o.toPlaceId),
    toCity: toKind === "residence" ? `${toResidence?.prefecture ?? ""}${toResidence?.city ?? ""}` : s(o.toCity),
    toResidence,
    shipmentDate,
    expectedArrival,
    fromCheckIn,
    toCheckOut,
    deliveryTime,
    recipient,
    suitcaseCount,
    itemType,
    notes,
    noteTarget,
  }
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "agency-booking")
  if (!limit.ok) return limit.response

  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // 契約書が未署名なら運用不可 (register→contract→agree→operate)。UIゲートのサーバー側担保。
  if (auth.agency.contract_status !== "signed") {
    return NextResponse.json(
      { error: "ご利用には契約書への署名が必要です。ポータルの「契約書に署名」から締結してください。", code: "CONTRACT_UNSIGNED" },
      { status: 403 },
    )
  }

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
      from_residence: leg.fromResidence,
      to_hotel: leg.toHotel,
      to_city: leg.toCity || null,
      to_place_id: leg.toPlaceId || null,
      to_residence: leg.toResidence,
      recipient: leg.recipient || leg.toHotel,
      suitcase_count: leg.suitcaseCount,
      item_type: leg.itemType,
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
  // reason: "far" = 1ヶ月超で発行窓の外 (正常な待ち) / "failed" = 発行を試みたが失敗
  const legOut: Array<{
    legIndex: number
    issued: boolean
    labelUrl?: string
    reason?: "far" | "failed"
    error?: string
  }> = []
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]
    if (daysUntilShip(leg.shipmentDate) > 30 || !opPw) {
      legOut.push({ legIndex: i, issued: false, reason: "far" })
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
          productName: leg.itemType,
          from: { hotel: leg.fromHotel, recipient: leg.recipient || leg.toHotel, placeId: leg.fromPlaceId, city: leg.fromCity, residence: leg.fromResidence },
          to: { hotel: leg.toHotel, recipient: leg.recipient || leg.toHotel, placeId: leg.toPlaceId, city: leg.toCity, residence: leg.toResidence },
          agency: agencyName,
          representative,
          travelerCount,
          bookingName,
          fromCheckIn: leg.fromCheckIn,
          toCheckOut: leg.toCheckOut,
          specialNote: leg.notes,
          noteTarget: leg.noteTarget,
          tourNumber,
          groupName,
          guestLanguage,
        }),
      })
      const d = (await res.json().catch(() => ({}))) as { label?: string; error?: string; code?: string; status?: string }
      if (res.ok && d.label) {
        legOut.push({ legIndex: i, issued: true, labelUrl: d.label })
      } else if (d.status === "deferred") {
        // shipandco 側で発行窓外と判定 (リードタイム超) — 正常な待ち扱い
        legOut.push({ legIndex: i, issued: false, reason: "far" })
      } else {
        // 1ヶ月以内なのに発行できなかった = 要確認 (過去日・住所解決失敗など)
        legOut.push({ legIndex: i, issued: false, reason: "failed", error: d.code || d.error || "issue failed" })
      }
    } catch {
      legOut.push({ legIndex: i, issued: false, reason: "failed", error: "network error" })
    }
  }
  const allIssued = legOut.length > 0 && legOut.every((r) => r.issued)
  const anyIssued = legOut.some((r) => r.issued)
  const issueFailures = legOut.filter((r) => r.reason === "failed")
  const farLegs = legOut.filter((r) => r.reason === "far") // 1ヶ月超先で発行窓の外(正常な待ち)
  // 「1ヶ月前になったら書類を用意してご連絡します」の案内は、本当に 1ヶ月超先の
  // 未発行区間があるときだけ出す。1ヶ月以内なのに発行できなかった区間は "failed" で
  // 別扱い(運用が対応・代理店には issueFailures を画面表示)。1ヶ月以内の発行失敗に
  // 対して誤って「1ヶ月前になりましたら」と案内しないようにする。
  const needsLabelWait = farLegs.length > 0

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
    // 1ヶ月超先(far)の区間のうち最も早い発送日を「最短の出荷予定日」として案内する。
    const farShipDates = farLegs.map((r) => legs[r.legIndex].shipmentDate)
    const earliestShipDate = farShipDates.reduce((min, d) => (d < min ? d : min), farShipDates[0])
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

  // 社内通知(Slack集約) — 新規予約が入ったことを1部屋にまとめて流す。best-effort。
  const issueSummary = allIssued
    ? "全区間 即発行済"
    : anyIssued
      ? "一部発行済"
      : needsLabelWait
        ? "1ヶ月前になったら発行予定"
        : "未発行"
  const firstLeg = legs[0]
  await notifyBondEx({
    kind: "booking",
    title: `${bookingId}（${agencyName}）`,
    lines: [
      `代表者: ${representative}`,
      tourNumber ? `ツアー番号: ${tourNumber}` : "",
      `区間: ${legs.length}件（${firstLeg.fromHotel} → ${firstLeg.toHotel}${legs.length > 1 ? " ほか" : ""}）`,
      `発行状況: ${issueSummary}`,
      issueFailures.length ? `⚠️ 発行失敗 ${issueFailures.length}件（要確認）` : "",
    ],
    link: `/track/${bookingId}`,
    linkLabel: "追跡ページで確認",
  })

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
    // 1ヶ月以内なのに発行できなかった区間 (過去日・住所解決失敗など) — 画面で明示する
    issueFailures: issueFailures.map((r) => ({ legIndex: r.legIndex, error: r.error })),
    noticeEmailSent,
  })
}
