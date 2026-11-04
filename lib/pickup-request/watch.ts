// 「送信中」のまま止まった集荷依頼の検知 (2026-11-03 監査 P1-4)。
// Biz-Logi へ送っている最中にサーバの処理が止まると (時間上限・障害)、記録は sending のまま残る。
// 二重依頼は起きない (有効な依頼として残るため再送できない) が、そのままでは誰も気づかない。
// 追跡の定時処理 (8:00〜21:30・30分ごと) の冒頭で呼び、該当があれば1回だけ運用へ通知する。
// 自動では解放も再送もしない。運営が佐川へ確認して記録する。

import type { SupabaseClient } from "@supabase/supabase-js"
import type { OpsAlertInput } from "@/lib/ops-alert"
import { STALE_SENDING_MS } from "./state"
import { isPickupTableMissing } from "./store"
import { loadPickupTodo, type PickupAttentionTask, type SagawaPickupTask } from "./todo"

export async function alertStaleSending(
  sb: SupabaseClient,
  alert: (input: OpsAlertInput) => Promise<unknown>,
  now: Date = new Date(),
): Promise<{ alerted: number; note: string }> {
  // 経過時間はここで判定する (DB 側の比較演算に頼らない。送信中の記録は通常0〜数件)。
  const { data, error } = await sb
    .from("pickup_requests")
    .select("id, booking_id, leg_index, environment, updated_at, pickup_date")
    .eq("state", "sending")
    .is("stale_alerted_at", null)
    .limit(200)
  if (error) {
    if (isPickupTableMissing(new Error(error.message))) return { alerted: 0, note: "pickup_requests 未作成" }
    return { alerted: 0, note: `読み込み失敗: ${error.message}` }
  }
  let alerted = 0
  type Row = { id: string; booking_id: string; leg_index: number; environment: string | null; updated_at: string; pickup_date: string | null }
  const stale = ((data ?? []) as Row[]).filter((r) => now.getTime() - Date.parse(r.updated_at) > STALE_SENDING_MS)
  for (const r of stale) {
    // 先に印を付けた実行だけが通知する (並走しても1回だけ)
    const { data: marked, error: mErr } = await sb
      .from("pickup_requests")
      .update({ stale_alerted_at: now.toISOString() })
      .eq("id", r.id)
      .eq("state", "sending")
      .is("stale_alerted_at", null)
      .select("id")
    if (mErr || !(marked ?? []).length) continue
    const sent = await alert({
      subject: `【要確認】Biz-Logi 集荷依頼が送信中のまま止まっています: ${r.booking_id}-L${r.leg_index + 1}`,
      lines: [
        `区間: ${r.booking_id}-L${r.leg_index + 1}（集荷日 ${r.pickup_date ?? "不明"}）`,
        `接続先: ${r.environment === "production" ? "本番" : "テスト環境"}`,
        `送信開始: ${r.updated_at}`,
        "",
        "送信の途中で処理が止まったため、佐川側で受け付けられたか分かりません。自動では再送していません。",
        "世田谷営業所に受付の有無を確認し、運営画面の「佐川へ集荷依頼」の要確認から結果を記録してください。",
        "締め (集荷前日 20:00) を過ぎて確認できない場合は、再依頼せず SOP (結果不明時の対応) に従ってください。",
        `記録ID: ${r.id}`,
      ],
    }).then(() => true, () => false)
    if (sent) alerted++
    // 送れなかったら印を戻し、次の回に送り直す
    else {
      const { error: rErr } = await sb.from("pickup_requests").update({ stale_alerted_at: null }).eq("id", r.id).eq("state", "sending")
      if (rErr) console.error("[pickup-watch] 通知済みの印を戻せません:", rErr.message)
    }
  }
  return { alerted, note: alerted ? `送信中のまま ${alerted}件を通知` : "なし" }
}

