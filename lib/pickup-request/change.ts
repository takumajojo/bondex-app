// 区間の変更申請 (日程・個数・ホテル・代表者名・取消・問い合わせ番号・個別再手配)。2026-11-04 谷口さん承認 (段階A)。
// 記録は shipment_change_requests (sql/043 を sql/068 で拡張)。判定と更新は DB 関数
// (create_shipment_change / step_shipment_change / apply_shipment_change) が1トランザクションで行い、ここは呼ぶだけ。
//   佐川へ集荷依頼済みの区間 (needs_sagawa): 登録 → 世田谷へ連絡 → 佐川の回答 (承認 / 不可) → 反映
//   依頼前の区間: 登録 → 運営の承認 / 不可 → 反映
// 佐川の回答 (承認) の前は区間の情報を変えない (DB のトリガーが区間の書き換えを止める)。新しい集荷依頼は送らない。

import { getSupabase } from "@/lib/supabase"
import { fetchHotelPlaceDetailsJa, parseJpAddressString, pickComponent } from "@/lib/hotel-place"
import { placesMockEnabled } from "@/lib/places-mock"
import { PLACES_TIMEOUT_MS } from "@/lib/pickup-request/leg-input"

export type ChangeStep = "contact" | "approve" | "reject" | "withdraw"
export type ChangeKind = "hotel_guest" | "hotel_pickup" | "dates" | "count" | "representative" | "cancel" | "number" | "rearrange"
export type ChangeStage = "requested" | "contacted" | "approved" | "rejected" | "applied" | "withdrawn"

export const CHANGE_KINDS: ChangeKind[] = ["hotel_guest", "hotel_pickup", "dates", "count", "representative", "cancel", "number", "rearrange"]

export const CHANGE_KIND_JA: Record<ChangeKind, string> = {
  hotel_guest: "到着先ホテル",
  hotel_pickup: "発送元ホテル",
  dates: "日程",
  count: "個数",
  representative: "代表者名",
  cancel: "取消",
  number: "問い合わせ番号の振り直し",
  rearrange: "個別再手配",
}

