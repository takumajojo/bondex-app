import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * P1-B2 課金保留 (実集荷個数の確認待ち) の配線ヘルパ。**既定 OFF**。
 *
 * SAGAWA_COUNT_HOLD_ENABLED="true" のときだけ、chargeShipmentIfDue が Stripe 送信の直前に
 * 原子的な課金権取得 (claim_charge_right RPC) を挟む。OFF の間は一切呼ばれず、既存の課金挙動は不変。
 *
 * 既存の二重課金防止 (Stripe idempotencyKey `charge_<id>` と recordShipmentCharge の
 * `charged_at IS NULL` 条件付きUPDATE) とは二重管理にならないよう役割を分ける:
 *   - claim_charge_right  … Stripe 送信**前**のゲート。保留判定を "その場" で再集計し、
 *                            課金可能なときだけ in-flight リース (charge_claim_at/owner) を立てる。
 *   - recordShipmentCharge … Stripe 成立**後**に charged_at を立てる (従来どおり・変更しない)。
 * 課金に至らなかったときは clearChargeClaim でリースを解放する (再試行を lease で塞がない。
 * 二重課金自体は Stripe idempotencyKey が防ぐ)。本番で ON にする前に sql/066 の適用が必要。
 */
export function chargeCountHoldEnabled(): boolean {
  return process.env.SAGAWA_COUNT_HOLD_ENABLED === "true"
}

export interface ClaimResult {
  claimed: boolean
  reason: string
}

/** Stripe 送信直前の原子的な課金権取得。保留中 (held:*)・既課金 (already_charged)・他owner は claimed=false。 */
export async function claimChargeRight(
  sb: SupabaseClient,
  shipmentId: string,
  owner: string,
  leaseSeconds = 120,
): Promise<ClaimResult> {
  const { data, error } = await sb.rpc("claim_charge_right", {
    p_shipment_id: shipmentId,
    p_owner: owner,
    p_lease_seconds: leaseSeconds,
  })
  if (error) return { claimed: false, reason: `rpc_error:${error.message}` }
  const row = (Array.isArray(data) ? data[0] : data) as { claimed?: boolean; reason?: string } | undefined
  return { claimed: !!row?.claimed, reason: row?.reason ?? "unknown" }
}

/** 課金に至らなかったときにリースを解放 (charged_at が未設定の行だけ)。再試行を lease で塞がないため。 */
export async function clearChargeClaim(sb: SupabaseClient, shipmentId: string): Promise<void> {
  await sb
    .from("shipments")
    .update({ charge_claim_at: null, charge_claim_owner: null })
    .eq("id", shipmentId)
    .is("charged_at", null)
}

// ── v3.4 Track C 段階導入の適用判定 (代理店単位 Allowlist・集荷単位の混在は scheme C) ──

export type ChargeHoldDisposition = "legacy" | "hold" | "operator_review"

/** 集荷単位の適用判定。RPC エラー時は "legacy" (安全側=従来動作) に倒す。 */
export async function chargeHoldDisposition(
  sb: SupabaseClient,
  shipmentId: string,
): Promise<ChargeHoldDisposition> {
  const { data, error } = await sb.rpc("charge_hold_unit_disposition", { p_shipment_id: shipmentId })
  if (error) return "legacy"
  const row = Array.isArray(data) ? data[0] : data
  const v = typeof row === "string" ? row : (row as { charge_hold_unit_disposition?: string } | null)?.charge_hold_unit_disposition
  return v === "hold" || v === "operator_review" ? v : "legacy"
}

/** 混在集荷単位 (operator_review) の leg を held にして Operator 確認へ回す (自動課金しない)。 */
export async function markChargeOperatorReview(sb: SupabaseClient, shipmentId: string): Promise<void> {
  const { error } = await sb.rpc("mark_charge_operator_review", { p_shipment_id: shipmentId })
  if (error) console.error("[charge-hold] markChargeOperatorReview failed", error.message)
}

/** 代理店 (名前→agencies.id) が段階導入の Allowlist 対象か。RPC エラー時は false (従来動作)。 */
export async function chargeHoldAgencyEnabledByName(sb: SupabaseClient, agencyName: string): Promise<boolean> {
  const { data, error } = await sb.rpc("charge_hold_agency_enabled_by_name", { p_name: agencyName })
  if (error) return false
  const row = Array.isArray(data) ? data[0] : data
  return typeof row === "boolean" ? row : !!(row as { charge_hold_agency_enabled_by_name?: boolean } | null)?.charge_hold_agency_enabled_by_name
}

// ── B2-3 課金試行の記録 (Stripe 結果不明時に新規課金を止める DB 側ガード) ──

export type StripeFailureKind = "definite_failure" | "unknown"

/**
 * Stripe 例外を「明確な失敗 (課金は作られていない=再試行可)」と「結果不明 (作られた可能性がある)」に分ける。
 * 接続断・タイムアウト・Stripe 側 API エラーは **結果不明** に倒し (reconciliation_required)、
 * 照合が済むまで新規課金を作らない。判別不能も安全側で unknown にする。
 */
