import { renderToBuffer } from "@react-pdf/renderer"
import QRCode from "qrcode"
import type { SupabaseClient } from "@supabase/supabase-js"
import { buildVoucherFileName } from "@/lib/utils"
import {
  VoucherDocument,
  SUPPORT_DEFAULTS,
  formatIssuedDate,
  normalizeGuestLanguage,
  type VoucherInput,
} from "@/lib/voucher-pdf"

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
  opts?: { expectedAgency?: string },
): Promise<RegenOutcome> {
  const { data, error } = await sb
    .from("shipments")
    .select(
      "booking_id, leg_index, agency, representative, traveler_count, booking_name, tour_number, group_name, shipment_date, expected_arrival, from_hotel, from_city, from_check_in, to_hotel, to_city, to_check_out, recipient, suitcase_count, amount_yen, notes, guest_language, carrier",
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
    shipments: data.map((s) => ({
      shipmentDate: s.shipment_date,
      expectedArrival: s.expected_arrival ?? s.shipment_date,
      from: { hotel: s.from_hotel ?? "", address: "", city: s.from_city ?? "" },
      to: { hotel: s.to_hotel ?? "", address: "", city: s.to_city ?? "" },
      recipient: s.recipient ?? "",
      suitcaseCount: s.suitcase_count ?? 0,
      bookingName: s.booking_name ?? undefined,
      fromCheckIn: s.from_check_in ?? undefined,
      toCheckOut: s.to_check_out ?? undefined,
      specialNote: s.notes ?? undefined,
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
