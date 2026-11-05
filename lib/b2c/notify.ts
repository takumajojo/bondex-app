/**
 * B2C の旅行者への通知の送信と、定期の処理（Stage 4）。docs/b2c/B2C_MVP_SCHEMA_v1.md 4章・B2C_PHASE1A_BETA_PLAN.md。
 * 滞留・再試行・重複・期限切れの方針は docs/b2c/B2C_NOTIFICATION_TEMPLATES.md 4章（sql/073_b2c_outbox_hardening.sql）。
 *
 * 通知は DB の変更と同じトランザクションで b2c_outbox に積む（確定・確認待ち・取消は DB の関数、リマインドはここ）。
 * 送信はこのファイルの processB2cOutbox だけが行う。
 * - 取る順: 重要度（当日のリマインド → 前日のリマインド → 取消・確定 → 確認待ち）→ 期限の近い順 → 予定の時刻の順。
 *   古い通常の通知が溜まっても、リマインドが後ろに並ばない。1回の処理は時間の上限まで小分けに取り続ける。
 * - 1つの処理だけが取る（DB の b2c_outbox_claim。FOR UPDATE SKIP LOCKED）。
 * - 送る直前に予約の今の状態と期限を確かめる（取消された予約に送らない。期限を過ぎた通知は expired にして送らない）。
 * - 送り始める前に send_started_at と文面を記録する。記録できなければ送らない。
 * - 結果は 3つに分ける: 届いた（sent）／確実に送れていない（再試行・最後は failed）／届いたか分からない（相手の応答が無い・
 *   送った直後に DB の記録に失敗した）。分からない時は、送信手段が冪等（同じ冪等キーの再送を相手が 1通にまとめる:
 *   Resend のメール・24時間）なら同じ文面・同じキーで再試行し、冪等でない手段（WhatsApp・SMTP）は自動で再送せず
 *   unknown にして運営が照合する（lib/b2c/outbox-ops.ts）。DB の一意の制約だけでは外への二重送信は防げないため。
 * - failed・unknown・expired と滞留は運営に知らせる（checkB2cOutboxHealth）。
 * - 外部に送るのは B2C_NOTIFY_LIVE=true の時だけ。それ以外は sandbox（文面を記録するだけで、何も送らない。運営への知らせも
 *   ログだけ）。WhatsApp は加えて B2C_WHATSAPP_LIVE=true（Meta のテンプレートの承認の後）。それまでは WhatsApp の通知を
 *   送らずに片付け（whatsapp_disabled）、メールだけで運用する（阪急向け Beta はメールだけで開始・2026-11-04 承認）。
 */
import { getSupabase } from "@/lib/supabase"
import { sendMail } from "@/lib/mailer"
import { sendOpsAlert, opsAlertConfigured, type OpsAlertInput, type OpsAlertResult } from "@/lib/ops-alert"
import { b2cAccessToken, b2cMyBookingUrl } from "./access-token"
import { renderEmail, renderWhatsApp, type B2cCancelReason, type B2cNotifyData, type B2cNotifyKind, type Lang } from "./notify-templates"

export const B2C_OUTBOX_MAX_ATTEMPTS = 6
const BACKOFF_MIN = [2, 5, 15, 60, 180] // 1回目の失敗の後 2分（時計のずれの許容 1分より長く）、… 3時間
/** DB とアプリのサーバーの時計のずれの許容（next_attempt_at は DB の時計で入る）。作った直後の通知を取りこぼさない。 */
const CLOCK_SKEW_SEC = 60
/** 冪等キーで再送してよい期間（Resend の冪等キーは 24時間。余裕を見て 23時間） */
const IDEMPOTENT_WINDOW_MS = 23 * 3600 * 1000

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
  /** 再試行しても直らない（宛先が無い・送信手段が使えない・相手が明確に断った） */
  permanent?: boolean
  /** 届いたか分からない（時間切れ・切断・相手の 5xx・例外）。ok=false の時だけ意味がある */
  uncertain?: boolean
  /** 届いたか分からないが、同じキーで送り直しても直らない（Resend の invalid_idempotent_request）。自動で再送せず運営の照合へ */
  noAutoRetry?: boolean
}

