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
import { sagawaBulkAlertEnabled, sagawaBulkEmailEnabled } from "@/lib/sagawa-bulk/flag"
import { cronBearerAuthorized } from "@/lib/sagawa-bulk/auth"
import { dryRunBulkAlert, recomputeSafe } from "@/lib/sagawa-bulk/db"
import type { SupabaseClient } from "@supabase/supabase-js"

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

// env を一時的に差し替えて関数を実行し、必ず元に戻す (フラグ判定テスト用)。
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {}
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k]
    if (vars[k] === undefined) delete process.env[k]
    else process.env[k] = vars[k]
  }
  try { fn() } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
  }
}

async function withEnvAsync(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const prev: Record<string, string | undefined> = {}
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k]
    if (vars[k] === undefined) delete process.env[k]
    else process.env[k] = vars[k]
  }
  try { await fn() } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
  }
}

// dryRunBulkAlert が読む2テーブルだけを返す最小 fake。write 系 (insert/update/upsert/delete) が
// 呼ばれたら throw = 「ドライランは一切書き込まない」ことをテストで保証する。
function fakeSb(tables: Record<string, Record<string, unknown>[]>, onWrite: () => void): SupabaseClient {
  const builder = (rows: Record<string, unknown>[]) => {
    const q: Record<string, unknown> = {}
    for (const m of ["select", "not", "gte", "in", "is", "neq", "eq", "order"]) q[m] = () => q
    for (const w of ["insert", "update", "upsert", "delete"]) q[w] = () => { onWrite(); throw new Error(`dry-run は書き込み禁止: ${w}`) }
    q.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null })
    q.single = () => Promise.resolve({ data: rows[0] ?? null, error: null })
    q.then = (resolve: (v: { data: unknown; error: null }) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve, reject)
    return q
  }
  return { from: (t: string) => builder(tables[t] ?? []) } as unknown as SupabaseClient
}

// shipments 行 (LEG_COLS 準拠)。dryRun は loadActiveLegs の status/日付フィルタを SQL 側ではなく
// fake が素通しするため、ここでは computeBulkGroups が対象化する行だけを渡す。
const shipRow = (o: Record<string, unknown>): Record<string, unknown> => ({
  id: "s1", booking_id: "BDX-A", leg_index: 0, agency: "Ag1", status: "issued",
  booking_type: "fit", suitcase_count: 1, shipment_date: FUTURE, pickup_time: null,
  from_place_id: "PID1", from_hotel: "Hotel A", from_hotel_ja: "ホテルA",
  from_prefecture: "東京都", from_city: "千代田区", from_residence: null, carrier: "sagawa", ...o,
})

