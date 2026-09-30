// WhatsApp 自動応答の「配送番号 → 配送状況の返信文」ロジック。
//
// 顧客が予約番号(BDX-…)または佐川/ヤマトの追跡番号を送ると、shipments を引いて
// 配送状況の返信文を組み立てる。公開追跡 (app/api/track/[bookingId]) と同じ最小開示。
// 検索キー: booking_id (バウチャーに載る番号) / tracking_numbers[] (キャリア追跡番号)。

import type { SupabaseClient } from "@supabase/supabase-js"

const STATUS_LABEL: Record<string, { ja: string; en: string }> = {
  requested: { ja: "受付済み", en: "Requested" },
  pending: { ja: "準備中", en: "Preparing" },
  issued: { ja: "発送準備完了", en: "Label issued" },
  picked_up: { ja: "集荷完了", en: "Picked up" },
  in_transit: { ja: "配送中", en: "In transit" },
  delivered: { ja: "配達完了", en: "Delivered" },
  failed: { ja: "確認中", en: "Under review" },
  cancelled: { ja: "キャンセル", en: "Cancelled" },
}

export interface TrackingLegRow {
  booking_id: string
  leg_index: number
  from_hotel: string | null
  to_hotel: string | null
  status: string
  tracking_numbers: string[] | null
  guest_language: string | null
}

const BOOKING_RE = /BDX-[\dA-Z]+(?:-[\dA-Z]+)?/i

function isBookingId(s: string): boolean {
  return /^BDX-[\dA-Z]+(?:-[\dA-Z]+)?$/i.test(s)
}

/** メッセージ本文から予約番号(BDX-…)または追跡番号らしき文字列を1つ抽出。無ければ null。 */
export function extractQuery(text: string): string | null {
  const t = (text || "").trim()
  const bdx = t.match(BOOKING_RE)
  if (bdx) return bdx[0].toUpperCase()
  // 追跡番号 (数字・ハイフン混じり、6桁以上)。ハイフンは除去して照合。
  const num = t.match(/\d[\d-]{5,}/)
  if (num) return num[0].replace(/-/g, "")
  return null
}

const SELECT = "booking_id, leg_index, from_hotel, to_hotel, status, tracking_numbers, guest_language"

/** 予約番号または追跡番号で shipments を引く (leg 昇順)。見つからなければ空配列。 */
export async function lookupShipmentByQuery(
  sb: SupabaseClient,
  query: string,
): Promise<TrackingLegRow[]> {
  if (isBookingId(query)) {
    const { data } = await sb
      .from("shipments")
      .select(SELECT)
      .eq("booking_id", query)
      .order("leg_index", { ascending: true })
    return (data ?? []) as TrackingLegRow[]
  }
  // 追跡番号: tracking_numbers 配列に含まれる区間を探す。
  const { data } = await sb
    .from("shipments")
    .select(SELECT)
    .contains("tracking_numbers", [query])
    .order("leg_index", { ascending: true })
  return (data ?? []) as TrackingLegRow[]
}

/** 区間配列から返信文を組み立てる。旅行者の言語 (guest_language) で ja / en 出し分け。 */
export function buildTrackingReply(rows: TrackingLegRow[]): string {
  const en = (rows[0]?.guest_language ?? "en") !== "ja"
  const bookingId = rows[0].booking_id
  const lines: string[] = []
  lines.push(en ? `BondEx — Delivery status (${bookingId})` : `BondEx — ご予約 ${bookingId} の配送状況`)
  for (const r of rows) {
    const label = STATUS_LABEL[r.status]?.[en ? "en" : "ja"] ?? r.status
    const route = [r.from_hotel, r.to_hotel].filter(Boolean).join(" → ")
    lines.push(`• ${route}: ${label}`)
  }
  lines.push(
    en
      ? `Details: https://bondex.express/track/${bookingId}`
      : `詳細: https://bondex.express/track/${bookingId}`,
  )
  return lines.join("\n")
}
