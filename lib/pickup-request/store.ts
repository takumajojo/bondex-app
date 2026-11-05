// 集荷依頼の記録 (pickup_requests) への読み書き。DB 関数 claim_pickup_request /
// transition_pickup_request (sql/067) を通すことで、判定と書き込みを1トランザクションにする。
// テストでは PickupStore を差し替える。

import { getSupabase } from "@/lib/supabase"
import { LIVE_STATES, type PickupChannel, type PickupRequestRow, type PickupRequestState } from "./state"

export interface ClaimInput {
  shipmentId: string
  channel: PickupChannel
  environment: "test" | "production" | null
  manageNumber: string | null
  pieceCount: number | null
  pickupDate: string | null
  actor: string
  owner: string
  note: string | null
  /**
   * 呼び出し側が電文・記録の元にした区間の内容 (./snapshot.ts)。DB には渡さない (DB は行ロック中に自分で作る)。
   * 確保の結果の snapshot と比べ、違えば送らない (読み取りから確保までの間に区間が変わった)。
   */
  snapshot: unknown
}

export interface ClaimResult {
  claimed: boolean
  requestId: string | null
  /** claimed / live_request_exists / shipment_cancelled / tracking_number_exists / shipment_not_found / invalid_channel */
  reason: string
  /** 確保した時点の依頼内容 (DB が行ロック中に作ったもの)。確保できなかったときは null。 */
  snapshot?: unknown
}

export interface TransitionInput {
  requestId: string
  from: PickupRequestState[]
  to: PickupRequestState
  owner?: string | null
  actor?: string | null
  shippingNumber?: string | null
  printRequestId?: string | null
  resultCodes?: string[] | null
  error?: string | null
  note?: string | null
  /** 新しい依頼内容 (変更が佐川に反映されたと記録するとき)。null/省略は変えない。 */
  snapshot?: unknown
}

export interface TransitionResult {
  applied: boolean
  state: string | null
  /** applied / state_mismatch / owner_mismatch / shipping_number_required / live_request_exists / not_found */
  reason: string
}

export interface PickupStore {
  claim(input: ClaimInput): Promise<ClaimResult>
  transition(input: TransitionInput): Promise<TransitionResult>
  listForShipments(shipmentIds: string[]): Promise<PickupRequestRow[]>
  get(requestId: string): Promise<PickupRequestRow | null>
  /**
   * 顧客側採番 (sql/078): 区間の問合番号 (有効な番号があればそれ、無ければ SG 指定の範囲から払い出す)。
   * reason: existing / allocated / no_number_range / number_range_exhausted / leg_not_found
   */
  legNumber?(shipmentId: string, environment: "test" | "production"): Promise<{ ok: boolean; number: string | null; reason: string }>
  /**
   * 区間の進行中の変更・取消の申請 (sql/068 の stage が requested・contacted・approved。運営の訂正の記録 correction は除く)。
   * 1件でもあれば Biz-Logi で送らない (申請が片付くまで区間は旧い内容のまま: 2026-11-06 監査 項目11)。
   */
  openChanges?(shipmentId: string): Promise<Array<{ id: string; kind: string; stage: string }>>
  /** 番号を使わなくする (範囲外・桁数の誤りで佐川が受け付けなかった)。次の送信は新しい番号になる。 */
  retireNumber?(number: string, reason: string): Promise<void>
  /** 顧客側採番で送る番号を依頼の記録に書く (送信中・未記録・区間の台帳の番号のときだけ。一度書いたら変わらない)。 */
  setAssignedNumber?(requestId: string, number: string): Promise<boolean>
}

/** 進行中の変更・取消の申請の段階 (sql/068 shipment_change_requests.stage)。 */
export const OPEN_CHANGE_STAGES = ["requested", "contacted", "approved"] as const

/** DB に届かなかった (例外・接続不可)。送信の前なら送らない、後なら結果不明として扱う。 */
export class PickupStoreError extends Error {}

