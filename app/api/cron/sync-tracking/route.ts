import { NextRequest, NextResponse } from "next/server"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { sendOpsAlert } from "@/lib/ops-alert"
import type { ShipmentStatus } from "@/lib/shipments-db"

export const runtime = "nodejs"
// Hobby プランでも Fluid Compute 有効なら 300s (5分) まで許可される
// (公式ドキュメント確認済み, 2026-07-02). 個々の Ship&co 呼び出しには
// 別途 10s のタイムアウトを設けているので、ここは安全マージンとして最大値を確保。
export const maxDuration = 300

/**
 * Vercel Cron から定期実行: Ship&co の GET トラッキング API をポーリングして
 * shipments.status を実際のヤマト配送状況に同期する.
 *
 * Ship&co の Webhook (tracking.updated) は現時点で FedEx のみ対応・ヤマトは
 * 非対応 (公式ドキュメント確認済み, 2026-07-02) なので push 通知は使えず、
 * ポーリング方式を採用している。
 *
 * 公開エンドポイントとして Vercel 上に存在するため、Vercel Cron の
 * `Authorization: Bearer $CRON_SECRET` ヘッダーで認証する
 * (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 *
 * 対象: status が終端状態 (delivered/cancelled/failed) ではなく、
 *       yamato_tracking に追跡番号が入っている shipment のみ。
 *
 * ステータスマッピングについて:
 *   Ship&co の current_status.status に入る正確な文字列の一覧は
 *   公式ドキュメントに明記されておらず (2026-07-02 時点で "transit" の例のみ)、
 *   本番の実キーでもローカルから検証できなかった (.env はプレースホルダーのみ)。
 *   そのため exact-match ではなくキーワードベースの寛容なマッチングを行い、
 *   「配達完了 / 配送中 / 集荷済」の順当な前進のみを自動反映する。
 *   未知のステータス文字列は握りつぶさず console.error に出し、レスポンスの
 *   `unmapped` にも積む — Vercel のログから実際の値を拾って、後日
 *   STATUS_KEYWORD_MAP を精緻化できるようにするため。
 *   失敗・返送等のネガティブ系ステータスは誤検知のリスクが高いため自動反映せず、
 *   人間の operator 判断に委ねる (dashboard の手動ステータス変更は従来通り有効).
 */

const SHIPANDCO_BASE = "https://api.shipandco.com/v1"

// 前進方向のみを許可する順序。この配列に無いステータス (pending/failed/cancelled) は
// 「Ship&co ポーリングでは触らない」ことを意味する。
const PROGRESSION: ShipmentStatus[] = ["issued", "picked_up", "in_transit", "delivered"]

function progressionRank(status: ShipmentStatus): number {
  const i = PROGRESSION.indexOf(status)
  return i === -1 ? -1 : i
}

/**
 * 異常系ステータスの検知。ヤマト公式 FAQ (a_id/3887) の語彙 + 想定される
 * 英語正規化の両方をカバーする。検知したら status は進めず、BondEx と
 * ランドオペレーターへアラートを送る (自動で failed 等にはしない —
 * 最終判断は人間に委ねる)。
 *
 * ヤマト側の異常系語彙 (公式 FAQ より):
 *   遅延中（〇〇） / 調査中 / 持戻（〇〇） / 返品 / 返品完了 /
 *   輸送経路修正 / 伝票番号誤り / 伝票番号未登録
 */
const EXCEPTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /遅延|delay/i, label: "遅延中 (delayed)" },
  { pattern: /調査|investigat/i, label: "調査中 (under investigation)" },
  { pattern: /持戻|bring.?back|attempt.*fail|absence/i, label: "持戻 (delivery attempted / brought back)" },
  { pattern: /返品|return/i, label: "返品 (being returned)" },
  { pattern: /経路修正|reroute|misroute|wrong.?route/i, label: "輸送経路修正 (rerouted)" },
  { pattern: /伝票番号誤り|伝票番号未登録|not.?found|invalid.*number|unregistered/i, label: "伝票番号エラー (tracking number issue)" },
  { pattern: /exception|hold.*exception|failed/i, label: "exception (carrier-reported problem)" },
]

