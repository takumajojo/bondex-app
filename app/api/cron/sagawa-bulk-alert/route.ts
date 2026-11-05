import { NextRequest, NextResponse } from "next/server"
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { sendMail, mailerConfigured } from "@/lib/mailer"
import { opsRecipients } from "@/lib/ops-recipients"
import { sagawaBulkAlertEnabled, sagawaBulkEmailEnabled } from "@/lib/sagawa-bulk/flag"
import {
  recomputeBulkPickups,
  listBulkPickups,
  claimBulkNotify,
  recordBulkNotifyResult,
  dryRunBulkAlert,
} from "@/lib/sagawa-bulk/db"
import { notifyKeyOf, urgencyOf, type NotifyKind } from "@/lib/sagawa-bulk/core"
import { buildBulkAlertEmail } from "@/lib/sagawa-bulk/notify"

export const runtime = "nodejs"
export const maxDuration = 120

/**
 * P1-B 大口集荷アラート cron (/api/cron/sagawa-bulk-alert)。正本の検知経路。
 *  1) 現在の shipments から集荷単位を再集計 (冪等)。
 *  2) 未対応の集荷単位ごとに、初回/変更/前日/当日の通知を冪等に送る (条件付きクレーム+lease+Resendキー)。
 * feature flag は2段階 (いずれも既定 OFF):
 *   - SAGAWA_BULK_ALERT_ENABLED (検知): OFF の間は何もしない (副作用ゼロ)。ON で再集計・検知・Operator 表示。
 *   - SAGAWA_BULK_EMAIL_ENABLED (送信): 検知フラグと両方 ON のときだけメールを送る。検知のみ ON ではメールを送らない。
 * ?dryRun=1 : 再集計もメール送信もせず、現在の候補 (大口/重複/初回・再通知候補/宛先件数) を返すだけ (read 専用)。
 * 宛先は opsRecipients() = [ALERT_EMAIL, support@]。代理店・旅行者には送らない。
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`
}

function todayJstYmd(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  // 検知フラグ OFF の間は既存フローに一切触れない。
  if (!sagawaBulkAlertEnabled()) return NextResponse.json({ ok: true, skipped: "flag off" })

  // ドライラン: 再集計もメール送信もせず、候補と宛先設定状況を返すだけ (DB 書込・claim 変更なし)。
  if (req.nextUrl.searchParams.get("dryRun") === "1") {
    const sb = getSupabase()
    if (!sb) return NextResponse.json({ ok: true, dryRun: true, skipped: "supabase unavailable" })
    const preview = await dryRunBulkAlert(sb, todayJstYmd())
    return NextResponse.json({ ok: true, dryRun: true, preview })
  }

  const lock = await acquireCronLock("sagawa-bulk-alert")
  if (!lock.ok) return NextResponse.json({ ok: true, skipped: "already running" })

  try {
    if (!isSupabaseConfigured()) return NextResponse.json({ ok: true, skipped: "supabase not configured" })
    const sb = getSupabase()
    if (!sb) return NextResponse.json({ ok: true, skipped: "supabase unavailable" })

    const today = todayJstYmd()
    const recompute = await recomputeBulkPickups(sb, today)

    // 検知 (recompute) は検知フラグ ON で常に実行済み。メール送信は送信フラグも ON のときだけ。
    const emailEnabled = sagawaBulkEmailEnabled()
    const recipients = opsRecipients()
    const canEmail = mailerConfigured() && recipients.length > 0
    const groups = await listBulkPickups(sb, today)

    let sent = 0
    let skipped = 0
    let dupeOnly = 0
    let emailDisabled = 0
    const failures: string[] = []

    for (const raw of groups) {
      const g = raw as Record<string, unknown>
      const status = String(g.status)
      if (status === "notified") continue // 既に佐川へ連絡済み (状態②) → 通知不要
      // 重複のみ (大口20個未満) の集荷単位は佐川への大口事前連絡の対象外。
      // Operator ダッシュボードの注意喚起のみ (メールは送らない)。
      if (!g.is_bulk) { dupeOnly++; continue }
      // 送信フラグ OFF (検知のみ ON) ならメールを送らない。claim も触らない (ドライラン相当)。
      if (!emailEnabled) { emailDisabled++; continue }
      if (!canEmail) { skipped++; continue }

      const pickupDate = String(g.pickup_date)
      const urgency = urgencyOf(pickupDate, today)
      // 通知種別の決定: 変更あり→change / 当日→day / 前日→eve / それ以外(初回)→initial。
      let kind: NotifyKind
      if (status === "needs_reconfirm") kind = "change"
      else if (urgency === "today" || urgency === "overdue") kind = "day"
      else if (urgency === "tomorrow") kind = "eve"
      else kind = "initial"

      const nk = notifyKeyOf(String(g.hotel_key), pickupDate, String(g.member_hash), kind)
      const owner = globalThis.crypto.randomUUID()
      let claimed: boolean
      try {
        claimed = await claimBulkNotify(sb, String(g.id), nk, owner, Date.now())
      } catch (e) {
        failures.push(`claim ${g.id}: ${e instanceof Error ? e.message : e}`)
        continue
      }
      if (!claimed) { skipped++; continue } // 既送信(同一バージョン)/他プロセス送信中 = 重複防止

      const email = buildBulkAlertEmail({
        kind, pickupDate, hotelLabel: String(g.hotel_label ?? g.hotel_key),
        totalPieces: Number(g.total_pieces ?? 0), legCount: Number(g.leg_count ?? 0),
        agencyCount: Number(g.agency_count ?? 0), confident: Boolean(g.confident),
      })

      // 送信成功後にのみ sent 記録。Resend Idempotency-Key に不変キーを渡し、
      // 「送信成功→DB記録前にクラッシュ」窓でも同一キーで Resend 側が重複排除する。
      let allSent = true
      for (const to of recipients) {
        const r = await sendMail({
          to, subject: email.subject, text: email.lines.join("\n"),
          idempotencyKey: `${nk}:${to}`,
        })
        if (!r.sent) allSent = false
      }
      await recordBulkNotifyResult(sb, String(g.id), owner, allSent, allSent ? undefined : "一部/全ての宛先に送信失敗")
      if (allSent) sent++
      else failures.push(`send ${g.id}`)
    }

    return NextResponse.json({ ok: true, recompute, emailEnabled, notified: sent, skipped, dupeOnly, emailDisabled, failures })
  } finally {
    await releaseCronLock("sagawa-bulk-alert")
  }
}
