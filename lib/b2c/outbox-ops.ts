/**
 * 運営による通知の照合（Stage 4）。届いたか分からない（unknown）・送れなかった（failed）・期限切れ（expired）の通知を、
 * 運営が送信サービスの記録（Resend のログ・WhatsApp の管理画面）と照らして片付ける。
 * 方針は docs/b2c/B2C_NOTIFICATION_TEMPLATES.md 4章。自動では再送しないもの（冪等でない手段の unknown）は、ここで人が決める。
 *
 * - delivered: 届いていた（unknown → sent）。
 * - resend: 届いていなかった・送り直す（unknown / failed → pending）。期限を過ぎた通知は送り直せない。
 *   試行の回数は 0 に戻し、文面は前と同じものを送る（メールは同じ冪等キー）。
 * - dismiss: 送らないことにした（unknown / failed / expired → cancelled）。別の手段で連絡した時など。
 * どれも理由（note）を必須にし、予約の記録（b2c_order_events）に運営者と理由を残す。
 */
import { getSupabase } from "@/lib/supabase"
import type { B2cOperator } from "./operator-identity"

export type OutboxResolution = "delivered" | "resend" | "dismiss"

export interface OutboxProblem {
  id: number
  orderNumber: number | null
  kind: string
  channel: string
  status: string
  attempts: number
  lastError: string | null
  provider: string | null
  sendStartedAt: string | null
  expiresAt: string | null
  createdAt: string
}

export async function listOutboxProblems(now: Date = new Date()): Promise<OutboxProblem[] | null> {
  const sb = getSupabase()
  if (!sb) return null
  const since = new Date(now.getTime() - 14 * 86400_000).toISOString()
  const { data, error } = await sb
    .from("b2c_outbox")
    .select("id, order_id, kind, channel, status, attempts, last_error, provider, send_started_at, expires_at, created_at")
    .in("status", ["unknown", "failed", "expired"])
    .gte("created_at", since)
    .order("id", { ascending: false })
    .limit(200)
  if (error) return null
  const ids = [...new Set((data ?? []).map((r) => r.order_id as string))]
  const { data: ords } = ids.length ? await sb.from("b2c_orders").select("id, order_number").in("id", ids) : { data: [] }
  const num = new Map((ords ?? []).map((o) => [o.id as string, o.order_number as number]))
  return (data ?? []).map((r) => ({
    id: r.id as number,
    orderNumber: num.get(r.order_id as string) ?? null,
    kind: r.kind as string,
    channel: r.channel as string,
    status: r.status as string,
    attempts: r.attempts as number,
    lastError: (r.last_error as string | null) ?? null,
    provider: (r.provider as string | null) ?? null,
    sendStartedAt: (r.send_started_at as string | null) ?? null,
    expiresAt: (r.expires_at as string | null) ?? null,
    createdAt: r.created_at as string,
  }))
}

export type ResolveResult =
  | { ok: true; status: string }
  | { ok: false; error: "not_found" | "invalid_state" | "expired" | "server_error" }

const FROM: Record<OutboxResolution, string[]> = {
  delivered: ["unknown"],
  resend: ["unknown", "failed"],
  dismiss: ["unknown", "failed", "expired"],
}

export async function resolveOutboxRow(op: B2cOperator, id: number, resolution: OutboxResolution, note: string, now: Date = new Date()): Promise<ResolveResult> {
  const sb = getSupabase()
  if (!sb) return { ok: false, error: "server_error" }
  const { data: row, error } = await sb.from("b2c_outbox").select("id, order_id, kind, channel, status, expires_at, send_started_at").eq("id", id).maybeSingle()
  if (error) return { ok: false, error: "server_error" }
  if (!row) return { ok: false, error: "not_found" }
  if (!FROM[resolution].includes(row.status as string)) return { ok: false, error: "invalid_state" }
  if (resolution === "resend" && row.expires_at && new Date(row.expires_at as string) <= now) return { ok: false, error: "expired" }

  const nowIso = now.toISOString()
  const patch: Record<string, unknown> =
    resolution === "delivered"
      ? { status: "sent", sent_at: (row.send_started_at as string | null) ?? nowIso, locked_at: null }
      : resolution === "resend"
        ? { status: "pending", attempts: 0, next_attempt_at: nowIso, locked_at: null, send_started_at: null, ops_alerted_at: null, last_error: `ops_resend (prev: ${row.status})` }
        : { status: "cancelled", locked_at: null, last_error: `ops_dismissed (prev: ${row.status})` }
  const { data: upd, error: uErr } = await sb
    .from("b2c_outbox")
    .update({ ...patch, resolved_by: op.operatorEmail, resolved_note: note })
    .eq("id", id)
    .eq("status", row.status as string) // 照合の間に状態が変わっていたら何もしない
    .select("status")
    .maybeSingle()
  if (uErr) return { ok: false, error: "server_error" }
  if (!upd) return { ok: false, error: "invalid_state" }
  await sb.from("b2c_order_events").insert({
    order_id: row.order_id, event: `notification_${resolution}`, actor_type: "operator", operator_email: op.operatorEmail, credential_id: op.credentialId, reason: note,
    before_state: { outbox_id: id, kind: row.kind, channel: row.channel, status: row.status },
    after_state: { status: upd.status },
  })
  return { ok: true, status: upd.status as string }
}
