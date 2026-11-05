/**
 * P1-B 大口集荷 — Supabase 配線 (薄いアプライヤ)。集計・照合・冪等判定の判断は
 * lib/sagawa-bulk/{core,reconcile,notify}.ts (純粋) が持つ。ここは I/O のみ。
 * すべて sagawa_bulk_pickups / _members / _events に閉じる (既存 shipments を書き換えない)。
 * feature flag のチェックは呼び出し側 (cron / API / 早期フック) が行う。
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  computeBulkGroups,
  snapshotOf,
  classifyChange,
  urgencyOf,
  type BulkLeg,
  type BulkGroupComputed,
  type BulkSnapshot,
  type BulkUrgency,
  type NotifyKind,
} from "./core"
import { planReconcile, type ExistingGroup, type GroupPlan } from "./reconcile"
import { canClaimNotify, notifyKeyHash, NOTIFY_LEASE_MS, type NotifyRow } from "./notify"
import { sagawaBulkAlertEnabled, sagawaBulkEmailEnabled } from "./flag"
import { opsRecipients } from "@/lib/ops-recipients"

const ACTIVE_EXCLUDE = ["cancelled", "picked_up", "in_transit", "delivered"]

const LEG_COLS =
  "id, booking_id, leg_index, agency, status, booking_type, suitcase_count, shipment_date, pickup_time, " +
  "from_place_id, from_hotel, from_hotel_ja, from_prefecture, from_city, from_residence, carrier"

function rowToLeg(r: Record<string, unknown>): BulkLeg {
  return {
    shipment_id: String(r.id),
    booking_id: String(r.booking_id ?? ""),
    leg_index: Number(r.leg_index ?? 0),
    agency: (r.agency as string) ?? null,
    status: String(r.status ?? ""),
    booking_type: (r.booking_type as string) ?? null,
    suitcase_count: Number(r.suitcase_count ?? 0),
    shipment_date: (r.shipment_date as string) ?? null,
    pickup_time: (r.pickup_time as string) ?? null,
    from_place_id: (r.from_place_id as string) ?? null,
    from_hotel: (r.from_hotel as string) ?? null,
    from_hotel_ja: (r.from_hotel_ja as string) ?? null,
    from_prefecture: (r.from_prefecture as string) ?? null,
    from_city: (r.from_city as string) ?? null,
    from_residence: r.from_residence ?? null,
    carrier: (r.carrier as string) ?? null,
    is_charter: false, // チャーターは本番 shipments に未存在 (将来 charter_quotes 連携)。
  }
}

/** 集荷予定が残っている leg を取得 (status 除外 + 集荷日が今日以降)。 */
export async function loadActiveLegs(sb: SupabaseClient, todayYmd: string): Promise<BulkLeg[]> {
  const { data, error } = await sb
    .from("shipments")
    .select(LEG_COLS)
    .not("status", "in", `(${ACTIVE_EXCLUDE.join(",")})`)
    .gte("shipment_date", todayYmd)
  if (error) throw new Error(`loadActiveLegs: ${error.message}`)
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(rowToLeg)
}

/** 既存の集荷単位 (+現在メンバー) を取得して照合用に整形。 */
export async function loadExistingGroups(sb: SupabaseClient): Promise<ExistingGroup[]> {
  const { data: groups, error } = await sb
    .from("sagawa_bulk_pickups")
    .select("id, hotel_key, pickup_date, status, member_hash, total_pieces, notified_snapshot")
  if (error) throw new Error(`loadExistingGroups: ${error.message}`)
  const groupRows = (groups ?? []) as unknown as Record<string, unknown>[]
  const ids = groupRows.map((g) => String(g.id))
  const membersByGroup = new Map<string, string[]>()
  if (ids.length) {
    const { data: members, error: mErr } = await sb
      .from("sagawa_bulk_pickup_members")
      .select("group_id, shipment_id")
      .in("group_id", ids)
      .is("removed_at", null)
    if (mErr) throw new Error(`loadExistingGroups(members): ${mErr.message}`)
    for (const m of (members ?? []) as unknown as Record<string, unknown>[]) {
      const gid = String(m.group_id)
      const arr = membersByGroup.get(gid) ?? []
      arr.push(String(m.shipment_id))
      membersByGroup.set(gid, arr)
    }
  }
  return groupRows.map((g) => {
    const row = g
    return {
      id: String(row.id),
      hotel_key: String(row.hotel_key),
      pickup_date: String(row.pickup_date),
      status: String(row.status),
      member_hash: String(row.member_hash ?? ""),
      total_pieces: Number(row.total_pieces ?? 0),
      notified_snapshot: (row.notified_snapshot as BulkSnapshot | null) ?? null,
      member_shipment_ids: membersByGroup.get(String(row.id)) ?? [],
    }
  })
}

