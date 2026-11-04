/**
 * 未収による新しい予約の受付の停止（B2C_PHASE1A_BETA_PLAN.md 5章・B2C_MVP_SCHEMA_v1.md 9章）。
 *
 * 未回収の請求（失敗・本人認証待ち・回収不能）が B2C_UNPAID_MAX_COUNT 件（既定 2）以上、または合計が
 * B2C_UNPAID_MAX_YEN 円（既定 30,000・税込）以上の間は、新しい予約（下書きの作成）を受け付けない。
 * 止めるのは新規の受付だけ。既存の予約の確認・取消・集荷・請求・回収・通知は続ける。
 * 止めた時は運営に知らせる（1時間に 1回まで）。
 */
import { getSupabase } from "@/lib/supabase"
import { b2cOpsAlert } from "./notify"

function limit(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function b2cUnpaidLimits(): { maxCount: number; maxYen: number } {
  return { maxCount: limit("B2C_UNPAID_MAX_COUNT", 2), maxYen: limit("B2C_UNPAID_MAX_YEN", 30000) }
}

/** true = 止める、false = 受け付ける、"db_error" = DB に届かない（受け付けない） */
export async function b2cUnpaidPause(now: Date = new Date()): Promise<boolean | "db_error"> {
  const sb = getSupabase()
  if (!sb) return "db_error"
  const { data, error } = await sb.rpc("b2c_unpaid_summary", {})
  if (error) return "db_error"
  const s = (data ?? { count: 0, amount_yen: 0 }) as { count: number; amount_yen: number }
  const { maxCount, maxYen } = b2cUnpaidLimits()
  if (s.count < maxCount && s.amount_yen < maxYen) return false
  console.error(`[b2c] 新しい予約を止めています: 未収 ${s.count}件・合計 ${s.amount_yen}円（上限 ${maxCount}件・${maxYen}円）`)
  const { data: gate } = await sb.rpc("b2c_ops_alert_gate_try", { p_key: "b2c_booking_paused_unpaid", p_now: now.toISOString(), p_every: "60 minutes" })
  if (gate === true) {
    await b2cOpsAlert()({
      subject: `【B2C 受付の停止】未収 ${s.count}件・合計 ¥${s.amount_yen.toLocaleString("ja-JP")} のため、新しい予約を止めています`,
      lines: [`上限: ${maxCount}件 または 合計 ¥${maxYen.toLocaleString("ja-JP")}`, "既存の予約の集荷・請求・回収は続けています。", "→ 運営の画面（/operator/b2c）の「未収」を回収するか、回収不能の判断をすると受付が再開します。"],
      agencyEmail: null,
    }).catch(() => undefined)
  }
  return true
}
