// 「佐川へ集荷依頼」TODO の抽出。
//
// 2026-11-03 是正: 旧条件は「status='issued' かつ pickup_requested_at が空」だったため、
// status='requested' のまま佐川へ未依頼の区間 (11/7・11/11・11/16・11/18 発送分) が出なかった。
// 配送状態ではなく集荷依頼の記録 (pickup_requests) で判定する:
//   依頼が必要 = 取消以外の佐川区間で、有効な集荷依頼が無い (未依頼)
//   要対応     = 結果不明 / 要確認 / 送信中のまま止まった / 変更・取消の連絡中 / 取消した区間に有効な依頼が残っている

import type { SupabaseClient } from "@supabase/supabase-js"
import { endpointLabel } from "@/lib/residence"
import { pickupRequestCutoff } from "@/lib/bizlogi/deadline"
import { STALE_SENDING_MS, isLive, type PickupRequestRow } from "./state"

/** 依頼が必要な区間を何日先まで出すか (前日締めに備えて早めに見せる)。 */
export const PICKUP_TODO_LOOKAHEAD_DAYS = 7

export interface PickupTodoLeg {
  id: string
  booking_id: string
  leg_index: number
  status: string
  carrier: string | null
  shipment_date: string
  representative: string | null
  tour_number: string | null
  from_hotel: string
  from_hotel_ja: string | null
  from_residence: unknown
  suitcase_count: number | null
  tracking_numbers: unknown
}

export const PICKUP_TODO_COLUMNS =
  "id, booking_id, leg_index, status, carrier, shipment_date, representative, tour_number, from_hotel, from_hotel_ja, from_residence, suitcase_count, tracking_numbers"

export type PickupUrgency = "overdue" | "due" | "upcoming"
export type AttentionKind = "unknown" | "needs_review" | "stale_sending" | "change_pending" | "cancel_needed"

export interface SagawaPickupTask {
  shipmentId: string
  bookingId: string
  legIndex: number
  representative: string
  tourNumber: string | null
  fromHotel: string
  fromHotelJa: string | null
  shipmentDate: string
  suitcaseCount: number
  /** overdue=当日以前 (締め超過) / due=明日発送 (今日20時が締め) / upcoming=2日後以降 */
  urgency: PickupUrgency
  cutoffAt: string | null
}

export interface PickupAttentionTask extends Omit<SagawaPickupTask, "urgency" | "cutoffAt"> {
  kind: AttentionKind
  requestId: string
  channel: string
  state: string
  shippingNumber: string | null
  error: string | null
  note: string | null
  updatedAt: string
}

export interface PickupTodo {
  needRequest: SagawaPickupTask[]
  attention: PickupAttentionTask[]
  /** pickup_requests が未作成 (sql/062 未適用) で旧条件に落としたとき true。 */
  legacyMode: boolean
}

