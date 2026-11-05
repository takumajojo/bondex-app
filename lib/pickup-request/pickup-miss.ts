// 未集荷（集荷漏れの可能性）の通知（G19・2026-11-05）。追跡の定時処理（sync-tracking）から独立させた唯一の発生元。
//
// これまでは追跡の定時処理の中にあり、Ship&co の鍵が無い時・追跡の一時停止（TRACKING_SYNC_PAUSED）の間は止まっていた。
// 今は集荷依頼の監視ジョブ（/api/cron/pickup-watch・追跡を止めていても動く）が呼ぶ。追跡の定時処理も同じ関数を呼ぶ
// （追跡で集荷が分かった直後に判定できるため）。どちらが呼んでも、通知は区間ごとに 1回だけ:
//   1. 対象（下の条件）を読み、区間ごとに「通知済み」の印（shipments.pickup_alert_sent_at）を条件付きで付ける
//      （印が空・状態が未集荷のままの時だけ）。印を付けられた実行だけが送る（同時に動いても 1回）
//   2. 送る。送れなかったことが確かな時（メールも Slack も届かなかった）だけ印を戻し、次の回に送り直す
//   3. 送ったかどうか分からない時（例外）は印を残し、送り直さない（重複より、運営の画面で目で確かめる方を選ぶ。
//      通知の基盤の方針と同じ。記録は console.error と戻り値の unknown）
// 条件（今までの追跡の定時処理と同じ・変えていない）:
//   - 状態が requested・pending・issued（集荷の前）の区間。取消（cancelled）・集荷の後は対象外
//   - 集荷日が今日（日本時間）より前なら、時刻に関わらず対象
//   - 集荷日が今日なら、日本時間 18:00 以降だけ対象（集荷は日中に来るため）
//   - 宛先: 運営（ops-alert）＋代理店の主メール（あれば。英語の代理店には英語の文）。旅行者の予約（B2C・代理店名 BondEx Direct）は代理店が無いので運営だけ
// 課金には関わらない（B2C の請求は運営の集荷の確認の後にしか作られない）。
import type { SupabaseClient } from "@supabase/supabase-js"
import type { OpsAlertInput, OpsAlertResult } from "@/lib/ops-alert"
import { endpointLabel } from "@/lib/residence"

const JST_MS = 9 * 3600 * 1000
export const PICKUP_MISS_SAME_DAY_FROM_HOUR_JST = 18
export const PICKUP_MISS_STATUSES = ["requested", "pending", "issued"] as const

interface MissRow {
  id: string
  booking_id: string
  leg_index: number
  agency: string | null
  representative: string | null
  recipient: string | null
  shipment_date: string
  status: string
  from_hotel: string | null
  from_residence: unknown
  to_hotel: string | null
  to_residence: unknown
  tracking_numbers: unknown
}

/** 今の時刻で通知の対象か（純粋関数・試験用に公開）。 */
export function pickupMissDue(shipmentDate: string, now: Date): boolean {
  const j = new Date(now.getTime() + JST_MS)
  const today = j.toISOString().slice(0, 10)
  if (shipmentDate < today) return true
  if (shipmentDate > today) return false
  return j.getUTCHours() >= PICKUP_MISS_SAME_DAY_FROM_HOUR_JST
}

export interface PickupMissResult {
  alerted: number
  /** 送れなかった（印を戻した・次の回に送り直す） */
  retry: number
  /** 送ったか分からない（印を残した・送り直さない） */
  unknown: number
  note: string
}

