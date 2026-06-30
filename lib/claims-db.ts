import { getSupabase } from "@/lib/supabase"

/**
 * claim_cases テーブル CRUD.
 * BondEx 管理側でのみ使う (代理店アクセスなし).
 */

export type ClaimCategory =
  | "damage"          // 毀損
  | "loss"            // 紛失
  | "delay"           // 遅配
  | "wrong_delivery"  // 誤配
  | "other"

export type ClaimStatus =
  | "open"           // 受付済
  | "investigating"  // 調査中
  | "resolved"       // 解決済
  | "closed"         // 案件クローズ
  | "rejected"       // 却下

export type ReportedBy = "agency" | "traveler" | "hotel" | "bondex" | "yamato"

export interface ClaimRecord {
  id: string
  shipment_id: string | null
  booking_id: string | null
  leg_index: number | null
  category: ClaimCategory
  reported_by: ReportedBy | null
  reporter_name: string | null
  reporter_contact: string | null
  description: string
  resolution: string | null
  claim_amount_yen: number | null
  yamato_case_number: string | null
  status: ClaimStatus
  occurred_at: string | null
  reported_at: string
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export type ClaimInsert = {
  shipment_id?: string | null
  booking_id?: string | null
  leg_index?: number | null
  category: ClaimCategory
  reported_by?: ReportedBy | null
  reporter_name?: string | null
  reporter_contact?: string | null
  description: string
  resolution?: string | null
  claim_amount_yen?: number | null
  yamato_case_number?: string | null
  status?: ClaimStatus
  occurred_at?: string | null
}

export async function listClaims(filter?: {
  status?: ClaimStatus
  bookingId?: string
  limit?: number
}): Promise<ClaimRecord[]> {
  const sb = getSupabase()
  if (!sb) return []
  try {
    let q = sb.from("claim_cases").select("*").order("created_at", { ascending: false })
    if (filter?.status) q = q.eq("status", filter.status)
    if (filter?.bookingId) q = q.eq("booking_id", filter.bookingId)
    q = q.limit(filter?.limit ?? 200)
    const { data, error } = await q
    if (error) {
      console.error("[claims-db] listClaims failed:", error.message)
      return []
    }
    return (data ?? []) as ClaimRecord[]
  } catch (err) {
    console.error("[claims-db] listClaims exception:", err instanceof Error ? err.message : err)
    return []
  }
}

export async function createClaim(input: ClaimInsert): Promise<{ ok: boolean; id?: string; error?: string }> {
  const sb = getSupabase()
  if (!sb) return { ok: false, error: "Supabase not configured" }
  try {
    const row = {
      shipment_id: input.shipment_id ?? null,
      booking_id: input.booking_id ?? null,
      leg_index: input.leg_index ?? null,
      category: input.category,
      reported_by: input.reported_by ?? null,
      reporter_name: input.reporter_name ?? null,
      reporter_contact: input.reporter_contact ?? null,
      description: input.description,
      resolution: input.resolution ?? null,
      claim_amount_yen: input.claim_amount_yen ?? null,
      yamato_case_number: input.yamato_case_number ?? null,
      status: input.status ?? "open",
      occurred_at: input.occurred_at ?? null,
    }
    const { data, error } = await sb.from("claim_cases").insert(row).select("id").single()
    if (error) return { ok: false, error: error.message }
    return { ok: true, id: (data as { id: string }).id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Insert failed" }
  }
}

export async function updateClaim(
  id: string,
  patch: Partial<ClaimInsert>,
): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase()
  if (!sb) return { ok: false, error: "Supabase not configured" }
  try {
    // status を resolved/closed に変えるなら resolved_at もセット
    const fullPatch: Record<string, unknown> = { ...patch }
    if (patch.status && ["resolved", "closed"].includes(patch.status)) {
      fullPatch.resolved_at = new Date().toISOString()
    }
    const { error } = await sb.from("claim_cases").update(fullPatch).eq("id", id)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Update failed" }
  }
}
