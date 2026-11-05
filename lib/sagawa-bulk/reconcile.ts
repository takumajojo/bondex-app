/**
 * P1-B 再集計の照合プランナ (純粋・DB 非依存・テスト可能)。
 * 現在の集荷単位 (computeBulkGroups 結果) と DB の既存レコードを突き合わせ、
 * 「どの集荷単位を upsert し、どのメンバーを追加/除去し、どのイベントを記録し、status をどうするか」
 * を計画として返す。DB I/O (lib/sagawa-bulk/db.ts) はこの計画を適用するだけにする。
 */
import {
  classifyChange,
  type BulkGroupComputed,
  type BulkMember,
  type BulkSnapshot,
} from "./core"

/** DB 上の既存集荷単位 (照合に必要な最小情報)。 */
export interface ExistingGroup {
  id: string
  hotel_key: string
  pickup_date: string
  status: string // pending|notified|needs_reconfirm|stale|cleared
  member_hash: string
  total_pieces: number
  notified_snapshot: BulkSnapshot | null
  member_shipment_ids: string[] // 現在 (removed_at=null) のメンバー shipment_id
}

export interface BulkEvent {
  kind: string
  detail: Record<string, unknown>
}

export interface GroupPlan {
  isNew: boolean
  existingId?: string
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
  booking_count: number
  is_bulk: boolean
  is_duplicate: boolean
  member_hash: string
  /** 読込時点の DB status (既存のみ)。applyGroupPlan が status 遷移を compare-and-set するために使う。新規は ""。 */
  prevStatus: string
  nextStatus: string
  members: BulkMember[]
  addMemberIds: string[]
  removeMemberIds: string[]
  events: BulkEvent[]
}

export interface ReconcilePlan {
  groups: GroupPlan[]
  /** 20個未満に減った/消えた既存集荷単位 → cleared にする (履歴は残す)。 */
  clears: Array<{ id: string; event: BulkEvent }>
}

const gk = (hotelKey: string, date: string) => `${hotelKey}@${date}`

export function planReconcile(
  computed: BulkGroupComputed[],
  existing: ExistingGroup[],
): ReconcilePlan {
  const existingByKey = new Map<string, ExistingGroup>()
  for (const e of existing) existingByKey.set(gk(e.hotel_key, e.pickup_date), e)

  const computedKeys = new Set<string>()
  const groups: GroupPlan[] = []

  for (const g of computed) {
    const key = gk(g.hotel_key, g.pickup_date)
    computedKeys.add(key)
    const e = existingByKey.get(key)
    const curIds = g.members.map((m) => m.shipment_id)
    const events: BulkEvent[] = []

    if (!e) {
      groups.push({
        isNew: true,
        hotel_key: g.hotel_key, key_source: g.key_source, confident: g.confident,
        pickup_date: g.pickup_date, hotel_label: g.hotel_label,
        from_prefecture: g.from_prefecture, from_city: g.from_city,
        total_pieces: g.total_pieces, leg_count: g.leg_count, agency_count: g.agency_count,
        booking_count: g.booking_count, is_bulk: g.is_bulk, is_duplicate: g.is_duplicate,
        member_hash: g.member_hash, prevStatus: "", nextStatus: "pending", members: g.members,
        addMemberIds: curIds, removeMemberIds: [],
        events: [{ kind: "detected", detail: { total_pieces: g.total_pieces, leg_count: g.leg_count } }],
      })
      continue
    }

    const prevIds = new Set(e.member_shipment_ids)
    const addMemberIds = curIds.filter((id) => !prevIds.has(id))
    const removeMemberIds = e.member_shipment_ids.filter((id) => !curIds.includes(id))
    const changed = e.member_hash !== g.member_hash
    const delta = g.total_pieces - e.total_pieces

    let nextStatus = e.status
    if (changed) {
      if (delta > 0) events.push({ kind: "increased", detail: { from: e.total_pieces, to: g.total_pieces, delta } })
      if (delta < 0) events.push({ kind: "decreased", detail: { from: e.total_pieces, to: g.total_pieces, delta } })
      if (addMemberIds.length) events.push({ kind: "membership_changed", detail: { added: addMemberIds } })
      if (removeMemberIds.length) events.push({ kind: "membership_changed", detail: { removed: removeMemberIds } })

      if ((e.status === "notified" || e.status === "needs_reconfirm") && e.notified_snapshot) {
        // 連絡済み後の変更: material なら再確認。減少/離脱のみは記録のみ (Operator 判断)。
        const c = classifyChange(e.notified_snapshot, g)
        if (c.material) {
          nextStatus = "needs_reconfirm"
          events.push({
            kind: "reconfirm_needed",
            detail: { increase: c.increase, pieceDelta: c.pieceDelta, added: c.added, pickupTimeChanged: c.pickupTimeChanged },
          })
        }
        // material でなければ status は据え置き (notified のまま)。decreased/membership イベントは上で記録済み。
      } else if (e.status === "cleared" || e.status === "stale") {
        // 一度 cleared/stale になった集荷単位が再び 20 以上に → 未連絡として再オープン。
        nextStatus = "pending"
        events.push({ kind: "reopened", detail: { total_pieces: g.total_pieces } })
      }
      // status==='pending' (未連絡) のときは nextStatus 据え置き (pending)。イベントのみ記録。
    }

    groups.push({
      isNew: false, existingId: e.id,
      hotel_key: g.hotel_key, key_source: g.key_source, confident: g.confident,
      pickup_date: g.pickup_date, hotel_label: g.hotel_label,
      from_prefecture: g.from_prefecture, from_city: g.from_city,
      total_pieces: g.total_pieces, leg_count: g.leg_count, agency_count: g.agency_count,
      booking_count: g.booking_count, is_bulk: g.is_bulk, is_duplicate: g.is_duplicate,
      member_hash: g.member_hash, prevStatus: e.status, nextStatus, members: g.members,
      addMemberIds, removeMemberIds, events,
    })
  }

  const clears: ReconcilePlan["clears"] = []
  for (const e of existing) {
    if (computedKeys.has(gk(e.hotel_key, e.pickup_date))) continue
    if (e.status === "cleared") continue // 既に cleared は何もしない
    clears.push({
      id: e.id,
      event: { kind: "cleared", detail: { from_total: e.total_pieces, prev_status: e.status } },
    })
  }

  return { groups, clears }
}
