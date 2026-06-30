import { getSupabase } from "@/lib/supabase"

/**
 * shipments テーブル CRUD.
 *
 * Supabase 未設定の環境では各関数が noop で返る (DB 機能 OFF でも本体は動く).
 * これにより POC 環境と本番環境で同じコードを共有できる.
 */

export type ShipmentStatus =
  | "pending"     // voucher 発行のみ、ヤマト未発行 (deferred)
  | "issued"      // ヤマト送り状発行済
  | "picked_up"   // 集荷済 (operator 手動更新)
  | "in_transit"  // 配達中 (operator 手動更新)
  | "delivered"   // 配達完了 (operator 手動更新)
  | "failed"      // ヤマト発行失敗
  | "cancelled"   // キャンセル

export interface ShipmentRecord {
  id: string
  booking_id: string
  leg_index: number
  agency: string
  representative: string
  traveler_count: number
  booking_name: string | null
  shipment_date: string  // YYYY-MM-DD
  expected_arrival: string | null
  from_hotel: string
  from_city: string | null
  from_place_id: string | null
  from_check_in: string | null
  to_hotel: string
  to_city: string | null
  to_place_id: string | null
  to_check_out: string | null
  recipient: string
  suitcase_count: number
  amount_yen: number
  yamato_tracking: string[] | null
  yamato_label_url: string | null
  yamato_issuable_from: string | null
  ship_ref_number: string | null
  status: ShipmentStatus
  error_message: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

// Insert 用 — null と undefined 両方を許容する (呼び出し側の柔軟性のため).
export type ShipmentInsert = {
  [K in keyof Omit<ShipmentRecord, "id" | "created_at" | "updated_at">]:
    ShipmentRecord[K] | undefined
}

/**
 * 1件 upsert. booking_id + leg_index で重複時は update.
 * 発行成功時 / deferred / 失敗時いずれの状態でも呼べる.
 */
export async function saveShipment(input: Partial<ShipmentInsert>): Promise<void> {
  const sb = getSupabase()
  if (!sb) return
  if (!input.booking_id) return
  // 必須フィールドのデフォルト
  const row = {
    booking_id: input.booking_id,
    leg_index: input.leg_index ?? 0,
    agency: input.agency ?? "",
    representative: input.representative ?? "",
    traveler_count: input.traveler_count ?? 1,
    booking_name: input.booking_name ?? null,
    shipment_date: input.shipment_date ?? null,
    expected_arrival: input.expected_arrival ?? null,
    from_hotel: input.from_hotel ?? "",
    from_city: input.from_city ?? null,
    from_place_id: input.from_place_id ?? null,
    from_check_in: input.from_check_in ?? null,
    to_hotel: input.to_hotel ?? "",
    to_city: input.to_city ?? null,
    to_place_id: input.to_place_id ?? null,
    to_check_out: input.to_check_out ?? null,
    recipient: input.recipient ?? "",
    suitcase_count: input.suitcase_count ?? 1,
    amount_yen: input.amount_yen ?? 0,
    yamato_tracking: input.yamato_tracking ?? null,
    yamato_label_url: input.yamato_label_url ?? null,
    yamato_issuable_from: input.yamato_issuable_from ?? null,
    ship_ref_number: input.ship_ref_number ?? null,
    status: input.status ?? "issued",
    error_message: input.error_message ?? null,
    notes: input.notes ?? null,
  }
  // booking_id + leg_index で同一区間を update (再発行対応)
  const { error } = await sb
    .from("shipments")
    .upsert(row, { onConflict: "booking_id,leg_index", ignoreDuplicates: false })
  if (error) {
    console.error("[shipments-db] saveShipment failed", error.message)
  }
}

/**
 * ダッシュボード用一覧取得. created_at 降順、最大 100件.
 */
export async function listShipments(filter?: {
  agency?: string
  status?: ShipmentStatus
  fromDate?: string
  toDate?: string
  limit?: number
}): Promise<ShipmentRecord[]> {
  const sb = getSupabase()
  if (!sb) return []
  let q = sb.from("shipments").select("*").order("created_at", { ascending: false })
  if (filter?.agency) q = q.eq("agency", filter.agency)
  if (filter?.status) q = q.eq("status", filter.status)
  if (filter?.fromDate) q = q.gte("shipment_date", filter.fromDate)
  if (filter?.toDate) q = q.lte("shipment_date", filter.toDate)
  q = q.limit(filter?.limit ?? 100)
  const { data, error } = await q
  if (error) {
    console.error("[shipments-db] listShipments failed", error.message)
    return []
  }
  return (data ?? []) as ShipmentRecord[]
}

/**
 * ステータス手動更新.
 */
export async function updateShipmentStatus(
  id: string,
  status: ShipmentStatus,
): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase()
  if (!sb) return { ok: false, error: "Supabase not configured" }
  const { error } = await sb.from("shipments").update({ status }).eq("id", id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * 代理店一覧 (重複除去). フィルタ UI のドロップダウン用.
 */
export async function listAgencies(): Promise<string[]> {
  const sb = getSupabase()
  if (!sb) return []
  const { data, error } = await sb.from("shipments").select("agency")
  if (error || !data) return []
  const set = new Set<string>()
  for (const row of data) {
    const a = (row as { agency?: string }).agency
    if (a) set.add(a)
  }
  return Array.from(set).sort()
}
