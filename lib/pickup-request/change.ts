// 集荷依頼の受付後の変更 (ホテル・問い合わせ番号) の管理。DB 関数 (sql/062) を呼ぶだけで、判定と更新は DB 側で
// 1トランザクションにまとめている。佐川の回答 (承認) の前は区間のホテル情報を変えない。新しい集荷依頼は送らない。
//   登録 (requested) → 世田谷へ連絡 (contacted) → 佐川の回答 approved / rejected → 反映 (applied)
//   連絡前は取り下げ (withdrawn) できる。

import { getSupabase } from "@/lib/supabase"
import { fetchHotelPlaceDetailsJa, parseJpAddressString, pickComponent } from "@/lib/hotel-place"
import { PLACES_TIMEOUT_MS } from "@/lib/pickup-request/leg-input"

export type ChangeStep = "contact" | "approve" | "reject" | "withdraw"

export interface PickupChangeRow {
  id: string
  shipment_id: string
  pickup_request_id: string
  side: "guest" | "pickup" | null
  new_hotel: string | null
  new_hotel_ja: string | null
  new_place_id: string | null
  new_city: string | null
  new_prefecture: string | null
  reason: string
  state: "requested" | "contacted" | "approved" | "rejected" | "applied" | "withdrawn"
  number_policy: "kept" | "changed" | null
  new_shipping_number: string | null
  old_shipping_number: string | null
  old_hotel: string | null
  old_hotel_ja: string | null
  requested_by: string
  contacted_by: string | null
  contact_note: string | null
  answered_by: string | null
  answer_note: string | null
  applied_by: string | null
  applied_at: string | null
  created_at: string
  updated_at: string
}

export const CHANGE_STATE_JA: Record<PickupChangeRow["state"], string> = {
  requested: "変更希望を登録 (世田谷へ未連絡)",
  contacted: "世田谷へ連絡済み (佐川の回答待ち)",
  approved: "佐川が承認 (BondEx へ未反映)",
  rejected: "佐川が変更不可と回答",
  applied: "反映済み",
  withdrawn: "取り下げ",
}

const REASON_JA: Record<string, string> = {
  shipment_not_found: "区間が見つかりません",
  shipment_cancelled: "取消済みの区間です",
  picked_up_or_later: "集荷済み以降の区間は変更できません",
  no_live_request: "佐川への集荷依頼の記録がありません (未依頼の区間は通常のホテル変更を使ってください)",
  request_change_pending: "別の変更・取消を世田谷へ連絡中です。佐川の回答を記録してからにしてください",
  request_unknown: "集荷依頼の結果が不明です。先に佐川へ確認して記録してください",
  request_sending: "集荷依頼を送信中です",
  request_needs_review: "依頼済みか不明の記録があります。先に確認して記録してください",
  reason_required: "変更の理由を入力してください",
  hotel_required: "新しいホテル (英名と Google の place_id) を指定してください",
  open_change_exists: "この区間には進行中の変更があります",
  not_found: "変更の記録が見つかりません",
  state_mismatch: "状態が変わっています。画面を更新してください",
  note_required: "連絡内容・佐川の回答の内容を入力してください",
  number_policy_required: "問い合わせ番号が維持されるか、振り直されるかを選んでください",
  invalid_number: "新しい問い合わせ番号は10〜12桁の数字です",
  same_number: "新しい問い合わせ番号が今の番号と同じです (維持を選んでください)",
  number_in_use: "その問い合わせ番号は別の区間で使われています",
  number_not_expected: "番号を維持する場合は、新しい番号を入力しないでください",
  invalid_step: "不明な操作です",
}
export const changeReasonJa = (r: string) => REASON_JA[r] ?? `処理できませんでした (${r})`

/**
 * 変更先ホテルの place_id を Google Places で確かめる (運営画面は候補の選択からだけ place_id を入れるが、
 * API を直接呼ばれても実在しない place_id では登録させない)。都道府県・市区は Google の値を正とする。
 */
