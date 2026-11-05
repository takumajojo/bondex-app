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
}

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
 * Excel に入れてよい区間か。記録が無い環境 (sql/067 未適用) では requests を空で渡し、
 * 従来の「依頼済み」印 (pickup_requested_at) と問合番号で判定する。
 */
export function checkExcelRows(refs: string[], legs: ExcelCheckLeg[], requests: PickupRequestRow[]): ExcelRowVerdict[] {
  const seen = new Set<string>()
  return refs.map((ref) => {
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
    return { ref, ok: true }
  })
}
