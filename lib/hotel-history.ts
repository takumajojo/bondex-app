/**
 * ホテルの「初回判定」と「前回連絡情報の引き継ぎ」。
 *
 * BondEx にはホテル台帳テーブルが無く、ホテルは shipments 上の
 * from_hotel/to_hotel (英語名) + from_place_id/to_place_id (Google場所ID) として
 * 自由記述で存在する。そのため「このホテルは初めてか」「前回どう連絡したか」は
 * 過去の shipments から導出する。照合キーは place_id を最優先し、無ければホテル名(完全一致)。
 *
 * 用途:
 *   - 初回バッジ「初めてのホテル」の判定。
 *   - 新規ホテルで登録した「今後メールで受付可/メールアドレス」を、次回以降の
 *     同一ホテルに引き継いで初期表示する。
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { parseHotelContactInfo, type HotelContactRoute, type HotelRoute } from "./hotel-contact-info"

export interface HotelHistoryResult {
  /** このホテルが過去の予約(現在の予約を除く)に一度も出ていない = 初回。 */
  firstTime: boolean
  /** 直近で保存されていた同一ホテルの連絡情報 (あれば)。引き継ぎ初期値に使う。 */
  prior: HotelContactRoute | null
  /** 参考: 判定に使ったキー種別。 */
  matchedBy: "place_id" | "name" | "none"
}

interface Row {
  booking_id: string
  created_at: string
  from_place_id: string | null
  to_place_id: string | null
  from_hotel: string | null
  to_hotel: string | null
  from_hotel_ja: string | null
  to_hotel_ja: string | null
  hotel_contact_info: unknown
}

// or() 区切り記号を含む名前は名前照合をスキップ (place_id に委ねる)。
function nameSafe(name: string | null): string | null {
  if (!name) return null
  if (/[,()]/.test(name)) return null
  const s = name.trim()
  return s || null
}

// place_id を PostgREST の or() フィルタ文字列に差し込む前の検証。
// Google の place_id は [A-Za-z0-9_-] のみ。想定外の文字(カンマ等)を含むものは、
// or() 構文へのフィルタ差し込み(RLS を迂回する service_role 経由の越権読み取り)を
// 防ぐため一切採用しない。
function placeIdSafe(id: string | null): string | null {
  if (!id) return null
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null
}

/**
 * 照合条件: place_id を最優先しつつ、ホテル名(英名・和名の両方)でも完全一致で拾う。
 * place_id が無い/0件でも名前で照合できるようにするフォールバック (谷口さん 2026-09-14)。
 */
function orClauses(placeId: string | null, hotelName: string | null, hotelNameJa: string | null): string | null {
  const parts: string[] = []
  const pid = placeIdSafe(placeId)
  if (pid) parts.push(`from_place_id.eq.${pid}`, `to_place_id.eq.${pid}`)
  const en = nameSafe(hotelName)
  if (en) parts.push(`from_hotel.eq.${en}`, `to_hotel.eq.${en}`)
  const ja = nameSafe(hotelNameJa)
  if (ja) parts.push(`from_hotel_ja.eq.${ja}`, `to_hotel_ja.eq.${ja}`)
  return parts.length ? parts.join(",") : null
}

/**
 * 現在の区間 (excludeBookingId) を除いて、同一ホテルの過去実績を調べる。
 * route は現在の区間でのそのホテルの立ち位置 (pickup=from_hotel / guest=to_hotel)。
 */
export async function lookupHotelHistory(
  sb: SupabaseClient,
  params: {
    placeId: string | null
    hotelName: string | null
    /** ホテルの和名 (to_hotel_ja / from_hotel_ja)。place_id が無い/0件でも和名で照合する。 */
    hotelNameJa?: string | null
    excludeBookingId: string
  },
): Promise<HotelHistoryResult> {
  const clause = orClauses(params.placeId, params.hotelName, params.hotelNameJa ?? null)
  if (!clause) return { firstTime: true, prior: null, matchedBy: "none" }

  const { data, error } = await sb
    .from("shipments")
    .select("booking_id, created_at, from_place_id, to_place_id, from_hotel, to_hotel, from_hotel_ja, to_hotel_ja, hotel_contact_info")
    .or(clause)
    .neq("booking_id", params.excludeBookingId)
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) {
    console.error("[hotel-history] lookup failed:", error.message)
    // 判定不能時は「初回ではない」と誤って断定しない。安全側で初回扱いにせず prior 無し。
    return { firstTime: false, prior: null, matchedBy: "none" }
  }

  const rows = (data ?? []) as Row[]
  if (rows.length === 0) return { firstTime: true, prior: null, matchedBy: params.placeId ? "place_id" : "name" }

  // 直近行から、そのホテルに対応するルートの連絡情報を引き継ぎ候補にする。
  let prior: HotelContactRoute | null = null
  for (const r of rows) {
    const routeKey: HotelRoute | null =
      (params.placeId && r.from_place_id === params.placeId) ||
      (params.hotelName && r.from_hotel === params.hotelName) ||
      (params.hotelNameJa && r.from_hotel_ja === params.hotelNameJa)
        ? "pickup"
        : (params.placeId && r.to_place_id === params.placeId) ||
            (params.hotelName && r.to_hotel === params.hotelName) ||
            (params.hotelNameJa && r.to_hotel_ja === params.hotelNameJa)
          ? "guest"
          : null
    if (!routeKey) continue
    const info = parseHotelContactInfo(r.hotel_contact_info)[routeKey]
    // 引き継ぐ価値がある (今後メールOK / メール / 公式電話のいずれか) 最初の行を採用。
    if (info.futureEmail || info.officialPhone || info.futureEmailOk !== "unknown" || info.value) {
      prior = info
      break
    }
  }

  return { firstTime: false, prior, matchedBy: params.placeId ? "place_id" : "name" }
}
