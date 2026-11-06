/**
 * 運用アラート送信 — 配送の異常系 (遅延中・調査中・持戻など) を
 * BondEx とランドオペレーター (代理店) の両方に通知する。
 *
 * チャンネルは環境変数の有無で自動的に有効化される:
 *   - RESEND_API_KEY      → Resend 経由のメール送信
 *                           (bondex.express ドメインを Resend で検証済みであること)
 *   - SLACK_WEBHOOK_URL   → Slack Incoming Webhook への投稿
 *
 * どちらも未設定の場合は console.error に出すだけ (cron のレスポンス JSON にも
 * 積まれるので、GitHub Actions のログからは必ず追える)。
 * 「アラートを絶対に取りこぼさない」ことを最優先に、送信失敗は throw せず
 * 戻り値で報告する。
 */

import { externalEffectsBlocked } from "@/lib/env-guard"
import { sendMail, mailerConfigured } from "./mailer"
import { opsRecipients } from "./ops-recipients"
import { safeLog, generateLogId, errorTypeOf } from "./safe-log"

export interface OpsAlertInput {
  subject: string
  /** プレーンテキスト本文の行。HTML はこちらで組み立てる。 */
  lines: string[]
  /** ランドオペレーター側の通知先 (agencies.contact_email)。無ければ BondEx のみ。 */
  agencyEmail?: string | null
  /** 代理店宛だけ別文面にする場合 (英語代理店への英語アラート等)。未指定は subject/lines を共用。 */
  agencySubject?: string
  agencyLines?: string[]
  /**
   * ログに残す起点の固定の ID（例: "cron.sync-tracking"）と、予約・区間の ID（DB の値）。2026-11-06。
   * ログには件名・本文を出さないので、運営はこの ID と時刻で運営の画面から中身を確かめる（lib/safe-log.ts）。
   */
  source?: string
  refs?: string[]
}

export interface OpsAlertResult {
  emailSent: boolean
  slackSent: boolean
  errors: string[]
}

async function sendViaSlack(webhookUrl: string, subject: string, lines: string[]): Promise<string | null> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `*${subject}*\n${lines.join("\n")}` }),
    })
    if (!res.ok) return `Slack HTTP ${res.status}`
    return null
  } catch (err) {
    // 例外の全文は返さない（種類だけ）
    return `Slack ${errorTypeOf(err)}`
  }
}

export async function sendOpsAlert(input: OpsAlertInput): Promise<OpsAlertResult> {
  const result: OpsAlertResult = { emailSent: false, slackSent: false, errors: [] }

  // メール: 共通 mailer (SMTP優先→Resendフォールバック)。BondEx運用 + 代理店(任意)。
  // 宛先ごとに送るので、片方が失敗しても他方には届く。
  if (mailerConfigured()) {
    const opsText = [...input.lines, "", "— BondEx 配送監視（自動送信）"].join("\n")
    // 代理店宛は agencyLines があればそれを使う (英語代理店への英語アラート)。無ければ共用。
    const agencyText = input.agencyLines
      ? [...input.agencyLines, "", "— BondEx delivery monitoring (automated)"].join("\n")
      : opsText
    const agencySubject = input.agencySubject ?? input.subject
    const targets: Array<{ to: string; subject: string; text: string }> = [
      // BondEx 運用: ALERT_EMAIL(谷口個人) と support@ の両方へ届ける。
      ...opsRecipients().map((to) => ({ to, subject: input.subject, text: opsText })),
      ...(input.agencyEmail ? [{ to: input.agencyEmail, subject: agencySubject, text: agencyText }] : []),
    ]
    let anySent = false
    for (const tgt of targets) {
      const r = await sendMail({ to: tgt.to, subject: tgt.subject, text: tgt.text })
      if (r.sent) anySent = true
      // 宛先のアドレスは出さない（運営か代理店かだけ）。r.error は lib/mailer.ts で番号・種類だけの形にしてある
      else result.errors.push(`email(${tgt.to === input.agencyEmail ? "agency" : "ops"}): ${r.error}`)
    }
    result.emailSent = anySent
  }

  // Preview・Development からは Slack に投稿しない (lib/env-guard.ts)
  const slackUrl = externalEffectsBlocked() ? undefined : process.env.SLACK_WEBHOOK_URL
  if (slackUrl) {
    const err = await sendViaSlack(slackUrl, input.subject, input.lines)
    if (err) result.errors.push(`slack: ${err}`)
    else result.slackSent = true
  }

  if (!mailerConfigured() && !slackUrl) {
    result.errors.push("no channel configured (SMTP / RESEND_API_KEY / SLACK_WEBHOOK_URL all unset)")
  }
  // 取りこぼし防止: チャンネルの成否に関わらず、必ずログにも残す。件名・本文は個人情報を含むので出さない（2026-11-06）。
  // 起点の ID・予約の ID・時刻・送れたか（メール・Slack）だけ。どちらにも届かなかった時は error で出る
  const delivered = result.emailSent || result.slackSent
  safeLog({
    kind: "ops_alert",
    source: input.source,
    id: generateLogId(),
    ref: input.refs,
    outcome: delivered ? "ok" : "failed",
    error: delivered ? (result.errors.length ? "partial" : undefined) : !mailerConfigured() && !slackUrl ? "config_missing" : "unknown",
    sent: (result.emailSent ? 1 : 0) + (result.slackSent ? 1 : 0),
  })
  return result
}

/**
 * アラートを届ける手段が1つでも設定されているか (2026-08-31 監査対応)。
 * cron はこれを検査し、「知らせるべきことがあるのに知らせる手段がない」場合に
 * HTTP エラーを返して GitHub Actions 側で赤くする (静かな成功にしない)。
 */
export function opsAlertConfigured(): boolean {
  return mailerConfigured() || Boolean(process.env.SLACK_WEBHOOK_URL)
}
