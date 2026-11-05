/**
 * P1-B 佐川大口集荷 — 集計・ホテルキー・差分判定の純粋ロジック (DB 非依存・テスト可能)。
 *
 * 集荷単位 = 同一集荷元ホテル (hotel_key) × 同一集荷日 (pickup_date)。合計 BULK_THRESHOLD 個以上で対象。
 * DB I/O (recompute 永続化・通知クレーム) は lib/sagawa-bulk/db.ts が薄く担う。ここは副作用なし。
 */

export const BULK_THRESHOLD = 20
/** 重複集荷の検知閾値: 同一ホテル×同一集荷日に distinct 予約がこの件数以上なら「重複集荷」として注意喚起する。 */
export const DUPLICATE_MIN_BOOKINGS = 2

export type BookingType = "fit" | "group"

/** 集計対象判定に必要な 1 leg の最小情報 (shipments 由来)。 */
export interface BulkLeg {
  shipment_id: string
  booking_id: string
  leg_index: number
  agency: string | null
  status: string
  booking_type: string | null
  suitcase_count: number | null
  shipment_date: string | null // 集荷日 YYYY-MM-DD
  pickup_time: string | null
  from_place_id: string | null
  from_hotel: string | null
  from_hotel_ja: string | null
  from_prefecture: string | null
  from_city: string | null
  from_residence: unknown | null
  carrier: string | null
  /** チャーター識別 (将来 charter_quotes 連携)。true は対象外。現状は未設定=false。 */
  is_charter?: boolean | null
}

/** ホテルキー解決結果。included=false は大口集荷管理の対象外 (民泊・チャーター)。 */
export type HotelKeyResult =
  | { included: true; key: string; source: "place_id" | "name"; confident: boolean; label: string }
  | { included: false; reason: "residence" | "charter" }

/** 文字列を deterministic に正規化 (小文字・空白畳み込み・トリム)。表記揺れは別キーのまま=誤統合しない。 */
function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim()
}

/** from_residence が「個人宅/民泊」として有効か (住所か氏名があるか)。曖昧 (空) なら false=residence扱いにしない。 */
function isResidenceValue(r: unknown): boolean {
  if (!r || typeof r !== "object") return false
  const o = r as Record<string, unknown>
  const has = (k: string) => typeof o[k] === "string" && (o[k] as string).trim() !== ""
  return has("name") || has("street") || has("building") || has("zip") || has("city")
}

/**
 * 集荷元ホテルの集計キーを解決する。
 *  - チャーターは対象外。
 *  - from_residence が有効 (民泊・個人宅) は対象外。判定できない (空) 場合は residence 扱いにしない (= ホテルとして確認対象)。
 *  - from_place_id があれば 'pid:<id>' (高信頼・confident)。
 *  - なければ 'name:<正規化(県/市/名称)>' (名称のみ=confident:false=Operator 確認対象)。名称一致だけで自動統合しない。
 */
export function resolveHotelKey(leg: BulkLeg): HotelKeyResult {
  if (leg.is_charter) return { included: false, reason: "charter" }
  if (isResidenceValue(leg.from_residence)) return { included: false, reason: "residence" }
  const pid = (leg.from_place_id ?? "").trim()
  const label = (leg.from_hotel_ja || leg.from_hotel || "").trim()
  if (pid) {
    return { included: true, key: `pid:${pid}`, source: "place_id", confident: true, label: label || pid }
  }
  const nameKey = `name:${norm(leg.from_prefecture)}/${norm(leg.from_city)}/${norm(leg.from_hotel_ja || leg.from_hotel)}`
  return { included: true, key: nameKey, source: "name", confident: false, label }
}

/**
 * この leg の集荷がまだ予定されている (大口集計の対象) か。
 *  - cancelled は対象外。
 *  - 既に集荷済み以降 (picked_up/in_transit/delivered) は対象外 (事前連絡は不要)。
 *  - failed は一律除外しない: 集荷日が今日以降 (pickup がまだ先=再発行/集荷の余地) なら対象 (D6)。
 *  - requested/pending/issued で集荷日が今日以降なら対象。
 *  - 集荷日が過去の未完了 leg は対象外 (もう当日連絡の意味がない)。
 */
export function isPickupPending(leg: BulkLeg, todayYmd: string): boolean {
  const st = leg.status
  if (st === "cancelled" || st === "picked_up" || st === "in_transit" || st === "delivered") return false
  if (!leg.shipment_date) return false
  if (leg.shipment_date < todayYmd) return false // 過去の集荷日は対象外 (failed 含む)
  return st === "requested" || st === "pending" || st === "issued" || st === "failed"
}

