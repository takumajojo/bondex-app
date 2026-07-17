import { getSupabase } from "@/lib/supabase"

/**
 * shipments テーブル CRUD.
 *
 * Supabase 未設定の環境では各関数が noop で返る (DB 機能 OFF でも本体は動く).
 * これにより POC 環境と本番環境で同じコードを共有できる.
 */

export type ShipmentStatus =
  | "requested"   // 代理店の発行依頼 (登録のみ・BondEx 未発行)
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
  tour_number: string | null
  group_name: string | null
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
  /** 書類一式を格納した Google Drive フォルダの共有 URL (BondEx が発行後に登録)。 */
  drive_url: string | null
  /** ヤマトお届け時間帯 (DELIVERY_TIME_SLOTS の値)。代理店の希望。 */
  delivery_time: string | null
  /** 配送キャリア (sagawa=佐川 / yamato=ヤマト)。既定=佐川。 */
  carrier: string
  /** バウチャー言語 (en/zh)。null は en 扱い。 */
  guest_language: string | null
  /** 集荷漏れアラート送信日時 (cron が設定・二重通知防止)。 */
  pickup_alert_sent_at: string | null
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
 *
 * 重要: この関数は **絶対に throw しない**. DB 保存失敗が Yamato 発行成功を
 *       覆い隠さないよう、内部で全エラーを握り潰してログに残す.
 */