// ─────────────────────────────────────────────────────────────────────────────
// 夕方の集荷依頼漏れの通知 (2026-11-04 最終検証・同日 専用ジョブへ分離と重複防止)。
// 受付締切 18:30 → 19:00 送信 → 佐川の締め 20:00 の間に、明日集荷の区間で「依頼が無い (未送信・送信失敗)」
// 「結果不明・送信中のまま・要確認・変更対応中」が残っていれば運用へ知らせる。
// 呼び出し元は集荷依頼の監視ジョブ (/api/cron/pickup-watch・10分おき)。追跡の定時処理とは独立。
// 同じ区間・種類は、締め前 (19:00〜19:59) と締め超過 (20:00〜21:59) にそれぞれ1回だけ通知する
// (sql/075 pickup_watch_alerts)。自動では送信も再送もしない。

const JST_MS = 9 * 3600 * 1000
export const EVENING_WATCH_FROM_MIN = 19 * 60 // 19:00 JST
export const EVENING_WATCH_UNTIL_MIN = 22 * 60 // 22:00 JST (この時刻より前)

export interface EveningGaps {
  tomorrow: string
  /** before = 佐川の締め (20:00) 前 / after = 締め超過 */
  phase: "before" | "after"
  unsent: SagawaPickupTask[]
  attention: PickupAttentionTask[]
}

export function eveningGaps(todo: { needRequest: SagawaPickupTask[]; attention: PickupAttentionTask[] }, now: Date): EveningGaps | null {
  const j = new Date(now.getTime() + JST_MS)
  const min = j.getUTCHours() * 60 + j.getUTCMinutes()
  if (min < EVENING_WATCH_FROM_MIN || min >= EVENING_WATCH_UNTIL_MIN) return null
  const tomorrow = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + 1)).toISOString().slice(0, 10)
  const unsent = todo.needRequest.filter((t) => t.shipmentDate === tomorrow)
  const attention = todo.attention.filter((t) => t.shipmentDate === tomorrow)
  return { tomorrow, phase: min >= 20 * 60 ? "after" : "before", unsent, attention }
}

/** 通知の単位 (重複防止のキー)。送信失敗は失敗した時刻ごとに別の単位 (再送してまた失敗したら再通知)。 */
export function gapKey(g: Pick<EveningGaps, "tomorrow" | "phase">, t: SagawaPickupTask | PickupAttentionTask): string {
  const kind = "kind" in t ? t.kind : t.lastFailure ? `failed@${t.lastFailure.at}` : "unsent"
  return `evening:${g.tomorrow}:${t.shipmentId}:${kind}:${g.phase}`
}

const ATTENTION_JA: Record<string, string> = {
  unknown: "結果不明",
  stale_sending: "送信中のまま",
  cancel_needed: "取消区間の取消連絡",
  changed_after_request: "依頼後に内容が変わった",
  needs_review: "依頼済みか不明",
  change_pending: "変更・取消の佐川確認待ち",
  record_missing: "問合番号はあるが記録なし",
  hotel_change_requested: "変更申請が未連絡",
  hotel_change_approved: "佐川承認済みの変更が未反映",
}

/** まだ通知していない単位だけを返す (DB で記録)。記録できないときは全件を返す (通知の漏れより重複を選ぶ)。 */
async function claimKeys(sb: SupabaseClient, keys: string[]): Promise<{ fresh: Set<string>; dedupeOk: boolean }> {
  if (!keys.length) return { fresh: new Set(), dedupeOk: true }
  const { data, error } = await sb.rpc("pickup_watch_claim", { p_keys: keys })
  if (error) {
    console.error("[pickup-watch] 重複防止の記録に失敗。全件を通知します:", error.message)
    return { fresh: new Set(keys), dedupeOk: false }
  }
  const rows = (Array.isArray(data) ? data : []) as Array<string | { pickup_watch_claim?: string }>
  return { fresh: new Set(rows.map((r) => (typeof r === "string" ? r : String(r.pickup_watch_claim ?? "")))), dedupeOk: true }
}

