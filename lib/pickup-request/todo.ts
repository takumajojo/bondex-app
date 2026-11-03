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
import { snapshotChanges } from "./snapshot"
import { bizlogiEligibility } from "./eligibility"
import { legTrackingNumbers } from "@/lib/shipment-reissue"

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
  booking_type?: string | null
  // 依頼後の変更検知用 (./snapshot.ts)。古い呼び出し元のために任意。
  from_place_id?: string | null
  to_hotel?: string | null
  to_place_id?: string | null
  to_residence?: unknown
  expected_arrival?: string | null
  delivery_time?: string | null
}

export const PICKUP_TODO_COLUMNS =
  "id, booking_id, leg_index, status, carrier, shipment_date, representative, tour_number, from_hotel, from_hotel_ja, from_residence, suitcase_count, tracking_numbers, booking_type, from_place_id, to_hotel, to_place_id, to_residence, expected_arrival, delivery_time"

export type PickupUrgency = "overdue" | "due" | "upcoming"
export type AttentionKind =
  | "unknown"
  | "needs_review"
  | "stale_sending"
  | "change_pending"
  | "cancel_needed"
  /** 依頼後に発送元・到着先・日付・時間帯・個数が変わった → 世田谷へ変更連絡が必要 */
  | "changed_after_request"
  /** 佐川の問合番号はあるのに集荷依頼の記録が無い → 依頼済みとして記録が必要 (Excel で重ねて依頼しない) */
  | "record_missing"
  /** 受付後の変更 (ホテル・番号) の希望を登録済みで、世田谷へ未連絡 */
  | "hotel_change_requested"
  /** 受付後の変更を佐川が承認済みで、BondEx へ未反映 */
  | "hotel_change_approved"

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
  /** Biz-Logi で送れない理由 (20個以上・団体)。null は送れる。手動 (Excel) では依頼できる。 */
  manualOnlyReason?: string | null
}

export interface PickupAttentionTask extends Omit<SagawaPickupTask, "urgency" | "cutoffAt"> {
  kind: AttentionKind
  /** record_missing では記録が無いので空文字。 */
  requestId: string
  /** changed_after_request: 依頼時から変わった項目 */
  changes?: string[]
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
export interface OpenChangeRow {
  id: string
  shipment_id: string
  /** shipment_change_requests.stage */
  state: string
  /** shipment_change_requests.kind */
  kind: string
  fields: Record<string, unknown> | null
  updated_at: string
}

const OPEN_CHANGE_KIND_JA: Record<string, string> = {
  hotel_guest: "到着ホテル",
  hotel_pickup: "発送元ホテル",
  dates: "日程",
  count: "個数",
  representative: "代表者名",
  cancel: "取消",
  number: "問い合わせ番号の振り直し",
  rearrange: "個別再手配",
}

function openChangeNote(c: OpenChangeRow): string {
  const f = c.fields ?? {}
  const label = OPEN_CHANGE_KIND_JA[c.kind] ?? c.kind
  if (c.kind === "hotel_guest") return `${label}: ${String(f.to_hotel_ja ?? f.to_hotel ?? "-")}`
  if (c.kind === "hotel_pickup") return `${label}: ${String(f.from_hotel_ja ?? f.from_hotel ?? "-")}`
  if (c.kind === "count" && f.suitcase_count != null) return `${label}: ${String(f.suitcase_count)}個`
  return `変更申請: ${label}`
}

export function buildPickupTodo(
  legs: PickupTodoLeg[],
  requests: PickupRequestRow[],
  today: string,
  now: Date,
  openChanges: OpenChangeRow[] = [],
): PickupTodo {
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
    // 番号がある = 佐川側に依頼がある。「依頼が必要」には出さず、記録漏れとして要確認に出す (下)。
    if (legTrackingNumbers(l).length > 0) continue
    needRequest.push({
      ...base(l),
      urgency: l.shipment_date <= today ? "overdue" : l.shipment_date === tomorrow ? "due" : "upcoming",
      cutoffAt: pickupRequestCutoff(l.shipment_date)?.toISOString() ?? null,
      manualOnlyReason: (() => {
        const e = bizlogiEligibility(l)
        return e.ok ? null : e.reason
      })(),
    })
  }
  needRequest.sort((a, b) => a.shipmentDate.localeCompare(b.shipmentDate))

