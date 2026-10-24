/**
 * 佐川の集荷依頼後（＝佐川側の取消・再採番が必要になる段階）の
 * キャンセル・変更・問い合わせ番号差し替えを運用へ必ず知らせるアラート群。
 *
 * 判定の基準 (sagawaDispatched):
 *   - pickup_requested_at あり … 運営が「集荷手配（佐川）済み」をトグル済み (migration 038)
 *   - tracking_numbers あり    … 佐川が発番済み (集荷段階以降)
 * いずれかが真なら「佐川へ集荷依頼済み」とみなす。status='issued' は予約直後に付くため判定に使わない。
 *
 * 送信は sendOpsAlert (ALERT_EMAIL=谷口さん個人 + support@ + Slack) を使い、必達・異常系扱いで統一する。
 * どれも throw しない (本処理=キャンセル/変更/番号更新を止めない)。
 */

import { sendOpsAlert } from "./ops-alert"
import { jstTodayYmd } from "./yamato-delivery"

interface DispatchRow {
  pickup_requested_at?: string | null
  tracking_numbers?: unknown
}

/** 佐川へ集荷依頼済み（キャンセル/変更時に佐川の取消・再採番が必要）か。 */
export function sagawaDispatched(s: DispatchRow): boolean {
  return !!s.pickup_requested_at || trackingNumbers(s).length > 0
}

function trackingNumbers(s: DispatchRow): string[] {
  return Array.isArray(s.tracking_numbers)
    ? (s.tracking_numbers as unknown[]).map((x) => String(x).trim()).filter(Boolean)
    : []
}
function trackLabel(s: DispatchRow): string {
  const n = trackingNumbers(s)
  return n.length ? n.join(", ") : "未発番"
}
const trackUrl = (bookingId?: string | null): string => `https://bondex.express/track/${bookingId ?? ""}`

/** (A) 集荷依頼後のキャンセル → 運用アラート。dispatched でなければ何もしない。 */
export async function alertSagawaCancel(p: {
  shipment: DispatchRow & {
    booking_id?: string | null
    shipment_date?: string | null
    agency?: string | null
    representative?: string | null
    from_hotel?: string | null
    to_hotel?: string | null
  }
  legRef: string
  cancelledBy: string
}): Promise<void> {
  const s = p.shipment
  if (!sagawaDispatched(s)) return
  const sameDay = !!s.shipment_date && s.shipment_date === jstTodayYmd()
  await sendOpsAlert({
    subject: `【要対応｜佐川の集荷取消】${p.legRef} がキャンセルされました${sameDay ? "（当日・至急）" : ""}`,
    lines: [
      `予約: ${p.legRef}${s.agency ? ` / ${s.agency}` : ""}${s.representative ? ` / ${s.representative}` : ""}`,
      `区間: ${s.from_hotel ?? "—"} → ${s.to_hotel ?? "—"}`,
      `集荷予定日: ${s.shipment_date ?? "—"}${sameDay ? "（本日・当日キャンセル）" : ""}`,
      `取消: ${p.cancelledBy}`,
      `問い合わせ番号: ${trackLabel(s)}`,
      `→ 佐川へ集荷依頼の取消を連絡してください。${sameDay ? "本日集荷予定のため至急対応。" : ""}`,
      `追跡: ${trackUrl(s.booking_id)}`,
    ],
    agencyEmail: null,
  }).catch(() => {})
}

/** (B) 集荷依頼後の日程/場所/個数の変更 → 運用アラート（佐川キャンセル＋再採番が必要）。 */
export async function alertSagawaChange(p: {
  shipment: DispatchRow & { booking_id?: string | null; agency?: string | null }
  legRef: string
  changeSummary: string
}): Promise<void> {
  const s = p.shipment
  if (!sagawaDispatched(s)) return
  await sendOpsAlert({
    subject: `【要対応｜佐川の再手配】${p.legRef} が変更されました（日程/場所/個数）`,
    lines: [
      `予約: ${p.legRef}${s.agency ? ` / ${s.agency}` : ""}`,
      `変更内容: ${p.changeSummary}`,
      `現在の問い合わせ番号: ${trackLabel(s)}`,
      `→ 佐川の集荷依頼を取消し、再採番（集荷依頼を作り直して再送）してください。`,
      `→ 新しい問い合わせ番号が出たら運営画面で登録してください（番号変更は自動通知されます）。`,
      `追跡: ${trackUrl(s.booking_id)}`,
    ],
    agencyEmail: null,
  }).catch(() => {})
}

/** (C) 問い合わせ番号（追跡番号）の差し替え（再採番）→ BondEx へ通知。初回入力は呼び出し側で除外。 */
export async function alertTrackingNumberChanged(p: {
  legRef: string
  bookingId?: string | null
  agency?: string | null
  oldNumbers: string[]
  newNumbers: string[]
}): Promise<void> {
  await sendOpsAlert({
    subject: `【問い合わせ番号の変更】${p.legRef}`,
    lines: [
      `予約: ${p.legRef}${p.agency ? ` / ${p.agency}` : ""}`,
      `問い合わせ番号: ${p.oldNumbers.join(", ") || "—"} → ${p.newNumbers.join(", ") || "—"}`,
      `追跡: ${trackUrl(p.bookingId)}`,
    ],
    agencyEmail: null,
  }).catch(() => {})
}
