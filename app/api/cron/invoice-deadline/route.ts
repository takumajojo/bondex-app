import { NextRequest, NextResponse } from "next/server"
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { sendOpsAlert, opsAlertConfigured } from "@/lib/ops-alert"
import { buildMonthlyInvoice } from "@/lib/invoice-build"
import { nthBusinessDayOfMonth, businessDaysBetween } from "@/lib/business-days"
import { INVOICE_DEADLINE_RULES } from "@/lib/invoice-deadline"

export const runtime = "nodejs"
export const maxDuration = 120

/**
 * 請求書「発行期限」監視アラート cron (/api/cron/invoice-deadline)。
 *
 * 一部の代理店は契約で、請求書の発行期限が標準(翌月10日)より前倒し (例: TRAPOL=翌月第2営業日)。
 * これを外さないよう、毎朝 ops へ「前月分の請求書を期限までに発行・送付してください」を通知する。
 *   - 生成済み(ops確認待ち) → 期限までに代理店へ転送するよう催促。
 *   - 未生成だが請求対象あり   → 月次請求の失敗の可能性として至急確認を促す。
 *   - 請求対象なし(発送実績ゼロ) → 送るべき請求書が無いので何もしない。
 * 期限前(残り営業日)・本日締切・期限超過を段階表示。アラートは期限+2日まで (無限催促を避ける)。
 *
 * 宛先は sendOpsAlert (= [ALERT_EMAIL, support@])。認証は他 cron と同じ CRON_SECRET。
 */

function todayJst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}
/** today の前月を YYYY-MM で。 */
function prevMonth(today: string): string {
  const [y, m] = today.split("-").map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  return `${py}-${String(pm).padStart(2, "0")}`
}
function addCalendarDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12) + n * 86_400_000).toISOString().slice(0, 10)
}
function mmdd(ymd: string): string {
  const [, m, d] = ymd.split("-")
  return `${Number(m)}/${Number(d)}`
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const lock = await acquireCronLock("invoice-deadline")
  if (!lock.ok) return NextResponse.json({ ok: true, skipped: "already running" })

  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ ok: true, skipped: "supabase not configured" })
    }
    const sb = getSupabase()
    if (!sb) return NextResponse.json({ ok: true, skipped: "supabase not configured" })

    const today = todayJst()
    const targetMonth = prevMonth(today) // 請求対象 = 前月
    const results: Array<Record<string, unknown>> = []

    for (const [agencyName, rule] of Object.entries(INVOICE_DEADLINE_RULES)) {
      const deadline = nthBusinessDayOfMonth(today, rule.nthBusinessDay) // 当月の第n営業日
      if (!deadline) continue
      // 監視ウィンドウ: 月初〜期限+2日 (無限催促を避ける)。
      if (today > addCalendarDays(deadline, 2)) {
        results.push({ agency: agencyName, skipped: "outside window", deadline })
        continue
      }

      // 対象代理店が有効 (請求書払い・稼働中・非免除) か。
      const { data: ag } = await sb
        .from("agencies")
        .select("name, contact_email, payment_method, status, billing_exempt")
        .eq("name", agencyName)
        .maybeSingle()
      if (!ag || ag.payment_method !== "invoice" || ag.status !== "active" || ag.billing_exempt === true) {
        results.push({ agency: agencyName, skipped: "agency not billable" })
        continue
      }

      // 生成済みか (月次請求が ops へ送付＝invoice_sends 記録)。
      const { data: sentRow } = await sb
        .from("invoice_sends")
        .select("invoice_no")
        .eq("agency", agencyName)
        .eq("month", targetMonth)
        .maybeSingle()
      const generated = !!sentRow

      // 未生成なら、そもそも請求対象(発送実績)があるか確認。無ければ送る請求書が無いので何もしない。
      let itemCount: number | null = null
      if (!generated) {
        const built = await buildMonthlyInvoice(sb, agencyName, targetMonth)
        if (!built.ok || (built.itemCount ?? 0) === 0) {
          results.push({ agency: agencyName, skipped: `no invoice due (${built.reason ?? "0 items"})` })
          continue
        }
        itemCount = built.itemCount ?? 0
      }

      const over = today > deadline
      const onDeadline = today === deadline
      const remainBiz = businessDaysBetween(today, deadline) ?? 0
      const when = over ? "🚨【期限超過】" : onDeadline ? "⏰【本日締切】" : `⏰【あと${remainBiz}営業日】`
      const statusLine = generated
        ? `✅ 請求書は生成済みです（運用の「要確認・代理店へは未送付」メールにPDF添付）。確認のうえ ${ag.contact_email ?? "(代理店メール未登録)"} へご転送ください。`
        : `⚠️ 請求書がまだ生成されていません（${targetMonth}分・対象${itemCount}件）。月次請求の失敗の可能性があります。至急ご確認のうえ発行・送付してください。`

      const subject =
        `【BondEx】${agencyName} 請求書の発行期限 ${mmdd(deadline)}（${rule.article}）` +
        (over ? "｜期限超過" : onDeadline ? "｜本日締切" : "")

      const lines = [
        `${when} ${agencyName} への ${targetMonth} 分の請求書を、${mmdd(deadline)}（当月の第${rule.nthBusinessDay}営業日）までに発行・送付してください。`,
        `根拠: ${rule.article}（請求書発行の締切＝翌月第${rule.nthBusinessDay}営業日）。`,
        statusLine,
        `送付先: ${ag.contact_email ?? "(未登録)"}`,
      ]

      if (!opsAlertConfigured()) {
        results.push({ agency: agencyName, skipped: "alert channel not configured", deadline, generated })
        continue
      }
      const sent = await sendOpsAlert({ subject, lines, agencyEmail: null })
      results.push({ agency: agencyName, deadline, generated, over, remainBiz, notified: sent })
    }

    return NextResponse.json({ ok: true, today, targetMonth, results })
  } finally {
    await releaseCronLock("invoice-deadline")
  }
}