  const attention: PickupAttentionTask[] = []
  for (const r of live.values()) {
    const l = legById.get(r.shipment_id)
    if (!l) continue
    let kind: AttentionKind | null = null
    const changes = l.status === "cancelled" ? [] : snapshotChanges(r.request_snapshot, l as Parameters<typeof snapshotChanges>[1])
    if (l.status === "cancelled" && (r.state === "accepted" || r.state === "unknown" || r.state === "needs_review")) kind = "cancel_needed"
    else if (r.state === "unknown") kind = "unknown"
    else if (r.state === "sending" && now.getTime() - Date.parse(r.updated_at) > STALE_SENDING_MS) kind = "stale_sending"
    else if ((r.state === "accepted" || r.state === "needs_review") && changes.length > 0) kind = "changed_after_request"
    else if (r.state === "needs_review") kind = "needs_review"
    else if (r.state === "change_pending") kind = "change_pending"
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
      changes: kind === "changed_after_request" ? changes : undefined,
    })
  }
  // 受付後の変更 (未連絡・承認済みで未反映)。連絡中 (contacted) は集荷依頼の change_pending として上で出る。
  for (const c of openChanges) {
    const l = legById.get(c.shipment_id)
    if (!l || (c.state !== "requested" && c.state !== "approved")) continue
    const r = live.get(c.shipment_id)
    attention.push({
      ...base(l),
      kind: c.state === "requested" ? "hotel_change_requested" : "hotel_change_approved",
      requestId: r?.id ?? "",
      channel: r?.channel ?? "",
      state: r?.state ?? "",
      shippingNumber: r?.shipping_number ?? null,
      error: null,
      note: openChangeNote(c),
      updatedAt: c.updated_at,
    })
  }
  // 記録が無いのに佐川の番号がある区間 (今日以降・取消以外)
  for (const l of legs) {
    if (l.status === "cancelled" || live.has(l.id) || l.shipment_date < today) continue
    if (legTrackingNumbers(l).length === 0) continue
    attention.push({ ...base(l), kind: "record_missing", requestId: "", channel: "", state: "", shippingNumber: legTrackingNumbers(l)[0], error: null, note: null, updatedAt: "" })
  }
  const order: Record<AttentionKind, number> = {
    unknown: 0,
    stale_sending: 1,
    cancel_needed: 2,
    changed_after_request: 3,
    needs_review: 4,
    change_pending: 5,
    record_missing: 6,
    hotel_change_approved: 3,
    hotel_change_requested: 4,
  }
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
  // 変更申請で進行中のもの (未連絡・承認済みで未反映)。sql/064 未適用の環境では列が無く空になる。
  const { data: chg } = await sb
    .from("shipment_change_requests")
    .select("id, shipment_id, stage, kind, fields, updated_at")
    .in("stage", ["requested", "approved"])
    .not("kind", "in", '("correction","fields")')
  const openChanges = ((chg ?? []) as Array<Omit<OpenChangeRow, "state"> & { stage: string }>).map((c) => ({ ...c, state: c.stage }))
  const extraIds = [...new Set([...requests.map((r) => r.shipment_id), ...openChanges.map((c) => c.shipment_id)])].filter((id) => !known.has(id))
  if (extraIds.length) {
    const { data: extra, error: exErr } = await sb.from("shipments").select(PICKUP_TODO_COLUMNS).in("id", extraIds)
    if (exErr) throw new Error(`集荷依頼TODOの区間を読めません: ${exErr.message}`)
    legs.push(...((extra ?? []) as unknown as Array<PickupTodoLeg & { pickup_requested_at: string | null }>))
  }
  return buildPickupTodo(legs, requests, today, now, openChanges)
}
