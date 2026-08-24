// 団体予約 (booking_type='group') の「個荷」管理。
// 1行 = 1スーツケース。誰の荷物か (guest_name) と追跡番号の対応を持つ。
//
// 設計原則: 個々の荷物ステータスは保存せず導出する。
//   - 既定の対応: yamato_tracking[luggage_no - 1] (発行時のラベル連番と一致)
//   - tracking_number が保存されていればそれを優先 (物理的に貼り替えた場合の確定値)
//   - 状態: manual_status(手動上書き) > 追跡明細の exception(=issue) > 追跡明細の status > 区間 status
// これにより毎時の追跡同期 (sync-tracking) を一切変更せず、団体ダッシュボードは
// 既に蓄積されている per-number 明細の読み取りモデルとして成立する。

import { getSupabase } from "./supabase"
import type { ShipmentRecord, ShipmentStatus } from "./shipments-db"

export interface GroupLuggageRecord {
  id: string
  booking_id: string
  leg_index: number
  luggage_no: number
  guest_name: string
  tracking_number: string | null
  manual_status: string | null
  issue_note: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** 荷物1個の表示ステータス。 */
export type LuggageStatus =
  | "pending" // 未集荷 (依頼中/発行待ち/発行済)
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "issue" // 遅延・調査中・持戻などの異常 / 発行失敗
  | "cancelled"

/** 団体全体のステータス (導出・保存しない)。 */
export type GroupStatus =
  | "preparing"
  | "in_transit"
  | "partially_delivered"
  | "delivered"
  | "issue"
  | "cancelled"

/** yamato_tracking_detail の1要素 (sync-tracking が書く形)。 */
export interface TrackingDetailEntry {
  number: string
  status?: ShipmentStatus | null
  rawStatus?: string
  exception?: string
  location?: string
  date?: string
  checkedAt?: string
}

/** 区間 status → 荷物既定ステータス。 */
function legFallback(leg: Pick<ShipmentRecord, "status">): LuggageStatus {
  switch (leg.status) {
    case "picked_up":
      return "picked_up"
    case "in_transit":
      return "in_transit"
    case "delivered":
      return "delivered"
    case "cancelled":
      return "cancelled"
    case "failed":
      return "issue"
    default:
      return "pending" // requested / pending / issued
  }
}

/** 荷物1個のステータスを導出。resolvedNumber も返す (UI 表示用)。 */
export function deriveLuggageStatus(
  lug: Pick<GroupLuggageRecord, "luggage_no" | "tracking_number" | "manual_status">,
  leg: Pick<ShipmentRecord, "status" | "yamato_tracking" | "yamato_tracking_detail">,
  detailByNumber: Map<string, TrackingDetailEntry>,
): { status: LuggageStatus; trackingNumber: string | null; exception: string | null; lastUpdate: string | null } {
  const trackingNumber =
    lug.tracking_number || (leg.yamato_tracking ? leg.yamato_tracking[lug.luggage_no - 1] ?? null : null)

  if (leg.status === "cancelled") {
    return { status: "cancelled", trackingNumber, exception: null, lastUpdate: null }
  }
  if (lug.manual_status) {
    return { status: lug.manual_status as LuggageStatus, trackingNumber, exception: null, lastUpdate: null }
  }
  const d = trackingNumber ? detailByNumber.get(trackingNumber) : undefined
  if (d?.exception) {
    return { status: "issue", trackingNumber, exception: d.exception, lastUpdate: d.date ?? d.checkedAt ?? null }
  }
  if (d?.status) {
    const mapped: LuggageStatus =
      d.status === "picked_up" || d.status === "in_transit" || d.status === "delivered"
        ? d.status
        : legFallback(leg)
    return { status: mapped, trackingNumber, exception: null, lastUpdate: d.date ?? d.checkedAt ?? null }
  }
  return { status: legFallback(leg), trackingNumber, exception: null, lastUpdate: null }
}

export interface GroupSummary {
  total: number
  delivered: number
  inTransit: number // picked_up + in_transit
  pending: number
  issue: number
  cancelled: number
  progressPct: number // delivered / (total - cancelled)
}

export function summarize(statuses: LuggageStatus[]): GroupSummary {
  const s: GroupSummary = { total: statuses.length, delivered: 0, inTransit: 0, pending: 0, issue: 0, cancelled: 0, progressPct: 0 }
  for (const st of statuses) {
    if (st === "delivered") s.delivered++
    else if (st === "picked_up" || st === "in_transit") s.inTransit++
    else if (st === "issue") s.issue++
    else if (st === "cancelled") s.cancelled++
    else s.pending++
  }
  const denom = s.total - s.cancelled
  s.progressPct = denom > 0 ? Math.round((s.delivered / denom) * 100) : 0
  return s
}

/** 団体全体のステータス判定 (仕様: 1件でも issue → Issue / 全 delivered → Delivered / 混在 → Partially)。 */
export function deriveGroupStatus(statuses: LuggageStatus[]): GroupStatus {
  const active = statuses.filter((s) => s !== "cancelled")
  if (active.length === 0) return statuses.length > 0 ? "cancelled" : "preparing"
  if (active.some((s) => s === "issue")) return "issue"
  if (active.every((s) => s === "delivered")) return "delivered"
  if (active.some((s) => s === "delivered")) return "partially_delivered"
  if (active.some((s) => s === "in_transit" || s === "picked_up")) return "in_transit"
  return "preparing"
}

// ---------------------------------------------------------------------------
// CRUD (サーバー側・service_role のみ。代理店の読み取りは RLS ポリシー)
// ---------------------------------------------------------------------------

export async function listGroupLuggage(bookingId: string): Promise<GroupLuggageRecord[]> {
  const sb = getSupabase()
  if (!sb) return []
  const { data, error } = await sb
    .from("group_luggage")
    .select("*")
    .eq("booking_id", bookingId)
    .order("leg_index", { ascending: true })
    .order("luggage_no", { ascending: true })
  if (error) {
    console.error("[group-luggage] list failed:", error.message)
    return []
  }
  return (data ?? []) as GroupLuggageRecord[]
}

/**
 * 区間の個荷をまとめて登録。names[i] が luggage_no=i+1 のゲスト名 (空文字可)。
 * 既存の同 (booking_id, leg_index, luggage_no) は upsert で上書きしない (ゲスト名保護) —
 * 新規行のみ挿入する。
 */
export async function bulkInsertLuggage(
  bookingId: string,
  legIndex: number,
  names: string[],
): Promise<{ ok: boolean; inserted: number; error?: string }> {
  const sb = getSupabase()
  if (!sb) return { ok: false, inserted: 0, error: "Supabase not configured" }
  if (names.length === 0) return { ok: true, inserted: 0 }
  const rows = names.map((n, i) => ({
    booking_id: bookingId,
    leg_index: legIndex,
    luggage_no: i + 1,
    guest_name: (n ?? "").trim().slice(0, 80),
  }))
  const { error } = await sb
    .from("group_luggage")
    .upsert(rows, { onConflict: "booking_id,leg_index,luggage_no", ignoreDuplicates: true })
  if (error) {
    console.error("[group-luggage] bulk insert failed:", error.message)
    return { ok: false, inserted: 0, error: error.message }
  }
  return { ok: true, inserted: rows.length }
}

export async function updateGroupLuggage(
  id: string,
  patch: Partial<Pick<GroupLuggageRecord, "guest_name" | "tracking_number" | "manual_status" | "issue_note" | "notes">>,
): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase()
  if (!sb) return { ok: false, error: "Supabase not configured" }
  const { error } = await sb.from("group_luggage").update(patch).eq("id", id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function deleteGroupLuggageForBooking(bookingId: string): Promise<void> {
  const sb = getSupabase()
  if (!sb) return
  try {
    await sb.from("group_luggage").delete().eq("booking_id", bookingId)
  } catch {
    /* best-effort (予約削除時の掃除) */
  }
}
