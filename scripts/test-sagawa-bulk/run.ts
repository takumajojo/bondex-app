/**
 * P1-B 佐川大口集荷 — 集計・ホテルキー・差分判定の純粋ロジック回帰テスト (DB 非依存)。
 *   実行: npx tsx --tsconfig scripts/test-sagawa-bulk/tsconfig.json scripts/test-sagawa-bulk/run.ts
 * 指示のケース A〜N のうち、検知・分類・冪等キーの純粋部分をここで固定する。
 * DB の一意制約・同時実行 (独立2接続)・claim 競合・lease・membership 永続化は、
 * scripts/test-sagawa-bulk-db/run_concurrency.sh (隔離した実 PostgreSQL 17) で検証する。
 */
import assert from "node:assert/strict"
import {
  BULK_THRESHOLD,
  resolveHotelKey,
  isPickupPending,
  computeBulkGroups,
  classifyChange,
  snapshotOf,
  memberHashOf,
  urgencyOf,
  notifyKeyOf,
  type BulkLeg,
  type BulkGroupComputed,
} from "@/lib/sagawa-bulk/core"
import { planReconcile, type ExistingGroup } from "@/lib/sagawa-bulk/reconcile"
import { canClaimNotify, notifyKeyHash, NOTIFY_LEASE_MS, type NotifyRow } from "@/lib/sagawa-bulk/notify"

// 条件付き UPDATE (claimBulkNotify の .or() フィルタ) を忠実に模す in-memory 1行モデル。
// DB はこの判定をアトミック(直列)に行うため、canClaimNotify が true の時だけ claim が成立する。
class FakeNotifyRow implements NotifyRow {
  notify_state: NotifyRow["notify_state"] = "idle"
  notify_key: string | null = null
  notify_claimed_at: string | null = null
  owner: string | null = null
  tryClaim(keyHash: string, nowMs: number, owner: string): boolean {
    if (!canClaimNotify(this, keyHash, nowMs, NOTIFY_LEASE_MS)) return false
    this.notify_state = "pending"; this.notify_key = keyHash
    this.notify_claimed_at = new Date(nowMs).toISOString(); this.owner = owner
    return true
  }
  record(owner: string, ok: boolean): void {
    if (this.owner !== owner || this.notify_state !== "pending") return // owner guard
    this.notify_state = ok ? "sent" : "failed"
  }
}

// 既存DBレコードを computed から擬似生成 (status/snapshot を指定)。
const existingFrom = (g: BulkGroupComputed, status: string, withSnapshot: boolean): ExistingGroup => ({
  id: "G-" + g.hotel_key + "@" + g.pickup_date,
  hotel_key: g.hotel_key, pickup_date: g.pickup_date, status,
  member_hash: g.member_hash, total_pieces: g.total_pieces,
  notified_snapshot: withSnapshot ? snapshotOf(g) : null,
  member_shipment_ids: g.members.map((m) => m.shipment_id),
})

const TODAY = "2026-11-10"
const FUTURE = "2026-12-01"

const leg = (o: Partial<BulkLeg>): BulkLeg => ({
  shipment_id: "s1", booking_id: "BDX-A", leg_index: 0, agency: "Ag1", status: "issued",
  booking_type: "fit", suitcase_count: 1, shipment_date: FUTURE, pickup_time: null,
  from_place_id: "PID1", from_hotel: "Hotel A", from_hotel_ja: "ホテルA",
  from_prefecture: "東京都", from_city: "千代田区", from_residence: null, carrier: "sagawa", ...o,
})
const groupByDate = (gs: BulkGroupComputed[], date = FUTURE) => gs.filter((g) => g.pickup_date === date)

