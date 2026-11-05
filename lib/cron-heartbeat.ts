/**
 * 定期の処理の最後の実行の記録と、止まった・失敗が続く時の見張り（2026-11-05・sql/080_cron_heartbeats.sql）。
 *
 * - recordHeartbeat: 各定期の処理の最後に呼ぶ。記録に失敗しても例外を出さない（本来の処理を止めない）。
 * - checkHeartbeats: 見張り（/api/cron/heartbeat-check）から呼ぶ。見張りは GitHub Actions が 1時間おきに呼ぶので、
 *   pg_cron・Vercel の定期の処理とは別の仕組みで動く。止まった・失敗が続く処理を運営に知らせる（同じ処理は 1時間に 1回まで）。
 */
import { getSupabase } from "@/lib/supabase"
import type { B2cAlertFn } from "@/lib/b2c/notify"

export async function recordHeartbeat(name: string, ok: boolean, error?: string, now: Date = new Date()): Promise<void> {
  try {
    const sb = getSupabase()
    if (!sb) return
    const { error: e } = await sb.rpc("cron_heartbeat_record", { p_name: name, p_ok: ok, p_error: error ?? null, p_now: now.toISOString() })
    if (e) console.error(`[cron-heartbeat] ${name} not recorded: ${e.message}`)
  } catch (e) {
    console.error(`[cron-heartbeat] ${name} not recorded`, e)
  }
}

export interface WatchedJob {
  name: string
  /** 最後の成功からこの分を過ぎたら「止まった」 */
  staleMin: number
  /** 失敗がこの回数続いたら知らせる */
  maxFailures: number
  /** 見張る時間帯か（例: 夜間に止める処理は、その間は見ない）。既定はいつも */
  activeAt?: (now: Date) => boolean
  /** 見張る条件（例: スイッチが ON の時だけ） */
  enabled?: () => boolean
  label: string
}

const jstHour = (d: Date) => new Date(d.getTime() + 9 * 3600_000).getUTCHours()

/** 見張る処理（pg_cron の登録と合わせる: sql/ops/pickup_watch_cron.sql・B2C は B6 で登録） */
export function watchedJobs(): WatchedJob[] {
  return [
    {
      name: "b2c-tick",
      label: "B2C の定期の処理（/api/b2c/cron/tick: 請求・照合・通知の送信）",
      staleMin: Number(process.env.B2C_TICK_STALE_MIN ?? 30),
      maxFailures: 3,
      enabled: () => process.env.B2C_SCHEDULER_ENABLED === "true",
    },
    {
      name: "pickup-watch",
      label: "集荷依頼の監視（/api/cron/pickup-watch: 未集荷・依頼漏れ）",
      staleMin: 40,
      maxFailures: 3,
      // pg_cron は 8:00〜22:59 JST の 10分おき。始まりの直後は見ない
      activeAt: (now) => jstHour(now) >= 9 && jstHour(now) <= 22,
    },
  ]
}

export interface HeartbeatProblem {
  name: string
  label: string
  kind: "never_ran" | "stale" | "failing"
  detail: string
}

const fmtJst = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ") + " JST" : "記録なし")

