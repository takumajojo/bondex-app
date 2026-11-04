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
    alerted++
    await alert({
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
    }).catch(() => {})
  }
  return { alerted, note: alerted ? `送信中のまま ${alerted}件を通知` : "なし" }
}

// ─────────────────────────────────────────────────────────────────────────────
// 夕方の集荷依頼漏れの通知 (2026-11-04 最終検証)。受付締切 18:30 → 19:00 送信 → 佐川の締め 20:00 の間に、
// 明日集荷の区間で「依頼が無い (未送信・送信失敗)」「結果不明・送信中のまま・要確認・変更対応中」が残っていれば
// 運用へ知らせる。朝の TODO メール (7:00) だけでは、夕方の漏れに画面を開かない限り気づけなかった。
// 追跡の定時処理 (8:00〜21:30・30分ごと) から呼ぶ。19:00〜21:59 の実行だけが対象で、残っている間は
// 実行ごとに通知する (19:00 / 19:30 / 20:00 … = 締めの前後で繰り返し知らせる)。自動では送信も再送もしない。

const JST_MS = 9 * 3600 * 1000
export const EVENING_WATCH_FROM_MIN = 19 * 60 // 19:00 JST
export const EVENING_WATCH_UNTIL_MIN = 22 * 60 // 22:00 JST (この時刻より前)

export interface EveningGaps {
  tomorrow: string
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
  return { tomorrow, unsent, attention }
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

export async function alertEveningPickupGaps(
  sb: SupabaseClient,
  alert: (input: OpsAlertInput) => Promise<unknown>,
  now: Date = new Date(),
): Promise<{ alerted: boolean; note: string }> {
  const j = new Date(now.getTime() + JST_MS)
  const min = j.getUTCHours() * 60 + j.getUTCMinutes()
  if (min < EVENING_WATCH_FROM_MIN || min >= EVENING_WATCH_UNTIL_MIN) return { alerted: false, note: "対象時間外" }
  const today = j.toISOString().slice(0, 10)
  const todo = await loadPickupTodo(sb, today, now)
  const g = eveningGaps(todo, now)
  if (!g || (g.unsent.length === 0 && g.attention.length === 0)) return { alerted: false, note: "漏れなし" }
  const pastCutoff = min >= 20 * 60
  const leg = (t: { bookingId: string; legIndex: number; fromHotel: string; fromHotelJa: string | null; suitcaseCount: number }) =>
    `${t.bookingId}-L${t.legIndex + 1}  ${t.fromHotelJa || t.fromHotel}  ${t.suitcaseCount}個`
  const lines: string[] = [
    pastCutoff
      ? `佐川の新規依頼の締め (前日 20:00) を過ぎています。明日 (${g.tomorrow}) 集荷の区間に、依頼が確定していないものがあります。`
      : `明日 (${g.tomorrow}) 集荷の区間に、依頼が確定していないものがあります (佐川の締めは今日 20:00)。`,
    "",
  ]
  if (g.unsent.length) {
    lines.push(`■ 依頼が無い (${g.unsent.length}件)`)
    for (const t of g.unsent) {
      const why = t.lastFailure ? `  ← 前回の依頼は佐川が受付せず (${t.lastFailure.error ?? "エラー"})` : t.manualOnlyReason ? "  ← 手動手配のみ (Excel・佐川へ事前連絡)" : ""
      lines.push(`  ${leg(t)}${why}`)
    }
    lines.push("")
  }
  if (g.attention.length) {
    lines.push(`■ 要確認 (${g.attention.length}件)`)
    for (const t of g.attention) lines.push(`  【${ATTENTION_JA[t.kind] ?? t.kind}】${leg(t)}`)
    lines.push("")
  }
  lines.push(
    pastCutoff
      ? "結果不明の区間は再依頼しないでください。SOP (docs/bizlogi-sop-pickup-failure.md) の 20:00 以降の手順に従い、世田谷営業所へ連絡・翌朝の確認をしてください。"
      : "運営画面の「佐川へ集荷依頼」から対応してください。結果不明の区間は再依頼せず、世田谷営業所へ受付の有無を確認してください。",
  )
  await alert({
    subject: `【${pastCutoff ? "締め超過" : "要対応"}】明日集荷の佐川依頼が未確定 ${g.unsent.length + g.attention.length}件 (${g.tomorrow})`,
    lines,
  })
  return { alerted: true, note: `未依頼 ${g.unsent.length}件・要確認 ${g.attention.length}件を通知` }
}
