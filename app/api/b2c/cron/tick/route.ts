import { NextRequest, NextResponse } from "next/server"
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock"
import { getSupabase } from "@/lib/supabase"
import { b2cStripeConfig } from "@/lib/b2c/stripe"
import { expireStaleCardPending } from "@/lib/b2c/card-service"
import { b2cNotifyLive, b2cOpsAlert, enqueueB2cReminders, expireB2cConfirmationTimeouts, processB2cOutbox } from "@/lib/b2c/notify"
import { enqueueCollectionReminders, runB2cCharges } from "@/lib/b2c/charge-service"
import { reconcileB2cRefunds } from "@/lib/b2c/refund-service"
import { watchB2cCharges } from "@/lib/b2c/charge-watch"
import { checkHeartbeats, recordHeartbeat, watcherJob } from "@/lib/cron-heartbeat"

export const runtime = "nodejs"
export const maxDuration = 120

/**
 * POST /api/b2c/cron/tick — B2C の定期の処理（Stage 4）。数分おきに呼ぶ。Authorization: Bearer <CRON_SECRET>。
 * 1. カードの入力のまま 30分放置された予約の取消（枠を返す・Stripe の SetupIntent を先に取り消す）
 * 2. ホテルの確認の期限切れの取消（請求なし・旅行者に通知）
 * 3. 前日・当日の集荷のリマインドの積み込み
 * 4. 集荷の後の請求（Stage 5）: 結果が分からない請求の照合 → 30分を過ぎた請求（条件の再確認・B2C_CHARGE_LIVE の時だけ）、
 *    返金の照合、回収の案内（1日後・3日後・7日後）
 * 4b. 請求の見張り（結果不明・保留・予定を過ぎた・処理中で停止 → 運営に知らせる。読むだけ・lib/b2c/charge-watch.ts）
 * 5. 通知の送信（重要度の順・重複の防止・再試行・期限切れ・滞留の知らせ。時間の上限 50秒、残りは次回）
 * 1つの段階が失敗しても、残りの段階（特に通知の送信）は動かす。
 * B2C_SCHEDULER_ENABLED=true の時だけ動く（B2B の定期の処理とは別。二重起動は lib/cron-lock.ts で止める）。
 * 本番（B2C_NOTIFY_LIVE=true）で、運営に知らせるべきことがあるのに知らせる手段が無い時は 503（定期の処理の側で赤くする）。
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 })
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (process.env.B2C_SCHEDULER_ENABLED !== "true") return NextResponse.json({ ok: true, skipped: "scheduler disabled" })
  // DB に接続できない設定のまま「成功 (200)」を返さない。各段階は DB が無いと 0件として通るため、
  // pg_cron・見張りの側で失敗として見えるように 503 にする (2026-11-06 監査 B-07)
  if (!getSupabase()) return NextResponse.json({ ok: false, error: "db_unavailable" }, { status: 503 })
  const lock = await acquireCronLock("b2c-tick")
  if (!lock.ok) return NextResponse.json({ ok: true, skipped: "already running" })
  const errors: string[] = []
  const step = async <T,>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn()
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message.slice(0, 200) : "error"}`)
      console.error(`[b2c-tick] ${name} failed`, e)
      return null
    }
  }
  try {
    const cardExpiry = await step("card_expiry", async () => {
      const s = b2cStripeConfig()
      return s.ok ? expireStaleCardPending(s.config.stripe, new Date(), 20) : { expired: 0, finalized: 0, skipped: "stripe_not_configured" }
    })
    const confirmationTimeouts = await step("confirmation_timeouts", () => expireB2cConfirmationTimeouts())
    const remindersQueued = await step("reminders", () => enqueueB2cReminders())
    const charges = await step("charges", async () => {
      const s = b2cStripeConfig()
      return s.ok ? runB2cCharges(s.config.stripe, new Date()) : { skipped: "stripe_not_configured" }
    })
    const refunds = await step("refunds", async () => {
      const s = b2cStripeConfig()
      return s.ok ? reconcileB2cRefunds(s.config.stripe, new Date()) : 0
    })
    const collection = await step("collection_reminders", () => enqueueCollectionReminders())
    const chargeWatch = await step("charge_watch", () => watchB2cCharges(new Date()))
    // 見張りの見張り（GitHub Actions の見張りが止まっていないか。集荷の監視と同じ門なので重ねても 1回）。失敗は本来の処理の失敗に数えない
    const watcher = await checkHeartbeats(b2cOpsAlert(), new Date(), [watcherJob()])
      .then((r) => ({ problems: r.problems.length, alerted: r.alerted }))
      .catch((e: unknown) => ({ note: e instanceof Error ? e.message : String(e) }))
    const outbox = await step("outbox", () => processB2cOutbox())
    const alertUndeliverable = b2cNotifyLive() && !!outbox?.health?.undeliverable
    // 最後の実行の記録（止まった・失敗が続くことを別の仕組みで見つける: /api/cron/heartbeat-check）
    await recordHeartbeat("b2c-tick", errors.length === 0 && !alertUndeliverable, errors.join(" / ") || (alertUndeliverable ? "ops_alert_undeliverable" : undefined))
    return NextResponse.json(
      { ok: errors.length === 0 && !alertUndeliverable, cardExpiry, confirmationTimeouts, remindersQueued, charges, refunds, collection, chargeWatch, watcher, outbox, errors, alertUndeliverable },
      { status: alertUndeliverable ? 503 : errors.length ? 500 : 200 },
    )
  } finally {
    await releaseCronLock("b2c-tick")
  }
}
