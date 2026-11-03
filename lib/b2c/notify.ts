/**
 * B2C の旅行者への通知の送信と、定期の処理（Stage 4）。docs/b2c/B2C_MVP_SCHEMA_v1.md 4章・B2C_PHASE1A_BETA_PLAN.md。
 *
 * 通知は DB の変更と同じトランザクションで b2c_outbox に積む（確定・確認待ち・取消は DB の関数、リマインドはここ）。
 * 送信はこのファイルの processB2cOutbox だけが行う。
 * - 二重に送らない: 積む時は dedupe_key（一意）、送る時は pending → sending の条件付きの更新で 1つの処理だけが取る。
 * - 送る直前に予約の今の状態を確かめる（取消された予約に確定・リマインドを送らない。確認待ちの通知は確認待ちの間だけ）。
 * - 失敗は間隔を広げて再試行（B2C_OUTBOX_MAX_ATTEMPTS 回まで）。最後まで失敗したら failed にして運営に知らせる。
 * - 送信中のまま止まった行（処理の途中で落ちた）は 10分後に再試行に戻す（届いていた場合は同じ通知がもう一度届きうる。
 *   メールは冪等キー対応の送信手段なら二重にならない）。
 * - 外部に送るのは B2C_NOTIFY_LIVE=true の時だけ。それ以外は sandbox（文面を記録するだけで、何も送らない）。
 *   WhatsApp は加えて B2C_WHATSAPP_LIVE=true（Meta のテンプレートの承認の後）。
 */
import { getSupabase } from "@/lib/supabase"
import { sendMail } from "@/lib/mailer"
import { sendOpsAlert } from "@/lib/ops-alert"
import { b2cAccessToken, b2cMyBookingUrl } from "./access-token"
import { renderEmail, renderWhatsApp, type B2cCancelReason, type B2cNotifyData, type B2cNotifyKind, type Lang } from "./notify-templates"

export const B2C_OUTBOX_MAX_ATTEMPTS = 6
const BACKOFF_MIN = [2, 5, 15, 60, 180] // 1回目の失敗の後 2分（時計のずれの許容 1分より長く）、… 3時間
const STALE_SENDING_MS = 10 * 60 * 1000
/** DB とアプリのサーバーの時計のずれの許容（next_attempt_at は DB の時計で入る）。作った直後の通知を取りこぼさない。 */
const CLOCK_SKEW_MS = 60 * 1000

export function b2cNotifyLive(): boolean {
  return process.env.B2C_NOTIFY_LIVE === "true"
}
export function b2cWhatsAppLive(): boolean {
  return process.env.B2C_WHATSAPP_LIVE === "true"
}

export interface SendOutcome {
  ok: boolean
  provider: string
  messageId?: string
  error?: string
  /** 再試行しても直らない（宛先が無い・送信手段が使えない等） */
  permanent?: boolean
}

export interface B2cTransport {
  email(to: string, subject: string, text: string, idempotencyKey: string): Promise<SendOutcome>
  whatsapp(to: string, template: string, languageCode: "ja" | "en_US", params: string[]): Promise<SendOutcome>
}

/** 何も送らず、送ったことにする（文面は outbox の rendered に残る）。ローカル・試験の環境の既定。 */
export const sandboxTransport: B2cTransport = {
  async email() {
    return { ok: true, provider: "sandbox" }
  },
  async whatsapp() {
    return { ok: true, provider: "sandbox" }
  },
}

export const liveTransport: B2cTransport = {
  async email(to, subject, text, idempotencyKey) {
    const r = await sendMail({ to, subject, text, idempotencyKey })
    if (r.sent) return { ok: true, provider: r.via ?? "email" }
    return { ok: false, provider: "email", error: r.error ?? "not_sent", permanent: !r.error }
  },
  async whatsapp(to, template, languageCode, params) {
    if (!b2cWhatsAppLive()) return { ok: false, provider: "whatsapp", error: "whatsapp_not_enabled", permanent: true }
    const token = process.env.WHATSAPP_CLOUD_TOKEN
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
    if (!token || !phoneId) return { ok: false, provider: "whatsapp", error: "whatsapp_not_configured", permanent: true }
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: to.replace(/[^\d]/g, ""),
          type: "template",
          template: {
            name: template,
            language: { code: languageCode },
            components: [{ type: "body", parameters: params.map((t) => ({ type: "text", text: cleanParam(t) })) }],
          },
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { code?: number; message?: string } }
      if (!res.ok) return { ok: false, provider: "whatsapp", error: `http_${res.status}:${body.error?.code ?? ""}`, permanent: res.status === 400 }
      return { ok: true, provider: "whatsapp", messageId: body.messages?.[0]?.id }
    } catch (e) {
      return { ok: false, provider: "whatsapp", error: e instanceof Error ? e.message.slice(0, 200) : "error" }
    }
  },
}

function cleanParam(v: string): string {
  return (v ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 900) || "-"
}

export function b2cTransport(): B2cTransport {
  return b2cNotifyLive() ? liveTransport : sandboxTransport
}

