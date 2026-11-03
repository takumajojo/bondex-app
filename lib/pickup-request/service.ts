// 運営画面の操作 (手動依頼の記録・運営の確認結果の記録) と、Biz-Logi 送信の組み立て。
// API ルートから呼ぶ。送信そのものの手順は ./bizlogi.ts。

import { getSupabase } from "@/lib/supabase"
import { bizLogiConfigFromEnv, BizLogiClient, BizLogiConfigError } from "@/lib/bizlogi/client"
import { sendOpsAlert } from "@/lib/ops-alert"
import { buildLegInput, legInputEnvFromProcess, overridesNote, PICKUP_SHIPMENT_COLUMNS, type NameOverrides, type PickupShipmentRow } from "./leg-input"
import { previewBizLogiPickup, sendBizLogiPickup, claimReasonJa, type PreviewResult, type SendOutcome } from "./bizlogi"
import { RESOLVE_TRANSITIONS, STALE_SENDING_MS, type ResolveAction } from "./state"
import { isPickupTableMissing, type PickupStore } from "./store"
import { pickupSnapshot, type SnapshotSourceRow } from "./snapshot"
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
    // テスト環境の設定ではアプリから送らない (2026-11-03 監査 P1-6)。本番 DB を使うデプロイ (Production・Preview) に
    // テスト環境の値を入れると、テストの問合番号が本番の区間に「依頼済み」として書き込まれ、本当の依頼が止まるため。
    // テスト環境への送信は DB に触れない scripts/bizlogi/test-env.ts からだけ行う。
    if (cfg.environment !== "production") return { available: false, reason: TEST_ENV_IN_APP_REASON }
    return { available: true, environment: cfg.environment, live: cfg.live }
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Biz-Logi 1回の通信の時間制限。住所照会 (最大8秒・2件並列) + 確認機能 + 発行依頼 が
 * API ルートの上限 60 秒に収まるようにする (8 + 20 + 20 = 48 秒・監査 P1-4)。
 */
export const BIZLOGI_CALL_TIMEOUT_MS = 20_000

const TEST_ENV_IN_APP_REASON =
  "BIZLOGI_ENV=test のためアプリからは送信しません (テスト環境の試験は scripts/bizlogi/test-env.ts で行います)"

function clientAndEnv() {
  const cfg = { ...bizLogiConfigFromEnv(), timeoutMs: BIZLOGI_CALL_TIMEOUT_MS }
  if (cfg.environment !== "production") throw new BizLogiConfigError(TEST_ENV_IN_APP_REASON)
  const legEnv = legInputEnvFromProcess()
  if ("missing" in legEnv) throw new BizLogiConfigError(`設定が不足しています: ${legEnv.missing.join(", ")}`)
  return { cfg, legEnv, client: new BizLogiClient(cfg) }
}

export async function previewForShipment(
  row: PickupShipmentRow,
  overrides: NameOverrides = {},
): Promise<PreviewResult & { origin?: unknown; destination?: unknown }> {
  const { legEnv, client } = clientAndEnv()
  const built = await buildLegInput(row, legEnv, overrides)
  if (!built.ok) return { ok: false, errors: built.errors }
  const res = await previewBizLogiPickup(row, built.input, { client })
  return { ...res, origin: built.input.origin, destination: built.input.destination }
}

export async function sendForShipment(
  row: PickupShipmentRow,
  opts: { actor: string; expectedFingerprint: string; overrides?: NameOverrides },
  store: PickupStore,
): Promise<SendOutcome> {
  const { cfg, legEnv, client } = clientAndEnv()
  const built = await buildLegInput(row, legEnv, opts.overrides ?? {})
  if (!built.ok) return { outcome: "blocked", reason: built.errors.join(" / ") }
  return sendBizLogiPickup(row, built.input, { ...opts, note: overridesNote(opts.overrides ?? {}) }, {
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
    snapshot: pickupSnapshot(row),
  })
  if (!r.claimed || !r.requestId) return { ok: false, reason: claimReasonJa(r.reason) }
  return { ok: true, requestId: r.requestId }
}

/**
 * 運営が佐川の問合番号を手入力したとき、その区間に集荷依頼の記録が無ければ「手動依頼済み」として記録する
 * (2026-11-03 監査 P1-1)。番号がある = 佐川側に依頼がある。記録が無いと TODO から外れず、Excel で
 * 重ねて依頼する恐れがあるため。既に記録がある・sql/067 未適用のときは何もしない。失敗しても番号の保存は止めない。
 */
export async function recordManualFromTrackingNumber(
  row: PickupShipmentRow,
  store: PickupStore,
): Promise<{ recorded: boolean; note: string }> {
  try {
    const r = await markManualRequested(row, "運営 (問合番号の手入力)", store, "問合番号の手入力に合わせて手動依頼済みとして記録")
    return r.ok ? { recorded: true, note: "集荷依頼の記録: 手動依頼済みとして記録" } : { recorded: false, note: `集荷依頼の記録: ${r.reason}` }
  } catch (e) {
    if (isPickupTableMissing(e)) return { recorded: false, note: "集荷依頼の記録: 移行前のため記録なし" }
    console.error("[pickup-request] recordManualFromTrackingNumber failed", e instanceof Error ? e.message : e)
    return { recorded: false, note: "集荷依頼の記録に失敗 (TODO で確認してください)" }
  }
}

/** 変更申請に置き換えた旧操作 (依頼記録だけを動かし、区間の取消などと食い違うため使わない)。 */
const OBSOLETE_ACTIONS = new Set<ResolveAction>(["start_change", "change_done", "cancel_done"])

/** 佐川の返信の記録が必要な操作 (メールを送っただけでは完了にしない)。 */
const NOTE_REQUIRED: Partial<Record<ResolveAction, string>> = {
  start_change: "世田谷営業所へ連絡した内容を入力してください",
  change_done: "佐川からの反映確認の返信内容を入力してください",
  cancel_done: "佐川からの取消確認の返信内容を入力してください",
}

/** 運営が佐川へ確認した結果などを記録する。 */
export async function resolvePickupRequest(
  requestId: string,
  action: ResolveAction,
  input: {
    actor: string
    shippingNumber?: string | null
    note?: string | null
    /** 区間の今の内容。change_done では新しい依頼内容として保存する (変更の検知を解除する)。 */
    current?: SnapshotSourceRow | null
  },
  store: PickupStore,
  now: () => Date = () => new Date(),
): Promise<{ ok: true; state: string } | { ok: false; reason: string }> {
  // 世田谷への変更・取消の連絡と佐川の回答は「変更申請」(shipment_change_requests・sql/068) で記録する
  // (2026-11-04 段階C)。依頼記録だけを動かす旧操作は、区間の情報 (取消など) と食い違うため受け付けない。
  if (OBSOLETE_ACTIONS.has(action)) {
    return { ok: false, reason: "変更・取消は『変更申請』から登録してください (世田谷への連絡・佐川の回答・反映を記録し、区間の情報と一緒に更新します)" }
  }
  const t = RESOLVE_TRANSITIONS[action]
  if (!t) return { ok: false, reason: "不明な操作です" }
  const required = NOTE_REQUIRED[action]
  if (required && !(input.note ?? "").trim()) return { ok: false, reason: required }
  if (action === "change_done" && !input.current) return { ok: false, reason: "区間の今の内容を読めませんでした" }
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
    snapshot: action === "change_done" && input.current ? pickupSnapshot(input.current) : null,
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