const tests: Array<[string, () => void | Promise<void>]> = [
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

  // ── 通知制御の2段階フラグ (検知 / メール送信) ──
  ["フラグ分離: メール送信は検知ON かつ メールON の両方成立時のみ (既定OFF・検知のみONでは送らない)", () => {
    withEnv({ SAGAWA_BULK_ALERT_ENABLED: undefined, SAGAWA_BULK_EMAIL_ENABLED: undefined }, () => {
      assert.equal(sagawaBulkAlertEnabled(), false)
      assert.equal(sagawaBulkEmailEnabled(), false)
    })
    withEnv({ SAGAWA_BULK_ALERT_ENABLED: "true", SAGAWA_BULK_EMAIL_ENABLED: undefined }, () => {
      assert.equal(sagawaBulkAlertEnabled(), true)
      assert.equal(sagawaBulkEmailEnabled(), false) // 検知のみON → メール不可
    })
    withEnv({ SAGAWA_BULK_ALERT_ENABLED: "true", SAGAWA_BULK_EMAIL_ENABLED: "true" }, () => {
      assert.equal(sagawaBulkEmailEnabled(), true) // 両方ON → 送信可
    })
    withEnv({ SAGAWA_BULK_ALERT_ENABLED: "false", SAGAWA_BULK_EMAIL_ENABLED: "true" }, () => {
      assert.equal(sagawaBulkEmailEnabled(), false) // 検知OFF ならメールもOFF
    })
  }],

  // ── ドライラン (メール送信せず・DB書込せず候補を返す) ──
  ["dryRun: 大口かつ重複を計数・初回通知候補を算出・一切書き込まない", async () => {
    let wrote = false
    const sb = fakeSb({
      shipments: [
        shipRow({ id: "s1", booking_id: "BDX-A", suitcase_count: 13 }),
        shipRow({ id: "s2", booking_id: "BDX-B", suitcase_count: 12 }),
      ],
      sagawa_bulk_pickups: [],
      sagawa_bulk_pickup_members: [],
    }, () => { wrote = true })
    const r = await dryRunBulkAlert(sb, TODAY)
    assert.equal(wrote, false) // 書き込みゼロ
    assert.equal(r.groups_total, 1)
    assert.equal(r.bulk_count, 1)
    assert.equal(r.duplicate_count, 1)
    assert.equal(r.both_count, 1)
    assert.equal(r.initial_notify_candidates, 1)
    assert.equal(r.rechange_notify_candidates, 0)
    assert.equal(r.groups[0].would_notify?.reason, "initial")
  }],
  ["dryRun: 連絡済み後に material 変更 → 再通知候補 (初回ではなく change)・書き込みなし", async () => {
    const g20 = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20 })], TODAY)[0]
    let wrote = false
    const sb = fakeSb({
      shipments: [shipRow({ id: "s1", booking_id: "BDX-A", suitcase_count: 30 })], // 20→30 (増加=material)
      sagawa_bulk_pickups: [{
        id: "G1", hotel_key: g20.hotel_key, pickup_date: g20.pickup_date, status: "notified",
        member_hash: g20.member_hash, total_pieces: 20, notified_snapshot: snapshotOf(g20),
      }],
      sagawa_bulk_pickup_members: [],
    }, () => { wrote = true })
    const r = await dryRunBulkAlert(sb, TODAY)
    assert.equal(wrote, false)
    assert.equal(r.bulk_count, 1)
    assert.equal(r.initial_notify_candidates, 0)
    assert.equal(r.rechange_notify_candidates, 1)
    assert.equal(r.groups[0].would_notify?.reason, "change")
  }],
  ["dryRun: 宛先件数は opsRecipients を反映 (ALERT_EMAIL 有無)・実アドレスは返さない / email_enabled はフラグ連動", async () => {
    const sb = fakeSb({ shipments: [], sagawa_bulk_pickups: [], sagawa_bulk_pickup_members: [] }, () => {})
    await withEnvAsync({ ALERT_EMAIL: undefined, SAGAWA_BULK_ALERT_ENABLED: "true", SAGAWA_BULK_EMAIL_ENABLED: undefined }, async () => {
      const r = await dryRunBulkAlert(sb, TODAY)
      assert.equal(r.recipients_count, 1)       // support@ のみ
      assert.equal(r.recipients_present, true)
      assert.equal(r.alert_enabled, true)
      assert.equal(r.email_enabled, false)      // 検知のみON
      assert.ok(!("recipients" in r))           // 実アドレスのフィールドは返さない
    })
    await withEnvAsync({ ALERT_EMAIL: "ops@example.com", SAGAWA_BULK_ALERT_ENABLED: "true", SAGAWA_BULK_EMAIL_ENABLED: "true" }, async () => {
      const r = await dryRunBulkAlert(sb, TODAY)
      assert.equal(r.recipients_count, 2)       // ALERT_EMAIL + support@
      assert.equal(r.email_enabled, true)       // 両方ON
    })
  }],
  ["dryRun: 検知フラグ OFF でも件数・候補を算出 (本番有効化なしで事前確認できる)・書き込みなし", async () => {
    let wrote = false
    const sb = fakeSb({
      shipments: [
        shipRow({ id: "s1", booking_id: "BDX-A", suitcase_count: 13 }),
        shipRow({ id: "s2", booking_id: "BDX-B", suitcase_count: 12 }),
      ],
      sagawa_bulk_pickups: [],
      sagawa_bulk_pickup_members: [],
    }, () => { wrote = true })
    // 検知フラグ・メールフラグとも未設定 (OFF)。dryRunBulkAlert はフラグに依存せず候補を計算し、状態は報告のみ。
    await withEnvAsync({ SAGAWA_BULK_ALERT_ENABLED: undefined, SAGAWA_BULK_EMAIL_ENABLED: undefined }, async () => {
      const r = await dryRunBulkAlert(sb, TODAY)
      assert.equal(wrote, false)                 // 書き込みゼロ
      assert.equal(r.alert_enabled, false)       // 検知OFF を正しく報告
      assert.equal(r.email_enabled, false)
      assert.equal(r.bulk_count, 1)              // OFF でも件数は算出される
      assert.equal(r.duplicate_count, 1)
      assert.equal(r.initial_notify_candidates, 1)
      assert.equal(r.groups[0].would_notify?.reason, "initial") // 「有効化したら送る対象」を提示
    })
  }],
  ["dryRun: プレビューの大口/重複分類は computeBulkGroups (再集計の正本ロジック) と一致する", async () => {
    const legs = [
      leg({ shipment_id: "s1", booking_id: "BDX-A", from_place_id: "PID1", suitcase_count: 13 }),
      leg({ shipment_id: "s2", booking_id: "BDX-B", from_place_id: "PID1", suitcase_count: 12 }),
      leg({ shipment_id: "s3", booking_id: "BDX-C", from_place_id: "PID2", suitcase_count: 5 }),
      leg({ shipment_id: "s4", booking_id: "BDX-D", from_place_id: "PID2", suitcase_count: 6 }),
    ]
    const expected = computeBulkGroups(legs, TODAY) // 再集計 (recompute/listBulkPickups) が使う正本
    const sb = fakeSb({
      shipments: legs.map((l) => shipRow(l as unknown as Record<string, unknown>)),
      sagawa_bulk_pickups: [], sagawa_bulk_pickup_members: [],
    }, () => {})
    const r = await dryRunBulkAlert(sb, TODAY)
    // 同じ入力なら件数・各集荷単位の分類がプレビューと再集計で一致 (本番で再集計を走らせず検証)。
    assert.equal(r.bulk_count, expected.filter((g) => g.is_bulk).length)
    assert.equal(r.duplicate_count, expected.filter((g) => g.is_duplicate).length)
    assert.equal(r.groups_total, expected.length)
    for (const g of expected) {
      const p = r.groups.find((x) => x.hotel_key === g.hotel_key && x.pickup_date === g.pickup_date)
      assert.ok(p, `preview に ${g.hotel_key} が無い`)
      assert.equal(p!.is_bulk, g.is_bulk)
      assert.equal(p!.is_duplicate, g.is_duplicate)
      assert.equal(p!.total_pieces, g.total_pieces)
      assert.equal(p!.booking_count, g.booking_count)
    }
  }],

  // ── cron 認証 (CRON_SECRET + Bearer・fail closed) ──
  ["cron認証: CRON_SECRET 未設定/空/空白なら常に拒否 (fail closed)", () => {
    for (const secret of [undefined, "", "   "]) {
      assert.equal(cronBearerAuthorized("Bearer whatever", secret), false)
      assert.equal(cronBearerAuthorized(null, secret), false)
    }
  }],
  ["cron認証: 正しい Bearer のみ許可・ヘッダなし/プレフィックス違い/トークン不一致は拒否", () => {
    const secret = "s3cr3t-token"
    assert.equal(cronBearerAuthorized(`Bearer ${secret}`, secret), true)   // 正規
    assert.equal(cronBearerAuthorized(null, secret), false)                // ヘッダなし
    assert.equal(cronBearerAuthorized("", secret), false)                  // 空ヘッダ
    assert.equal(cronBearerAuthorized(secret, secret), false)              // Bearer プレフィックスなし
    assert.equal(cronBearerAuthorized(`Bearer ${secret}x`, secret), false) // トークン不一致
    assert.equal(cronBearerAuthorized(`bearer ${secret}`, secret), false)  // 大文字小文字も区別
    assert.equal(cronBearerAuthorized(`Basic ${secret}`, secret), false)   // 別スキーム
  }],

  // ── Track A 実運用シナリオ (指示のケース1-10を明示的に固定) ──
  ["ケース1: 単独20個 → 大口 (佐川事前連絡が必要=is_bulk)・重複ではない", () => {
    const g = computeBulkGroups([leg({ shipment_id: "s1", booking_id: "BDX-A", suitcase_count: 20 })], TODAY)
    assert.equal(g.length, 1)
    assert.equal(g[0].is_bulk, true)       // 大口=佐川への事前連絡が必要
    assert.equal(g[0].is_duplicate, false) // 単独予約=重複ではない
    assert.equal(g[0].booking_count, 1)
  }],
  ["ケース2: 同一ホテル同日 12個+8個 → 大口かつ重複・予約別の個数を独立保持", () => {
    const g = computeBulkGroups([
      leg({ shipment_id: "s1", booking_id: "BDX-A", suitcase_count: 12 }),
      leg({ shipment_id: "s2", booking_id: "BDX-B", suitcase_count: 8 }),
    ], TODAY)[0]
    assert.equal(g.is_bulk, true)       // 合計20=大口
    assert.equal(g.is_duplicate, true)  // distinct予約2=重複
    assert.equal(g.total_pieces, 20)
    assert.equal(g.booking_count, 2)
    // 予約別の個数は合算しても独立保持 (members に 12 と 8 が別々に残る)。
    const pieces = g.members.map((m) => m.pieces).sort((a, b) => a - b)
    assert.deepEqual(pieces, [8, 12])
  }],
  ["ケース3: 同一ホテル同日 3個+4個 → 重複のみ (佐川大口事前連絡は不要=is_bulk:false)", () => {
    const g = computeBulkGroups([
      leg({ shipment_id: "s1", booking_id: "BDX-A", suitcase_count: 3 }),
      leg({ shipment_id: "s2", booking_id: "BDX-B", suitcase_count: 4 }),
    ], TODAY)[0]
    assert.equal(g.is_duplicate, true)
    assert.equal(g.is_bulk, false) // 合計7<20 → 大口事前連絡は不要 (メール対象外・画面注意喚起のみ)
  }],
  ["ケース4: 連絡済み20個→25個 → 再連絡が必要・以前の個数(20)を保持・変更内容(+5)を確認可能", () => {
    const before = computeBulkGroups([leg({ shipment_id: "s1", booking_id: "BDX-A", suitcase_count: 20 })], TODAY)[0]
    const snap = snapshotOf(before)                 // 連絡時点のスナップショット=20個を保持
    const after = computeBulkGroups([leg({ shipment_id: "s1", booking_id: "BDX-A", suitcase_count: 25 })], TODAY)[0]
    const c = classifyChange(snap, after)
    assert.equal(c.material, true)                  // 再連絡が必要
    assert.equal(c.increase, true)
    assert.equal(c.pieceDelta, 5)                   // Operatorで +5 の変更を確認できる
    // reconcile でも needs_reconfirm に遷移し、以前の連絡 (notified) を巻き戻さない。
    const plan = planReconcile([after], [existingFrom(before, "notified", true)])
    assert.equal(plan.groups[0].nextStatus, "needs_reconfirm")
    assert.ok(plan.groups[0].events.some((e) => e.kind === "increased"))
  }],
  ["ケース5: 同日・別ホテルへ変更 → 旧集荷単位から離脱・新ホテルで再判定・旧履歴は削除しない(cleared)", () => {
    const beforeA = computeBulkGroups([leg({ shipment_id: "s1", booking_id: "BDX-A", from_place_id: "PID1", suitcase_count: 20 })], TODAY)[0]
    // s1 が同日・別ホテル(PID2)へ移動。旧ホテル(PID1)には現メンバーが残らない。
    const afterB = computeBulkGroups([leg({ shipment_id: "s1", booking_id: "BDX-A", from_place_id: "PID2", suitcase_count: 20 })], TODAY)
    const plan = planReconcile(afterB, [existingFrom(beforeA, "notified", true)])
    // 新ホテル(PID2)=新規の大口として再判定。
    const neu = plan.groups.find((g) => g.hotel_key.includes("PID2"))
    assert.ok(neu && neu.isNew && neu.nextStatus === "pending")
    // 旧ホテル(PID1)=クリア。履歴(行)は削除せず status=cleared で残す。
    assert.equal(plan.clears.length, 1)
    assert.ok(plan.clears[0].id.includes("PID1")) // existingFrom の id は "G-"+hotel_key+"@"+date
    assert.equal(plan.clears[0].event.kind, "cleared")
  }],
  ["ケース6: 20個予約がキャンセル → アクティブな大口を解除(cleared)・履歴は保持", () => {
    const before = computeBulkGroups([leg({ shipment_id: "s1", booking_id: "BDX-A", suitcase_count: 20 })], TODAY)[0]
    // キャンセルは computeBulkGroups から除外される → 現在のアクティブ集荷単位は空。
    const afterCancelled = computeBulkGroups([leg({ shipment_id: "s1", booking_id: "BDX-A", suitcase_count: 20, status: "cancelled" })], TODAY)
    assert.equal(afterCancelled.length, 0)
    const plan = planReconcile(afterCancelled, [existingFrom(before, "notified", true)])
    assert.equal(plan.clears.length, 1)                       // アクティブ解除
    assert.equal(plan.clears[0].event.kind, "cleared")        // 履歴イベントは残す
  }],
  ["ケース7: 同一ホテル A社30個+B社20個 → 合計50の大口かつ重複・予約別内訳保持・自動統合しない", () => {
    const g = computeBulkGroups([
      leg({ shipment_id: "s1", booking_id: "BDX-A", agency: "A社", from_place_id: "PID1", suitcase_count: 30 }),
      leg({ shipment_id: "s2", booking_id: "BDX-B", agency: "B社", from_place_id: "PID1", suitcase_count: 20 }),
    ], TODAY)[0]
    assert.equal(g.total_pieces, 50)
    assert.equal(g.is_bulk, true)
    assert.equal(g.is_duplicate, true)
    assert.equal(g.agency_count, 2)
    assert.equal(g.booking_count, 2)
    // 予約別の個数・代理店・予約番号を独立保持 (按分も自動統合もしない)。
    const byBooking = new Map(g.members.map((m) => [m.booking_id, m]))
    assert.equal(byBooking.get("BDX-A")!.pieces, 30)
    assert.equal(byBooking.get("BDX-A")!.agency, "A社")
    assert.equal(byBooking.get("BDX-B")!.pieces, 20)
    assert.equal(byBooking.get("BDX-B")!.agency, "B社")
  }],
  ["ケース8: 表記揺れ → place_id一致のみ自動統合・名称のみ(不確実)は別キー=Operator確認・誤集計しない", () => {
    // 確実なホテルID(place_id)が一致 → 同一集荷単位に統合。
    const merged = computeBulkGroups([
      leg({ shipment_id: "s1", booking_id: "BDX-A", from_place_id: "PID1", from_hotel_ja: "パレスホテル東京", suitcase_count: 12 }),
      leg({ shipment_id: "s2", booking_id: "BDX-B", from_place_id: "PID1", from_hotel_ja: "Palace Hotel", suitcase_count: 8 }),
    ], TODAY)
    assert.equal(merged.length, 1)
    assert.equal(merged[0].total_pieces, 20)
    assert.equal(merged[0].confident, true) // place_id ベース=高信頼
    // place_id なし・名称だけ違う → 別キー=自動統合しない (誤集計を避ける)。
    const split = computeBulkGroups([
      leg({ shipment_id: "s3", booking_id: "BDX-C", from_place_id: null, from_hotel_ja: "パレスホテル東京", suitcase_count: 12 }),
      leg({ shipment_id: "s4", booking_id: "BDX-D", from_place_id: null, from_hotel_ja: "パレスホテル", suitcase_count: 8 }),
    ], TODAY)
    assert.equal(split.length, 0) // 別キー扱いで各<20・単独予約 → グループ化しない
  }],
  ["再集計失敗時の復旧: recomputeSafe は DB エラーでも throw せず復帰 (cron を落とさない・次回再試行)", async () => {
    // loadActiveLegs の読み取りが error を返す fake → recomputeBulkPickups は throw するが、
    // recomputeSafe が握りつぶして void 復帰する (呼び出し元の予約フロー/cron を壊さない)。
    const failingSb = {
      from: () => {
        const q: Record<string, unknown> = {}
        for (const m of ["select", "not", "gte", "in", "is", "neq", "eq", "order"]) q[m] = () => q
        q.then = (resolve: (v: { data: null; error: { message: string } }) => unknown) =>
          Promise.resolve({ data: null, error: { message: "boom (simulated DB failure)" } }).then(resolve)
        return q
      },
    } as unknown as SupabaseClient
    await recomputeSafe(failingSb, TODAY) // throw しなければ復旧成功 (assert は例外が出ないこと)
  }],
  ["ケース10: 検知ON・メールOFF → 再集計/表示ロジックは動作し、メール送信経路に入らない(claimしない)", () => {
    // メール送信は is_bulk かつ emailEnabled の両方成立時のみ (cron route の分岐)。
    // 検知のみONではメールフラグが false → 送信もclaimも発生しない。
    withEnv({ SAGAWA_BULK_ALERT_ENABLED: "true", SAGAWA_BULK_EMAIL_ENABLED: undefined }, () => {
      assert.equal(sagawaBulkAlertEnabled(), true)   // 検知は動作
      assert.equal(sagawaBulkEmailEnabled(), false)  // メールは送らない (送信経路ガード)
    })
    // 検知自体は純粋ロジックで動く (フラグに依存しない集計)。
    const g = computeBulkGroups([leg({ shipment_id: "s1", suitcase_count: 20 })], TODAY)
    assert.equal(g.length, 1)
    assert.equal(g[0].is_bulk, true)
  }],
]

;(async () => {
  let failed = 0
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok   ${name}`) }
    catch (e) { failed++; console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : e}`) }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`)
  process.exit(failed ? 1 : 0)
})()
