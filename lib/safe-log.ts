/**
 * 個人情報・秘密を出さないログ（2026-11-06・谷口さん決定）。
 *
 * 許可リスト方式: 下の型で決めた項目だけを、1行の JSON で出す。件名・本文・宛先のアドレス・外部サービスのエラーの全文は受け取らない。
 *   - 種類（kind）・起点（source）は、プログラムで決めた固定の ID（件名・本文から取り出さない）
 *   - 予約・区間の ID は、呼び出し側が DB の値を明示して渡した時だけ（本文から取り出さない）
 *   - エラーは、決めた種類（SafeErrorType）と HTTP の状態の番号だけ
 * 運営は ref（予約・区間の ID）と時刻で、運営の画面から中身を確かめる。
 */

/** 何のログか（固定の ID） */
export type SafeLogKind =
  | "ops_alert" // 運営への通知（lib/ops-alert.ts）
  | "ops_alert_sandbox" // B2C の運営への通知・試験の形（lib/b2c/notify.ts）
  | "mail_send" // メールの送信の結果（lib/mailer.ts）
  | "mail_capture" // 試験・staging で送らずに記録した（lib/mailer.ts）
  | "mail_staging_send" // staging の社内の宛先への実送信（lib/mailer.ts）
  | "agency_booking_request_mail" // 代理店の依頼の受付のメール（lib/agency-notify.ts）
  | "agency_invite_mail" // 代理店の担当者の招待のメール（lib/agency-contacts.ts）
  | "agency_push" // 代理店への WhatsApp・LINE（lib/agency-push.ts）
  | "whatsapp_webhook" // WhatsApp の受信と自動の返信（app/api/whatsapp/webhook）
  | "shipandco_request" // Ship&co への送り状の作成（lib/dispatch/shipandco.ts・app/api/shipandco/create）
  | "shipandco_address" // ホテルの住所の解決（app/api/shipandco/create）
  | "shipandco_tracking" // Ship&co の追跡の照会（lib/tracking/shipandco.ts）
  | "contact_inquiry" // お問い合わせ（app/api/contact）

export type SafeOutcome = "ok" | "failed" | "unknown" | "skipped"

/** 外部・内部のエラーの種類（エラーの全文の代わり） */
export type SafeErrorType =
  | "http_error" // 相手が 4xx・5xx を返した（http に番号）
  | "timeout"
  | "network" // つながらない・切れた
  | "config_missing" // 鍵・設定が無い
  | "invalid_response" // 応答の形が想定と違う
  | "blocked" // こちらの安全装置で送らなかった（staging の宛先の制限など）
  | "no_recipient"
  | "partial" // 一部だけ成功
  | "unknown"

export interface SafeLogFields {
  kind: SafeLogKind
  /** 起点の固定の ID（例: "cron.pickup-watch"）。呼び出し側がコードに書いた文字列だけを渡す */
  source?: string
  /** その回の処理の ID（generateLogId で作る） */
  id?: string
  outcome: SafeOutcome
  error?: SafeErrorType
  http?: number
  /** 予約・区間などの内部の ID（DB の値を明示して渡す・最小限） */
  ref?: string | string[]
  /** 宛先の数・送れた数など、個人を表さない数 */
  count?: number
  sent?: number
  /** 宛先の種類（"ops"・"agency"・"traveler"・"internal"）。アドレスは出さない */
  to?: "ops" | "agency" | "traveler" | "internal" | "other"
  /** 送信の手段（"resend"・"smtp"・"slack"・"whatsapp"・"line"） */
  via?: string
}

const SOURCE_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** 処理の ID（ログの行を結び付けるためだけの乱数。中身に意味は無い） */
export function generateLogId(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`).slice(0, 36)
}

/**
 * 許可した項目だけを取り出して 1行にする（値の形も確かめ、形が違う値は捨てる。メールアドレス・空白・URL は ref・source に入らない）。
 */
export function formatSafeLog(f: SafeLogFields, now: Date = new Date()): string {
  const out: Record<string, unknown> = { t: now.toISOString(), kind: f.kind }
  if (f.source && SOURCE_RE.test(f.source)) out.source = f.source
  if (f.id && /^[A-Za-z0-9-]{8,36}$/.test(f.id)) out.id = f.id
  out.outcome = f.outcome
  if (f.error) out.error = f.error
  if (typeof f.http === "number" && Number.isInteger(f.http) && f.http >= 100 && f.http <= 599) out.http = f.http
  const refs = (Array.isArray(f.ref) ? f.ref : f.ref ? [f.ref] : []).filter((r) => typeof r === "string" && REF_RE.test(r)).slice(0, 10)
  if (refs.length) out.ref = refs
  if (typeof f.count === "number" && Number.isInteger(f.count) && f.count >= 0) out.count = f.count
  if (typeof f.sent === "number" && Number.isInteger(f.sent) && f.sent >= 0) out.sent = f.sent
  if (f.to) out.to = f.to
  if (f.via && /^[a-z]{2,12}$/.test(f.via)) out.via = f.via
  return `[safe-log] ${JSON.stringify(out)}`
}

/** 成功・記録は info、失敗・結果不明は error に出す */
export function safeLog(f: SafeLogFields): void {
  const line = formatSafeLog(f)
  if (f.outcome === "failed" || f.outcome === "unknown") console.error(line)
  else console.log(line)
}

/** HTTP の状態の番号から、エラーの種類を決める */
export function errorTypeOfHttp(status: number): SafeErrorType {
  return status >= 400 ? "http_error" : "invalid_response"
}

/** 例外から、エラーの種類だけを決める（メッセージの全文は使わない） */
export function errorTypeOf(e: unknown): SafeErrorType {
  const name = e instanceof Error ? e.name : ""
  const code = (e as { code?: unknown } | null)?.code
  if (name === "TimeoutError" || name === "AbortError" || code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "timeout"
  if (typeof code === "string" && /^(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE)$/.test(code)) return "network"
  if (name === "TypeError" && /fetch failed/i.test(e instanceof Error ? e.message : "")) return "network"
  return "unknown"
}