const tests: Array<[string, () => void]> = [
  // ── ホテルキー解決 (D3) ──
  ["resolveHotelKey: place_id ありは confident な pid キー", () => {
    const r = resolveHotelKey(leg({ from_place_id: "PID9" }))
    assert.equal(r.included, true)
    if (r.included) { assert.equal(r.key, "pid:PID9"); assert.equal(r.source, "place_id"); assert.equal(r.confident, true) }
  }],
  ["resolveHotelKey: place_id なし (名称のみ) は name キー・confident=false (要確認)", () => {
    const r = resolveHotelKey(leg({ from_place_id: null }))
    assert.equal(r.included, true)
    if (r.included) { assert.equal(r.source, "name"); assert.equal(r.confident, false); assert.ok(r.key.startsWith("name:")) }
  }],
  ["resolveHotelKey: 表記揺れは別キー (自動統合しない)", () => {
    const a = resolveHotelKey(leg({ from_place_id: null, from_hotel: "Palace Hotel Tokyo", from_hotel_ja: "" }))
    const b = resolveHotelKey(leg({ from_place_id: null, from_hotel: "Palace Hotel", from_hotel_ja: "" }))
    assert.equal(a.included && b.included && a.key !== b.key, true)
  }],
  ["resolveHotelKey: residence(民泊) は対象外", () => {
    const r = resolveHotelKey(leg({ from_place_id: null, from_residence: { name: "ゲストハウス道", street: "..." } }))
    assert.equal(r.included, false)
    if (!r.included) assert.equal(r.reason, "residence")
  }],
  ["resolveHotelKey: 空の residence は除外しない (名称ホテルとして確認対象)", () => {
    const r = resolveHotelKey(leg({ from_place_id: null, from_residence: {} }))
    assert.equal(r.included, true)
  }],
  ["resolveHotelKey: チャーターは対象外", () => {
    const r = resolveHotelKey(leg({ is_charter: true }))
    assert.equal(r.included, false)
  }],

  // ── 集荷予定判定 (D6: failed の扱い) ──
  ["isPickupPending: cancelled/集荷済み以降は対象外", () => {
    for (const st of ["cancelled", "picked_up", "in_transit", "delivered"])
      assert.equal(isPickupPending(leg({ status: st }), TODAY), false)
  }],
  ["isPickupPending: requested/pending/issued/failed で集荷日が今日以降は対象", () => {
    for (const st of ["requested", "pending", "issued", "failed"])
      assert.equal(isPickupPending(leg({ status: st, shipment_date: FUTURE }), TODAY), true)
  }],
  ["isPickupPending: failed でも集荷日が過去なら対象外 (集荷予定が残っていない)", () => {
    assert.equal(isPickupPending(leg({ status: "failed", shipment_date: "2026-01-01" }), TODAY), false)
  }],

  // ── 集計 (ケース A/B/I/M/N・閾値) ──
  ["A: 単一予約20個 → 1集荷単位を検知", () => {
    const gs = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20 })], TODAY)
    assert.equal(gs.length, 1)
    assert.equal(gs[0].total_pieces, 20)
    assert.equal(gs[0].leg_count, 1)
  }],
  ["B: 12個+8個 同一ホテル同一日 → 合計20で検知", () => {
    const gs = computeBulkGroups([
      leg({ shipment_id: "s1", booking_id: "BDX-A", suitcase_count: 12 }),
      leg({ shipment_id: "s2", booking_id: "BDX-B", suitcase_count: 8 }),
    ], TODAY)
    assert.equal(gs.length, 1)
    assert.equal(gs[0].total_pieces, 20)
    assert.equal(gs[0].leg_count, 2)
  }],
  ["閾値: 19個は対象外 / 20個は対象", () => {
    assert.equal(computeBulkGroups([leg({ suitcase_count: 19 })], TODAY).length, 0)
    assert.equal(computeBulkGroups([leg({ suitcase_count: BULK_THRESHOLD })], TODAY).length, 1)
  }],
  ["別ホテル or 別集荷日 は別集計 (各<20なら対象外)", () => {
    const diffHotel = computeBulkGroups([
      leg({ shipment_id: "s1", from_place_id: "PID1", suitcase_count: 12 }),
      leg({ shipment_id: "s2", from_place_id: "PID2", suitcase_count: 8 }),
    ], TODAY)
    assert.equal(diffHotel.length, 0)
    const diffDate = computeBulkGroups([
      leg({ shipment_id: "s1", shipment_date: "2026-12-01", suitcase_count: 12 }),
      leg({ shipment_id: "s2", shipment_date: "2026-12-02", suitcase_count: 8 }),
    ], TODAY)
    assert.equal(diffDate.length, 0)
  }],
  ["I: 異なる代理店から同一ホテル同一日 → 集荷単位で合算 (agency_count=2)", () => {
    const gs = computeBulkGroups([
      leg({ shipment_id: "s1", agency: "Ag1", suitcase_count: 12 }),
      leg({ shipment_id: "s2", agency: "Ag2", suitcase_count: 10 }),
    ], TODAY)
    assert.equal(gs.length, 1)
    assert.equal(gs[0].total_pieces, 22)
    assert.equal(gs[0].agency_count, 2)
  }],
  ["M: 複数ホテルに20個以上 → 別々の集荷単位", () => {
    const gs = computeBulkGroups([
      leg({ shipment_id: "s1", from_place_id: "PID1", suitcase_count: 20 }),
      leg({ shipment_id: "s2", from_place_id: "PID2", suitcase_count: 25 }),
    ], TODAY)
    assert.equal(gs.length, 2)
  }],
  ["N: FIT予約でも集荷量20個以上なら対象", () => {
    const gs = computeBulkGroups([leg({ booking_type: "fit", suitcase_count: 20 })], TODAY)
    assert.equal(gs.length, 1)
  }],
  ["residence/charter/キャンセルは集計から除外", () => {
    const gs = computeBulkGroups([
      leg({ shipment_id: "s1", suitcase_count: 15 }),
      leg({ shipment_id: "s2", suitcase_count: 15, from_residence: { name: "民泊" } }),
      leg({ shipment_id: "s3", suitcase_count: 15, is_charter: true }),
      leg({ shipment_id: "s4", suitcase_count: 15, status: "cancelled" }),
    ], TODAY)
    // 対象は s1(15) のみ → 20未満・予約1件 → グループなし
    assert.equal(gs.length, 0)
  }],

  // ── 重複集荷の検知 (req1: 同一ホテル×同日に複数予約・20個未満でも Operator へ注意喚起) ──
  ["重複: 同一ホテル同日に2予約・合計<20 → is_duplicate=true / is_bulk=false / booking_count=2", () => {
    const gs = computeBulkGroups([
      leg({ shipment_id: "s1", booking_id: "BDX-A", suitcase_count: 3 }),
      leg({ shipment_id: "s2", booking_id: "BDX-B", suitcase_count: 4 }),
    ], TODAY)
    assert.equal(gs.length, 1)
    assert.equal(gs[0].is_duplicate, true)
    assert.equal(gs[0].is_bulk, false)
    assert.equal(gs[0].booking_count, 2)
    assert.equal(gs[0].total_pieces, 7)
  }],
  ["重複: 同一予約の複数区間は重複に数えない (booking_count=1 → 大口でも重複でもなくグループなし)", () => {
    const gs = computeBulkGroups([
      leg({ shipment_id: "s1", booking_id: "BDX-A", leg_index: 0, suitcase_count: 5 }),
      leg({ shipment_id: "s2", booking_id: "BDX-A", leg_index: 1, suitcase_count: 5 }),
    ], TODAY)
    assert.equal(gs.length, 0)
  }],
  ["大口かつ重複: 2予約 合計25 → is_bulk=true かつ is_duplicate=true (同じ集荷単位に両方)", () => {
    const gs = computeBulkGroups([
      leg({ shipment_id: "s1", booking_id: "BDX-A", suitcase_count: 13 }),
      leg({ shipment_id: "s2", booking_id: "BDX-B", suitcase_count: 12 }),
    ], TODAY)
    assert.equal(gs.length, 1)
    assert.equal(gs[0].is_bulk, true)
    assert.equal(gs[0].is_duplicate, true)
    assert.equal(gs[0].booking_count, 2)
  }],
  ["単一予約20個は大口だが重複ではない (booking_count=1)", () => {
    const g = computeBulkGroups([leg({ shipment_id: "s1", booking_id: "BDX-A", suitcase_count: 20 })], TODAY)[0]
    assert.equal(g.is_bulk, true)
    assert.equal(g.is_duplicate, false)
    assert.equal(g.booking_count, 1)
  }],
  ["重複: 別ホテルの2予約 (各<20) は別集荷単位 → 重複としない", () => {
    const gs = computeBulkGroups([
      leg({ shipment_id: "s1", booking_id: "BDX-A", from_place_id: "PID1", suitcase_count: 5 }),
      leg({ shipment_id: "s2", booking_id: "BDX-B", from_place_id: "PID2", suitcase_count: 5 }),
    ], TODAY)
    assert.equal(gs.length, 0)
  }],
  ["重複: 名称のみ表記揺れは別キー=自動統合せず重複としない / 同一名称キーは重複(要確認)", () => {
    const split = computeBulkGroups([
      leg({ shipment_id: "s1", booking_id: "BDX-A", from_place_id: null, from_hotel_ja: "パレスホテル東京", suitcase_count: 5 }),
      leg({ shipment_id: "s2", booking_id: "BDX-B", from_place_id: null, from_hotel_ja: "パレスホテル", suitcase_count: 5 }),
    ], TODAY)
    assert.equal(split.length, 0)
    const same = computeBulkGroups([
      leg({ shipment_id: "s1", booking_id: "BDX-A", from_place_id: null, from_hotel_ja: "パレスホテル東京", suitcase_count: 5 }),
      leg({ shipment_id: "s2", booking_id: "BDX-B", from_place_id: null, from_hotel_ja: "パレスホテル東京", suitcase_count: 5 }),
    ], TODAY)
    assert.equal(same.length, 1)
    assert.equal(same[0].is_duplicate, true)
    assert.equal(same[0].confident, false)
  }],

  // ── member_hash の安定性 ──
  ["member_hash: 同一構成は同一・構成変化で変化", () => {
    const g1 = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20 })], TODAY)[0]
    const g2 = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20 })], TODAY)[0]
    assert.equal(g1.member_hash, g2.member_hash)
    const g3 = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 21 })], TODAY)[0]
    assert.notEqual(g1.member_hash, g3.member_hash)
  }],

  // ── 差分判定 (ケース E/L・+1増加・時間帯・減少) ──
  ["E: 連絡済み20個 → 30個 (増加) は material (再確認)", () => {
    const snap = snapshotOf(computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20 })], TODAY)[0])
    const cur = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 30 })], TODAY)[0]
    const c = classifyChange(snap, cur)
    assert.equal(c.material, true); assert.equal(c.increase, true); assert.equal(c.pieceDelta, 10)
  }],
  ["D4: 連絡済みから+1個でも material", () => {
    const snap = snapshotOf(computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20 })], TODAY)[0])
    const cur = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 21 })], TODAY)[0]
    assert.equal(classifyChange(snap, cur).material, true)
  }],
  ["L: 連絡済み後に新規予約追加 (合計増) は material・added に検出", () => {
    const snap = snapshotOf(computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20 })], TODAY)[0])
    const cur = computeBulkGroups([
      leg({ shipment_id: "s1", suitcase_count: 20 }),
      leg({ shipment_id: "s2", booking_id: "BDX-B", suitcase_count: 5 }),
    ], TODAY)[0]
    const c = classifyChange(snap, cur)
    assert.equal(c.material, true); assert.deepEqual(c.added, ["s2"])
  }],
  ["集荷時間帯の変更は material", () => {
    const snap = snapshotOf(computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20, pickup_time: "9:30" })], TODAY)[0])
    const cur = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20, pickup_time: "14:00" })], TODAY)[0]
    assert.equal(classifyChange(snap, cur).pickupTimeChanged, true)
    assert.equal(classifyChange(snap, cur).material, true)
  }],
  ["減少は material にしない (履歴のみ・Operator判断)。decrease/removed を記録", () => {
    const snap = snapshotOf(computeBulkGroups([
      leg({ shipment_id: "s1", suitcase_count: 20 }),
      leg({ shipment_id: "s2", booking_id: "BDX-B", suitcase_count: 10 }),
    ], TODAY)[0])
    const cur = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20 })], TODAY)[0]
    const c = classifyChange(snap, cur)
    assert.equal(c.material, false); assert.equal(c.decrease, true); assert.deepEqual(c.removed, ["s2"])
  }],
  ["変更なしは material=false", () => {
    const g = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20 })], TODAY)[0]
    assert.equal(classifyChange(snapshotOf(g), g).material, false)
  }],

  // ── 優先度・冪等キー (D4/D5) ──
  ["urgencyOf: 当日=today / 前日=tomorrow / 過去=overdue / それ以前=upcoming", () => {
    assert.equal(urgencyOf("2026-11-10", TODAY), "today")
    assert.equal(urgencyOf("2026-11-11", TODAY), "tomorrow")
    assert.equal(urgencyOf("2026-11-09", TODAY), "overdue")
    assert.equal(urgencyOf("2026-11-20", TODAY), "upcoming")
  }],
  ["notifyKeyOf: 種別・member_hash を含む (構成変化で別キー=再通知可 / 同一で重複防止)", () => {
    const k1 = notifyKeyOf("pid:X", FUTURE, "h1", "initial")
    const k2 = notifyKeyOf("pid:X", FUTURE, "h1", "initial")
    const k3 = notifyKeyOf("pid:X", FUTURE, "h2", "change")
    assert.equal(k1, k2)
    assert.notEqual(k1, k3)
  }],

  // ── 再集計の照合プラン (F/G/L/クリア/再オープン・冪等) ──
  ["reconcile: 既存なし → 新規検知 (isNew・pending・detected)", () => {
    const g = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20 })], TODAY)
    const plan = planReconcile(g, [])
    assert.equal(plan.groups.length, 1)
    assert.equal(plan.groups[0].isNew, true)
    assert.equal(plan.groups[0].nextStatus, "pending")
    assert.equal(plan.groups[0].events[0].kind, "detected")
  }],
  ["reconcile: booking_count/is_bulk/is_duplicate と prevStatus を計画へ反映 (新規・重複のみ)", () => {
    const g = computeBulkGroups([
      leg({ shipment_id: "s1", booking_id: "BDX-A", suitcase_count: 3 }),
      leg({ shipment_id: "s2", booking_id: "BDX-B", suitcase_count: 4 }),
    ], TODAY)
    const plan = planReconcile(g, [])
    assert.equal(plan.groups[0].is_duplicate, true)
    assert.equal(plan.groups[0].is_bulk, false)
    assert.equal(plan.groups[0].booking_count, 2)
    assert.equal(plan.groups[0].prevStatus, "")
    assert.equal(plan.groups[0].nextStatus, "pending")
  }],
  ["reconcile: 既存 status を prevStatus に保持・変化なしは遷移しない (status を書かせない)", () => {
    const g = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20 })], TODAY)
    const plan = planReconcile(g, [existingFrom(g[0], "notified", true)])
    assert.equal(plan.groups[0].prevStatus, "notified")
    assert.equal(plan.groups[0].nextStatus, "notified") // prevStatus===nextStatus → applyGroupPlan は status を書かない
  }],
  ["reconcile: 変化なし (冪等) → イベントなし・status 据え置き", () => {
    const g = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20 })], TODAY)
    const plan = planReconcile(g, [existingFrom(g[0], "notified", true)])
    assert.equal(plan.groups[0].events.length, 0)
    assert.equal(plan.groups[0].nextStatus, "notified")
    assert.equal(plan.clears.length, 0)
  }],
  ["L: 連絡済みに新規予約追加 → needs_reconfirm + reconfirm_needed", () => {
    const before = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20 })], TODAY)
    const after = computeBulkGroups([
      leg({ shipment_id: "s1", suitcase_count: 20 }),
      leg({ shipment_id: "s2", booking_id: "BDX-B", suitcase_count: 6 }),
    ], TODAY)
    const plan = planReconcile(after, [existingFrom(before[0], "notified", true)])
    assert.equal(plan.groups[0].nextStatus, "needs_reconfirm")
    assert.deepEqual(plan.groups[0].addMemberIds, ["s2"])
    assert.ok(plan.groups[0].events.some((e) => e.kind === "reconfirm_needed"))
  }],
  ["E: 連絡済み個数増加 → needs_reconfirm + increased", () => {
    const before = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20 })], TODAY)
    const after = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 30 })], TODAY)
    const plan = planReconcile(after, [existingFrom(before[0], "notified", true)])
    assert.equal(plan.groups[0].nextStatus, "needs_reconfirm")
    assert.ok(plan.groups[0].events.some((e) => e.kind === "increased"))
  }],
  ["F/G: 連絡済みからメンバー離脱(減少) → material でなく status 据え置き・decreased/removeを記録", () => {
    const before = computeBulkGroups([
      leg({ shipment_id: "s1", suitcase_count: 20 }),
      leg({ shipment_id: "s2", booking_id: "BDX-B", suitcase_count: 8 }),
    ], TODAY)
    // s2 が別集荷日/別ホテルへ移動 → この集荷単位からは離脱 (s1 の 20 のみ残る)
    const after = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20 })], TODAY)
    const plan = planReconcile(after, [existingFrom(before[0], "notified", true)])
    assert.equal(plan.groups[0].nextStatus, "notified") // 減少のみ=自動再確認しない
    assert.deepEqual(plan.groups[0].removeMemberIds, ["s2"])
    assert.ok(plan.groups[0].events.some((e) => e.kind === "decreased"))
  }],
  ["クリア: 既存が20個未満に減少/消滅 → clears に (履歴は残す)", () => {
    const before = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 22 })], TODAY)
    // 現在は 15個 (20未満) → computed に現れない
    const plan = planReconcile([], [existingFrom(before[0], "notified", true)])
    assert.equal(plan.groups.length, 0)
    assert.equal(plan.clears.length, 1)
    assert.equal(plan.clears[0].event.kind, "cleared")
  }],
  ["再オープン: cleared が再び20個以上 → pending + reopened", () => {
    const g = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20 })], TODAY)
    const plan = planReconcile(g, [existingFrom(g[0], "cleared", false)])
    // member_hash は同じだが status=cleared からの復帰。構成変化が無い場合は据え置き=cleared のままになり得るので
    // 構成が変わって再浮上するケースを確認する。
    const after = computeBulkGroups([
      leg({ shipment_id: "s1", suitcase_count: 20 }),
      leg({ shipment_id: "s2", booking_id: "BDX-B", suitcase_count: 3 }),
    ], TODAY)
    const plan2 = planReconcile(after, [existingFrom(g[0], "cleared", false)])
    assert.equal(plan2.groups[0].nextStatus, "pending")
    assert.ok(plan2.groups[0].events.some((e) => e.kind === "reopened"))
    void plan
  }],

  // ── 通知の冪等性 (J/K/D5): 条件付きクレーム + lease + 成功後のみ sent ──
  ["canClaimNotify: 同一キーで sent は不可 / idle・failed は可 / 別キーは可", () => {
    const kh = notifyKeyHash("nk-1")
    assert.equal(canClaimNotify({ notify_state: "idle", notify_key: null, notify_claimed_at: null }, kh, Date.now(), NOTIFY_LEASE_MS), true)
    assert.equal(canClaimNotify({ notify_state: "sent", notify_key: kh, notify_claimed_at: null }, kh, Date.now(), NOTIFY_LEASE_MS), false)
    assert.equal(canClaimNotify({ notify_state: "failed", notify_key: kh, notify_claimed_at: null }, kh, Date.now(), NOTIFY_LEASE_MS), true)
    assert.equal(canClaimNotify({ notify_state: "sent", notify_key: kh, notify_claimed_at: null }, notifyKeyHash("nk-2"), Date.now(), NOTIFY_LEASE_MS), true)
  }],
  ["J: cron同時実行 → claim は1本だけ成立 (他は false)", () => {
    const row = new FakeNotifyRow()
    const kh = notifyKeyHash("nk-J")
    const now = Date.now()
    const a = row.tryClaim(kh, now, "ownerA")
    const b = row.tryClaim(kh, now, "ownerB") // 直後に同一キーで claim → pending-fresh で不可
    assert.equal(a, true); assert.equal(b, false)
    assert.equal(row.owner, "ownerA")
  }],
  ["J: 送信成功後は同一バージョンの再claim不可 (重複送信しない)", () => {
    const row = new FakeNotifyRow()
    const kh = notifyKeyHash("nk-J2")
    row.tryClaim(kh, Date.now(), "o1"); row.record("o1", true)
    assert.equal(row.notify_state, "sent")
    assert.equal(row.tryClaim(kh, Date.now(), "o2"), false)
  }],
  ["K: 送信失敗 → failed → 再試行で再claim可、成功で sent", () => {
    const row = new FakeNotifyRow()
    const kh = notifyKeyHash("nk-K")
    row.tryClaim(kh, Date.now(), "o1"); row.record("o1", false)
    assert.equal(row.notify_state, "failed")
    assert.equal(row.tryClaim(kh, Date.now(), "o2"), true) // 再試行
    row.record("o2", true)
    assert.equal(row.notify_state, "sent")
  }],
  ["K: owner guard — pending を持たない run は結果を書けない", () => {
    const row = new FakeNotifyRow()
    const kh = notifyKeyHash("nk-K2")
    row.tryClaim(kh, Date.now(), "o1")
    row.record("intruder", true) // 別ownerの記録は無視される
    assert.equal(row.notify_state, "pending")
    row.record("o1", true)
    assert.equal(row.notify_state, "sent")
  }],
  ["D5: 送信成功後にDB記録が失敗(pendingのまま)→ lease中は再claim不可 / lease切れ後に再claim(再送はResendキーで重複排除)", () => {
    const row = new FakeNotifyRow()
    const kh = notifyKeyHash("nk-D5")
    const t0 = Date.now()
    row.tryClaim(kh, t0, "o1")
    // 送信成功したが record が失敗 → pending のまま (owner=o1, claimed_at=t0)
    assert.equal(row.tryClaim(kh, t0 + 60_000, "o2"), false) // lease(10分)内は再claim不可=二重送信しない
    assert.equal(row.tryClaim(kh, t0 + NOTIFY_LEASE_MS + 1, "o3"), true) // lease切れ後は再claim可
    // ※実際の再送は同一 Resend Idempotency-Key のため Resend 側で重複排除される (SMTPフォールバック時を除く=残存制約)。
  }],
]

let failed = 0
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok   ${name}`) }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : e}`) }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`)
process.exit(failed ? 1 : 0)
