// 「送信中」のまま止まった集荷依頼の検知 (2026-11-03 監査 P1-4)。
// Biz-Logi へ送っている最中にサーバの処理が止まると (時間上限・障害)、記録は sending のまま残る。
// 二重依頼は起きない (有効な依頼として残るため再送できない) が、そのままでは誰も気づかない。
// 追跡の定時処理 (8:00〜21:30・30分ごと) の冒頭で呼び、該当があれば1回だけ運用へ通知する。
// 自動では解放も再送もしない。運営が佐川へ確認して記録する。

import type { SupabaseClient } from "@supabase/supabase-js"
import type { OpsAlertInput } from "@/lib/ops-alert"
import { STALE_SENDING_MS } from "./state"
import { isPickupTableMissing } from "./store"

export async function alertStaleSending(
  sb: SupabaseClient,
  alert: (input: OpsAlertInput) => Promise<unknown>,
  now: Date = new Date(),
): Promise<{ alerted: number; note: string }> {
  const before = new Date(now.getTime() - STALE_SENDING_MS).toISOString()
  const { data, error } = await sb
    .from("pickup_requests")
    .select("id, booking_id, leg_index, environment, updated_at, pickup_date")
    .eq("state", "sending")
    .lt("updated_at", before)
    .is("stale_alerted_at", null)
    .limit(50)
  if (error) {
    if (isPickupTableMissing(new Error(error.message))) return { alerted: 0, note: "pickup_requests 未作成" }
    return { alerted: 0, note: `読み込み失敗: ${error.message}` }
  }
  let alerted = 0
  for (const r of (data ?? []) as Array<{ id: string; booking_id: string; leg_index: number; environment: string | null; updated_at: string; pickup_date: string | null }>) {
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
