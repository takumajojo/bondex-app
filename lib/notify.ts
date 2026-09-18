/**
 * BondEx 社内通知 — 業務イベントを Slack の1チャンネルに集約する。
 *
 * これまで各所からバラバラに飛んでいた「社内向けメール」を、Slack の1部屋
 * (#bondex-通知) にまとめて流すための単一の入口。文面・絵文字・リンクの体裁は
 * すべてこのファイルで決まるので、呼び出し側は「起きたこと」を渡すだけでよい。
 *
 * 送信チャンネルは ops-alert.ts と同じ環境変数 SLACK_WEBHOOK_URL を共用する
 * (Webhook は1本で全通知が相乗りする)。未設定なら console に出すだけで送信は
 * スキップし、{ sent:false } を返す。通知の失敗で本処理を止めないよう、例外は
 * 一切 throw しない (呼び出し側は await するだけで安全)。
 *
 * 「メールも当面は残す」方針のため、この関数は各所の既存メール送信を置き換えず、
 * 隣に1行足す形で使う。Slack 運用が安定したら、社内向けメール(ALERT_EMAIL 宛の
 * コピー)だけを止めれば受信箱が静かになる。
 */

import { sendMail, mailerConfigured } from "./mailer"

const SITE_URL = "https://bondex.express"

// 社内通知メールの宛先 (ops-alert.ts と共通の考え方: ALERT_EMAIL があれば優先、無ければ support@)。
const BONDEX_OPS_EMAIL = process.env.ALERT_EMAIL || "support@bondex.express"

export type NotifyKind =
  | "booking" // 🆕 新規予約(発行依頼)
  | "pickup" // 🚚 集荷完了
  | "delivery" // 📦 配送完了
  | "cancel" // ❌ キャンセル(代理店セルフ / 運営操作)
  | "contract" // ✍️ 契約締結(受注契約)
  | "agency" // 🏢 新規代理店(承認待ち)
  | "contact" // 💬 お問い合わせ
  | "charge" // 💳 課金
  | "adjust" // ✏️ 個数修正(受付≠実個数)
  | "change" // 🔁 予約変更(代理店セルフの日程/個数変更)

const KIND_META: Record<NotifyKind, { emoji: string; label: string }> = {
  booking: { emoji: "🆕", label: "新規予約" },
  pickup: { emoji: "🚚", label: "集荷完了" },
  delivery: { emoji: "📦", label: "配送完了" },
  cancel: { emoji: "❌", label: "キャンセル" },
  contract: { emoji: "✍️", label: "契約締結" },
  agency: { emoji: "🏢", label: "新規代理店" },
  contact: { emoji: "💬", label: "お問い合わせ" },
  charge: { emoji: "💳", label: "課金" },
  adjust: { emoji: "✏️", label: "個数修正" },
  change: { emoji: "🔁", label: "予約変更" },
}

// support@ へメールでも通知するイベント (谷口さんの要望: 依頼・キャンセル・集荷完了・配送完了)。
// これ以外 (契約・新規代理店・問い合わせ・課金・個数修正・日程変更) は従来どおり Slack のみ。
const EMAIL_KINDS: ReadonlySet<NotifyKind> = new Set<NotifyKind>([
  "booking",
  "cancel",
  "pickup",
  "delivery",
])

export interface NotifyInput {
  kind: NotifyKind
  /** 見出し(予約番号・代理店名など、一目でわかる主題) */
  title: string
  /** 補足行(「代理店: ○○」「区間: 東京→大阪」など)。頭の "• " は自動で付く。 */
  lines?: string[]
  /** クリックで飛べる先。相対パス("/operator") でも絶対URLでも可。 */
  link?: string
  /** リンクの表示ラベル(既定「ダッシュボードで開く」)。 */
  linkLabel?: string
}

/** 社内通知の手段が1つでも有効か (メール or Slack)。 */
export function notifyConfigured(): boolean {
  return mailerConfigured() || !!process.env.SLACK_WEBHOOK_URL
}

/**
 * 1イベントを社内へ通知する。EMAIL_KINDS(依頼/キャンセル/集荷完了/配送完了)は
 * support@ へメール送信も行い、加えて Slack が設定されていれば集約チャンネルへ投稿する。
 * どちらか一方でも届けば sent=true。失敗しても例外は投げない。
 */
export async function notifyBondEx(
  input: NotifyInput,
): Promise<{ sent: boolean; error?: string }> {
  const meta = KIND_META[input.kind]
  const header = `${meta.emoji} *${meta.label}*　${input.title}`
  const parts = [header, ...(input.lines ?? []).filter(Boolean).map((l) => `• ${l}`)]
  if (input.link) {
    const url = input.link.startsWith("http") ? input.link : `${SITE_URL}${input.link}`
    parts.push(`<${url}|${input.linkLabel ?? "ダッシュボードで開く"}>`)
  }
  const text = parts.join("\n")

  const errors: string[] = []
  let sent = false

  // ── (1) support@ へメール通知 (依頼・キャンセル・集荷完了・配送完了のみ)。
  //     Slack が未設定/未接続でも「谷口さんのメールに必ず届く」ことを担保する経路。
  //     失敗しても Slack 送信を止めない (best-effort・throw しない)。
  if (EMAIL_KINDS.has(input.kind) && mailerConfigured()) {
    try {
      const bodyLines = [
        `${meta.label}　${input.title}`,
        "",
        ...(input.lines ?? []).filter(Boolean).map((l) => `・${l}`),
      ]
      if (input.link) {
        const url = input.link.startsWith("http") ? input.link : `${SITE_URL}${input.link}`
        bodyLines.push("", `${input.linkLabel ?? "ダッシュボードで開く"}: ${url}`)
      }
      bodyLines.push("", "— BondEx 自動通知")
      const r = await sendMail({
        to: BONDEX_OPS_EMAIL,
        subject: `【BondEx】${meta.label}　${input.title}`,
        text: bodyLines.join("\n"),
      })
      if (r.sent) sent = true
      else errors.push(`email: ${r.error}`)
    } catch (e) {
      errors.push(`email: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // ── (2) Slack 集約チャンネル (設定があれば)。
  const webhook = process.env.SLACK_WEBHOOK_URL
  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
      if (res.ok) sent = true
      else {
        console.error(`[notify] Slack HTTP ${res.status} (${meta.label})`)
        errors.push(`Slack HTTP ${res.status}`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[notify] Slack 例外 (${meta.label}):`, msg)
      errors.push(msg)
    }
  }

  if (!sent) {
    console.log(`[notify] 未送信 ${meta.label} :: ${input.title}${errors.length ? ` (${errors.join("; ")})` : " (送信先未設定)"}`)
    return { sent: false, error: errors.join("; ") || "no channel configured" }
  }
  return { sent: true, error: errors.length ? errors.join("; ") : undefined }
}