function addDays(ymd: string, n: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

function base(l: PickupTodoLeg) {
  return {
    shipmentId: l.id,
    bookingId: l.booking_id,
    legIndex: l.leg_index,
    representative: l.representative ?? "",
    tourNumber: l.tour_number ?? null,
    // 個人宅区間は from_hotel に氏名が入るため住所を表示する (従来どおり)
    fromHotel: endpointLabel(l.from_hotel, l.from_residence),
    fromHotelJa: l.from_hotel_ja ?? null,
    shipmentDate: l.shipment_date,
    suitcaseCount: l.suitcase_count ?? 1,
  }
}

/** DB に触れない判定本体 (テスト対象)。legs は今日〜先読み日の取消以外の区間と、要対応の記録が指す区間。 */
export function buildPickupTodo(legs: PickupTodoLeg[], requests: PickupRequestRow[], today: string, now: Date): PickupTodo {
  const legById = new Map(legs.map((l) => [l.id, l]))
  const live = new Map<string, PickupRequestRow>()
  for (const r of requests) if (isLive(r.state)) live.set(r.shipment_id, r)
  const tomorrow = addDays(today, 1)
  const horizon = addDays(today, PICKUP_TODO_LOOKAHEAD_DAYS)

  const needRequest: SagawaPickupTask[] = []
  for (const l of legs) {
    if (l.status === "cancelled") continue
    if ((l.carrier ?? "sagawa") !== "sagawa") continue
    if (l.shipment_date < today || l.shipment_date > horizon) continue
    if (live.has(l.id)) continue
    needRequest.push({
      ...base(l),
      urgency: l.shipment_date <= today ? "overdue" : l.shipment_date === tomorrow ? "due" : "upcoming",
      cutoffAt: pickupRequestCutoff(l.shipment_date)?.toISOString() ?? null,
    })
  }
  needRequest.sort((a, b) => a.shipmentDate.localeCompare(b.shipmentDate))

  const attention: PickupAttentionTask[] = []
  for (const r of live.values()) {
    const l = legById.get(r.shipment_id)
    if (!l) continue
    let kind: AttentionKind | null = null
    if (l.status === "cancelled" && (r.state === "accepted" || r.state === "unknown" || r.state === "needs_review")) kind = "cancel_needed"
    else if (r.state === "unknown") kind = "unknown"
    else if (r.state === "needs_review") kind = "needs_review"
    else if (r.state === "change_pending") kind = "change_pending"
    else if (r.state === "sending" && now.getTime() - Date.parse(r.updated_at) > STALE_SENDING_MS) kind = "stale_sending"
    if (!kind) continue
    attention.push({
      ...base(l),
      kind,
      requestId: r.id,
      channel: r.channel,
      state: r.state,
      shippingNumber: r.shipping_number,
      error: r.error,
      note: r.note,
      updatedAt: r.updated_at,
    })
  }
  const order: Record<AttentionKind, number> = { unknown: 0, stale_sending: 1, cancel_needed: 2, needs_review: 3, change_pending: 4 }
  attention.sort((a, b) => order[a.kind] - order[b.kind] || a.shipmentDate.localeCompare(b.shipmentDate))
  return { needRequest, attention, legacyMode: false }
}

const isMissingTable = (msg: string | undefined) => !!msg && /pickup_requests/.test(msg) && /(does not exist|schema cache|not find)/i.test(msg)

/** TODO を DB から組み立てる。sql/062 未適用なら旧来の印 (pickup_requested_at) で判定する。 */
export async function loadPickupTodo(sb: SupabaseClient, today: string, now: Date = new Date()): Promise<PickupTodo> {
  const horizon = addDays(today, PICKUP_TODO_LOOKAHEAD_DAYS)
  const { data: windowLegs, error: legErr } = await sb
    .from("shipments")
    .select(PICKUP_TODO_COLUMNS + ", pickup_requested_at")
    .neq("status", "cancelled")
    .gte("shipment_date", today)
    .lte("shipment_date", horizon)
    .order("shipment_date", { ascending: true })
  if (legErr) throw new Error(`集荷依頼TODOの区間を読めません: ${legErr.message}`)
  const legs = (windowLegs ?? []) as unknown as Array<PickupTodoLeg & { pickup_requested_at: string | null }>

  const { data: reqWindow, error: reqErr } = await sb
    .from("pickup_requests")
    .select("*")
    .in("shipment_id", legs.length ? legs.map((l) => l.id) : ["00000000-0000-0000-0000-000000000000"])
  if (reqErr) {
    if (!isMissingTable(reqErr.message)) throw new Error(`集荷依頼の記録を読めません: ${reqErr.message}`)
    // 移行前: 旧来の印で「未依頼」を判定する (status は見ない)
    const needRequest = buildPickupTodo(
      legs.filter((l) => !l.pickup_requested_at),
      [],
      today,
      now,
    ).needRequest
    return { needRequest, attention: [], legacyMode: true }
  }

  // 発送日に関係なく残っている要対応の記録 (結果不明・要確認・送信中・変更対応中) と、取消された区間の有効な依頼
  const { data: openReqs, error: openErr } = await sb
    .from("pickup_requests")
    .select("*")
    .in("state", ["sending", "unknown", "needs_review", "change_pending", "accepted"])
    .or(`pickup_date.is.null,pickup_date.gte.${addDays(today, -14)}`)
  if (openErr) throw new Error(`集荷依頼の記録を読めません: ${openErr.message}`)
  const requests = [...((reqWindow ?? []) as PickupRequestRow[])]
  const seen = new Set(requests.map((r) => r.id))
  for (const r of (openReqs ?? []) as PickupRequestRow[]) if (!seen.has(r.id)) requests.push(r)

  // 記録が指す区間のうち、窓の外 (過去日・取消) のものを追加で読む
  const known = new Set(legs.map((l) => l.id))
  const extraIds = [...new Set(requests.map((r) => r.shipment_id))].filter((id) => !known.has(id))
  if (extraIds.length) {
    const { data: extra, error: exErr } = await sb.from("shipments").select(PICKUP_TODO_COLUMNS).in("id", extraIds)
    if (exErr) throw new Error(`集荷依頼TODOの区間を読めません: ${exErr.message}`)
    legs.push(...((extra ?? []) as unknown as Array<PickupTodoLeg & { pickup_requested_at: string | null }>))
  }
  return buildPickupTodo(legs, requests, today, now)
}