export function supabasePickupStore(): PickupStore {
  const sb = getSupabase()
  if (!sb) throw new PickupStoreError("Supabase が設定されていません")
  return {
    async claim(i) {
      const { data, error } = await sb.rpc("claim_pickup_request", {
        p_shipment_id: i.shipmentId,
        p_channel: i.channel,
        p_environment: i.environment,
        p_manage_number: i.manageNumber,
        p_piece_count: i.pieceCount,
        p_pickup_date: i.pickupDate,
        p_actor: i.actor,
        p_owner: i.owner,
        p_note: i.note,
      })
      if (error) throw new PickupStoreError(`集荷依頼の確保に失敗しました: ${error.message}`)
      const row = (Array.isArray(data) ? data[0] : data) as { claimed?: boolean; request_id?: string; reason?: string; snapshot?: unknown } | null
      return { claimed: row?.claimed === true, requestId: row?.request_id ?? null, reason: row?.reason ?? "unknown", snapshot: row?.snapshot ?? null }
    },
    async transition(i) {
      const { data, error } = await sb.rpc("transition_pickup_request", {
        p_request_id: i.requestId,
        p_from_states: i.from,
        p_to_state: i.to,
        p_owner: i.owner ?? null,
        p_actor: i.actor ?? null,
        p_shipping_number: i.shippingNumber ?? null,
        p_print_request_id: i.printRequestId ?? null,
        p_result_codes: i.resultCodes ?? null,
        p_error: i.error ?? null,
        p_note: i.note ?? null,
        p_snapshot: i.snapshot ?? null,
      })
      if (error) throw new PickupStoreError(`集荷依頼の状態更新に失敗しました: ${error.message}`)
      const row = (Array.isArray(data) ? data[0] : data) as { applied?: boolean; state?: string; reason?: string } | null
      return { applied: row?.applied === true, state: row?.state ?? null, reason: row?.reason ?? "unknown" }
    },
    async listForShipments(ids) {
      if (!ids.length) return []
      const { data, error } = await sb
        .from("pickup_requests")
        .select("*")
        .in("shipment_id", ids)
        .order("created_at", { ascending: false })
      if (error) throw new PickupStoreError(`集荷依頼の読み込みに失敗しました: ${error.message}`)
      return (data ?? []) as PickupRequestRow[]
    },
    async get(id) {
      const { data, error } = await sb.from("pickup_requests").select("*").eq("id", id).maybeSingle()
      if (error) throw new PickupStoreError(`集荷依頼の読み込みに失敗しました: ${error.message}`)
      return (data as PickupRequestRow | null) ?? null
    },
    async openChanges(shipmentId) {
      const { data, error } = await sb
        .from("shipment_change_requests")
        .select("id, kind, stage")
        .eq("shipment_id", shipmentId)
        .in("stage", OPEN_CHANGE_STAGES as unknown as string[])
        .neq("kind", "correction")
      if (error) throw new PickupStoreError(`変更・取消の申請の読み込みに失敗しました: ${error.message}`)
      return (data ?? []) as Array<{ id: string; kind: string; stage: string }>
    },
    async legNumber(shipmentId, environment) {
      const { data, error } = await sb.rpc("pickup_leg_number", { p_shipment_id: shipmentId, p_environment: environment })
      if (error) throw new PickupStoreError(`問合番号の採番に失敗しました: ${error.message}`)
      const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; number?: string | null; reason?: string } | null
      return { ok: row?.ok === true, number: row?.number ?? null, reason: row?.reason ?? "unknown" }
    },
    async setAssignedNumber(requestId, number) {
      const { data, error } = await sb.rpc("pickup_set_assigned_number", { p_request_id: requestId, p_number: number })
      if (error) throw new PickupStoreError(`送る問合番号の記録に失敗しました: ${error.message}`)
      const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean } | null
      return row?.ok === true
    },
    async retireNumber(number, reason) {
      const { error } = await sb.rpc("pickup_retire_number", { p_number: number, p_reason: reason })
      if (error) throw new PickupStoreError(`問合番号を使わなくする処理に失敗しました: ${error.message}`)
    },
  }
}

/** 区間ごとの有効な依頼 (無ければ未依頼)。 */
export function liveRequestByShipment(rows: PickupRequestRow[]): Map<string, PickupRequestRow> {
  const m = new Map<string, PickupRequestRow>()
  for (const r of rows) if ((LIVE_STATES as readonly string[]).includes(r.state)) m.set(r.shipment_id, r)
  return m
}

/** sql/067 が未適用 (pickup_requests・関数が無い) ことを示すエラーか。 */
export function isPickupTableMissing(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /pickup_requests|claim_pickup_request|transition_pickup_request/.test(msg) && /(does not exist|schema cache|not find)/i.test(msg)
}
