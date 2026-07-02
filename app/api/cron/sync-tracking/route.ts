import { NextRequest, NextResponse } from "next/server"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
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
 * Ship&co の current_status.status (未確定の語彙) を BondEx の ShipmentStatus に
 * キーワードベースでゆるく対応付ける。マッチしなければ null (= 何もしない)。
 */
function mapTrackingStatus(raw: string): ShipmentStatus | null {
  const s = raw.toLowerCase()
  if (s.includes("deliver")) return "delivered"
  if (s.includes("transit") || s.includes("out_for_delivery") || s.includes("out for delivery")) {
    return "in_transit"
  }
  if (s.includes("picked_up") || s.includes("picked up") || s.includes("pickup_complete")) {
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
    .select("id, booking_id, leg_index, status, yamato_tracking")
    .not("yamato_tracking", "is", null)
    .not("status", "in", '("delivered","cancelled","failed")')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let checked = 0
  let updated = 0
  let skipped = 0
  const unmapped: Array<{ bookingId: string; leg: number; raw: string }> = []
  const failures: Array<{ bookingId: string; leg: number; reason: string }> = []

  for (const row of data ?? []) {
    const trackingNumbers = (row.yamato_tracking as string[] | null) ?? []
    if (trackingNumbers.length === 0) {
      skipped++
      continue
    }
    checked++

    // 複数口 (同一 leg に複数トラッキング番号) の場合は「最も進んでいない番号」を
    // その leg の代表ステータスとする — 1個でも未着なら全体は "配達中" 扱いが安全。
    let bestRank = -1
    let bestStatus: ShipmentStatus | null = null
    let sawUnmapped: string | null = null

    for (const num of trackingNumbers) {
      const tracking = await fetchYamatoTracking(token, num)
      const rawStatus = tracking?.current_status?.status
      if (!rawStatus) continue
      const mapped = mapTrackingStatus(rawStatus)
      if (!mapped) {
        sawUnmapped = rawStatus
        continue
      }
      const rank = progressionRank(mapped)
      // 初回 or より「手前」のステータスで上書き (=足並みを揃える)
      if (bestRank === -1 || rank < bestRank) {
        bestRank = rank
        bestStatus = mapped
      }
    }

    if (sawUnmapped) {
      unmapped.push({ bookingId: row.booking_id, leg: row.leg_index, raw: sawUnmapped })
      console.error(
        `[cron/sync-tracking] Unmapped Ship&co status "${sawUnmapped}" for ${row.booking_id}-L${row.leg_index + 1}`,
      )
    }

    if (!bestStatus) {
      skipped++
      continue
    }

    const currentRank = progressionRank(row.status as ShipmentStatus)
    // 後退は絶対にしない。現在より前進している場合のみ更新。
    if (bestRank <= currentRank) {
      skipped++
      continue
    }

    const { error: updateError } = await sb
      .from("shipments")
      .update({ status: bestStatus })
      .eq("id", row.id)

    if (updateError) {
      failures.push({ bookingId: row.booking_id, leg: row.leg_index, reason: updateError.message })
    } else {
      updated++
    }
  }

  return NextResponse.json({
    checked,
    updated,
    skipped,
    unmapped,
    failures,
  })
}
