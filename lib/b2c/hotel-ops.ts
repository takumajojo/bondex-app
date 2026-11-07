/**
 * ホテルの確認の結果の入力（運営の手作業・Stage 4）。docs/b2c/B2C_PHASE1A_BETA_PLAN.md 4章。
 *
 * - 施設の確認（未確認のホテル）: verified → そのホテルで確認待ちの予約を確定（b2c_confirm_order）。
 *   unsupported → そのホテルで確認待ちの予約を取り消して旅行者に通知（請求なし）。
 * - 予約ごとの受入（直前予約）: 両方 accepted → 確定。refused / no_answer → 取り消して通知。
 * 確定・取消・通知の積み込みは DB の関数の中の 1つのトランザクション。記録には操作した運営者（個人のパスキー）と理由を残す。
 *
 * 二重の操作の防止（2026-11-07）: 施設は「未確認（unknown）のまま」の時だけ、受入は「未回答（pending）のまま」の時だけ
 * 書き換える（条件つきの 1つの UPDATE。同時に 2回押しても片方は state_changed / already_decided）。取消は予約が
 * 確認待ちのままの時だけ（b2c_cancel_order の p_expect_status）。
 * 保留（hold）: 状態は変えず、確認の途中の記録（例: 折り返し待ち）を予約ごとの操作の記録に残すだけ。期限は延びない。
 */
import { getSupabase } from "@/lib/supabase"
import type { B2cOperator } from "./operator-identity"
import { scheduleBulkRecount } from "./bulk-recount"

export interface HotelOpsResult {
  ok: boolean
  error?: string
  confirmed: number[]
  cancelled: number[]
  stillWaiting: number[]
}

async function confirmOrCancel(orderIds: string[], cancelReason: "hotel_refused" | "hotel_unsupported" | null, op: B2cOperator, note: string): Promise<HotelOpsResult> {
  const sb = getSupabase()!
  const out: HotelOpsResult = { ok: true, confirmed: [], cancelled: [], stillWaiting: [] }
  for (const id of orderIds) {
    const { data: o } = await sb.from("b2c_orders").select("order_number").eq("id", id).maybeSingle()
    const n = (o?.order_number as number) ?? 0
    if (cancelReason) {
      const { data } = await sb.rpc("b2c_cancel_order", {
        p_order_id: id, p_reason: cancelReason, p_actor_type: "operator", p_operator_email: op.operatorEmail, p_credential_id: op.credentialId, p_note: note,
        p_expect_status: "awaiting_hotel_confirmation",
      })
      if (data === "cancelled") out.cancelled.push(n)
      else out.stillWaiting.push(n)
    } else {
      const { data } = await sb.rpc("b2c_confirm_order", { p_order_id: id })
      if (data === true) out.confirmed.push(n)
      else out.stillWaiting.push(n)
    }
  }
  // 確定・取消で区間が増減した時だけ、大口集荷を集計し直す（スイッチ OFF なら何もしない）
  if (out.confirmed.length || out.cancelled.length) scheduleBulkRecount(sb, `hotel-ops confirmed=${out.confirmed.length} cancelled=${out.cancelled.length}`)
  return out
}

const fail = (error: string): HotelOpsResult => ({ ok: false, error, confirmed: [], cancelled: [], stillWaiting: [] })

async function waitingOrderIds(placeId: string): Promise<string[]> {
  const { data: orders } = await getSupabase()!
    .from("b2c_orders")
    .select("id")
    .eq("status", "awaiting_hotel_confirmation")
    .eq("confirmation_mode", "awaiting_hotel_verification")
    .or(`origin_place_id.eq.${placeId},dest_place_id.eq.${placeId}`)
  return (orders ?? []).map((o) => o.id as string)
}

async function logFacilityEvent(ids: string[], op: B2cOperator, placeId: string, event: string, note: string) {
  const sb = getSupabase()!
  for (const id of ids) {
    await sb.from("b2c_order_events").insert({
      order_id: id, event, actor_type: "operator", operator_email: op.operatorEmail, credential_id: op.credentialId, reason: note,
      after_state: { place_id: placeId, facility_status: event.replace(/^facility_/, "") },
    })
  }
}

/**
 * 施設の確認の結果。未確認（unknown）の施設だけを書き換える（既に確認済み・受けないの施設は state_changed）。
 * 確認済みを受けないに変える等の見直しは、この画面の操作の対象にしない（確定済みの予約に影響するため、別の手順）。
 */
