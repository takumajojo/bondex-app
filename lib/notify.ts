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

const SITE_URL = "https://bondex.express"

export type NotifyKind =
  | "booking" // 🆕 新規予約(発行依頼)
  | "delivery" // 📦 配送完了
  | "contract" // ✍️ 契約締結(受注契約)
  | "agency" // 🏢 新規代理店(承認待ち)
  | "contact" // 💬 お問い合わせ
  | "charge" // 💳 課金

const KIND_META: Record<NotifyKind, { emoji: string; label: string }> = {
  booking: { emoji: "🆕", label: "新規予約" },
  delivery: { emoji: "📦", label: "配送完了" },
  contract: { emoji: "✍️", label: "契約締結" },
  agency: { emoji: "🏢", label: "新規代理店" },
  contact: { emoji: "💬", label: "お問い合わせ" },
  charge: { emoji: "💳", label: "課金" },
}

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

/** Slack 集約チャンネルが有効か(環境変数が入っているか)。 */
export function notifyConfigured(): boolean {
  return !!process.env.SLACK_WEBHOOK_URL
}

/**
 * 1イベントを Slack の集約チャンネルへ投稿する。失敗しても例外は投げない。
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

  const webhook = process.env.SLACK_WEBHOOK_URL
  if (!webhook) {
    console.log(`[notify] (Slack未設定) ${meta.label} :: ${input.title}`)
    return { sent: false, error: "SLACK_WEBHOOK_URL unset" }
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      console.error(`[notify] Slack HTTP ${res.status} (${meta.label})`)
      return { sent: false, error: `Slack HTTP ${res.status}` }
    }
    return { sent: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[notify] Slack 例外 (${meta.label}):`, msg)
    return { sent: false, error: msg }
  }
}
