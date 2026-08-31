/**
 * cron の二重起動防止ロック。
 *
 * 背景 (2026-08-31 監査): GitHub Actions の curl --max-time が Vercel 関数の
 * maxDuration より短く、処理が長引くと「失敗」と誤判定して自動リトライが走る。
 * 1本目がまだ実行中に2本目が起動すると、送り状の二重発行 (Ship&co は発行ごと課金) や
 * 通知の二重送信につながる。DB の一意制約を使った行ロックで2本目を即座に弾く。
 *
 * 使い方:
 *   const lock = await acquireCronLock("issue-due")
 *   if (!lock.ok) return NextResponse.json({ ok: true, skipped: "already running" })
 *   try { ... } finally { await releaseCronLock("issue-due") }
 */
import { getSupabase } from "./supabase"

/** これより古いロックは「前回が異常終了した残骸」とみなして乗っ取る。maxDuration(300s)より十分長く。 */
const STALE_MINUTES = 15

export async function acquireCronLock(
  name: string,
): Promise<{ ok: boolean; reason?: string }> {
  const sb = getSupabase()
  // DB が無い環境 (ローカル検証など) ではロックなしで通す。cron 本体側が
  // isSupabaseConfigured で早期 return するので実害はない。
  if (!sb) return { ok: true }

  // 1) まず素朴に insert。行が無ければこれwho取得成功。
  const ins = await sb.from("cron_locks").insert({ name, locked_at: new Date().toISOString() })
  if (!ins.error) return { ok: true }

  // 2) 既に行がある → stale (15分超) なら条件付き update で乗っ取る。
  //    条件付き update なので、並走する2本が同時に乗っ取ることはない (勝者は1本)。
  const staleBefore = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString()
  const upd = await sb
    .from("cron_locks")
    .update({ locked_at: new Date().toISOString() })
    .eq("name", name)
    .lt("locked_at", staleBefore)
    .select("name")
  if (upd.error) {
    // ロック機構自体の障害で cron を止めない (二重起動よりcron停止の方が実害大)。
    console.error("[cron-lock] acquire failed:", upd.error.message)
    return { ok: true }
  }
  if ((upd.data ?? []).length > 0) return { ok: true }
  return { ok: false, reason: "already running" }
}

export async function releaseCronLock(name: string): Promise<void> {
  const sb = getSupabase()
  if (!sb) return
  const { error } = await sb.from("cron_locks").delete().eq("name", name)
  if (error) console.error("[cron-lock] release failed:", error.message)
}