export async function setFacilityStatus(op: B2cOperator, placeId: string, status: "verified" | "unsupported", note: string): Promise<HotelOpsResult> {
  const sb = getSupabase()
  if (!sb) return fail("server_error")
  const now = new Date().toISOString()
  const { data: fac, error } = await sb
    .from("b2c_facilities")
    .update({ status, checked_by: op.operatorEmail, checked_at: now, last_verified_at: now, check_note: note, updated_at: now })
    .eq("place_id", placeId)
    .eq("status", "unknown")
    .select("place_id")
  if (error) return fail("server_error")
  if (!fac?.length) {
    const { data: exists } = await sb.from("b2c_facilities").select("status").eq("place_id", placeId).maybeSingle()
    return fail(exists ? "state_changed" : "facility_not_found")
  }
  const ids = await waitingOrderIds(placeId)
  await logFacilityEvent(ids, op, placeId, `facility_${status}`, note)
  return confirmOrCancel(ids, status === "unsupported" ? "hotel_unsupported" : null, op, note)
}

/** 施設の確認の保留（例: ホテルの担当者の折り返し待ち）。状態・期限は変えず、確認待ちの予約の記録に残す。 */
export async function holdFacility(op: B2cOperator, placeId: string, note: string): Promise<HotelOpsResult> {
  const sb = getSupabase()
  if (!sb) return fail("server_error")
  const { data: fac } = await sb.from("b2c_facilities").select("status").eq("place_id", placeId).maybeSingle()
  if (!fac) return fail("facility_not_found")
  if (fac.status !== "unknown") return fail("state_changed")
  const ids = await waitingOrderIds(placeId)
  if (!ids.length) return fail("nothing_waiting")
  await logFacilityEvent(ids, op, placeId, "facility_hold", note)
  return { ok: true, confirmed: [], cancelled: [], stillWaiting: [] }
}

/**
 * 直前予約の受入の結果（集荷元・配送先のそれぞれ）。予約が確認待ちで、その側が未回答の時だけ記録する
 * （一度決めた側を上書きしない: already_decided）。hold は記録だけ（未回答のまま・期限は変わらない）。
 */
export async function setHotelAcceptance(op: B2cOperator, orderNumber: number, side: "origin" | "dest", status: "accepted" | "refused" | "no_answer" | "hold", note: string): Promise<HotelOpsResult> {
  const sb = getSupabase()
  if (!sb) return fail("server_error")
  const { data: o } = await sb.from("b2c_orders").select("id, status, confirmation_mode").eq("order_number", orderNumber).maybeSingle()
  if (!o) return fail("order_not_found")
  if (o.confirmation_mode !== "awaiting_hotel_acceptance") return fail("not_late_booking")
  if (o.status !== "awaiting_hotel_confirmation") return fail("state_changed")
  const { data: cur } = await sb.from("b2c_hotel_acceptances").select("status").eq("order_id", o.id).eq("side", side).maybeSingle()
  if (cur && cur.status !== "pending") return fail("already_decided")
  if (status !== "hold") {
    const row = { status, contact_note: note, decided_by: op.operatorEmail, decided_at: new Date().toISOString() }
    if (cur) {
      const { data: upd, error } = await sb.from("b2c_hotel_acceptances").update(row).eq("order_id", o.id).eq("side", side).eq("status", "pending").select("id")
      if (error) return fail("server_error")
      if (!upd?.length) return fail("already_decided")
    } else {
      // 同時の 2回目は unique(order_id, side) で失敗する → already_decided
      const { error } = await sb.from("b2c_hotel_acceptances").insert({ order_id: o.id, side, ...row })
      if (error) return fail(error.code === "23505" ? "already_decided" : "server_error")
    }
  }
  await sb.from("b2c_order_events").insert({
    order_id: o.id, event: `hotel_${side}_${status}`, actor_type: "operator", operator_email: op.operatorEmail, credential_id: op.credentialId, reason: note,
    after_state: { side, acceptance: status },
  })
  if (status === "hold") return { ok: true, confirmed: [], cancelled: [], stillWaiting: [orderNumber] }
  return confirmOrCancel([o.id as string], status === "accepted" ? null : "hotel_refused", op, note)
}

// ---------------------------------------------------------------------------
// 確認待ちの一覧（運営の画面）。旅行者の名前・連絡先は返さない（受付番号・集荷日・個数・ホテルだけ）。
// ---------------------------------------------------------------------------
export interface HotelQueueOrder { orderNumber: number; side: "origin" | "dest" | "both"; pickupDate: string; pieces: number; dueAt: string | null }
export interface HotelQueueEvent { event: string; operatorEmail: string | null; reason: string | null; at: string; orderNumber: number }
export interface HotelQueueFacility {
  placeId: string; name: string; address: string | null; postalCode: string | null; status: string
  dueAt: string | null; orders: HotelQueueOrder[]; events: HotelQueueEvent[]
}
export interface HotelQueueAcceptanceSide { placeId: string; name: string; address: string | null; status: string; decidedBy: string | null; decidedAt: string | null; note: string | null }
export interface HotelQueueAcceptance { orderNumber: number; pickupDate: string; pieces: number; dueAt: string | null; origin: HotelQueueAcceptanceSide; dest: HotelQueueAcceptanceSide; events: HotelQueueEvent[] }

