/**
 * 旅行者の予約（B2C）の確定・取消の後の、佐川の大口・重複集荷の集計し直し（2026-11-05）。
 *
 * - 大口集荷の検知のスイッチ（SAGAWA_BULK_ALERT_ENABLED）が OFF なら何もしない（今の動きのまま）。
 * - DB の確定・取消が成功した後にだけ呼ぶ（呼ぶ側の責任）。予約の DB の処理（トランザクション）の外で、応答を返した後に動く
 *   （next/server の after。要求の外で呼ばれた時は待たずに動かす）。予約の処理を待たせない・巻き戻さない。
 * - 集計し直しは全体の再計算（lib/sagawa-bulk/db.ts の recomputeSafe）で、何度動いても同じ結果。失敗は記録だけで、
 *   定時の集計（/api/cron/sagawa-bulk-alert）が正本として最後に正しい個数に戻す。
 */
import { after } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { sagawaBulkAlertEnabled } from "@/lib/sagawa-bulk/flag"
import { recomputeSafe } from "@/lib/sagawa-bulk/db"
import { jstToday } from "@/lib/pickup-cutoff"

/** 今すぐ集計し直す（スイッチが OFF なら何もしない）。試験と、after が使えない場面のため。 */
export async function recountBulkPickupsNow(sb: SupabaseClient, now: Date = new Date()): Promise<boolean> {
  if (!sagawaBulkAlertEnabled()) return false
  await recomputeSafe(sb, jstToday(now))
  return true
}

/** 応答を返した後に集計し直す（スイッチが OFF なら何もしない）。 */
export function scheduleBulkRecount(sb: SupabaseClient, reason: string): void {
  if (!sagawaBulkAlertEnabled()) return
  const task = async () => {
    try {
      await recountBulkPickupsNow(sb)
    } catch (e) {
      console.error(`[b2c/bulk-recount] ${reason}: 集計し直しに失敗（定時の集計で戻る）:`, e instanceof Error ? e.message : e)
    }
  }
  try {
    after(task)
  } catch {
    void task()
  }
}
