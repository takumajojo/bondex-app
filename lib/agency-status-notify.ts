/**
 * 代理店向け「集荷完了 / 配達完了」ステータス通知メールの送出ラッパー。
 *
 * テンプレは lib/agency-status-email.ts (見栄え重視の HTML + text)。本モジュールは
 * shipment 行から入力を組み立て、共通 mailer で送るところまでを担う。自動同期 cron
 * (api/cron/sync-tracking) と手動ステータス変更 (api/shipments) の両方から呼び、
 * どちらの経路でも同じ体裁のメールが届くようにするための単一ソース。
 *
 * 宛先は代理店の contact_email。無ければ送らない (best-effort・呼び出し側は失敗を無視)。
 * 差出人は mailer 既定の support@bondex.express、返信先も support@bondex.express。
 */

import { sendMail } from "./mailer"
import { buildAgencyStatusEmail, type StatusEmailData } from "./agency-status-email"

/** shipments 行 (Supabase snake_case) と ShipmentRecord のどちらも満たす最小形。 */
export interface StatusRow {
  agency?: string | null
  booking_id: string
  leg_index: number
  tour_number?: string | null
  representative?: string | null
  from_hotel?: string | null
  to_hotel?: string | null
  shipment_date?: string | null
  tracking_numbers?: string[] | null
}

/** shipment 行 + 代理店担当者名 → ステータス通知メールの入力。 */
export function statusDataFromRow(row: StatusRow, contactPerson: string | null): StatusEmailData {
  return {
    agencyName: row.agency ?? "",
    contactPerson,
    bookingId: row.booking_id,
    legIndex: row.leg_index,
    tourNumber: row.tour_number ?? null,
    representative: row.representative ?? "",
    fromHotel: row.from_hotel ?? "",
    toHotel: row.to_hotel ?? "",
    shipmentDate: row.shipment_date ?? "",
    trackingNumbers: row.tracking_numbers ?? [],
    trackUrl: `https://bondex.express/track/${row.booking_id}`,
  }
}

/**
 * 代理店へ「集荷完了 / 配達完了」の設計版ステータス通知メールを送る (best-effort)。
 * agencyEmail は単一 or 複数(主メール+追加メール)。1件でも送れれば true。無ければ false。
 * 複数宛先は個別に送る (Resend/SMTP の to はアドレス単位で扱うため)。
 */
export async function sendAgencyStatusEmail(
  kind: "picked_up" | "delivered",
  data: StatusEmailData,
  agencyEmail: string | string[] | null,
  en: boolean,
): Promise<boolean> {
  // 宛先を大文字小文字を無視して重複排除(先勝ち)。
  const seen = new Set<string>()
  const list: string[] = []
  for (const raw of Array.isArray(agencyEmail) ? agencyEmail : [agencyEmail]) {
    const v = (raw ?? "").trim()
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    list.push(v)
  }
  if (list.length === 0) return false
  const mail = buildAgencyStatusEmail(kind, data, en ? "en" : "ja")
  let anySent = false
  for (const to of list) {
    const r = await sendMail({
      to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      replyTo: "support@bondex.express",
    })
    if (r.sent) anySent = true
  }
  return anySent
}
