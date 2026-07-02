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

const ALERT_FROM = process.env.ALERT_FROM_EMAIL || "BondEx Alerts <alerts@bondex.express>"
const BONDEX_OPS_EMAIL = process.env.ALERT_EMAIL || "support@bondex.express"

export interface OpsAlertInput {
  subject: string
  /** プレーンテキスト本文の行。HTML はこちらで組み立てる。 */
  lines: string[]
  /** ランドオペレーター側の通知先 (agencies.contact_email)。無ければ BondEx のみ。 */
  agencyEmail?: string | null
}

export interface OpsAlertResult {
  emailSent: boolean
  slackSent: boolean
  errors: string[]
}

async function sendViaResend(
  apiKey: string,
  to: string[],
  subject: string,
  lines: string[],
): Promise<string | null> {
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px">
      <h2 style="color:#C8102E;font-size:18px">${subject}</h2>
      ${lines.map((l) => `<p style="margin:6px 0;font-size:14px;color:#111">${l}</p>`).join("")}
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee"/>
      <p style="font-size:12px;color:#888">
        BondEx 配送監視 (自動送信) — このステータスは Ship&co / ヤマト運輸の追跡情報に基づきます。
      </p>
    </div>`
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: ALERT_FROM, to, subject, html }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return `Resend HTTP ${res.status}: ${body.slice(0, 200)}`
    }
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
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
    return err instanceof Error ? err.message : String(err)
  }
}

export async function sendOpsAlert(input: OpsAlertInput): Promise<OpsAlertResult> {
  const result: OpsAlertResult = { emailSent: false, slackSent: false, errors: [] }

  const resendKey = process.env.RESEND_API_KEY
  if (resendKey) {
    const to = [BONDEX_OPS_EMAIL]
    if (input.agencyEmail) to.push(input.agencyEmail)
    const err = await sendViaResend(resendKey, to, input.subject, input.lines)
    if (err) result.errors.push(`email: ${err}`)
    else result.emailSent = true
  }

  const slackUrl = process.env.SLACK_WEBHOOK_URL
  if (slackUrl) {
    const err = await sendViaSlack(slackUrl, input.subject, input.lines)
    if (err) result.errors.push(`slack: ${err}`)
    else result.slackSent = true
  }

  if (!resendKey && !slackUrl) {
    result.errors.push("no channel configured (RESEND_API_KEY / SLACK_WEBHOOK_URL both unset)")
  }
  // 取りこぼし防止: チャンネル成否に関わらず必ずログにも残す
  console.error(`[ops-alert] ${input.subject} :: ${input.lines.join(" | ")}`)
  return result
}
