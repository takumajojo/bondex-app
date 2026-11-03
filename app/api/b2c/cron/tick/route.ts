import { NextRequest, NextResponse } from "next/server"
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock"
import { b2cStripeConfig } from "@/lib/b2c/stripe"
import { expireStaleCardPending } from "@/lib/b2c/card-service"
import { enqueueB2cReminders, expireB2cConfirmationTimeouts, processB2cOutbox } from "@/lib/b2c/notify"

export const runtime = "nodejs"
export const maxDuration = 120

/**
 * POST /api/b2c/cron/tick — B2C の定期の処理（Stage 4）。数分おきに呼ぶ。Authorization: Bearer <CRON_SECRET>。
 * 1. カードの入力のまま 30分放置された予約の取消（枠を返す・Stripe の SetupIntent を先に取り消す）
 * 2. ホテルの確認の期限切れの取消（請求なし・旅行者に通知）
 * 3. 前日・当日の集荷のリマインドの積み込み
 * 4. 通知の送信（重複の防止・再試行）
 * B2C_SCHEDULER_ENABLED=true の時だけ動く（B2B の定期の処理とは別。二重起動は lib/cron-lock.ts で止める）。
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 })
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (process.env.B2C_SCHEDULER_ENABLED !== "true") return NextResponse.json({ ok: true, skipped: "scheduler disabled" })
  const lock = await acquireCronLock("b2c-tick")
  if (!lock.ok) return NextResponse.json({ ok: true, skipped: "already running" })
  try {
    const s = b2cStripeConfig()
    const cardExpiry = s.ok ? await expireStaleCardPending(s.config.stripe, new Date(), 20) : { expired: 0, finalized: 0, skipped: "stripe_not_configured" }
    const confirmationTimeouts = await expireB2cConfirmationTimeouts()
    const remindersQueued = await enqueueB2cReminders()
    const outbox = await processB2cOutbox()
    return NextResponse.json({ ok: true, cardExpiry, confirmationTimeouts, remindersQueued, outbox })
  } finally {
    await releaseCronLock("b2c-tick")
  }
}