export async function alertEveningPickupGaps(
  sb: SupabaseClient,
  alert: (input: OpsAlertInput) => Promise<unknown>,
  now: Date = new Date(),
): Promise<{ alerted: boolean; note: string; newItems: number }> {
  const j = new Date(now.getTime() + JST_MS)
  const min = j.getUTCHours() * 60 + j.getUTCMinutes()
  if (min < EVENING_WATCH_FROM_MIN || min >= EVENING_WATCH_UNTIL_MIN) return { alerted: false, note: "対象時間外", newItems: 0 }
  const today = j.toISOString().slice(0, 10)
  const todo = await loadPickupTodo(sb, today, now)
  const g = eveningGaps(todo, now)
  if (!g || (g.unsent.length === 0 && g.attention.length === 0)) return { alerted: false, note: "漏れなし", newItems: 0 }
  const items = [...g.unsent, ...g.attention]
  const { fresh, dedupeOk } = await claimKeys(sb, items.map((t) => gapKey(g, t)))
  const unsent = g.unsent.filter((t) => fresh.has(gapKey(g, t)))
  const attention = g.attention.filter((t) => fresh.has(gapKey(g, t)))
  if (!unsent.length && !attention.length) return { alerted: false, note: `通知済み (${items.length}件は前回までに通知)`, newItems: 0 }

  const pastCutoff = g.phase === "after"
  const leg = (t: { bookingId: string; legIndex: number; fromHotel: string; fromHotelJa: string | null; suitcaseCount: number }) =>
    `${t.bookingId}-L${t.legIndex + 1}  ${t.fromHotelJa || t.fromHotel}  ${t.suitcaseCount}個`
  const lines: string[] = [
    pastCutoff
      ? `佐川の新規依頼の締め (前日 20:00) を過ぎています。明日 (${g.tomorrow}) 集荷の区間に、依頼が確定していないものがあります。`
      : `明日 (${g.tomorrow}) 集荷の区間に、依頼が確定していないものがあります (佐川の締めは今日 20:00)。`,
    "",
  ]
  if (unsent.length) {
    lines.push(`■ 依頼が無い (${unsent.length}件)`)
    for (const t of unsent) {
      const why = t.lastFailure ? `  ← 前回の依頼は佐川が受付せず (${t.lastFailure.error ?? "エラー"})` : t.manualOnlyReason ? "  ← 手動手配のみ (Excel・佐川へ事前連絡)" : ""
      lines.push(`  ${leg(t)}${why}`)
    }
    lines.push("")
  }
  if (attention.length) {
    lines.push(`■ 要確認 (${attention.length}件)`)
    for (const t of attention) lines.push(`  【${ATTENTION_JA[t.kind] ?? t.kind}】${leg(t)}`)
    lines.push("")
  }
  const already = items.length - unsent.length - attention.length
  if (already > 0) lines.push(`(ほかに通知済みで未解決のものが ${already}件あります。運営画面で確認してください)`, "")
  if (!dedupeOk) lines.push("(重複防止の記録が使えないため、前回と同じ内容を含むことがあります)", "")
  lines.push(
    pastCutoff
      ? "結果不明の区間は再依頼しないでください。SOP (docs/bizlogi-sop-pickup-failure.md) の 20:00 以降の手順に従い、世田谷営業所へ連絡・翌朝の確認をしてください。"
      : "運営画面の「佐川へ集荷依頼」から対応してください。結果不明の区間は再依頼せず、世田谷営業所へ受付の有無を確認してください。",
  )
  try {
    await alert({
      subject: `【${pastCutoff ? "締め超過" : "要対応"}】明日集荷の佐川依頼が未確定 ${unsent.length + attention.length}件 (${g.tomorrow})`,
      lines,
    })
  } catch (e) {
    // 送れなかった通知は「通知済み」の記録を戻し、次の回に送り直す
    if (dedupeOk) await sb.from("pickup_watch_alerts").delete().in("alert_key", [...fresh])
    throw e
  }
  return { alerted: true, note: `未依頼 ${unsent.length}件・要確認 ${attention.length}件を通知`, newItems: unsent.length + attention.length }
}
