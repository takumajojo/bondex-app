import { NextRequest, NextResponse } from "next/server"
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock"
import { getSupabase } from "@/lib/supabase"
import { sendOpsAlert } from "@/lib/ops-alert"
import { fetchSagawaLeadTimeLive } from "@/lib/sagawa-lead-time"

export const runtime = "nodejs"
export const maxDuration = 300

/**
 * 佐川 配達日数 (リードタイム) の定期再取得 cron。
 *
 * 佐川の営業所統廃合・輸送網の変更で日数が変わりうるため、fetched_at が30日より古い
 * 郵便番号ペア (sagawa_lead_times) を佐川「配達日数検索」へ再照会して更新する。
 *   - 1回あたり最大300件・1秒間隔・1本だけ (佐川サイトへ並列の大量照会をしない)。
 *     毎日回すと全 6,060 件が約20日で一巡する (= 30日以内に必ず更新される)。
 *   - 日数が変わった行は件数と例を sendOpsAlert で通知。営業所ペア表も同じ値で更新する。
 *   - parse_fail (佐川のページ構造の変更) は即アラートを出して打ち切る。
 *   - 既存の予約の到着日はさかのぼって書き換えない (この表を更新するだけ)。
 * 認証は他 cron と同じ CRON_SECRET。スケジュールは .github/workflows/sagawa-lead-times.yml。
 */

const BATCH = 300
const INTERVAL_MS = 1_000
const STALE_DAYS = 30
/** maxDuration (300s) 内に必ず終える。照会1件は最大8秒 (lib/sagawa-lead-time のタイムアウト)。 */
const TIME_BUDGET_MS = 240_000
/** 連続で照会に失敗したら佐川側の障害とみなして打ち切る */
const MAX_CONSECUTIVE_FAILURES = 10

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ ok: true, skipped: "supabase not configured" })
  const lock = await acquireCronLock("sagawa-lead-times")
  if (!lock.ok) return NextResponse.json({ ok: true, skipped: "already running" })
  const started = Date.now()
  try {
    const staleBefore = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString()
    const { data: rows, error } = await sb
      .from("sagawa_lead_times")
      .select("from_zip, to_zip, days")
      .lt("fetched_at", staleBefore)
      .order("fetched_at", { ascending: true })
      .limit(BATCH)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    let checked = 0
    let failed = 0
    let consecutiveFailures = 0
    const changed: Array<{ from: string; to: string; before: number; after: number }> = []
    let parseFail: { from: string; to: string } | null = null
    let stopReason = ""

    for (const row of rows ?? []) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        stopReason = "time budget"
        break
      }
      if (checked + failed > 0) await sleep(INTERVAL_MS)
      const live = await fetchSagawaLeadTimeLive(row.from_zip, row.to_zip)
      if (live?.error === "parse_fail") {
        parseFail = { from: row.from_zip, to: row.to_zip }
        stopReason = "parse_fail"
        break
      }
      if (!live || live.days === null) {
        failed++
        if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stopReason = "consecutive failures"
          break
        }
        continue
      }
      consecutiveFailures = 0
      checked++
      const now = new Date().toISOString()
      if (live.days !== row.days) {
        changed.push({ from: row.from_zip, to: row.to_zip, before: row.days, after: live.days })
      }
      const upd = await sb
        .from("sagawa_lead_times")
        .update({ days: live.days, from_office: live.fromOffice, to_office: live.toOffice, fetched_at: now })
        .eq("from_zip", row.from_zip)
        .eq("to_zip", row.to_zip)
      if (upd.error) console.error("[cron sagawa-lead-times] update failed", upd.error.message)
      if (live.fromOffice && live.toOffice) {
        const op = await sb.from("sagawa_office_lead_times").upsert({
          from_office: live.fromOffice,
          to_office: live.toOffice,
          days: live.days,
          sample_from_zip: row.from_zip,
          sample_to_zip: row.to_zip,
          fetched_at: now,
        })
        if (op.error) console.error("[cron sagawa-lead-times] office upsert failed", op.error.message)
      }
    }

    if (parseFail) {
      await sendOpsAlert({
        subject: "【要確認】佐川の配達日数ページの構造が変わった可能性があります",
        lines: [
          `佐川「配達日数検索」の結果から日数を読み取れませんでした (${parseFail.from} → ${parseFail.to})。`,
          "再取得を中断しました。lib/sagawa-lead-time.ts の parseSagawaDaysHtml を確認してください。",
          "予約・発行は止まりません (日数が分からない区間は従来どおり発送翌日以降を許可します)。",
        ],
        agencyEmail: null,
      })
    } else if (stopReason === "consecutive failures") {
      await sendOpsAlert({
        subject: "【要確認】佐川の配達日数の再取得が連続で失敗しました",
        lines: [
          `${MAX_CONSECUTIVE_FAILURES}件続けて佐川「配達日数検索」に接続できませんでした。今回の再取得を中断しました。`,
          "佐川サイトの障害であれば翌日の実行で自動的に再開します。",
        ],
        agencyEmail: null,
      })
    }
    if (changed.length > 0) {
      await sendOpsAlert({
        subject: `【お知らせ】佐川の配達日数が変わったルート ${changed.length}件`,
        lines: [
          "佐川「配達日数検索」の再取得で、配達日数が前回と変わったルートがありました。",
          "新しい予約の最短お届け日は自動で新しい日数になります (既存の予約は変更していません)。",
          "",
          ...changed.slice(0, 20).map((c) => `${c.from} → ${c.to}: +${c.before}日 → +${c.after}日`),
          ...(changed.length > 20 ? [`ほか ${changed.length - 20}件`] : []),
        ],
        agencyEmail: null,
      })
    }

    return NextResponse.json({
      ok: !parseFail,
      stale: rows?.length ?? 0,
      checked,
      failed,
      changed: changed.length,
      stopReason: stopReason || undefined,
      elapsedMs: Date.now() - started,
    })
  } finally {
    await releaseCronLock("sagawa-lead-times")
  }
}
