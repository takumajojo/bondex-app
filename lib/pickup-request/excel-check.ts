// 佐川指定 Excel (output/sagawa-pickup/build_sheet.py・アプリ外) を作る前の照合 (2026-11-03 監査 P1-8)。
// Excel に入れようとしている区間が、既に佐川へ依頼済み (手動・Biz-Logi・結果不明・要確認・変更対応中)
// でないかを DB の記録で確かめる。読み取りのみ。build_sheet.py の rows.json は列31 (顧客管理番号) に
// 「予約番号-L区間」(例: BDX-PR6NBD-L1) を持つ。

import { isLive, type PickupRequestRow } from "./state"
import { legTrackingNumbers } from "@/lib/shipment-reissue"

export interface ExcelCheckLeg {
  id: string
  booking_id: string
  leg_index: number
  status: string
  tracking_numbers: unknown
  pickup_requested_at: string | null
  /** 予約の内容 (Excel の行と照合する。読んでいない時は照合しない) */
  suitcase_count?: number | null
  shipment_date?: string | null
  expected_arrival?: string | null
}

/** Excel の 1行。ref は列31 (顧客管理番号)。pieces = 列4 (総個数)・pickupDate = 列12 (集荷予定日付)・deliveryDate = 列28 (配達指定日付) */
export interface ExcelRowInput {
  ref: string
  pieces?: string | number | null
  pickupDate?: string | null
  deliveryDate?: string | null
}

/** 処理中の変更・取消の申請 (stage が requested・contacted・approved、kind が correction 以外。068 の前は status='pending') */
export interface ExcelOpenChange {
  shipment_id: string
  kind?: string | null
  stage?: string | null
}

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "")

export type ExcelRowVerdict =
  | { ref: string; ok: true }
  | { ref: string; ok: false; reason: string }

/** "BDX-PR6NBD-L1" → { bookingId: "BDX-PR6NBD", legIndex: 0 }。形式が違えば null。 */
export function parseLegRef(ref: string): { bookingId: string; legIndex: number } | null {
  const m = /^(.+)-L(\d+)$/.exec((ref || "").trim())
  if (!m || Number(m[2]) < 1) return null
  return { bookingId: m[1], legIndex: Number(m[2]) - 1 }
}

/**
 * Excel に入れてよい区間か (rows は顧客管理番号の文字列か、個数・日付つきの行)。記録が無い環境 (sql/067 未適用) では requests を空で渡し、
 * 従来の「依頼済み」印 (pickup_requested_at) と問合番号で判定する。
 */
export function checkExcelRows(
  rows: Array<string | ExcelRowInput>,
  legs: ExcelCheckLeg[],
  requests: PickupRequestRow[],
  openChanges: ExcelOpenChange[] = [],
): ExcelRowVerdict[] {
  const seen = new Set<string>()
  return rows.map((row) => {
    const input: ExcelRowInput = typeof row === "string" ? { ref: row } : row
    const ref = String(input.ref ?? "").trim()
    const p = parseLegRef(ref)
    if (!p) return { ref, ok: false, reason: "顧客管理番号が「予約番号-L区間」の形式ではありません" }
    if (seen.has(ref)) return { ref, ok: false, reason: "同じ区間が Excel に2回入っています" }
    seen.add(ref)
    const leg = legs.find((l) => l.booking_id === p.bookingId && l.leg_index === p.legIndex)
    if (!leg) return { ref, ok: false, reason: "区間が見つかりません" }
    if (leg.status === "cancelled") return { ref, ok: false, reason: "取消済みの区間です" }
    if (legTrackingNumbers(leg).length > 0) return { ref, ok: false, reason: "佐川の問合番号が入力済み (依頼済み) です" }
    const live = requests.find((r) => r.shipment_id === leg.id && isLive(r.state))
    if (live) return { ref, ok: false, reason: `集荷依頼の記録があります (${live.channel}・${live.state})` }
    // 印は、記録の有無に関係なく見る (以前は記録が1件でもあると印を見ず、記録の無い印を見落としていた・2026-11-06 監査)
    if (leg.pickup_requested_at) return { ref, ok: false, reason: "「依頼済み」の印が付いています" }
    // 処理中の変更・取消の申請がある区間は Excel に入れない (Biz-Logi と同じ。sql/083・2026-11-06 監査 B-12)
    const chg = openChanges.find((c) => c.shipment_id === leg.id)
    if (chg) return { ref, ok: false, reason: `処理中の変更・取消の申請があります (${chg.kind ?? "-"}・${chg.stage ?? "pending"})。申請を処理してから作り直してください` }
    // 予約の内容と Excel の行が違えば入れない (推測で合わせない)。予約の側を読んでいない項目は照合しない
    if (input.pieces != null && String(input.pieces).trim() !== "" && leg.suitcase_count != null && Number(digits(input.pieces)) !== Number(leg.suitcase_count)) {
      return { ref, ok: false, reason: `個数が予約と違います (Excel ${String(input.pieces).trim()}・予約 ${leg.suitcase_count})` }
    }
    if (input.pickupDate && leg.shipment_date && digits(input.pickupDate) !== digits(leg.shipment_date)) {
      return { ref, ok: false, reason: `集荷日が予約と違います (Excel ${input.pickupDate}・予約 ${leg.shipment_date})` }
    }
    if (input.deliveryDate && leg.expected_arrival && digits(input.deliveryDate) !== digits(leg.expected_arrival)) {
      return { ref, ok: false, reason: `配達指定日が予約と違います (Excel ${input.deliveryDate}・予約 ${leg.expected_arrival})` }
    }
    return { ref, ok: true }
  })
}