export interface BulkMember {
  shipment_id: string
  booking_id: string
  leg_index: number
  agency: string | null
  pieces: number
  pickup_time: string | null
}

export interface BulkGroupComputed {
  hotel_key: string
  key_source: "place_id" | "name"
  confident: boolean
  pickup_date: string
  hotel_label: string
  from_prefecture: string | null
  from_city: string | null
  total_pieces: number
  leg_count: number
  agency_count: number
  booking_count: number   // distinct booking_id 数 (同一予約の複数区間は 1 と数える)
  is_bulk: boolean        // total_pieces >= BULK_THRESHOLD = 佐川への大口事前連絡が必要
  is_duplicate: boolean   // 同一ホテル×同一日に distinct 予約が DUPLICATE_MIN_BOOKINGS 件以上 = 重複集荷
  member_hash: string
  members: BulkMember[]
}

/** deterministic な軽量ハッシュ (djb2)。構成変化の検知用 (暗号用途ではない)。 */
export function stableHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

/** 集荷単位の構成ハッシュ。members(shipment_id:pieces:pickup_time を昇順) + 日付 + キー。 */
export function memberHashOf(g: {
  hotel_key: string
  pickup_date: string
  members: BulkMember[]
}): string {
  const parts = g.members
    .map((m) => `${m.shipment_id}:${m.pieces}:${norm(m.pickup_time)}`)
    .sort()
    .join("|")
  return stableHash(`${g.hotel_key}@${g.pickup_date}#${parts}`)
}

/**
 * active な leg 群から集荷単位 (hotel_key × pickup_date) を集計し、
 *  - 大口 (合計 BULK_THRESHOLD 個以上)                       … 佐川への大口事前連絡が必要 (is_bulk)
 *  - 重複 (同一ホテル×同一日に distinct 予約が 2 件以上)       … 合計20個未満でも Operator へ注意喚起 (is_duplicate)
 * のいずれかに該当する集荷単位を返す。対象外 (民泊/チャーター/集荷予定なし/個数0) は除外。
 * FIT・団体の両方を対象。複数代理店・複数予約も同一集荷単位に合算。同一予約の複数区間は booking_count で 1 と数える。
 */
export function computeBulkGroups(legs: BulkLeg[], todayYmd: string): BulkGroupComputed[] {
  const map = new Map<string, BulkGroupComputed>()
  for (const leg of legs) {
    const pieces = Math.max(0, Math.floor(Number(leg.suitcase_count) || 0))
    if (pieces <= 0) continue
    if (!isPickupPending(leg, todayYmd)) continue
    const hk = resolveHotelKey(leg)
    if (!hk.included) continue
    const date = leg.shipment_date as string
    const gkey = `${hk.key}@${date}`
    let g = map.get(gkey)
    if (!g) {
      g = {
        hotel_key: hk.key,
        key_source: hk.source,
        confident: hk.confident,
        pickup_date: date,
        hotel_label: hk.label,
        from_prefecture: leg.from_prefecture ?? null,
        from_city: leg.from_city ?? null,
        total_pieces: 0,
        leg_count: 0,
        agency_count: 0,
        booking_count: 0,
        is_bulk: false,
        is_duplicate: false,
        member_hash: "",
        members: [],
      }
      map.set(gkey, g)
    }
    g.members.push({
      shipment_id: leg.shipment_id,
      booking_id: leg.booking_id,
      leg_index: leg.leg_index,
      agency: leg.agency ?? null,
      pieces,
      pickup_time: leg.pickup_time ?? null,
    })
    g.total_pieces += pieces
    g.leg_count += 1
    if (!g.hotel_label && hk.label) g.hotel_label = hk.label
  }
  const out: BulkGroupComputed[] = []
  for (const g of map.values()) {
    g.agency_count = new Set(g.members.map((m) => m.agency ?? "")).size
    // distinct 予約数 (同一予約の複数区間は 1 と数える = 重複集荷にカウントしない)。
    g.booking_count = new Set(g.members.map((m) => m.booking_id)).size
    g.is_bulk = g.total_pieces >= BULK_THRESHOLD
    g.is_duplicate = g.booking_count >= DUPLICATE_MIN_BOOKINGS
    // 大口でも重複でもない集荷単位は対象外。
    if (!g.is_bulk && !g.is_duplicate) continue
    g.members.sort((a, b) => (a.shipment_id < b.shipment_id ? -1 : a.shipment_id > b.shipment_id ? 1 : 0))
    g.member_hash = memberHashOf(g)
    out.push(g)
  }
  out.sort((a, b) => (a.pickup_date < b.pickup_date ? -1 : a.pickup_date > b.pickup_date ? 1 : b.total_pieces - a.total_pieces))
  return out
}

