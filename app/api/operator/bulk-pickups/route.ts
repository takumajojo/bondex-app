import { NextRequest, NextResponse } from "next/server"
import { getSupabase } from "@/lib/supabase"
import { sagawaBulkAlertEnabled } from "@/lib/sagawa-bulk/flag"
import {
  recomputeBulkPickups,
  listBulkPickups,
  markBulkNotified,
  undoBulkNotified,
  dryRunBulkAlert,
} from "@/lib/sagawa-bulk/db"
import { urgencyOf } from "@/lib/sagawa-bulk/core"

export const runtime = "nodejs"

// 運用データ (集荷候補: ホテル名・個数・予約件数) を含むため、プレビュー応答は no-store で
// 中間/ブラウザキャッシュによる第三者露出を防ぐ。
const NO_STORE = { "Cache-Control": "no-store" } as const

/**
 * P1-B 大口集荷 Operator API。middleware で operator 認証済み (代理店には到達しない)。
 *   GET                  → 未対応の集荷単位一覧 (flag OFF なら enabled:false を返しUI非表示)
 *   GET ?id=<uuid>       → 1件の詳細 (メンバー履歴・イベント履歴・連絡時スナップショットとの差分)
 *   POST {action:recompute}        → 手動再集計 (正本は cron。Operator が今すぐ更新したいとき)
 *   POST {action:notify,  id, by?} → 佐川へ連絡済みにする (状態②。pickup_requested_at は触らない)
 *   POST {action:undo,    id, by?} → 連絡済みの取り消し
 */
function todayJstYmd(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  const enabled = sagawaBulkAlertEnabled()

  // 読み取り専用プレビュー (ドライラン): 検知フラグ OFF でも Operator 認証済みなら利用可。
  // 本番機能を一切有効化せずに、対象集荷単位・大口/重複件数・初回/再通知候補・宛先設定状況だけを確認する。
  // メール送信なし・送信済みフラグ/claim 変更なし・DB 書込なし (read 専用)。レスポンスの enabled で検知フラグ状態が分かる。
  if (req.nextUrl.searchParams.get("preview") === "1") {
    const sb = getSupabase()
    if (!sb) return NextResponse.json({ enabled, preview: null }, { headers: NO_STORE })
    const preview = await dryRunBulkAlert(sb, todayJstYmd())
    return NextResponse.json({ enabled, preview }, { headers: NO_STORE })
  }

  if (!enabled) return NextResponse.json({ enabled: false, groups: [] })
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ enabled, groups: [] })
  const today = todayJstYmd()

  const id = req.nextUrl.searchParams.get("id")

  if (id) {
    const { data: group } = await sb.from("sagawa_bulk_pickups").select("*").eq("id", id).maybeSingle()
    if (!group) return NextResponse.json({ error: "not found" }, { status: 404 })
    const { data: members } = await sb
      .from("sagawa_bulk_pickup_members").select("*").eq("group_id", id).order("added_at", { ascending: true })
    const { data: events } = await sb
      .from("sagawa_bulk_pickup_events").select("*").eq("group_id", id).order("created_at", { ascending: false })
    return NextResponse.json({ enabled, group, members: members ?? [], events: events ?? [] })
  }

  const rows = await listBulkPickups(sb, today)
  const groups = (rows as Record<string, unknown>[]).map((g) => ({
    ...g,
    urgency: urgencyOf(String(g.pickup_date), today),
  }))
  return NextResponse.json({ enabled, today, groups })
}

export async function POST(req: NextRequest) {
  if (!sagawaBulkAlertEnabled()) return NextResponse.json({ error: "feature disabled" }, { status: 409 })
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "supabase unavailable" }, { status: 500 })

  let body: { action?: unknown; id?: unknown; by?: unknown; method?: unknown; reply?: unknown }
  try { body = (await req.json()) as typeof body } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }) }
  const action = typeof body.action === "string" ? body.action : ""
  const id = typeof body.id === "string" ? body.id : ""
  const by = typeof body.by === "string" && body.by.trim() ? body.by.trim() : "operator"
  const method = typeof body.method === "string" ? body.method : null
  const reply = typeof body.reply === "string" ? body.reply : null

  if (action === "recompute") {
    const result = await recomputeBulkPickups(sb, todayJstYmd())
    return NextResponse.json({ ok: true, result })
  }
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
  if (action === "notify") {
    const r = await markBulkNotified(sb, id, by, { method, reply })
    return NextResponse.json(r, { status: r.ok ? 200 : 500 })
  }
  if (action === "undo") {
    const r = await undoBulkNotified(sb, id, by)
    return NextResponse.json(r, { status: r.ok ? 200 : 500 })
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
