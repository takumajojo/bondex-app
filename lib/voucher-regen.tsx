import { renderToBuffer } from "@react-pdf/renderer"
import QRCode from "qrcode"
import type { SupabaseClient } from "@supabase/supabase-js"
import { buildVoucherFileName } from "@/lib/utils"
import { getPlaceNameByLang, hasJapanese } from "@/lib/places-search"
import {
  VoucherDocument,
  SUPPORT_DEFAULTS,
  formatIssuedDate,
  normalizeGuestLanguage,
  type VoucherInput,
} from "@/lib/voucher-pdf"
import { cleanResidence } from "@/lib/residence"

/** 個人宅住所を1行に整形（バウチャーの住所欄用）。ホテル(null)なら空文字。 */
function residenceLine(raw: unknown): string {
  const r = cleanResidence(raw)
  if (!r || (!r.street && !r.city)) return ""
  const zip = r.zip ? `〒${r.zip} ` : ""
  const bld = r.building ? ` ${r.building}` : ""
  return `${zip}${r.prefecture}${r.city}${r.street}${bld}`.trim()
}

/**
 * 発行済み shipments データから Voucher PDF を再生成する共有ロジック。
 *
 * 運営 (/api/voucher/regenerate) と代理店 (/api/agency/voucher) の両方から使う。
 * 代理店ルートは自社の予約しか再発行できないよう、opts.expectedAgency に自社名を渡す
 * と、一致しない場合 { ok:false, reason:"forbidden" } を返す (他社バウチャーの漏洩防止)。
 */

type RegenOutcome =
  | { ok: true; buf: Uint8Array; fileName: string; agencyName: string }
  | { ok: false; reason: "not_found" | "forbidden" }