/** 佐川へ連絡した時点のスナップショット (notified_snapshot に保存する形)。 */
export interface BulkSnapshot {
  pickup_date: string
  hotel_key: string
  total_pieces: number
  pickup_times: string[] // distinct・昇順
  members: Array<{ shipment_id: string; pieces: number }>
  member_hash: string
}

export function snapshotOf(g: BulkGroupComputed): BulkSnapshot {
  const pickup_times = Array.from(new Set(g.members.map((m) => norm(m.pickup_time)).filter((x) => x !== ""))).sort()
  return {
    pickup_date: g.pickup_date,
    hotel_key: g.hotel_key,
    total_pieces: g.total_pieces,
    pickup_times,
    members: g.members.map((m) => ({ shipment_id: m.shipment_id, pieces: m.pieces })).sort((a, b) => (a.shipment_id < b.shipment_id ? -1 : 1)),
    member_hash: g.member_hash,
  }
}

export interface ChangeClassification {
  /** 自動で再確認通知を出すべき重要変更 (D4: 増加・新規追加・集荷時間帯変更)。 */
  material: boolean
  increase: boolean          // 合計個数が増えた
  pieceDelta: number         // 現在 - スナップショット
  added: string[]            // 新たに加わった shipment_id
  removed: string[]          // 外れた shipment_id (日付/ホテル変更・キャンセル・個数減での離脱)
  pickupTimeChanged: boolean // 集荷時間帯 (pickup_time の集合) が変わった
  decrease: boolean          // 合計個数が減った (履歴に残し Operator 判断・自動通知しない)
}

/**
 * 連絡済みスナップショットと現在の集荷単位を比較して、再確認の要否を判定する (D4)。
 * material (自動再確認通知) = 個数増加 または 新規メンバー追加 または 集荷時間帯変更。
 * 減少・メンバー離脱は material にせず removed/decrease に記録 → Operator が再連絡要否を判断。
 * 集荷日・ホテル変更は、対象メンバーが当該グループから離脱 (removed) し、別グループで新規検知/増加として material 化する。
 */
export function classifyChange(snapshot: BulkSnapshot, current: BulkGroupComputed): ChangeClassification {
  const snapIds = new Set(snapshot.members.map((m) => m.shipment_id))
  const curIds = new Set(current.members.map((m) => m.shipment_id))
  const added = [...curIds].filter((id) => !snapIds.has(id)).sort()
  const removed = [...snapIds].filter((id) => !curIds.has(id)).sort()
  const pieceDelta = current.total_pieces - snapshot.total_pieces
  const increase = pieceDelta > 0
  const decrease = pieceDelta < 0
  const curTimes = snapshotOf(current).pickup_times
  const pickupTimeChanged = JSON.stringify(curTimes) !== JSON.stringify(snapshot.pickup_times)
  const material = increase || added.length > 0 || pickupTimeChanged
  return { material, increase, pieceDelta, added, removed, pickupTimeChanged, decrease }
}

/** 集荷日からアラート優先度を決める (D4: 当日=緊急 / 前日=優先 / それ以前=通常)。 */
export type BulkUrgency = "overdue" | "today" | "tomorrow" | "upcoming"
export function urgencyOf(pickupDate: string, todayYmd: string): BulkUrgency {
  if (pickupDate < todayYmd) return "overdue"
  if (pickupDate === todayYmd) return "today"
  // 前日判定: todayYmd の翌日 == pickupDate
  const t = new Date(`${todayYmd}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + 1)
  const tomorrow = t.toISOString().slice(0, 10)
  if (pickupDate === tomorrow) return "tomorrow"
  return "upcoming"
}

/** メール通知の不変冪等キー。種別 (initial/change/eve/day) と構成ハッシュを含める。 */
export type NotifyKind = "initial" | "change" | "eve" | "day"
export function notifyKeyOf(hotelKey: string, pickupDate: string, memberHash: string, kind: NotifyKind): string {
  return `bulk|${hotelKey}|${pickupDate}|${memberHash}|${kind}`
}