function detectException(raw: string): string | null {
  for (const { pattern, label } of EXCEPTION_PATTERNS) {
    if (pattern.test(raw)) return label
  }
  return null
}

/**
 * Ship&co の current_status.status を BondEx の ShipmentStatus に対応付ける。
 *
 * ヤマト公式 FAQ の全ステータス語彙 (日本語) と、Ship&co が英語正規化して
 * 返す場合の両方をカバーする。判定順序が重要:
 *   1. まず異常系 (呼び出し元で detectException を先に評価すること)
 *   2. 「配達完了」系 — ただし "out for delivery" (持ち出し中 = 配達中) が
 *      "deliver" を含むため、配達中系を先に判定しないと誤って delivered に
 *      マップされる (実際に初期実装にあったバグ)
 *   3. 配達中・輸送中系
 *   4. 集荷・発送済み系
 *
 * マッチしなければ null (= 何もしない・unmapped としてログに残す)。
 */
function mapTrackingStatus(raw: string): ShipmentStatus | null {
  const s = raw.toLowerCase()

  // -- 配達中 (out for delivery) を「完了」より先に判定する --
  if (
    s.includes("out_for_delivery") ||
    s.includes("out for delivery") ||
    s.includes("配達中") ||
    s.includes("持ち出し")
  ) {
    return "in_transit"
  }

  // -- 配達完了系 --
  if (s.includes("配達完了") || /deliver/.test(s)) return "delivered"

  // -- 輸送中系 (ヤマト語彙: 輸送中 / 作業店通過 / 配達店到着 / 配達準備中 /
  //    転送 / 保管中系は「持ち出し前の正常な中間状態」として扱う) --
  if (
    s.includes("transit") ||
    s.includes("輸送中") ||
    s.includes("作業店通過") ||
    s.includes("配達店到着") ||
    s.includes("配達準備") ||
    s.includes("転送") ||
    s.includes("保管") ||
    s.includes("hold") ||
    s.includes("stored")
  ) {
    return "in_transit"
  }

  // -- 集荷・発送済み系 (ヤマト語彙: 荷物受付 / 発送済み) --
  if (
    s.includes("picked_up") ||
    s.includes("picked up") ||
    s.includes("pickup_complete") ||
    s.includes("荷物受付") ||
    s.includes("発送済")
  ) {
    return "picked_up"
  }

  return null
}

interface TrackingCurrentStatus {
  date?: string
  status?: string
  details?: string[]
  location?: string
}

interface TrackingResponse {
  current_status?: TrackingCurrentStatus
}

const SHIPANDCO_TIMEOUT_MS = 10_000

/**
 * 1件の Ship&co 呼び出しがハングすると batch 全体が maxDuration まで
 * ブロックされてしまうため、個別に AbortController でタイムアウトを切る。
 */