async function addEvent(sb: SupabaseClient, groupId: string, kind: string, detail: Record<string, unknown>): Promise<void> {
  await sb.from("sagawa_bulk_pickup_events").insert({ group_id: groupId, kind, detail })
}

async function applyGroupPlan(sb: SupabaseClient, p: GroupPlan): Promise<void> {
  // データ列 (集計結果・recompute が正本)。workflow 列の status とは分けて扱う。
  const data = {
    hotel_key: p.hotel_key, key_source: p.key_source, confident: p.confident,
    pickup_date: p.pickup_date, hotel_label: p.hotel_label,
    from_prefecture: p.from_prefecture, from_city: p.from_city,
    total_pieces: p.total_pieces, leg_count: p.leg_count, agency_count: p.agency_count,
    booking_count: p.booking_count, is_bulk: p.is_bulk, is_duplicate: p.is_duplicate,
    member_hash: p.member_hash,
  }
  let groupId: string
  if (p.isNew) {
    // 同時作成 (cron × 予約直後フックの並行再集計) でも unique(hotel_key,pickup_date) で衝突 → 例外にならず
    // 収束するよう upsert。衝突 (=他プロセスが先に作成) 時は既存行を更新する。新規作成時の status は pending。
    const { data: row, error } = await sb
      .from("sagawa_bulk_pickups")
      .upsert({ ...data, status: p.nextStatus }, { onConflict: "hotel_key,pickup_date" })
      .select("id")
      .single()
    if (error) throw new Error(`upsert group: ${error.message}`)
    groupId = String((row as { id: string }).id)
  } else {
    groupId = p.existingId as string
    // データ列は recompute が正本なので無条件更新。status は書かない。
    const { error } = await sb.from("sagawa_bulk_pickups").update(data).eq("id", groupId)
    if (error) throw new Error(`update group: ${error.message}`)
    // status 遷移は「意図した変化」(notified/needs_reconfirm→needs_reconfirm, cleared/stale→pending 等) の時のみ、
    // 読込時 status からの compare-and-set で書く。これにより、変化なしの再集計が Operator の
    // 「連絡済み (notified)」を pending へ巻き戻す lost update を防ぐ (D5・再集計×Operator 競合対策)。
    if (p.nextStatus !== p.prevStatus) {
      const { error: sErr } = await sb.from("sagawa_bulk_pickups")
        .update({ status: p.nextStatus }).eq("id", groupId).eq("status", p.prevStatus)
      if (sErr) throw new Error(`update group status: ${sErr.message}`)
    }
  }
  // メンバー追加 (upsert: 既存 removed を復活させる場合も added_at を今に)。
  const toAdd = p.members.filter((m) => p.addMemberIds.includes(m.shipment_id))
  for (const m of toAdd) {
    await sb.from("sagawa_bulk_pickup_members").upsert(
      {
        group_id: groupId, shipment_id: m.shipment_id, booking_id: m.booking_id,
        leg_index: m.leg_index, agency: m.agency, pieces: m.pieces, pickup_time: m.pickup_time,
        added_at: new Date().toISOString(), removed_at: null,
      },
      { onConflict: "group_id,shipment_id" },
    )
  }
  // メンバー除去 (removed_at をスタンプ・履歴保持)。
  if (p.removeMemberIds.length) {
    await sb.from("sagawa_bulk_pickup_members")
      .update({ removed_at: new Date().toISOString() })
      .eq("group_id", groupId)
      .in("shipment_id", p.removeMemberIds)
      .is("removed_at", null)
  }
  for (const ev of p.events) await addEvent(sb, groupId, ev.kind, ev.detail)
}