export async function loadB2cHotelQueue(): Promise<{ facilities: HotelQueueFacility[]; acceptances: HotelQueueAcceptance[] } | null> {
  const sb = getSupabase()
  if (!sb) return null
  const { data: orders, error } = await sb
    .from("b2c_orders")
    .select("id, order_number, pickup_date, pieces, confirmation_mode, confirmation_due_at, origin_place_id, dest_place_id")
    .eq("status", "awaiting_hotel_confirmation")
    .order("confirmation_due_at")
    .limit(200)
  if (error) return null
  const list = orders ?? []
  const placeIds = [...new Set(list.flatMap((o) => [o.origin_place_id as string, o.dest_place_id as string]))]
  const ids = list.map((o) => o.id as string)
  const [facs, accs, evs] = await Promise.all([
    placeIds.length ? sb.from("b2c_facilities").select("place_id, name, address, postal_code, status").in("place_id", placeIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ids.length ? sb.from("b2c_hotel_acceptances").select("order_id, side, status, decided_by, decided_at, contact_note").in("order_id", ids) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ids.length
      ? sb.from("b2c_order_events").select("order_id, event, operator_email, reason, created_at").in("order_id", ids).or("event.like.facility_%,event.like.hotel_%").order("id", { ascending: false }).limit(500)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ])
  const fac = new Map((facs.data ?? []).map((f) => [f.place_id as string, f]))
  const numOf = new Map(list.map((o) => [o.id as string, o.order_number as number]))
  const evOf = (orderIds: string[]) =>
    (evs.data ?? [])
      .filter((e) => orderIds.includes(e.order_id as string))
      .map((e) => ({ event: e.event as string, operatorEmail: (e.operator_email as string | null) ?? null, reason: (e.reason as string | null) ?? null, at: e.created_at as string, orderNumber: numOf.get(e.order_id as string) ?? 0 }))

  const byPlace = new Map<string, { orders: HotelQueueOrder[]; orderIds: string[] }>()
  for (const o of list.filter((x) => x.confirmation_mode === "awaiting_hotel_verification")) {
    for (const side of ["origin", "dest"] as const) {
      const pid = o[`${side}_place_id`] as string
      if ((fac.get(pid)?.status as string | undefined) !== "unknown") continue
      const g = byPlace.get(pid) ?? { orders: [], orderIds: [] }
      const prev = g.orders.find((x) => x.orderNumber === o.order_number)
      if (prev) prev.side = "both"
      else {
        g.orders.push({ orderNumber: o.order_number as number, side, pickupDate: o.pickup_date as string, pieces: o.pieces as number, dueAt: (o.confirmation_due_at as string | null) ?? null })
        g.orderIds.push(o.id as string)
      }
      byPlace.set(pid, g)
    }
  }
  const facilities: HotelQueueFacility[] = [...byPlace.entries()].map(([pid, g]) => {
    const f = fac.get(pid) ?? {}
    const dues = g.orders.map((x) => x.dueAt).filter((x): x is string => !!x).sort()
    return {
      placeId: pid, name: (f.name as string) ?? pid, address: (f.address as string | null) ?? null, postalCode: (f.postal_code as string | null) ?? null,
      status: (f.status as string) ?? "unknown", dueAt: dues[0] ?? null, orders: g.orders,
      events: evOf(g.orderIds).filter((e) => e.event.startsWith("facility_")).slice(0, 20),
    }
  }).sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"))

  const side = (o: Record<string, unknown>, s: "origin" | "dest"): HotelQueueAcceptanceSide => {
    const pid = o[`${s}_place_id`] as string
    const f = fac.get(pid) ?? {}
    const a = (accs.data ?? []).find((x) => x.order_id === o.id && x.side === s)
    return {
      placeId: pid, name: (f.name as string) ?? pid, address: (f.address as string | null) ?? null,
      status: (a?.status as string) ?? "pending", decidedBy: (a?.decided_by as string | null) ?? null, decidedAt: (a?.decided_at as string | null) ?? null, note: (a?.contact_note as string | null) ?? null,
    }
  }
  const acceptances: HotelQueueAcceptance[] = list
    .filter((o) => o.confirmation_mode === "awaiting_hotel_acceptance")
    .map((o) => ({
      orderNumber: o.order_number as number, pickupDate: o.pickup_date as string, pieces: o.pieces as number, dueAt: (o.confirmation_due_at as string | null) ?? null,
      origin: side(o, "origin"), dest: side(o, "dest"), events: evOf([o.id as string]).filter((e) => e.event.startsWith("hotel_")).slice(0, 20),
    }))
  return { facilities, acceptances }
}