// ---------------------------------------------------------------------------
// 送る直前の確認と文面の材料
// ---------------------------------------------------------------------------
interface OrderForNotify {
  id: string
  order_number: number
  status: string
  language: Lang
  guest_name: string
  guest_email: string
  guest_whatsapp: string
  origin_snapshot: { name: string; name_en?: string | null }
  dest_snapshot: { name: string; name_en?: string | null }
  pickup_date: string
  delivery_date: string
  pieces: number
  total_gross_yen: number
  confirmation_due_at: string | null
  cancel_reason: string | null
}

export function jstYmdOf(d: Date): string {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}
function jstHour(d: Date): number {
  return new Date(d.getTime() + 9 * 3600 * 1000).getUTCHours()
}
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** この通知を今送ってよいか（予約の今の状態で判断）。だめなら理由。 */
export function notifyEligibility(kind: B2cNotifyKind, o: Pick<OrderForNotify, "status" | "pickup_date">, shipmentStatus: string | null, now: Date): string | null {
  switch (kind) {
    case "booking_confirmed":
      return o.status === "confirmed" || o.status === "completed" ? null : `order_${o.status}`
    case "awaiting_hotel":
      return o.status === "awaiting_hotel_confirmation" ? null : `order_${o.status}`
    case "cancelled":
      return o.status === "cancelled" ? null : `order_${o.status}`
    case "reminder_eve":
    case "reminder_day": {
      if (o.status !== "confirmed") return `order_${o.status}`
      if (shipmentStatus && !["requested", "pending", "issued"].includes(shipmentStatus)) return `shipment_${shipmentStatus}`
      const today = jstYmdOf(now)
      const want = kind === "reminder_eve" ? addDays(today, 1) : today
      if (o.pickup_date !== want) return "date_mismatch"
      if (kind === "reminder_day" && jstHour(now) >= 11) return "too_late"
      return null
    }
  }
}

function dataOf(o: OrderForNotify): B2cNotifyData {
  const token = b2cAccessToken(o.id)
  const base = (process.env.B2C_SITE_URL || "https://bondex.express").replace(/\/+$/, "")
  return {
    lang: o.language === "ja" ? "ja" : "en",
    orderNumber: o.order_number,
    guestName: o.guest_name,
    // 英語の旅行者には英語のホテル名（控えに無ければ日本語）
    originName: (o.language === "en" && o.origin_snapshot?.name_en) || o.origin_snapshot?.name || "",
    destName: (o.language === "en" && o.dest_snapshot?.name_en) || o.dest_snapshot?.name || "",
    pickupDate: o.pickup_date,
    deliveryDate: o.delivery_date,
    pieces: o.pieces,
    totalGrossYen: o.total_gross_yen,
    confirmationDueAt: o.confirmation_due_at,
    cancelReason: (o.cancel_reason as B2cCancelReason | null) ?? null,
    myBookingUrl: b2cMyBookingUrl(o.id, o.language === "ja" ? "ja" : "en"),
    frontDeskUrl: `${base}/my/${token}/frontdesk`,
  }
}

// ---------------------------------------------------------------------------
// 送信
// ---------------------------------------------------------------------------
export interface OutboxRunResult {
  claimed: number
  sent: number
  skipped: number
  retried: number
  failed: number
  recovered: number
}