async function fetchYamatoTracking(
  token: string,
  trackingNumber: string,
): Promise<TrackingResponse | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SHIPANDCO_TIMEOUT_MS)
  try {
    const res = await fetch(
      `${SHIPANDCO_BASE}/tracking/yamato/${encodeURIComponent(trackingNumber)}`,
      {
        headers: { "x-access-token": token, "Content-Type": "application/json" },
        signal: controller.signal,
      },
    )
    if (!res.ok) {
      console.error(
        `[cron/sync-tracking] Ship&co tracking HTTP ${res.status} for ${trackingNumber}`,
      )
      return null
    }
    return (await res.json()) as TrackingResponse
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[cron/sync-tracking] Ship&co call failed for ${trackingNumber}: ${reason}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 単純な同時実行数制限つき map。
 *
 * 直列 (for...await) だと、1 leg に 5 個口 × 13 shipments のような実データでは
 * 合計 30〜40 回の Ship&co 呼び出しが積み重なり、1 件 10s のタイムアウトでも
 * 最悪 300〜400s になって関数がタイムアウトする (実際にこれで 2 回失敗した)。
 * かといって全部同時に投げると Ship&co 側のレート制限に引っかかる恐れがあるため、
 * 同時実行数を CONCURRENCY 件に制限しつつ並列化する。
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (true) {
      const i = nextIndex++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

const CONCURRENCY = 6

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 })
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const token = process.env.SHIPANDCO_API_KEY
  if (!token) {
    return NextResponse.json({ error: "SHIPANDCO_API_KEY not configured" }, { status: 503 })
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  }
  const sb = getSupabase()
  if (!sb) {
    return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })
  }

  const { data, error } = await sb
    .from("shipments")
    .select("id, booking_id, leg_index, agency, status, yamato_tracking, yamato_tracking_detail")
    .not("yamato_tracking", "is", null)
    .not("status", "in", '("delivered","cancelled","failed")')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ランドオペレーター通知用: 代理店名 → contact_email の対応表を 1 回で引く
  const agencyEmailByName = new Map<string, string>()
  {
    const { data: agencies } = await sb.from("agencies").select("name, contact_email")
    for (const a of agencies ?? []) {
      if (a.name && a.contact_email) agencyEmailByName.set(a.name, a.contact_email)
    }
  }

  const rows = (data ?? []).filter(
    (row) => ((row.yamato_tracking as string[] | null) ?? []).length > 0,
  )
  const skippedNoTracking = (data?.length ?? 0) - rows.length

  // Step 1: 全 shipment × 全追跡番号をフラットなタスク一覧にして、まとめて並列取得。
  // 「1 leg 内で直列」ではなく「全体で並列」にすることで、leg 数や口数に関わらず
  // 総所要時間が ceil(タスク総数 / CONCURRENCY) × 平均レイテンシ に収まる。
  type Task = { rowIndex: number; trackingNumber: string }
  const tasks: Task[] = []
  rows.forEach((row, rowIndex) => {
    const trackingNumbers = (row.yamato_tracking as string[] | null) ?? []
    trackingNumbers.forEach((num) => tasks.push({ rowIndex, trackingNumber: num }))
  })

  const checkedAt = new Date().toISOString()

  const taskResults = await mapWithConcurrency(tasks, CONCURRENCY, async (task) => {
    const tracking = await fetchYamatoTracking(token, task.trackingNumber)
    return { ...task, current: tracking?.current_status }
  })

  // Step 2: rowIndex ごとにグルーピングして、(a) leg の代表ステータス、
  // (b) 追跡番号ごとの詳細 (現在地・日時) を組み立てる。
  // 代表ステータスは複数口のうち「最も進んでいない番号」を採用 — 1個でも
  // 未着なら leg 全体は "配達中" 扱いが安全。詳細の方は個数分すべて保持する
  // (公開トラッキングページで各番号を個別に表示するため).
  let updated = 0
  let detailUpdated = 0
  let skipped = skippedNoTracking
  const unmapped: Array<{ bookingId: string; leg: number; raw: string }> = []
  const failures: Array<{ bookingId: string; leg: number; reason: string }> = []
  const alertsSent: Array<{ bookingId: string; leg: number; exception: string }> = []

  interface PrevDetail {
    number: string
    alertedException?: string
  }

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]
    const resultsForRow = taskResults.filter((r) => r.rowIndex === rowIndex)

    // 前回 cron が保存した「通知済み異常」を番号単位で引き継ぐ —
    // 同じ遅延に対して毎時アラートを打ち続けないための重複防止。
    const prevAlerted = new Map<string, string>()
    for (const d of (row.yamato_tracking_detail as PrevDetail[] | null) ?? []) {
      if (d.alertedException) prevAlerted.set(d.number, d.alertedException)
    }

    let bestRank = -1
    let bestStatus: ShipmentStatus | null = null
    let sawUnmapped: string | null = null
    let anySuccess = false
    const newExceptions: Array<{ number: string; label: string; raw: string; location?: string }> = []

    const detail = resultsForRow.map((r) => {
      const rawStatus = r.current?.status
      if (!rawStatus) {
        return { number: r.trackingNumber, checkedAt, alertedException: prevAlerted.get(r.trackingNumber) }
      }
      anySuccess = true

      // 異常系を最優先で判定 — 異常中は status の前進判定に使わない
      const exception = detectException(rawStatus)
      if (exception) {
        const alreadyAlerted = prevAlerted.get(r.trackingNumber) === exception
        if (!alreadyAlerted) {
          newExceptions.push({
            number: r.trackingNumber,
            label: exception,
            raw: rawStatus,
            location: r.current?.location,
          })
        }
        return {
          number: r.trackingNumber,
          status: null,
          rawStatus,
          exception,
          alertedException: exception,
          location: r.current?.location,
          date: r.current?.date,
          checkedAt,
        }
      }

      const mapped = mapTrackingStatus(rawStatus)
      if (mapped) {
        const rank = progressionRank(mapped)
        if (bestRank === -1 || rank < bestRank) {
          bestRank = rank
          bestStatus = mapped
        }
      } else {
        sawUnmapped = rawStatus
      }
      return {
        number: r.trackingNumber,
        status: mapped,
        rawStatus,
        location: r.current?.location,
        date: r.current?.date,
        checkedAt,
      }
    })

    // 新規の異常があれば BondEx + ランドオペレーターへ即時通知
    if (newExceptions.length > 0) {
      const agencyEmail = agencyEmailByName.get(row.agency as string) ?? null
      const legLabel = `${row.booking_id}-L${(row.leg_index as number) + 1}`
      await sendOpsAlert({
        subject: `【要確認】配送異常を検知 — ${legLabel}`,
        lines: [
          `予約: ${legLabel} (代理店: ${row.agency})`,
          ...newExceptions.map(
            (e) =>
              `追跡番号 ${e.number}: ${e.label} — ヤマト側表示「${e.raw}」${e.location ? ` @ ${e.location}` : ""}`,
          ),
          `ダッシュボード: https://bondex.express/operator/dashboard`,
          `お客様向け: https://bondex.express/track/${row.booking_id}`,
        ],
        agencyEmail,
      })
      for (const e of newExceptions) {
        alertsSent.push({ bookingId: row.booking_id, leg: row.leg_index, exception: e.label })
      }
    }

    if (sawUnmapped) {
      unmapped.push({ bookingId: row.booking_id, leg: row.leg_index, raw: sawUnmapped })
      console.error(
        `[cron/sync-tracking] Unmapped Ship&co status "${sawUnmapped}" for ${row.booking_id}-L${row.leg_index + 1}`,
      )
    }

    // Ship&co 側が今回まるごと応答しなかった場合 (全滅) は、既存の
    // yamato_tracking_detail を空で上書きしない — 一時的な障害で
    // 「今どこにあるか」の情報を消してしまわないため。
    const updatePayload: Record<string, unknown> = {}
    if (anySuccess) {
      updatePayload.yamato_tracking_detail = detail
    }

    const currentRank = progressionRank(row.status as ShipmentStatus)
    // 後退は絶対にしない。現在より前進している場合のみ status を更新。
    const statusAdvances = bestStatus !== null && bestRank > currentRank
    if (statusAdvances) {
      updatePayload.status = bestStatus
    }

    if (Object.keys(updatePayload).length === 0) {
      skipped++
      continue
    }

    const { error: updateError } = await sb
      .from("shipments")
      .update(updatePayload)
      .eq("id", row.id)

    if (updateError) {
      failures.push({ bookingId: row.booking_id, leg: row.leg_index, reason: updateError.message })
      continue
    }
    if (statusAdvances) updated++
    if (anySuccess) detailUpdated++
    if (!statusAdvances && !anySuccess) skipped++
  }

  return NextResponse.json({
    checked: rows.length,
    tasksRun: tasks.length,
    updated,
    detailUpdated,
    skipped,
    unmapped,
    alertsSent,
    failures,
  })
}