export function classifyStripeError(err: unknown): StripeFailureKind {
  const type = (err as { type?: string } | null | undefined)?.type
  switch (type) {
    case "StripeCardError": // カード拒否 (与信NG) — 課金は成立していない
    case "StripeInvalidRequestError": // リクエスト不正 (当方のバグ) — 課金は作られない
    case "StripeAuthenticationError": // 認証 (キー誤り) — 課金は作られない
    case "StripeRateLimitError": // 429 — 受理されず課金は作られない
    case "StripeIdempotencyError": // 冪等キー誤用 — 課金は作られない
      return "definite_failure"
    case "StripeConnectionError": // 通信断・タイムアウト — 届いて課金された可能性あり
    case "StripeAPIError": // Stripe 側障害 — 結果不明
      return "unknown"
    default:
      return "unknown" // 判別不能は安全側 (新規課金を止める)
  }
}

/** Stripe 送信の直前に試行を in_flight にする。失敗 (既課金/直前試行が未確定) なら送信してはいけない。 */
export async function beginChargeAttempt(
  sb: SupabaseClient,
  shipmentId: string,
  owner: string,
  idempotencyKey: string,
): Promise<{ ok: boolean; reason: string }> {
  const { data, error } = await sb.rpc("begin_charge_attempt", {
    p_shipment_id: shipmentId,
    p_owner: owner,
    p_idempotency_key: idempotencyKey,
  })
  if (error) return { ok: false, reason: `rpc_error:${error.message}` }
  const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; reason?: string } | undefined
  return { ok: !!row?.ok, reason: row?.reason ?? "unknown" }
}

/**
 * Stripe 送信の直前 (begin の後・create の前) に集荷単位を再評価する (v3.2 §2)。
 * claim 後に別予約が足されて単位が大口化していたら ok=false で、呼び出し側は送信を中止する。
 * DB 側で held へ戻し課金権/試行を解放済み (unit_changed_hold)。短い Tx で、Stripe 通信は含まない。
 */
export async function revalidateChargeClaim(
  sb: SupabaseClient,
  shipmentId: string,
  owner: string,
  leaseSeconds = 120,
): Promise<{ ok: boolean; reason: string }> {
  const { data, error } = await sb.rpc("revalidate_charge_claim", {
    p_shipment_id: shipmentId,
    p_owner: owner,
    p_lease_seconds: leaseSeconds,
  })
  if (error) return { ok: false, reason: `rpc_error:${error.message}` }
  const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; reason?: string } | undefined
  return { ok: !!row?.ok, reason: row?.reason ?? "unknown" }
}

/**
 * Stripe 送信の結果を記録する。
 *  - "succeeded": 状態を succeeded に (charged_at は recordShipmentCharge が別途 CAS で立てる)。
 *  - "failed": 明確な失敗。claim を解放し再試行可。
 *  - "reconciliation_required": 結果不明。claim を保持し、照合まで新規課金を禁止。
 */
export async function settleChargeAttempt(
  sb: SupabaseClient,
  shipmentId: string,
  owner: string,
  outcome: "succeeded" | "failed" | "reconciliation_required",
  piId?: string | null,
  stripeStatus?: string | null,
  errorText?: string | null,
): Promise<void> {
  const { error } = await sb.rpc("settle_charge_attempt", {
    p_shipment_id: shipmentId,
    p_owner: owner,
    p_outcome: outcome,
    p_pi_id: piId ?? null,
    p_stripe_status: stripeStatus ?? null,
    p_error: errorText ? errorText.slice(0, 500) : null,
  })
  if (error) console.error("[charge-hold] settleChargeAttempt failed", error.message)
}

/**
 * 結果不明/送信中の課金試行を、Stripe 照会の結果で解決する (reconcile ジョブ / webhook から呼ぶ)。
 *  - resolved="succeeded": charged_at を CAS で確定 (二重課金防止)。charged=このコールで初確定したか。
 *  - resolved="failed": 未課金が確定。claim 解放 → 再試行可。
 */
export async function reconcileChargeAttempt(
  sb: SupabaseClient,
  shipmentId: string,
  resolved: "succeeded" | "failed",
  piId?: string | null,
  amountYen?: number | null,
): Promise<{ ok: boolean; state: string; charged: boolean }> {
  const { data, error } = await sb.rpc("reconcile_charge_attempt", {
    p_shipment_id: shipmentId,
    p_resolved: resolved,
    p_pi_id: piId ?? null,
    p_amount_yen: amountYen ?? null,
  })
  if (error) return { ok: false, state: `rpc_error:${error.message}`, charged: false }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; state?: string; charged?: boolean }
    | undefined
  return { ok: !!row?.ok, state: row?.state ?? "unknown", charged: !!row?.charged }
}