export async function processB2cOutbox(transport: B2cTransport = b2cTransport(), now: Date = new Date(), limit = 50): Promise<OutboxRunResult> {
  const res: OutboxRunResult = { claimed: 0, sent: 0, skipped: 0, retried: 0, failed: 0, recovered: 0 }
  const sb = getSupabase()
  if (!sb) return res

  // 送信中のまま止まった行を再試行に戻す
  const { data: stale } = await sb
    .from("b2c_outbox")
    .update({ status: "pending", locked_at: null, last_error: "stale_sending_recovered" })
    .eq("status", "sending")
    .lt("locked_at", new Date(now.getTime() - STALE_SENDING_MS).toISOString())
    .select("id")
  res.recovered = stale?.length ?? 0

  const { data: due } = await sb
    .from("b2c_outbox")
    .select("id")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date(now.getTime() + CLOCK_SKEW_MS).toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limit)

  for (const { id } of due ?? []) {
    // 1つの処理だけが取る（同時に動いても二重に送らない）
    const { data: claimed } = await sb
      .from("b2c_outbox")
      .update({ status: "sending", locked_at: now.toISOString() })
      .eq("id", id)
      .eq("status", "pending")
      .select("id, order_id, kind, channel, dedupe_key, attempts")
      .maybeSingle()
    if (!claimed) continue
    res.claimed++
    const row = claimed as { id: number; order_id: string; kind: B2cNotifyKind; channel: "email" | "whatsapp"; dedupe_key: string; attempts: number }

    const { data: order } = await sb
      .from("b2c_orders")
      .select("id, order_number, status, language, guest_name, guest_email, guest_whatsapp, origin_snapshot, dest_snapshot, pickup_date, delivery_date, pieces, total_gross_yen, confirmation_due_at, cancel_reason")
      .eq("id", row.order_id)
      .maybeSingle()
    if (!order) {
      await sb.from("b2c_outbox").update({ status: "pending", locked_at: null, last_error: "order_unreadable", next_attempt_at: new Date(now.getTime() + 60_000).toISOString() }).eq("id", row.id)
      res.retried++
      continue
    }
    const o = order as OrderForNotify
    const { data: ship } = await sb.from("shipments").select("status").eq("b2c_order_id", o.id).maybeSingle()
    const notOk = notifyEligibility(row.kind, o, (ship?.status as string) ?? null, now)
    if (notOk) {
      await sb.from("b2c_outbox").update({ status: "cancelled", locked_at: null, last_error: `not_eligible:${notOk}` }).eq("id", row.id)
      res.skipped++
      continue
    }

    const data = dataOf(o)
    let out: SendOutcome
    let rendered: Record<string, unknown>
    if (row.channel === "email") {
      const m = renderEmail(row.kind, data)
      rendered = { to: o.guest_email, subject: m.subject, text: m.text }
      out = await transport.email(o.guest_email, m.subject, m.text, row.dedupe_key).catch((e) => ({ ok: false, provider: "email", error: String(e).slice(0, 200) }))
    } else {
      const w = renderWhatsApp(row.kind, data)
      rendered = { to: o.guest_whatsapp, template: w.template, language: w.languageCode, params: w.params }
      out = await transport.whatsapp(o.guest_whatsapp, w.template, w.languageCode, w.params).catch((e) => ({ ok: false, provider: "whatsapp", error: String(e).slice(0, 200) }))
    }
    const attempts = row.attempts + 1
    if (out.ok) {
      await sb
        .from("b2c_outbox")
        .update({ status: "sent", sent_at: now.toISOString(), attempts, locked_at: null, last_error: null, rendered, provider: out.provider, provider_message_id: out.messageId ?? null, language: data.lang })
        .eq("id", row.id)
        .eq("status", "sending")
      res.sent++
      continue
    }
    if (out.permanent || attempts >= B2C_OUTBOX_MAX_ATTEMPTS) {
      await sb.from("b2c_outbox").update({ status: "failed", attempts, locked_at: null, last_error: out.error ?? "failed", rendered, provider: out.provider }).eq("id", row.id)
      res.failed++
      await sendOpsAlert({
        subject: `【B2C 通知の送信の失敗】受付番号 ${o.order_number}（${row.kind} / ${row.channel}）`,
        lines: [`理由: ${out.error ?? "failed"}`, `試行: ${attempts}回`, "→ 旅行者に別の手段で連絡してください。"],
        agencyEmail: null,
      }).catch(() => undefined)
      continue
    }
    const wait = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000
    await sb
      .from("b2c_outbox")
      .update({ status: "pending", attempts, locked_at: null, last_error: out.error ?? "failed", next_attempt_at: new Date(now.getTime() + wait).toISOString() })
      .eq("id", row.id)
    res.retried++
  }
  return res
}

// ---------------------------------------------------------------------------
// リマインドの積み込み・ホテルの確認の期限切れの取消
// ---------------------------------------------------------------------------
/**
 * 前日のリマインド: 集荷日の前日の 18:00 以降（集荷日の前に確定した直前の予約も、その日のうちに）。
 * 当日のリマインド: 集荷日の 8:00〜11:00。
 * dedupe_key で 1予約 1回ずつ。
 */
export async function enqueueB2cReminders(now: Date = new Date()): Promise<number> {
  const sb = getSupabase()
  if (!sb) return 0
  const today = jstYmdOf(now)
  const hour = jstHour(now)
  const targets: Array<{ kind: "reminder_eve" | "reminder_day"; date: string }> = []
  if (hour >= 18) targets.push({ kind: "reminder_eve", date: addDays(today, 1) })
  if (hour >= 8 && hour < 11) targets.push({ kind: "reminder_day", date: today })
  let n = 0
  for (const t of targets) {
    const { data } = await sb.from("b2c_orders").select("id, language").eq("status", "confirmed").eq("pickup_date", t.date).limit(500)
    const rows = (data ?? []).flatMap((o) =>
      (["email", "whatsapp"] as const).map((ch) => ({ order_id: o.id, kind: t.kind, channel: ch, dedupe_key: `${t.kind}:${o.id}:${ch}`, language: o.language })),
    )
    if (!rows.length) continue
    const { data: ins } = await sb.from("b2c_outbox").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id")
    n += ins?.length ?? 0
  }
  return n
}

/** ホテルの確認の期限を過ぎた確認待ちの予約を取り消す（請求なし・旅行者に通知）。 */
export async function expireB2cConfirmationTimeouts(now: Date = new Date(), limit = 50): Promise<number> {
  const sb = getSupabase()
  if (!sb) return 0
  const { data } = await sb
    .from("b2c_orders")
    .select("id")
    .eq("status", "awaiting_hotel_confirmation")
    .lt("confirmation_due_at", now.toISOString())
    .limit(limit)
  let n = 0
  for (const r of data ?? []) {
    const { data: out } = await sb.rpc("b2c_cancel_order", { p_order_id: r.id, p_reason: "confirmation_timeout", p_actor_type: "system" })
    if (out === "cancelled") n++
  }
  return n
}