export async function verifyChangeHotel(
  placeId: string,
  apiKey: string | undefined,
  fetchPlace: typeof fetchHotelPlaceDetailsJa = fetchHotelPlaceDetailsJa,
): Promise<{ ok: true; prefecture: string | null; city: string | null } | { ok: false; status: number; reason: string }> {
  if (!apiKey) return { ok: false, status: 503, reason: "GOOGLE_MAPS_API_KEY が未設定のため、ホテルを確認できません" }
  let d: Awaited<ReturnType<typeof fetchHotelPlaceDetailsJa>>
  try {
    d = await fetchPlace("", apiKey, placeId, { timeoutMs: PLACES_TIMEOUT_MS })
  } catch {
    return { ok: false, status: 502, reason: "ホテルの照会が完了しませんでした。時間をおいて再度登録してください" }
  }
  if (!d) return { ok: false, status: 422, reason: "選んだホテルを Google で確認できません。ホテル名で検索し直してください" }
  const parsed = parseJpAddressString(d.formattedAddress)
  return {
    ok: true,
    prefecture: pickComponent(d.components, "administrative_area_level_1") || parsed.prefecture || null,
    city: pickComponent(d.components, "locality") || null,
  }
}

function sb() {
  const c = getSupabase()
  if (!c) throw new Error("Supabase が設定されていません")
  return c
}

export async function listPickupChanges(shipmentId: string): Promise<PickupChangeRow[]> {
  const { data, error } = await sb()
    .from("pickup_change_requests")
    .select("*")
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: false })
  if (error) throw new Error(`変更の記録を読めません: ${error.message}`)
  return (data ?? []) as PickupChangeRow[]
}

export async function createPickupChange(i: {
  shipmentId: string
  side: "guest" | "pickup" | null
  newHotel?: string | null
  newHotelJa?: string | null
  newPlaceId?: string | null
  newCity?: string | null
  newPrefecture?: string | null
  reason: string
  actor: string
}): Promise<{ ok: true; changeId: string } | { ok: false; reason: string }> {
  const { data, error } = await sb().rpc("create_pickup_change", {
    p_shipment_id: i.shipmentId,
    p_side: i.side,
    p_new_hotel: i.newHotel ?? null,
    p_new_hotel_ja: i.newHotelJa ?? null,
    p_new_place_id: i.newPlaceId ?? null,
    p_new_city: i.newCity ?? null,
    p_new_prefecture: i.newPrefecture ?? null,
    p_reason: i.reason,
    p_actor: i.actor,
  })
  if (error) throw new Error(`変更を登録できません: ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; change_id?: string; reason?: string } | null
  return row?.ok && row.change_id ? { ok: true, changeId: row.change_id } : { ok: false, reason: changeReasonJa(row?.reason ?? "unknown") }
}

export async function stepPickupChange(i: {
  changeId: string
  step: ChangeStep
  actor: string
  note?: string | null
  numberPolicy?: "kept" | "changed" | null
  newNumber?: string | null
}): Promise<{ ok: true; state: string } | { ok: false; reason: string }> {
  const { data, error } = await sb().rpc("step_pickup_change", {
    p_change_id: i.changeId,
    p_step: i.step,
    p_actor: i.actor,
    p_note: i.note ?? null,
    p_number_policy: i.numberPolicy ?? null,
    p_new_number: i.newNumber ?? null,
  })
  if (error) throw new Error(`変更を記録できません: ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; state?: string; reason?: string } | null
  return row?.ok ? { ok: true, state: row.state ?? "" } : { ok: false, reason: changeReasonJa(row?.reason ?? "unknown") }
}

export async function applyPickupChange(changeId: string, actor: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await sb().rpc("apply_pickup_change", { p_change_id: changeId, p_actor: actor })
  if (error) throw new Error(`変更を反映できません: ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; reason?: string } | null
  if (row?.ok) return { ok: true }
  const r = row?.reason ?? "unknown"
  return { ok: false, reason: r.startsWith("state_") ? REASON_JA.state_mismatch : changeReasonJa(r) }
}