/** 止まった・失敗が続く処理の一覧（読むだけ）。DB を読めない時は例外（見張りは 503 で GitHub 側を赤くする）。 */
export async function findHeartbeatProblems(now: Date = new Date(), jobs: WatchedJob[] = watchedJobs()): Promise<HeartbeatProblem[]> {
  const sb = getSupabase()
  if (!sb) throw new Error("db_unavailable")
  const { data, error } = await sb.from("cron_heartbeats").select("name, last_started_at, last_ok_at, last_error_at, last_error, consecutive_failures")
  if (error) throw new Error(`heartbeat_read: ${error.message}`)
  const byName = new Map((data ?? []).map((r) => [r.name as string, r]))
  const out: HeartbeatProblem[] = []
  for (const j of jobs) {
    if (j.enabled && !j.enabled()) continue
    if (j.activeAt && !j.activeAt(now)) continue
    const r = byName.get(j.name)
    if (!r) {
      out.push({ name: j.name, label: j.label, kind: "never_ran", detail: "実行の記録がありません（定期の処理が登録されていないか、一度も動いていません）" })
      continue
    }
    const lastOk = r.last_ok_at ? new Date(r.last_ok_at as string).getTime() : 0
    if ((r.consecutive_failures as number) >= j.maxFailures) {
      out.push({ name: j.name, label: j.label, kind: "failing", detail: `${r.consecutive_failures}回続けて失敗しています（最後の失敗 ${fmtJst(r.last_error_at as string)}: ${String(r.last_error ?? "").slice(0, 160)}）` })
    } else if (now.getTime() - lastOk > j.staleMin * 60_000) {
      out.push({ name: j.name, label: j.label, kind: "stale", detail: `最後の成功 ${fmtJst(r.last_ok_at as string | null)}・最後の開始 ${fmtJst(r.last_started_at as string | null)}（${j.staleMin}分を超えて成功がありません）` })
    }
  }
  return out
}

export interface HeartbeatCheckResult {
  problems: HeartbeatProblem[]
  alerted: number
  suppressed: number
  undeliverable: boolean
}

/** 止まった・失敗が続く処理を運営に知らせる（同じ処理・同じ種類は 1時間に 1回。送れなかった時は門を戻す）。 */
export async function checkHeartbeats(alert: B2cAlertFn, now: Date = new Date(), jobs?: WatchedJob[]): Promise<HeartbeatCheckResult> {
  const sb = getSupabase()
  if (!sb) throw new Error("db_unavailable")
  const problems = await findHeartbeatProblems(now, jobs)
  const out: HeartbeatCheckResult = { problems, alerted: 0, suppressed: 0, undeliverable: false }
  const claimed: HeartbeatProblem[] = []
  for (const p of problems) {
    const { data: gate, error } = await sb.rpc("b2c_ops_alert_gate_try", { p_key: `cron:${p.name}:${p.kind}`, p_now: now.toISOString(), p_every: "60 minutes" })
    if (error) throw new Error(`heartbeat_gate: ${error.message}`)
    if (gate === true) claimed.push(p)
    else out.suppressed++
  }
  if (!claimed.length) return out
  const lines = [`検知の時刻: ${fmtJst(now.toISOString())}`]
  for (const p of claimed) lines.push("", `■ ${p.label}`, `  ${p.detail}`)
  lines.push(
    "",
    "→ 対応: pg_cron の登録（select * from cron.job）・Supabase の Vault の cron_secret・Vercel の応答（500・503）を確かめてください。",
    "  止まっている間の請求・通知は、再開した最初の回でまとめて処理されます（自動で新しい請求は作りません）。手順書 docs/release/b2c_ops_runbook.md の 11。",
    "",
    "運営の画面: https://bondex.express/operator/b2c",
  )
  let r: Awaited<ReturnType<B2cAlertFn>>
  try {
    r = await alert({ subject: `【監視】定期の処理が止まっているか、失敗が続いています（${claimed.map((p) => p.name).join("・")}）`, lines, agencyEmail: null })
  } catch (e) {
    console.error("[cron-heartbeat] alert result unknown", e)
    out.alerted = claimed.length // 送ったか分からない: 門は戻さない
    return out
  }
  if (r.emailSent || r.slackSent || (r as { sandbox?: boolean }).sandbox === true) {
    out.alerted = claimed.length
    return out
  }
  for (const p of claimed) {
    await sb.from("b2c_ops_alert_gate").update({ last_sent_at: "1970-01-01T00:00:00Z" }).eq("alert_key", `cron:${p.name}:${p.kind}`).eq("last_sent_at", now.toISOString())
  }
  out.undeliverable = true
  return out
}
