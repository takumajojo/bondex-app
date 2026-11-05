import { NextRequest, NextResponse } from "next/server"
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { sendOpsAlert } from "@/lib/ops-alert"
import { alertStaleSending, alertEveningPickupGaps } from "@/lib/pickup-request/watch"
import { alertPickupMisses } from "@/lib/pickup-request/pickup-miss"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 集荷依頼の監視ジョブ (/api/cron/pickup-watch)。2026-11-04 谷口さん指示で追跡の定時処理 (sync-tracking) から分離。
 * 佐川の追跡 API・Ship&co が止まっていても独立して動く。追跡・課金・通知 (配送) の処理には触れない。
 *   1. 送信中のまま止まった集荷依頼 (5分超) → 1件ごとに1回だけ通知 (pickup_requests.stale_alerted_at)
 *   2. 19:00〜21:59: 明日集荷の未依頼・送信失敗・結果不明・要確認 → 締め前・締め超過にそれぞれ1回 (sql/075)
 *   3. 未集荷（集荷日の 18:00 以降・過去の集荷日）→ 区間ごとに1回 (G19。追跡の定時処理と共通の lib/pickup-request/pickup-miss.ts)
 * 自動では送信も再送もしない。定時実行は pg_cron (sql/ops/pickup_watch_cron.sql・10分おき)。
 * 認証は他の cron と同じ CRON_SECRET (Bearer)。?probe=1 は通知の到達確認だけ (監視はしない)。
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 })
  if (req.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  const sb = getSupabase()!

  // 通知の到達確認 (本番移行の手順): ?probe=1 で確認用の通知を1通だけ送り、届いた経路を返す。監視はしない。
  if (req.nextUrl.searchParams.get("probe") === "1") {
    const r = await sendOpsAlert({
      subject: "【確認】集荷依頼の監視ジョブの通知テスト",
      lines: ["本番移行の確認のための通知です。対応は不要です。", `送信時刻: ${new Date().toISOString()}`],
    })
    return NextResponse.json({ ok: r.emailSent || r.slackSent, probe: true, emailSent: r.emailSent, slackSent: r.slackSent, errors: r.errors }, { status: r.emailSent || r.slackSent ? 200 : 502 })
  }

  // 同時に2つ動かない (pg_cron と手動実行が重なっても通知は重ならないが、無駄な照会を避ける)
  const lock = await acquireCronLock("pickup-watch")
  if (!lock.ok) return NextResponse.json({ ok: true, skipped: "already_running" })
  // メールも Slack も届かなかったら失敗として扱う (監視側が「通知済み」の記録を戻して次の回に送り直す)
  const alert = async (i: Parameters<typeof sendOpsAlert>[0]) => {
    const r = await sendOpsAlert(i)
    if (!r.emailSent && !r.slackSent) throw new Error(r.errors.join("; ") || "通知の送り先が設定されていません")
  }
  const result: Record<string, unknown> = {}
  try {
    // 片方が失敗しても、もう片方は行う
    result.staleSending = await alertStaleSending(sb, alert).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
    result.evening = await alertEveningPickupGaps(sb, alert).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
    // 未集荷（集荷漏れの可能性）: 追跡を止めていても通知する（G19。区間ごとに 1回だけ・lib/pickup-request/pickup-miss.ts）
    result.pickupMiss = await alertPickupMisses(sb, sendOpsAlert).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
  } finally {
    await releaseCronLock("pickup-watch")
  }
  const failed = Object.values(result).some((r) => r && typeof r === "object" && "error" in r)
  return NextResponse.json({ ok: !failed, ...result }, { status: failed ? 500 : 200 })
}