/** 画面向けに整えた申請 (shipment_change_requests の1行)。 */
export interface PickupChangeRow {
  id: string
  shipment_id: string
  pickup_request_id: string | null
  kind: ChangeKind
  needs_sagawa: boolean
  fields: Record<string, unknown>
  before: Record<string, unknown>
  side: "guest" | "pickup" | null
  new_hotel: string | null
  new_hotel_ja: string | null
  old_hotel: string | null
  reason: string
  state: ChangeStage
  large_lot: boolean
  number_policy: "kept" | "changed" | null
  new_shipping_number: string | null
  old_shipping_number: string | null
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

export const CHANGE_STATE_JA: Record<ChangeStage, string> = {
  requested: "変更申請を登録 (未連絡・未承認)",
  contacted: "世田谷へ連絡済み (佐川の回答待ち)",
  approved: "承認済み (BondEx へ未反映)",
  rejected: "変更不可",
  applied: "反映済み",
  withdrawn: "取り下げ",
}

const REASON_JA: Record<string, string> = {
  shipment_not_found: "区間が見つかりません",
  shipment_cancelled: "取消済みの区間です",
  picked_up_or_later: "集荷済み以降の区間は変更できません",
  no_live_request: "佐川への集荷依頼の記録がありません",
  request_change_pending: "別の変更・取消を世田谷へ連絡中です。佐川の回答を記録してからにしてください",
  request_unknown: "集荷依頼の結果が不明です。先に佐川へ確認して記録してください",
  request_sending: "集荷依頼を送信中です。送信が終わってから申請してください",
  request_needs_review: "依頼済みか不明の記録があります。先に確認して記録してください",
  request_replaced: "申請の後に集荷依頼が置き換わっています。申請を取り下げて出し直してください",
  request_now_live: "申請の後に集荷依頼が送られました。取り下げて、佐川への連絡が要る申請として出し直してください",
  reason_required: "変更の理由を入力してください",
  hotel_required: "新しいホテル (英名と Google の place_id) を指定してください",
  fields_required: "変更する内容を入力してください",
  invalid_kind: "変更の種類が正しくありません",
  invalid_source: "申請元が正しくありません",
  invalid_fields: "変更する内容の形式が正しくありません",
  invalid_count: "個数は1〜99で入力してください",
  invalid_date: "日付の形式が正しくありません",
  representative_required: "代表者名を入力してください",
  open_change_exists: "この区間には進行中の変更申請があります",
  not_found: "変更申請が見つかりません",
  state_mismatch: "状態が変わっています。画面を更新してください",
  note_required: "連絡内容・佐川の回答の内容を入力してください",
  actor_required: "担当者名を入力してください",
  contact_not_needed: "集荷依頼前の申請は、世田谷への連絡なしで承認・不可を記録してください",
  number_policy_required: "問い合わせ番号が維持されるか、振り直されるかを選んでください",
  invalid_number: "新しい問い合わせ番号は10〜12桁の数字です",
  same_number: "新しい問い合わせ番号が今の番号と同じです (維持を選んでください)",
  number_in_use: "その問い合わせ番号は別の区間で使われています",
  number_not_expected: "番号を維持する場合 (取消・再手配を含む) は、新しい番号を入力しないでください",
  invalid_step: "不明な操作です",
}
export const changeReasonJa = (r: string) =>
  r.startsWith("field_not_allowed:") ? `この種類の申請では変えられない項目です (${r.slice(18)})` : REASON_JA[r] ?? `処理できませんでした (${r})`

/**
 * 変更先ホテルの place_id を Google Places で確かめる (運営画面は候補の選択からだけ place_id を入れるが、
 * API を直接呼ばれても実在しない place_id では登録させない)。都道府県・市区は Google の値を正とする。
 */
export async function verifyChangeHotel(
  placeId: string,
  apiKey: string | undefined,
  fetchPlace: typeof fetchHotelPlaceDetailsJa = fetchHotelPlaceDetailsJa,
): Promise<{ ok: true; prefecture: string | null; city: string | null } | { ok: false; status: number; reason: string }> {
  if (!apiKey && !placesMockEnabled()) return { ok: false, status: 503, reason: "GOOGLE_MAPS_API_KEY が未設定のため、ホテルを確認できません" }
  let d: Awaited<ReturnType<typeof fetchHotelPlaceDetailsJa>>
  try {
    d = await fetchPlace("", apiKey ?? "", placeId, { timeoutMs: PLACES_TIMEOUT_MS })
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

type DbChangeRow = Record<string, unknown> & { id: string; shipment_id: string; kind: ChangeKind; stage: ChangeStage }

function toView(r: DbChangeRow): PickupChangeRow {
  const fields = (r.fields ?? {}) as Record<string, unknown>
  const before = (r.before ?? {}) as Record<string, unknown>
  const side = r.kind === "hotel_guest" ? "guest" : r.kind === "hotel_pickup" ? "pickup" : null
  const pre = side === "guest" ? "to" : "from"
  const str = (v: unknown) => (typeof v === "string" && v ? v : null)
  return {
    id: r.id,
    shipment_id: r.shipment_id,
    pickup_request_id: str(r.pickup_request_id),
    kind: r.kind,
    needs_sagawa: r.needs_sagawa === true,
    fields,
    before,
    side,
    new_hotel: side ? str(fields[`${pre}_hotel`]) : null,
    new_hotel_ja: side ? str(fields[`${pre}_hotel_ja`]) : null,
    old_hotel: side ? str(before[`${pre}_hotel_ja`]) ?? str(before[`${pre}_hotel`]) : null,
    reason: String(r.reason ?? ""),
    state: r.stage,
    large_lot: r.large_lot === true,
    number_policy: (r.number_policy as "kept" | "changed" | null) ?? null,
    new_shipping_number: str(r.new_shipping_number),
    old_shipping_number: str(r.old_shipping_number),
    requested_by: r.requested_by === "guest" ? `旅行者 (My Booking・${str(r.requester) ?? ""})` : str(r.requested_actor) ?? str(r.requester) ?? String(r.requested_by ?? ""),
    contacted_by: str(r.contacted_by),
    contact_note: str(r.contact_note),
    answered_by: str(r.answered_by),
    answer_note: str(r.answer_note),
    applied_by: str(r.applied_by),
    applied_at: str(r.applied_at),
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? r.created_at ?? ""),
  }
}

/** 区間の変更申請 (運営の訂正の監査記録と旧来の申請は除く)。新しい順。 */
export async function listPickupChanges(shipmentId: string): Promise<PickupChangeRow[]> {
  const { data, error } = await sb()
    .from("shipment_change_requests")
    .select("*")
    .eq("shipment_id", shipmentId)
    .in("kind", CHANGE_KINDS)
    .order("created_at", { ascending: false })
  if (error) throw new Error(`変更申請を読めません: ${error.message}`)
  return ((data ?? []) as DbChangeRow[]).map(toView)
}

/** 旧画面 (ホテルの side 指定) の入力を、申請の種類と項目に直す。 */
export function hotelChangeFields(i: {
  side: "guest" | "pickup"
  newHotel?: string | null
  newHotelJa?: string | null
  newPlaceId?: string | null
  newCity?: string | null
  newPrefecture?: string | null
}): { kind: ChangeKind; fields: Record<string, string> } {
  const pre = i.side === "guest" ? "to" : "from"
  const fields: Record<string, string> = {}
  const put = (k: string, v: string | null | undefined) => {
    if (v && v.trim()) fields[`${pre}_${k}`] = v.trim()
  }
  put("hotel", i.newHotel)
  put("hotel_ja", i.newHotelJa)
  put("place_id", i.newPlaceId)
  put("city", i.newCity)
  put("prefecture", i.newPrefecture)
  return { kind: i.side === "guest" ? "hotel_guest" : "hotel_pickup", fields }
}

export async function createPickupChange(i: {
  shipmentId: string
  kind: ChangeKind
  fields: Record<string, unknown>
  reason: string
  source: "agency" | "operator"
  requester: string
  actor: string
  /** true なら理由をコード (open_change_exists 等) のまま返す (代理店向けの文言は呼び出し側で作る) */
  rawReason?: boolean
}): Promise<{ ok: true; changeId: string } | { ok: false; reason: string }> {
  const { data, error } = await sb().rpc("create_shipment_change", {
    p_shipment_id: i.shipmentId,
    p_kind: i.kind,
    p_fields: i.fields,
    p_reason: i.reason,
    p_source: i.source,
    p_requester: i.requester,
    p_actor: i.actor,
  })
  if (error) throw new Error(`変更申請を登録できません: ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; change_id?: string; reason?: string } | null
  if (row?.ok && row.change_id) return { ok: true, changeId: row.change_id }
  const code = row?.reason ?? "unknown"
  return { ok: false, reason: i.rawReason ? code : changeReasonJa(code) }
}

export async function stepPickupChange(i: {
  changeId: string
  step: ChangeStep
  actor: string
  note?: string | null
  numberPolicy?: "kept" | "changed" | null
  newNumber?: string | null
}): Promise<{ ok: true; state: string } | { ok: false; reason: string }> {
  const { data, error } = await sb().rpc("step_shipment_change", {
    p_change_id: i.changeId,
    p_step: i.step,
    p_actor: i.actor,
    p_note: i.note ?? null,
    p_number_policy: i.numberPolicy ?? null,
    p_new_number: i.newNumber ?? null,
  })
  if (error) throw new Error(`変更申請を記録できません: ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; stage?: string; reason?: string } | null
  return row?.ok ? { ok: true, state: row.stage ?? "" } : { ok: false, reason: changeReasonJa(row?.reason ?? "unknown") }
}

export async function applyPickupChange(changeId: string, actor: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await sb().rpc("apply_shipment_change", { p_change_id: changeId, p_actor: actor })
  if (error) throw new Error(`変更申請を反映できません: ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; reason?: string } | null
  if (row?.ok) return { ok: true }
  const r = row?.reason ?? "unknown"
  return { ok: false, reason: r.startsWith("state_") ? REASON_JA.state_mismatch : changeReasonJa(r) }
}