export interface RecomputeResult { groups: number; cleared: number; newGroups: number; reconfirm: number }

/**
 * 集荷単位を現在の shipments から丸ごと再計算し、DB を整合させる (正本の検知経路)。
 * 冪等: 何度実行しても現在状態に収束する。feature flag は呼び出し側で確認済み前提。
 */
export async function recomputeBulkPickups(sb: SupabaseClient, todayYmd: string): Promise<RecomputeResult> {
  const legs = await loadActiveLegs(sb, todayYmd)
  const computed: BulkGroupComputed[] = computeBulkGroups(legs, todayYmd)
  const existing = await loadExistingGroups(sb)
  const plan = planReconcile(computed, existing)
  for (const g of plan.groups) await applyGroupPlan(sb, g)
  for (const c of plan.clears) {
    const { error } = await sb.from("sagawa_bulk_pickups").update({ status: "cleared" }).eq("id", c.id)
    if (!error) await addEvent(sb, c.id, c.event.kind, c.event.detail)
  }
  return {
    groups: plan.groups.length,
    cleared: plan.clears.length,
    newGroups: plan.groups.filter((g) => g.isNew).length,
    reconfirm: plan.groups.filter((g) => g.nextStatus === "needs_reconfirm").length,
  }
}

/** ベストエフォートの単一集荷単位 再集計 (予約/発行成功直後の早期検知用・絶対に throw しない)。 */
export async function recomputeSafe(sb: SupabaseClient, todayYmd: string): Promise<void> {
  try {
    await recomputeBulkPickups(sb, todayYmd)
  } catch (e) {
    console.error("[sagawa-bulk] recomputeSafe failed (ignored):", e instanceof Error ? e.message : e)
  }
}

export interface BulkDryRunGroup {
  hotel_key: string
  pickup_date: string
  hotel_label: string
  confident: boolean
  total_pieces: number
  booking_count: number
  leg_count: number
  agency_count: number
  is_bulk: boolean
  is_duplicate: boolean
  urgency: BulkUrgency
  /** もしメール送信が ON なら送られる種別と理由 (null = 送信対象外 = 重複のみ等)。 */
  would_notify: { kind: NotifyKind; reason: "initial" | "change" } | null
}

export interface BulkDryRun {
  today: string
  alert_enabled: boolean        // SAGAWA_BULK_ALERT_ENABLED
  email_enabled: boolean        // SAGAWA_BULK_ALERT_ENABLED && SAGAWA_BULK_EMAIL_ENABLED
  recipients_count: number      // opsRecipients().length (実アドレスは返さない)
  recipients_present: boolean   // 宛先が1件以上設定されているか
  groups_total: number
  bulk_count: number            // 大口 (20個以上)
  duplicate_count: number       // 同一ホテル同日の重複 (予約2件以上)
  both_count: number            // 大口かつ重複
  initial_notify_candidates: number   // 初回通知候補 (大口・未連絡)
  rechange_notify_candidates: number  // 再通知候補 (連絡済み後に material 変更)
  groups: BulkDryRunGroup[]
}

/**
 * ドライラン: 現在の shipments から大口/重複を再計算し「もし送るなら」の候補を返す。
 * 一切 DB に書き込まない (再集計・status・メンバー・送信済みフラグ notify_* / 通知 claim を変更しない)。メールも送らない。
 * 送信先は件数と有無のみ返し、実アドレスは返さない。flag チェックは呼び出し側で行う前提 (関数自体は read 専用)。
 */