export async function alertPickupMisses(
  sb: SupabaseClient,
  send: (input: OpsAlertInput) => Promise<OpsAlertResult>,
  now: Date = new Date(),
): Promise<PickupMissResult> {
  const today = new Date(now.getTime() + JST_MS).toISOString().slice(0, 10)
  const { data, error } = await sb
    .from("shipments")
    .select("id, booking_id, leg_index, agency, representative, recipient, shipment_date, status, from_hotel, from_residence, to_hotel, to_residence, tracking_numbers")
    .in("status", [...PICKUP_MISS_STATUSES])
    .lte("shipment_date", today)
    .is("pickup_alert_sent_at", null)
    .limit(500)
  if (error) throw new Error(`未集荷の対象の読み込みに失敗: ${error.message}`)
  const due = ((data ?? []) as MissRow[]).filter((r) => pickupMissDue(r.shipment_date, now))
  if (due.length === 0) return { alerted: 0, retry: 0, unknown: 0, note: "なし" }

  // 代理店の主メールと言語（区間に代理店名があるものだけ）
  const names = [...new Set(due.map((r) => r.agency).filter((a): a is string => !!a))]
  const agencyEmail = new Map<string, string>()
  const agencyEn = new Map<string, boolean>()
  if (names.length) {
    const { data: ags } = await sb.from("agencies").select("name, contact_email, locale").in("name", names)
    for (const a of ags ?? []) {
      if (a.contact_email) agencyEmail.set(a.name as string, a.contact_email as string)
      agencyEn.set(a.name as string, a.locale === "en")
    }
  }

  let alerted = 0, retry = 0, unknown = 0
  for (const s of due) {
    // 1. 印を付けた実行だけが送る（印が空・まだ集荷の前の時だけ）
    const { data: marked, error: mErr } = await sb
      .from("shipments")
      .update({ pickup_alert_sent_at: now.toISOString() })
      .eq("id", s.id)
      .is("pickup_alert_sent_at", null)
      .in("status", [...PICKUP_MISS_STATUSES])
      .select("id")
    if (mErr) {
      console.error("[pickup-miss] 通知済みの印を付けられません（送らない）:", mErr.message)
      continue
    }
    if (!(marked ?? []).length) continue
    const leg = `${s.booking_id}-L${s.leg_index + 1}`
    const route = `${endpointLabel(s.from_hotel, s.from_residence)} → ${endpointLabel(s.to_hotel, s.to_residence)}`
    const tracking = Array.isArray(s.tracking_numbers) ? (s.tracking_numbers as string[]).join(", ") : ""
    const en = s.agency ? agencyEn.get(s.agency) === true : false
    const input: OpsAlertInput = {
      subject: `【集荷漏れの可能性】${leg} ${endpointLabel(s.from_hotel, s.from_residence)}`,
      lines: [
        `予約: ${s.booking_id} (区間 ${s.leg_index + 1})`,
        `代表者: ${s.representative ?? ""} / 受取人: ${s.recipient ?? ""}`,
        `発送日: ${s.shipment_date} を過ぎても集荷が確認できていません (現在: ${s.status})`,
        `発送元: ${route}`,
        `追跡番号: ${tracking || "未発行"}`,
        `対応: 発送元ホテルへ荷物の有無を確認し、必要なら集荷を再手配してください。`,
      ],
      agencyEmail: s.agency ? agencyEmail.get(s.agency) ?? null : null,
      ...(en
        ? {
            agencySubject: `[BondEx] Possible missed pickup — ${leg}`,
            agencyLines: [
              `Booking: ${s.booking_id} (leg ${s.leg_index + 1})`,
              `Traveler: ${s.representative ?? ""}`,
              `The ship date ${s.shipment_date} has passed but pickup is not confirmed yet.`,
              `Route: ${route}`,
              `We are checking with the origin hotel and the carrier, and will re-arrange pickup if needed.`,
            ],
          }
        : {}),
    }
    // 2・3. 送る。確かに送れなかった時だけ印を戻す。分からない時（例外）は印を残す
    let result: OpsAlertResult
    try {
      result = await send(input)
    } catch (e) {
      unknown++
      console.error(`[pickup-miss] ${leg}: 送ったか分からないため印を残します（送り直さない）:`, e instanceof Error ? e.message : e)
      continue
    }
    if (result.emailSent || result.slackSent) {
      alerted++
    } else {
      retry++
      const { error: rErr } = await sb.from("shipments").update({ pickup_alert_sent_at: null }).eq("id", s.id).eq("pickup_alert_sent_at", now.toISOString())
      if (rErr) console.error(`[pickup-miss] ${leg}: 印を戻せません（次の回に送り直せない）:`, rErr.message)
    }
  }
  const parts = [alerted ? `通知 ${alerted}件` : "", retry ? `送れず次の回に再送 ${retry}件` : "", unknown ? `結果不明 ${unknown}件（再送しない）` : ""].filter(Boolean)
  return { alerted, retry, unknown, note: parts.join("・") || "なし" }
}
