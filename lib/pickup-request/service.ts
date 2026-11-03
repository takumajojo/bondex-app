// 運営画面の操作 (手動依頼の記録・運営の確認結果の記録) と、Biz-Logi 送信の組み立て。
// API ルートから呼ぶ。送信そのものの手順は ./bizlogi.ts。

import { getSupabase } from "@/lib/supabase"
import { bizLogiConfigFromEnv, BizLogiClient, BizLogiConfigError } from "@/lib/bizlogi/client"
import { sendOpsAlert } from "@/lib/ops-alert"
import { buildLegInput, legInputEnvFromProcess, PICKUP_SHIPMENT_COLUMNS, type PickupShipmentRow } from "./leg-input"
import { previewBizLogiPickup, sendBizLogiPickup, claimReasonJa, type PreviewResult, type SendOutcome } from "./bizlogi"
import { RESOLVE_TRANSITIONS, STALE_SENDING_MS, type ResolveAction } from "./state"
import type { PickupStore } from "./store"
import { randomUUID } from "node:crypto"

export async function loadPickupShipment(shipmentId: string): Promise<PickupShipmentRow | null> {
  const sb = getSupabase()
  if (!sb) return null
  const { data, error } = await sb.from("shipments").select(PICKUP_SHIPMENT_COLUMNS).eq("id", shipmentId).maybeSingle()
  if (error) throw new Error(`区間を読めません: ${error.message}`)
  return (data as unknown as PickupShipmentRow | null) ?? null
}

/** Biz-Logi から送れる状態か (設定が揃っているか)。理由も返す。秘密の値は返さない。 */
export function bizLogiAvailability(env: Record<string, string | undefined> = process.env):
  | { available: true; environment: "test" | "production"; live: boolean }
  | { available: false; reason: string } {
  try {
    const cfg = bizLogiConfigFromEnv(env)
    if (!cfg.okuriCode) return { available: false, reason: "BIZLOGI_OKURI_CODE が未設定です" }
    const legEnv = legInputEnvFromProcess(env)
    if ("missing" in legEnv) return { available: false, reason: `設定が不足しています: ${legEnv.missing.join(", ")}` }
    return { available: true, environment: cfg.environment, live: cfg.live }
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

function clientAndEnv() {
  const cfg = bizLogiConfigFromEnv()
  const legEnv = legInputEnvFromProcess()
  if ("missing" in legEnv) throw new BizLogiConfigError(`設定が不足しています: ${legEnv.missing.join(", ")}`)
  return { cfg, legEnv, client: new BizLogiClient(cfg) }
}

export async function previewForShipment(row: PickupShipmentRow): Promise<PreviewResult & { origin?: unknown; destination?: unknown }> {
  const { legEnv, client } = clientAndEnv()
  const built = await buildLegInput(row, legEnv)
  if (!built.ok) return { ok: false, errors: built.errors }
  const res = await previewBizLogiPickup(row, built.input, { client })
  return { ...res, origin: built.input.origin, destination: built.input.destination }
}

export async function sendForShipment(
  row: PickupShipmentRow,
  opts: { actor: string; expectedFingerprint: string },
  store: PickupStore,
): Promise<SendOutcome> {
  const { cfg, legEnv, client } = clientAndEnv()
  const built = await buildLegInput(row, legEnv)
  if (!built.ok) return { outcome: "blocked", reason: built.errors.join(" / ") }
  return sendBizLogiPickup(row, built.input, opts, {
    store,
    client,
    environment: cfg.environment,
    alert: (input) => sendOpsAlert(input),
  })
}

/** 手動 (佐川指定 Excel) で世田谷営業所へ依頼したことを記録する。 */
export async function markManualRequested(
  row: PickupShipmentRow,
  actor: string,
  store: PickupStore,
  note?: string | null,
): Promise<{ ok: true; requestId: string } | { ok: false; reason: string }> {
  const r = await store.claim({
    shipmentId: row.id,
    channel: "manual",
    environment: null,
    manageNumber: null,
    pieceCount: row.suitcase_count ?? null,
    pickupDate: row.shipment_date,
    actor,
    owner: randomUUID(),
    note: note ?? null,
  })
  if (!r.claimed || !r.requestId) return { ok: false, reason: claimReasonJa(r.reason) }
  return { ok: true, requestId: r.requestId }
}

/** 運営が佐川へ確認した結果などを記録する。 */
export async function resolvePickupRequest(
  requestId: string,
  action: ResolveAction,
  input: { actor: string; shippingNumber?: string | null; note?: string | null },
  store: PickupStore,
  now: () => Date = () => new Date(),
): Promise<{ ok: true; state: string } | { ok: false; reason: string }> {
  const t = RESOLVE_TRANSITIONS[action]
  if (!t) return { ok: false, reason: "不明な操作です" }
  const current = await store.get(requestId)
  if (!current) return { ok: false, reason: "集荷依頼の記録が見つかりません" }
  if (!t.from.includes(current.state)) {
    return { ok: false, reason: `現在の状態 (${current.state}) ではこの操作はできません` }
  }
  // 送信中の記録は、送信処理が動いている間は触らない (止まったと判断できる時間が経ってから)
  if (current.state === "sending" && now().getTime() - Date.parse(current.updated_at) < STALE_SENDING_MS) {
    return { ok: false, reason: "送信処理中です。数分待ってから確認してください" }
  }
  // Biz-Logi が受け付けた依頼を「依頼なし」にはできない (佐川に依頼が存在する)。取消は世田谷営業所経由で。
  if (action === "confirm_none" && current.state === "accepted" && current.channel !== "manual") {
    return { ok: false, reason: "Biz-Logi で受付済みの依頼は無効にできません。取消は世田谷営業所へ連絡してください" }
  }
  const number = (input.shippingNumber ?? "").replace(/[^\d]/g, "")
  if (action === "confirm_accepted" && current.channel === "bizlogi" && !number && !current.shipping_number) {
    return { ok: false, reason: "佐川に確認した問合番号を入力してください" }
  }
  if (number && !/^\d{10,12}$/.test(number)) return { ok: false, reason: "問合番号は10桁または12桁の数字です" }
  const r = await store.transition({
    requestId,
    from: t.from,
    to: t.to,
    actor: input.actor,
    shippingNumber: number || null,
    note: input.note ? `${input.actor}: ${input.note}` : null,
  })
  if (!r.applied) {
    const why: Record<string, string> = {
      state_mismatch: "状態が変わっています。画面を更新してください",
      live_request_exists: "この区間には既に別の有効な集荷依頼があります",
      shipping_number_required: "問合番号が必要です",
    }
    return { ok: false, reason: why[r.reason] ?? `更新できませんでした (${r.reason})` }
  }
  return { ok: true, state: t.to }
}