export async function dryRunBulkAlert(sb: SupabaseClient, todayYmd: string): Promise<BulkDryRun> {
  const legs = await loadActiveLegs(sb, todayYmd)
  const computed = computeBulkGroups(legs, todayYmd)
  const existing = await loadExistingGroups(sb)
  const byKey = new Map(existing.map((e) => [`${e.hotel_key}@${e.pickup_date}`, e]))

  let bulk = 0, dup = 0, both = 0, initial = 0, rechange = 0
  const groups: BulkDryRunGroup[] = computed.map((g) => {
    const ex = byKey.get(`${g.hotel_key}@${g.pickup_date}`)
    const urgency = urgencyOf(g.pickup_date, todayYmd)
    let would: { kind: NotifyKind; reason: "initial" | "change" } | null = null
    if (g.is_bulk) {
      bulk++
      const alreadyNotified = Boolean(ex && ex.status === "notified" && ex.notified_snapshot)
      if (!alreadyNotified) {
        const kind: NotifyKind =
          urgency === "today" || urgency === "overdue" ? "day" : urgency === "tomorrow" ? "eve" : "initial"
        would = { kind, reason: "initial" }
        initial++
      } else {
        const ch = classifyChange(ex!.notified_snapshot as BulkSnapshot, g)
        if (ch.material) { would = { kind: "change", reason: "change" }; rechange++ }
      }
    }
    if (g.is_duplicate) dup++
    if (g.is_bulk && g.is_duplicate) both++
    return {
      hotel_key: g.hotel_key, pickup_date: g.pickup_date, hotel_label: g.hotel_label, confident: g.confident,
      total_pieces: g.total_pieces, booking_count: g.booking_count, leg_count: g.leg_count, agency_count: g.agency_count,
      is_bulk: g.is_bulk, is_duplicate: g.is_duplicate, urgency, would_notify: would,
    }
  })

  const recips = opsRecipients()
  return {
    today: todayYmd,
    alert_enabled: sagawaBulkAlertEnabled(),
    email_enabled: sagawaBulkEmailEnabled(),
    recipients_count: recips.length,
    recipients_present: recips.length > 0,
    groups_total: computed.length,
    bulk_count: bulk, duplicate_count: dup, both_count: both,
    initial_notify_candidates: initial, rechange_notify_candidates: rechange,
    groups,
  }
}

/** Operator / cron 表示用: 集荷日が from 以降の集荷単位 (cleared 以外)。 */
export async function listBulkPickups(sb: SupabaseClient, fromYmd: string) {
  const { data, error } = await sb
    .from("sagawa_bulk_pickups")
    .select("*")
    .neq("status", "cleared")
    .gte("pickup_date", fromYmd)
    .order("pickup_date", { ascending: true })
  if (error) throw new Error(`listBulkPickups: ${error.message}`)
  return data ?? []
}

/**
 * メール送信を claim する (条件付き UPDATE = アトミック。canClaimNotify をミラー)。
 * 返り値 true = 自分が送信権を得た (notify_state=pending・owner 記録)。false = 既送信/他者送信中。
 */
export async function claimBulkNotify(
  sb: SupabaseClient, groupId: string, notifyKeyStr: string, owner: string, nowMs: number,
): Promise<boolean> {
  const keyHash = notifyKeyHash(notifyKeyStr)
  const leaseExpiry = new Date(nowMs - NOTIFY_LEASE_MS).toISOString()
  const nowIso = new Date(nowMs).toISOString()
  const { data, error } = await sb
    .from("sagawa_bulk_pickups")
    .update({
      notify_state: "pending", notify_key: keyHash, notify_attempt_owner: owner,
      notify_claimed_at: nowIso, notify_error: null,
    })
    .eq("id", groupId)
    // 同一キーで sent / 生きた pending は除外。別キー(新バージョン)・idle・failed・期限切れ pending のみ claim。
    .or(`notify_key.neq.${keyHash},notify_state.eq.idle,notify_state.eq.failed,and(notify_state.eq.pending,notify_claimed_at.lt.${leaseExpiry})`)
    .select("id")
  if (error) throw new Error(`claimBulkNotify: ${error.message}`)
  return (data ?? []).length === 1
}