export async function regenerateVoucherPdf(
  sb: SupabaseClient,
  bookingId: string,
  opts?: { expectedAgency?: string; includeHowto?: boolean },
): Promise<RegenOutcome> {
  const { data, error } = await sb
    .from("shipments")
    .select(
      "booking_id, leg_index, agency, representative, traveler_count, booking_name, tour_number, group_name, shipment_date, expected_arrival, from_hotel, from_city, from_check_in, from_residence, to_hotel, to_city, to_check_out, to_residence, recipient, suitcase_count, amount_yen, notes, note_target, guest_language, carrier, from_place_id, to_place_id, from_hotel_en, to_hotel_en",
    )
    .eq("booking_id", bookingId)
    .order("leg_index", { ascending: true })

  if (error) throw new Error(error.message)
  if (!data || data.length === 0) return { ok: false, reason: "not_found" }

  const agencyName: string = data[0].agency ?? ""

  // 所有権チェック: 代理店ルートでは自社の予約のみ許可
  if (opts?.expectedAgency !== undefined && agencyName !== opts.expectedAgency) {
    return { ok: false, reason: "forbidden" }
  }

  // 代理店情報 (担当者名・電話) も取得
  const { data: agencyRow } = await sb
    .from("agencies")
    .select("contact_person, contact_phone")
    .eq("name", agencyName)
    .maybeSingle()

  const representativeLabel = data[0].representative ?? ""
  const tourNumber = data[0].tour_number || undefined
  const groupName = data[0].group_name || undefined

  // react-pdf は canvas/JS を実行できないため、QR は事前に画像化しておく。
  let trackingQrDataUri: string | undefined
  let supportQrDataUri: string | undefined
  const waUrl = process.env.BONDEX_WHATSAPP_URL?.trim()
  try {
    supportQrDataUri = await QRCode.toDataURL(waUrl || `mailto:${SUPPORT_DEFAULTS.email}`, {
      margin: 0,
      width: 200,
      color: { dark: "#16161a", light: "#FFFFFF" },
    })
    trackingQrDataUri = await QRCode.toDataURL(`https://bondex.express/track/${bookingId}`, {
      margin: 0,
      width: 200,
      color: { dark: "#1A1A1A", light: "#FFFFFF" },
    })
  } catch (err) {
    console.error("[voucher-regen] QR generation failed:", err)
  }

  // ホテル名の英語併記 (バウチャーはお客様が読むため)。日本語名のホテルだけ Google Places
  // から英語名を補い、DB にキャッシュ (次回以降は API を叩かない)。失敗しても JP 名で継続。
  type Row = (typeof data)[number] & {
    from_place_id?: string | null; to_place_id?: string | null
    from_hotel_en?: string | null; to_hotel_en?: string | null
    from_residence?: unknown; to_residence?: unknown
  }
  const enName = new Map<number, { from?: string; to?: string }>()
  await Promise.all(
    (data as Row[]).map(async (s) => {
      const out: { from?: string; to?: string } = {}
      const wb: Record<string, string> = {}
      const fromJa = s.from_hotel ?? ""
      const toJa = s.to_hotel ?? ""
      if (s.from_hotel_en) out.from = s.from_hotel_en
      else if (hasJapanese(fromJa) && s.from_place_id) {
        const n = await getPlaceNameByLang(s.from_place_id, "en")
        if (n && !hasJapanese(n)) { out.from = n; wb.from_hotel_en = n }
      }
      if (s.to_hotel_en) out.to = s.to_hotel_en
      else if (hasJapanese(toJa) && s.to_place_id) {
        const n = await getPlaceNameByLang(s.to_place_id, "en")
        if (n && !hasJapanese(n)) { out.to = n; wb.to_hotel_en = n }
      }
      if (Object.keys(wb).length) {
        await sb.from("shipments").update(wb).eq("booking_id", bookingId).eq("leg_index", s.leg_index)
      }
      enName.set(s.leg_index, out)
    }),
  )

  const input: VoucherInput = {
    bookingId,
    issuedDate: formatIssuedDate(),
    representativeLabel,
    groupName,
    tourCompany: agencyName,
    carrier: (data[0] as { carrier?: string }).carrier ?? "sagawa",
    tourNumber,
    travelerCount: data[0].traveler_count ?? 1,
    totalAmount: data.reduce((sum, s) => sum + (s.amount_yen ?? 0), 0),
    supportPhone: SUPPORT_DEFAULTS.phone,
    supportEmail: SUPPORT_DEFAULTS.email,
    contactPersonName: agencyRow?.contact_person ?? "",
    contactPersonPhone: agencyRow?.contact_phone ?? "",
    companyName: SUPPORT_DEFAULTS.companyName,
    companyAddress: SUPPORT_DEFAULTS.companyAddress,
    trackingQrDataUri,
    supportQrDataUri,
    supportQrKind: waUrl ? "whatsapp" : "email",
    guestLanguage: normalizeGuestLanguage(data[0].guest_language),
    // 既定 = ガイド同梱。呼び出し側が false を渡したときだけ省く。
    includeHowto: opts?.includeHowto !== false,
    shipments: (data as Row[]).map((s) => ({
      shipmentDate: s.shipment_date,
      expectedArrival: s.expected_arrival ?? s.shipment_date,
      // 個人宅は住所を1行に整形して address に入れる（ホテルは空＝名称のみ表示）。
      from: { hotel: s.from_hotel ?? "", address: residenceLine(s.from_residence), city: s.from_city ?? "" },
      to: { hotel: s.to_hotel ?? "", address: residenceLine(s.to_residence), city: s.to_city ?? "" },
      fromHotelEn: enName.get(s.leg_index)?.from,
      toHotelEn: enName.get(s.leg_index)?.to,
      recipient: s.recipient ?? "",
      suitcaseCount: s.suitcase_count ?? 0,
      bookingName: s.booking_name ?? undefined,
      fromCheckIn: s.from_check_in ?? undefined,
      toCheckOut: s.to_check_out ?? undefined,
      specialNote: s.notes ?? undefined,
      noteTarget: (s.note_target as "from" | "to" | "both" | null) ?? undefined,
    })),
  }

  const buf = await renderToBuffer(<VoucherDocument data={input} />)
  const fileName = buildVoucherFileName({
    bookingId,
    tourNumber,
    representativeLabel,
    kind: "voucher",
  })
  return { ok: true, buf: new Uint8Array(buf), fileName, agencyName }
}