export async function saveShipment(
  input: Partial<ShipmentInsert>,
): Promise<{ ok: boolean; error?: string }> {
  let sb: ReturnType<typeof getSupabase>
  try {
    sb = getSupabase()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[shipments-db] getSupabase failed:", msg)
    return { ok: false, error: msg }
  }
  if (!sb) return { ok: false, error: "Supabase not configured" }
  if (!input.booking_id) return { ok: false, error: "booking_id required" }
  // 必須フィールドのデフォルト
  const row = {
    booking_id: input.booking_id,
    leg_index: input.leg_index ?? 0,
    agency: input.agency ?? "",
    representative: input.representative ?? "",
    traveler_count: input.traveler_count ?? 1,
    booking_name: input.booking_name ?? null,
    tour_number: input.tour_number ?? null,
    group_name: input.group_name ?? null,
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
    drive_url: input.drive_url ?? null,
    delivery_time: input.delivery_time ?? null,
    carrier: input.carrier ?? "sagawa",
    guest_language: input.guest_language ?? null,
  }
  // booking_id + leg_index で同一区間を update (再発行対応)
  const { error } = await sb
    .from("shipments")
    .upsert(row, { onConflict: "booking_id,leg_index", ignoreDuplicates: false })
  if (error) {
    console.error("[shipments-db] saveShipment failed", error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/**
 * ダッシュボード用一覧取得. created_at 降順、最大 100件.
 */
export async function listShipments(filter?: {
  agency?: string
  status?: ShipmentStatus
  fromDate?: string
  toDate?: string
  /** 予約番号・代表者・受取人・ツアー番号の部分一致検索 */
  search?: string
  limit?: number
}): Promise<ShipmentRecord[]> {
  const sb = getSupabase()
  if (!sb) return []
  let q = sb.from("shipments").select("*").order("created_at", { ascending: false })
  if (filter?.agency) q = q.eq("agency", filter.agency)
  if (filter?.status) q = q.eq("status", filter.status)
  if (filter?.fromDate) q = q.gte("shipment_date", filter.fromDate)
  if (filter?.toDate) q = q.lte("shipment_date", filter.toDate)
  if (filter?.search) {
    // PostgREST の or() 構文に流すため、区切り文字になりうる記号を除去
    const s = filter.search.replace(/[,%()]/g, "").trim()
    if (s) {
      q = q.or(
        `booking_id.ilike.%${s}%,representative.ilike.%${s}%,recipient.ilike.%${s}%,tour_number.ilike.%${s}%`,
      )
    }
  }
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
 * 運用フィールドの編集 (ダッシュボードの編集モーダル用)。
 * 変更できるのは配送の実務に関わる最小限のフィールドのみ。
 * ホテル・氏名の変更は「削除して再発行」に誘導する (送り状と食い違う事故防止)。
 */
export async function updateShipmentFields(
  id: string,
  patch: {
    shipment_date?: string
    expected_arrival?: string | null
    suitcase_count?: number
    notes?: string | null
    status?: ShipmentStatus
    /** 予約単位の Drive フォルダ URL。update 時は同一 booking_id の全区間に反映する。 */
    drive_url?: string | null
  },
): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase()
  if (!sb) return { ok: false, error: "Supabase not configured" }
  const update: Record<string, unknown> = {}
  if (patch.shipment_date !== undefined) update.shipment_date = patch.shipment_date
  if (patch.expected_arrival !== undefined) update.expected_arrival = patch.expected_arrival
  if (patch.suitcase_count !== undefined) update.suitcase_count = patch.suitcase_count
  if (patch.notes !== undefined) update.notes = patch.notes
  if (patch.status !== undefined) update.status = patch.status
  if (patch.drive_url !== undefined) update.drive_url = patch.drive_url
  if (Object.keys(update).length === 0) return { ok: true }
  const { error } = await sb.from("shipments").update(update).eq("id", id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * 予約単位で Drive フォルダ URL を設定する。全区間 (同一 booking_id) に反映。
 * BondEx が発行後、書類を格納した Google Drive フォルダのリンクを登録する用途。
 */
export async function setBookingDriveUrl(
  bookingId: string,
  driveUrl: string | null,
): Promise<{ ok: boolean; updated: number; error?: string }> {
  const sb = getSupabase()
  if (!sb) return { ok: false, updated: 0, error: "Supabase not configured" }
  const { data, error } = await sb
    .from("shipments")
    .update({ drive_url: driveUrl })
    .eq("booking_id", bookingId)
    .select("id")
  if (error) return { ok: false, updated: 0, error: error.message }
  return { ok: true, updated: data?.length ?? 0 }
}

/**
 * 予約単位の削除 (誤作成のクリーンアップ用)。全区間を物理削除する。
 * 発行済み送り状の破棄は Ship&co 側の操作が必要 — UI で必ず注意を出すこと。
 */
export async function deleteBooking(
  bookingId: string,
): Promise<{ ok: boolean; deleted: number; error?: string }> {
  const sb = getSupabase()
  if (!sb) return { ok: false, deleted: 0, error: "Supabase not configured" }
  const { data, error } = await sb
    .from("shipments")
    .delete()
    .eq("booking_id", bookingId)
    .select("id")
  if (error) return { ok: false, deleted: 0, error: error.message }
  return { ok: true, deleted: data?.length ?? 0 }
}

/**
 * 二重発行チェック: 同じ氏名 (代表者 or 受取人) + 同じ発送日の
 * 既存予約 (キャンセル除く) を探す。発行前の警告用。
 */
export async function findDuplicateBookings(params: {
  names: string[]
  dates: string[]
  /** 指定時はこの代理店の予約のみ対象 (代理店ポータルの自社内チェック用)。 */
  agency?: string
}): Promise<
  Array<
    Pick<
      ShipmentRecord,
      "booking_id" | "representative" | "recipient" | "shipment_date" | "from_hotel" | "to_hotel" | "status"
    >
  >
> {
  const sb = getSupabase()
  if (!sb) return []
  const names = params.names
    .map((n) => n.replace(/[,%()]/g, "").trim())
    .filter((n) => n.length >= 2)
  const dates = params.dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  if (names.length === 0 || dates.length === 0) return []
  const orExpr = names
    .flatMap((n) => [`representative.ilike.%${n}%`, `recipient.ilike.%${n}%`])
    .join(",")
  let q = sb
    .from("shipments")
    .select("booking_id, representative, recipient, shipment_date, from_hotel, to_hotel, status")
    .in("shipment_date", dates)
    .neq("status", "cancelled")
    .or(orExpr)
  if (params.agency) q = q.eq("agency", params.agency)
  const { data, error } = await q.limit(20)
  if (error) {
    console.error("[shipments-db] findDuplicateBookings failed", error.message)
    return []
  }
  return (data ?? []) as Array<
    Pick<
      ShipmentRecord,
      "booking_id" | "representative" | "recipient" | "shipment_date" | "from_hotel" | "to_hotel" | "status"
    >
  >
}

/**
 * 集荷漏れ候補: 発送日を過ぎても集荷が確認できていない区間。
 * (status が pending/issued のまま = picked_up 以降に進んでいない)
 */
export async function listPickupMisses(
  todayJstYmd: string,
): Promise<ShipmentRecord[]> {
  const sb = getSupabase()
  if (!sb) return []
  const { data, error } = await sb
    .from("shipments")
    .select("*")
    .in("status", ["pending", "issued"])
    .lte("shipment_date", todayJstYmd)
    .is("pickup_alert_sent_at", null)
  if (error) {
    console.error("[shipments-db] listPickupMisses failed", error.message)
    return []
  }
  return (data ?? []) as ShipmentRecord[]
}

export async function markPickupAlerted(ids: string[]): Promise<void> {
  const sb = getSupabase()
  if (!sb || ids.length === 0) return
  const { error } = await sb
    .from("shipments")
    .update({ pickup_alert_sent_at: new Date().toISOString() })
    .in("id", ids)
  if (error) console.error("[shipments-db] markPickupAlerted failed", error.message)
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