/** 送信結果を記録 (owner guard: pending かつ自分が owner の時のみ)。成功→sent / 失敗→failed。 */
export async function recordBulkNotifyResult(
  sb: SupabaseClient, groupId: string, owner: string, ok: boolean, error?: string,
): Promise<void> {
  const patch = ok
    ? { notify_state: "sent", last_alerted_at: new Date().toISOString(), notify_error: null }
    : { notify_state: "failed", notify_error: (error ?? "send failed").slice(0, 300) }
  await sb.from("sagawa_bulk_pickups").update(patch)
    .eq("id", groupId).eq("notify_attempt_owner", owner).eq("notify_state", "pending")
}

/**
 * Operator「佐川へ連絡済み」: status=notified・連絡時スナップショットを保存 (状態②)。pickup_requested_at は触らない。
 * extra で連絡方法・佐川の回答を記録 (§4: 何を伝え何を確認したかを後から追跡できるようにする)。
 */
export async function markBulkNotified(
  sb: SupabaseClient, groupId: string, by: string,
  extra?: { method?: string | null; reply?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const { data: row, error: selErr } = await sb.from("sagawa_bulk_pickups").select("*").eq("id", groupId).maybeSingle()
  if (selErr) return { ok: false, error: selErr.message }
  if (!row) return { ok: false, error: "not found" }
  // 現在のメンバーからスナップショットを再構成 (佐川へ伝える内容)。
  const { data: members } = await sb.from("sagawa_bulk_pickup_members")
    .select("shipment_id, pieces, pickup_time").eq("group_id", groupId).is("removed_at", null)
  const g = row as Record<string, unknown>
  const snap: BulkSnapshot = snapshotOf({
    hotel_key: String(g.hotel_key), key_source: g.key_source as "place_id" | "name", confident: Boolean(g.confident),
    pickup_date: String(g.pickup_date), hotel_label: String(g.hotel_label ?? ""),
    from_prefecture: (g.from_prefecture as string) ?? null, from_city: (g.from_city as string) ?? null,
    total_pieces: Number(g.total_pieces ?? 0), leg_count: Number(g.leg_count ?? 0), agency_count: Number(g.agency_count ?? 0),
    booking_count: Number(g.booking_count ?? 0), is_bulk: Boolean(g.is_bulk), is_duplicate: Boolean(g.is_duplicate),
    member_hash: String(g.member_hash ?? ""),
    members: (members ?? []).map((m) => {
      const mm = m as Record<string, unknown>
      return { shipment_id: String(mm.shipment_id), booking_id: "", leg_index: 0, agency: null, pieces: Number(mm.pieces ?? 0), pickup_time: (mm.pickup_time as string) ?? null }
    }),
  })
  const method = extra?.method?.slice(0, 100) ?? null
  const reply = extra?.reply?.slice(0, 1000) ?? null
  const { error: upErr } = await sb.from("sagawa_bulk_pickups").update({
    status: "notified", notified_at: new Date().toISOString(), notified_by: by, notified_snapshot: snap,
    notified_method: method, sagawa_reply: reply, needs_recontact: false,
  }).eq("id", groupId)
  if (upErr) return { ok: false, error: upErr.message }
  await addEvent(sb, groupId, "notified", { by, total_pieces: snap.total_pieces, method, reply })
  return { ok: true }
}

/** 「連絡済み」取り消し (誤操作時)。status を pending に戻す。 */
export async function undoBulkNotified(sb: SupabaseClient, groupId: string, by: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb.from("sagawa_bulk_pickups").update({
    status: "pending", notified_at: null, notified_by: null, notified_snapshot: null,
    notified_method: null, sagawa_reply: null, needs_recontact: false,
  }).eq("id", groupId)
  if (error) return { ok: false, error: error.message }
  await addEvent(sb, groupId, "operator_note", { by, note: "連絡済みを取り消し" })
  return { ok: true }
}

// 冪等判定の純粋関数を再公開 (呼び出し側の便宜)。
export { canClaimNotify, type NotifyRow }
