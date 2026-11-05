import { NextRequest, NextResponse } from "next/server"
import { isSupabaseConfigured } from "@/lib/supabase"
import { sendOpsAlert } from "@/lib/ops-alert"
import { checkHeartbeats, recordHeartbeat } from "@/lib/cron-heartbeat"
import { watchB2cCharges } from "@/lib/b2c/charge-watch"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 定期の処理の見張り（/api/cron/heartbeat-check・2026-11-05）。GitHub Actions が 1時間おきに呼ぶ（.github/workflows/cron-heartbeat.yml）。
 * pg_cron で動く処理（B2C の定期の処理・集荷依頼の監視）とは別の仕組みから呼ぶので、pg_cron が止まっても気づける。
 *   1. 定期の処理が止まった・失敗が続く → 運営に知らせる（lib/cron-heartbeat.ts）
 *   2. B2C の請求の見張り（結果不明・保留・予定を過ぎた・処理中で停止）も、ここで重ねて行う（lib/b2c/charge-watch.ts。
 *      B2C の定期の処理の中でも動く。門を共有するので、重ねても同じ知らせは 1回）
 *   3. 見張り自身の実行も記録する（GitHub Actions が止まったことを、pg_cron の側の処理〔集荷の監視・B2C の定期の処理〕が見つける）
 * 読むだけ（請求・送信の処理はしない）。問題があれば 503 を返し、GitHub Actions を失敗にする（メールが届かない時の 2つ目の知らせ）。
 * 認証は他の cron と同じ CRON_SECRET（Bearer）。
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 })
  if (req.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  const now = new Date()
  const errors: string[] = []
  const hb = await checkHeartbeats(sendOpsAlert, now).catch((e) => {
    errors.push(`heartbeat: ${e instanceof Error ? e.message.slice(0, 200) : "error"}`)
    return null
  })
  const charges =
    process.env.B2C_SCHEDULER_ENABLED === "true" || process.env.B2C_CHARGE_LIVE === "true"
      ? await watchB2cCharges(now, sendOpsAlert).catch((e) => {
          errors.push(`charges: ${e instanceof Error ? e.message.slice(0, 200) : "error"}`)
          return null
        })
      : { skipped: "b2c_off" }
  const problems = (hb?.problems.length ?? 0) > 0 || !!hb?.undeliverable || errors.length > 0
  // 見張り自身の記録（見張りが止まったことを pg_cron の側の処理が見つける: lib/cron-heartbeat.ts watcherJob）。
  // 見つけた問題があっても「見張りは動いた」ので成功として記録する。見張りの処理そのものが失敗した時だけ失敗
  await recordHeartbeat("heartbeat-check", errors.length === 0, errors.join(" / ") || undefined, now)
  return NextResponse.json(
    { ok: !problems, heartbeats: hb && { problems: hb.problems.map((p) => ({ name: p.name, kind: p.kind })), alerted: hb.alerted, suppressed: hb.suppressed, undeliverable: hb.undeliverable }, charges, errors },
    { status: problems ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  )
}