export interface B2cTransport {
  email(to: string, subject: string, text: string, idempotencyKey: string): Promise<SendOutcome>
  whatsapp(to: string, template: string, languageCode: "ja" | "en_US", params: string[]): Promise<SendOutcome>
  /** 同じ冪等キーで送り直しても相手が 1通にまとめるか（チャネルごと）。無ければ冪等でないとみなす */
  idempotent?: { email: boolean; whatsapp: boolean }
  /**
   * WhatsApp で送るか。false の間（Meta のテンプレートの承認の前・メールだけの Beta）は、WhatsApp の通知を送らずに
   * 「送らない（whatsapp_disabled）」として片付ける（失敗・運営への知らせにしない）。無ければ送る。
   */
  whatsappEnabled?: boolean
}

/** 何も送らず、送ったことにする（文面は outbox の rendered に残る）。ローカル・試験の環境の既定。 */
export const sandboxTransport: B2cTransport = {
  async email() {
    return { ok: true, provider: "sandbox" }
  },
  async whatsapp() {
    return { ok: true, provider: "sandbox" }
  },
  idempotent: { email: true, whatsapp: true },
}

export const liveTransport: B2cTransport = {
  async email(to, subject, text, idempotencyKey) {
    // strict: 送信手段を 1つに固定（失敗しても別の手段で送り直さない）。Resend なら冪等キーが効く
    const r = await sendMail({ to, subject, text, idempotencyKey, strict: true })
    if (r.sent) return { ok: true, provider: r.via ?? "email" }
    const st = r.status ?? 0
    const permanent = !r.uncertain && (!r.via || (r.via === "resend" && st >= 400 && st < 500 && st !== 429 && st !== 409) || (r.via === "smtp" && st >= 500))
    return { ok: false, provider: r.via ?? "email", error: r.error ?? "not_sent", permanent, uncertain: !!r.uncertain, noAutoRetry: r.code === "invalid_idempotent_request" }
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
        signal: AbortSignal.timeout(15_000),
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
      if (!res.ok) {
        // 5xx は届いたか分からない。429 は送られていない（後で再試行）。その他の 4xx は直らない
        return { ok: false, provider: "whatsapp", error: `http_${res.status}:${body.error?.code ?? ""}`, uncertain: res.status >= 500, permanent: res.status >= 400 && res.status < 500 && res.status !== 429 }
      }
      return { ok: true, provider: "whatsapp", messageId: body.messages?.[0]?.id }
    } catch (e) {
      // 名前の解決・接続の拒否は送れていない。時間切れ・切断は届いたか分からない（WhatsApp には冪等キーが無い）
      const code = (e as { cause?: { code?: string } })?.cause?.code ?? ""
      return { ok: false, provider: "whatsapp", error: e instanceof Error ? e.message.slice(0, 200) : "error", uncertain: !["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"].includes(code) }
    }
  },
  get idempotent() {
    return { email: !!process.env.RESEND_API_KEY, whatsapp: false }
  },
  get whatsappEnabled() {
    return b2cWhatsAppLive()
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
export function notifyEligibility(kind: B2cNotifyKind, o: Pick<OrderForNotify, "status" | "pickup_date">, shipmentStatus: string | null, now: Date, ref: RefState | null = null): string | null {
  switch (kind) {
    // 支払・返金の通知（Stage 5）: 予約ではなく、その請求・返金の今の状態で判断する（支払の後は案内を送らない）
    case "payment_action_required":
      if (!ref?.paymentStatus) return "payment_missing"
      return ["failed", "requires_action"].includes(ref.paymentStatus) ? null : `payment_${ref.paymentStatus}`
    case "payment_received":
      if (!ref?.paymentStatus) return "payment_missing"
      return ["succeeded", "partially_refunded", "refunded"].includes(ref.paymentStatus) ? null : `payment_${ref.paymentStatus}`
    case "refund_issued":
      if (!ref?.refundStatus) return "refund_missing"
      return ref.refundStatus === "succeeded" ? null : `refund_${ref.refundStatus}`
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

/** 支払・返金の通知の材料（b2c_outbox.ref_id の請求・返金） */
export interface RefState {
  paymentStatus?: string
  refundStatus?: string
  amountYen?: number
}

function dataOf(o: OrderForNotify, ref: RefState | null = null): B2cNotifyData {
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
    amountYen: ref?.amountYen ?? null,
    payUrl: `${base}/my/${token}/pay${o.language === "ja" ? "?lang=ja" : ""}`,
  }
}

// ---------------------------------------------------------------------------
// 送信
// ---------------------------------------------------------------------------
export interface OutboxRunResult {
  batches: number
  claimed: number
  sent: number
  skipped: number
  expired: number
  retried: number
  failed: number
  unknown: number
  /** 送る前に止まっていた行を再試行に戻した数 */
  recovered: number
  /** 送った後に止まっていた行を、冪等キーで再試行に戻した数 */
  idempotentRetry: number
  /** 時間の上限に達して、送らずに戻した数 */
  released: number
  /** 送った後に結果を DB に記録できなかった数（止まった送信として後で照合される） */
  unrecorded: number
  health?: HealthResult
}

export type B2cAlertFn = (input: OpsAlertInput) => Promise<OpsAlertResult>

/** 本番（B2C_NOTIFY_LIVE=true）は運営へのメール・Slack。sandbox ではログだけ（外に出さない）。 */
export function b2cOpsAlert(): B2cAlertFn {
  if (b2cNotifyLive()) return sendOpsAlert
  return async (input) => {
    console.error(`[b2c-ops-alert:sandbox] ${input.subject} :: ${input.lines.join(" | ")}`)
    return { emailSent: false, slackSent: false, errors: [], sandbox: true } as OpsAlertResult
  }
}

export interface ProcessOpts {
  /** 1回に取る件数（既定 20） */
  batch?: number
  /** この処理の時間の上限（既定 50秒。超えたら残りは次回） */
  budgetMs?: number
  /** 1通の送信の時間の上限（既定 20秒。超えたら「届いたか分からない」） */
  sendTimeoutMs?: number
  alert?: B2cAlertFn
  /** 試験用: 行を取った直後に呼ぶ（DB の障害を差し込むため） */
  afterClaim?: (ids: number[]) => Promise<void>
}

interface OutboxRow {
  id: number
  order_id: string
  kind: B2cNotifyKind
  channel: "email" | "whatsapp"
  dedupe_key: string
  attempts: number
  rendered: Record<string, unknown> | null
  first_send_at: string | null
  expires_at: string | null
  priority: number
  ref_id: string | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 結果の記録。DB の一時的な失敗に備えて 3回まで。記録できたら true。 */
async function recordOutcome(id: number, patch: Record<string, unknown>): Promise<boolean> {
  const sb = getSupabase()
  if (!sb) return false
  for (const wait of [0, 300, 1500]) {
    if (wait) await sleep(wait)
    try {
      const { data, error } = await sb.from("b2c_outbox").update(patch).eq("id", id).eq("status", "sending").select("id").maybeSingle()
      if (!error && data) return true
      if (!error && !data) return false // 既に他の処理で状態が変わっている
    } catch {
      /* 次の試行 */
    }
  }
  return false
}

async function sendWithTimeout(p: () => Promise<SendOutcome>, provider: string, ms: number): Promise<SendOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<SendOutcome>((res) => {
    timer = setTimeout(() => res({ ok: false, provider, error: "send_timeout", uncertain: true }), ms)
  })
  const run = p().catch((e): SendOutcome => ({ ok: false, provider, error: String(e).slice(0, 200), uncertain: true }))
  try {
    return await Promise.race([run, timeout])
  } finally {
    clearTimeout(timer)
  }
}

export async function processB2cOutbox(transport: B2cTransport = b2cTransport(), now: Date = new Date(), opts: ProcessOpts = {}): Promise<OutboxRunResult> {
  const res: OutboxRunResult = { batches: 0, claimed: 0, sent: 0, skipped: 0, expired: 0, retried: 0, failed: 0, unknown: 0, recovered: 0, idempotentRetry: 0, released: 0, unrecorded: 0 }
  const sb = getSupabase()
  if (!sb) return res
  const started = Date.now()
  const budget = opts.budgetMs ?? 50_000
  const batch = opts.batch ?? 20
  const sendTimeout = opts.sendTimeoutMs ?? 20_000
  const nowIso = now.toISOString()

  // 止まった送信の片付け（送る前 → 再試行・送った後 → 冪等なら再試行／でなければ unknown）と期限切れ
  const { data: m } = await sb.rpc("b2c_outbox_maintain", { p_now: nowIso })
  const mm = (m ?? {}) as { recovered?: number; idempotent_retry?: number; unknown?: number; expired?: number }
  res.recovered += mm.recovered ?? 0
  res.idempotentRetry += mm.idempotent_retry ?? 0
  res.unknown += mm.unknown ?? 0
  res.expired += mm.expired ?? 0

  while (Date.now() - started < budget) {
    const { data: rows, error } = await sb.rpc("b2c_outbox_claim", { p_now: nowIso, p_limit: batch, p_skew: `${CLOCK_SKEW_SEC} seconds` })
    if (error || !rows || !(rows as unknown[]).length) break
    res.batches++
    const claimed = (rows as OutboxRow[]).sort((a, b) => a.priority - b.priority || (a.expires_at ?? "").localeCompare(b.expires_at ?? "") || a.id - b.id)
    res.claimed += claimed.length
    if (opts.afterClaim) await opts.afterClaim(claimed.map((r) => r.id))
    for (const row of claimed) {
      if (Date.now() - started >= budget) {
        // 時間切れ: まだ送っていない行は戻す（戻せなくても send_started_at が無いので、後で安全に再試行される）
        await sb.from("b2c_outbox").update({ status: "pending", locked_at: null }).eq("id", row.id).eq("status", "sending").is("send_started_at", null)
        res.released++
        continue
      }
      await processRow(row, transport, now, sendTimeout, res)
    }
  }
  res.health = await checkB2cOutboxHealth(now, opts.alert ?? b2cOpsAlert()).catch((e) => {
    console.error("[b2c-outbox] health check failed", String(e).slice(0, 200))
    return undefined
  })
  return res
}

async function processRow(row: OutboxRow, transport: B2cTransport, now: Date, sendTimeout: number, res: OutboxRunResult): Promise<void> {
  const sb = getSupabase()!
  const nowIso = now.toISOString()
  const { data: order, error: oErr } = await sb
    .from("b2c_orders")
    .select("id, order_number, status, language, guest_name, guest_email, guest_whatsapp, origin_snapshot, dest_snapshot, pickup_date, delivery_date, pieces, total_gross_yen, confirmation_due_at, cancel_reason")
    .eq("id", row.order_id)
    .maybeSingle()
  const { data: ship, error: sErr } = order ? await sb.from("shipments").select("status").eq("b2c_order_id", row.order_id).maybeSingle() : { data: null, error: null }
  // 支払・返金の通知は、その請求・返金の今の状態を読む
  let ref: RefState | null = null
  let refErr = false
  if (row.ref_id && (row.kind === "payment_action_required" || row.kind === "payment_received")) {
    const { data: pay, error } = await sb.from("b2c_payments").select("status, amount_yen").eq("id", row.ref_id).maybeSingle()
    refErr = !!error
    ref = pay ? { paymentStatus: pay.status as string, amountYen: pay.amount_yen as number } : {}
  } else if (row.ref_id && row.kind === "refund_issued") {
    const { data: rf, error } = await sb.from("b2c_refunds").select("status, amount_yen").eq("id", row.ref_id).maybeSingle()
    refErr = !!error
    ref = rf ? { refundStatus: rf.status as string, amountYen: rf.amount_yen as number } : {}
  }
  if (oErr || sErr || refErr || !order) {
    // 予約を読めない（DB の一時的な障害）: 送らずに 1分後に回す（試行の回数には数えない）
    await sb.from("b2c_outbox").update({ status: "pending", locked_at: null, last_error: "order_unreadable", next_attempt_at: new Date(now.getTime() + 60_000).toISOString() }).eq("id", row.id).eq("status", "sending")
    res.retried++
    return
  }
  const o = order as OrderForNotify
  // メールだけの運用（WhatsApp のテンプレートの承認の前）: WhatsApp は送らずに片付ける。失敗・運営への知らせにしない
  // （全予約で「送れなかった」の知らせが出て、本当のメールの失敗が埋もれないように）。承認の後に B2C_WHATSAPP_LIVE=true で送る。
  if (row.channel === "whatsapp" && transport.whatsappEnabled === false) {
    await sb.from("b2c_outbox").update({ status: "cancelled", locked_at: null, last_error: "whatsapp_disabled" }).eq("id", row.id).eq("status", "sending")
    res.skipped++
    return
  }
  const notOk = notifyEligibility(row.kind, o, (ship?.status as string) ?? null, now, ref)
  if (notOk) {
    // 予約の状態が変わった → cancelled。時刻の条件（当日 11:00 を過ぎた・日付が合わない）→ expired（運営に知らせる）
    const timing = notOk === "too_late" || notOk === "date_mismatch"
    await sb.from("b2c_outbox").update({ status: timing ? "expired" : "cancelled", locked_at: null, last_error: `not_eligible:${notOk}` }).eq("id", row.id).eq("status", "sending")
    if (timing) res.expired++
    else res.skipped++
    return
  }

  // 文面: 前の試行で記録した文面があれば同じものを送る（冪等キーで再送する時に、相手が同じ要求と見なすため）
  const data = dataOf(o, ref)
  let rendered: Record<string, unknown>
  if (row.rendered && typeof row.rendered === "object" && Object.keys(row.rendered).length) rendered = row.rendered
  else if (row.channel === "email") {
    const mail = renderEmail(row.kind, data)
    rendered = { to: o.guest_email, subject: mail.subject, text: mail.text }
  } else {
    const w = renderWhatsApp(row.kind, data)
    rendered = { to: o.guest_whatsapp, template: w.template, language: w.languageCode, params: w.params }
  }
  const idem = row.channel === "email" ? !!transport.idempotent?.email : !!transport.idempotent?.whatsapp
  const attempts = row.attempts + 1
  const firstSendAt = row.first_send_at ?? nowIso

  // 送り始める前の記録。記録できなければ送らない（送ったかどうかの記録が無いまま外に出さない）
  const { data: pre, error: preErr } = await sb
    .from("b2c_outbox")
    .update({ send_started_at: nowIso, first_send_at: firstSendAt, send_idempotent: idem, rendered, attempts, language: data.lang })
    .eq("id", row.id)
    .eq("status", "sending")
    .select("id")
    .maybeSingle()
  if (preErr || !pre) {
    await sb.from("b2c_outbox").update({ status: "pending", locked_at: null, last_error: "pre_send_record_failed" }).eq("id", row.id).eq("status", "sending").is("send_started_at", null)
    res.released++
    return
  }

  const out =
    row.channel === "email"
      ? await sendWithTimeout(() => transport.email(String(rendered.to), String(rendered.subject), String(rendered.text), row.dedupe_key), "email", sendTimeout)
      : await sendWithTimeout(() => transport.whatsapp(String(rendered.to), String(rendered.template), rendered.language as "ja" | "en_US", rendered.params as string[]), "whatsapp", sendTimeout)

  let patch: Record<string, unknown>
  let outcome: "sent" | "retry" | "failed" | "unknown"
  if (out.ok) {
    outcome = "sent"
    patch = { status: "sent", sent_at: nowIso, locked_at: null, last_error: null, provider: out.provider, provider_message_id: out.messageId ?? null }
  } else if (out.uncertain) {
    const inWindow = now.getTime() - new Date(firstSendAt).getTime() < IDEMPOTENT_WINDOW_MS
    if (idem && inWindow && attempts < B2C_OUTBOX_MAX_ATTEMPTS && !out.noAutoRetry) {
      // 冪等な手段: 同じ文面・同じ冪等キーで再試行（届いていれば相手が 1通にまとめる）
      outcome = "retry"
      patch = { status: "pending", locked_at: null, send_started_at: null, last_error: `uncertain:${out.error ?? ""}`.slice(0, 300), provider: out.provider, next_attempt_at: new Date(now.getTime() + backoffMs(attempts)).toISOString() }
    } else {
      // 冪等でない手段（WhatsApp・SMTP）: 自動で再送しない。運営が送信の記録と照合する
      outcome = "unknown"
      patch = { status: "unknown", locked_at: null, last_error: `uncertain:${out.error ?? ""}`.slice(0, 300), provider: out.provider }
    }
  } else if (out.permanent || attempts >= B2C_OUTBOX_MAX_ATTEMPTS) {
    outcome = "failed"
    patch = { status: "failed", locked_at: null, send_started_at: null, last_error: out.error ?? "failed", provider: out.provider }
  } else {
    outcome = "retry"
    patch = { status: "pending", locked_at: null, send_started_at: null, last_error: out.error ?? "failed", provider: out.provider, next_attempt_at: new Date(now.getTime() + backoffMs(attempts)).toISOString() }
  }

  const recorded = await recordOutcome(row.id, patch)
  if (!recorded) {
    // 送った（または送ったかもしれない）のに記録できなかった。行は sending のまま残り、10分後の片付けで
    // 冪等な手段なら同じキーで再試行（相手が 1通にまとめる）、でなければ unknown として運営に知らせる。
    res.unrecorded++
    console.error(JSON.stringify({ event: "b2c_outbox_result_unrecorded", outbox_id: row.id, outcome, provider: out.provider, provider_message_id: out.messageId ?? null }))
    return
  }
  if (outcome === "sent") res.sent++
  else if (outcome === "retry") res.retried++
  else if (outcome === "failed") res.failed++
  else res.unknown++
}

function backoffMs(attempts: number): number {
  return BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000
}

// ---------------------------------------------------------------------------
// 運営への知らせ（failed・unknown・expired は 1行 1回。滞留は 1時間に 1回）
// ---------------------------------------------------------------------------
export interface OutboxHealth {
  pending_total: number
  overdue_15m: number
  reminder_overdue_10m: number
  oldest_overdue_min: number
  sending_stuck: number
  unalerted_problems: number
}
export interface HealthResult {
  health: OutboxHealth | null
  problemsAlerted: number
  backlogAlerted: boolean
  /** 知らせるべきことがあるのに、知らせる手段が無い・届かなかった */
  undeliverable: boolean
}

const PROBLEM_TEXT: Record<string, string> = {
  failed: "送れませんでした（相手が受け付けない・再試行の上限）。→ 旅行者に別の手段で連絡してください。",
  unknown: "届いたか分かりません（送った直後に応答・記録が途切れた）。→ 送信サービスの記録（Resend のログ・WhatsApp の管理画面）で確かめ、運営の画面（/api/b2c/ops/outbox）で「届いていた」か「再送」を選んでください。自動では再送しません（二重送信を防ぐため）。",
  expired: "期限までに送れませんでした（リマインドの時刻を過ぎた等）。→ 必要なら旅行者に直接連絡してください。",
}

export async function checkB2cOutboxHealth(now: Date = new Date(), alert: B2cAlertFn = b2cOpsAlert()): Promise<HealthResult> {
  const out: HealthResult = { health: null, problemsAlerted: 0, backlogAlerted: false, undeliverable: false }
  const sb = getSupabase()
  if (!sb) return out
  const sandbox = !b2cNotifyLive()
  const delivered = (r: OpsAlertResult) => r.emailSent || r.slackSent || (r as { sandbox?: boolean }).sandbox === true

  const { data: probs } = await sb
    .from("b2c_outbox")
    .select("id, order_id, kind, channel, status, last_error, attempts")
    .in("status", ["failed", "unknown", "expired"])
    .is("ops_alerted_at", null)
    .order("id")
    .limit(50)
  if (probs?.length) {
    const ids = [...new Set(probs.map((p) => p.order_id as string))]
    const { data: ords } = await sb.from("b2c_orders").select("id, order_number").in("id", ids)
    const num = new Map((ords ?? []).map((x) => [x.id as string, x.order_number as number]))
    const byStatus = (st: string) => probs.filter((p) => p.status === st)
    const lines: string[] = []
    for (const st of ["unknown", "failed", "expired"]) {
      const ps = byStatus(st)
      if (!ps.length) continue
      lines.push(`■ ${st}（${ps.length}件）: ${PROBLEM_TEXT[st]}`)
      for (const p of ps) lines.push(`  受付番号 ${num.get(p.order_id as string) ?? "?"} / ${p.kind} / ${p.channel} / 試行 ${p.attempts}回 / ${String(p.last_error ?? "").slice(0, 120)} / outbox#${p.id}`)
    }
    const r = await alert({ subject: `【B2C 通知】要確認 ${probs.length}件（届いたか不明・送信失敗・期限切れ）`, lines, agencyEmail: null })
    if (delivered(r)) {
      await sb.from("b2c_outbox").update({ ops_alerted_at: now.toISOString() }).in("id", probs.map((p) => p.id as number))
      out.problemsAlerted = probs.length
    } else out.undeliverable = true
  }

  const { data: h } = await sb.rpc("b2c_outbox_health", { p_now: now.toISOString() })
  const health = (h ?? null) as OutboxHealth | null
  out.health = health
  if (health && (health.overdue_15m > 0 || health.reminder_overdue_10m > 0 || health.sending_stuck > 0)) {
    const { data: gate } = await sb.rpc("b2c_ops_alert_gate_try", { p_key: "b2c_outbox_backlog", p_now: now.toISOString(), p_every: "60 minutes" })
    if (gate === true) {
      const r = await alert({
        subject: `【B2C 通知】送信待ちが滞留しています（${health.overdue_15m}件が 15分以上遅れ）`,
        lines: [
          `送信待ち: ${health.pending_total}件 / 15分以上遅れ: ${health.overdue_15m}件 / 最も古い遅れ: ${health.oldest_overdue_min}分`,
          `集荷のリマインドの遅れ（10分以上）: ${health.reminder_overdue_10m}件`,
          `送信中のまま止まった: ${health.sending_stuck}件`,
          "→ 定期の処理（/api/b2c/cron/tick）が動いているか、メール・WhatsApp の送信サービスが落ちていないかを確かめてください。",
        ],
        agencyEmail: null,
      })
      out.backlogAlerted = true
      if (!delivered(r)) out.undeliverable = true
    }
  }
  if (out.undeliverable && !sandbox && !opsAlertConfigured()) console.error("[b2c-outbox] 運営に知らせる手段がありません（SMTP / RESEND_API_KEY / SLACK_WEBHOOK_URL）")
  return out
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
