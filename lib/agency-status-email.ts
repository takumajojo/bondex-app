// 代理店向け「配送ステータス通知メール」テンプレート (2026-09-11 谷口さん・9/16 配送開始)。
//
// 4種類: issued(発送準備完了/送り状発行) / picked_up(集荷完了・追跡番号) /
//        delivered(配達完了) / delay(遅延・要確認)。
// メールクライアント互換のため table + インラインスタイルで組む (flex/外部CSS不可)。
// ロゴは本番配信の実URL (200 確認済み) を参照する。text 版も併せて返す。

export type StatusEmailKind = "issued" | "picked_up" | "delivered" | "delay"

export interface StatusEmailData {
  agencyName: string
  contactPerson?: string | null
  bookingId: string
  legIndex: number
  legCount?: number
  tourNumber?: string | null
  representative: string
  fromHotel: string
  toHotel: string
  shipmentDate: string
  expectedArrival?: string | null
  /** 追跡番号 (picked_up 以降)。 */
  trackingNumbers?: string[]
  /** 追跡ページ (BondEx 公開) の URL。 */
  trackUrl?: string
}

const BRAND = "#C8102E"
const AMBER = "#B45309"
const INK = "#0F172A"
const MUTED = "#64748B"
const HAIR = "#E5E7EB"
const LOGO_URL = "https://bondex.express/bondex-logo.png"
const SUPPORT = "support@bondex.express"

type Copy = {
  subject: string
  title: string
  lead: string
  note?: string
  accent: string
}

function copyFor(kind: StatusEmailKind, d: StatusEmailData, en: boolean): Copy {
  const legTag = `${d.bookingId}-L${d.legIndex + 1}`
  if (en) {
    switch (kind) {
      case "issued":
        return {
          accent: BRAND,
          subject: `[BondEx] Shipment arranged (${d.bookingId})`,
          title: "The shipment has been arranged",
          lead: "We have arranged this shipment with the courier. No shipping labels are needed — the courier brings and attaches them at pickup. We will notify you again once the luggage is collected.",
        }
      case "picked_up":
        return {
          accent: BRAND,
          subject: `[BondEx] Luggage picked up (${d.bookingId})`,
          title: "The luggage has been picked up",
          lead: "The courier has collected the luggage and delivery is now under way. You can follow the status with the tracking number below.",
          note: "The charge for this leg is confirmed upon pickup. Card-paying agencies are billed now; monthly-invoice agencies are billed on the monthly statement.",
        }
      case "delivered":
        return {
          accent: "#2E7D32",
          subject: `[BondEx] Luggage delivered (${d.bookingId})`,
          title: "The luggage has arrived",
          lead: "The luggage has arrived at the destination hotel. Your guest can collect it at the front desk.",
        }
      case "delay":
        return {
          accent: AMBER,
          subject: `[BondEx | Action needed] Delivery is delayed (${d.bookingId})`,
          title: "Delivery is running late",
          lead: "This shipment is running later than scheduled. BondEx is checking the status with the courier.",
          note: "No action is needed on your side — please do not contact the guest or hotel directly. We will follow up as soon as we have an update.",
        }
    }
  }
  switch (kind) {
    case "issued":
      return {
        accent: BRAND,
        subject: `【BondEx】配送の手配が完了しました（${d.bookingId}）`,
        title: "配送の手配が完了しました",
        lead: "配送業者への手配が完了しました。送り状のご用意は不要です（集荷ドライバーが持参・貼付します）。配送業者がお荷物を集荷しましたら、改めてご連絡します。",
      }
    case "picked_up":
      return {
        accent: BRAND,
        subject: `【BondEx】お荷物を集荷しました（${d.bookingId}）`,
        title: "お荷物を集荷しました",
        lead: "配送業者がお荷物を集荷し、配送を開始しました。下記の追跡番号から状況をご確認いただけます。",
        note: "本区間のご利用料金は、集荷完了をもって確定します。カード決済の代理店様はこの時点でご請求（決済）、月次請求の代理店様は当月分にまとめてご請求します。",
      }
    case "delivered":
      return {
        accent: "#2E7D32",
        subject: `【BondEx】お荷物が到着しました（${d.bookingId}）`,
        title: "お荷物が到着しました",
        lead: "お荷物がお届け先ホテルに到着しました。お客様はホテルのフロントでお受け取りいただけます。",
      }
    case "delay":
      return {
        accent: AMBER,
        subject: `【BondEx｜要確認】配送に遅れが生じています（${d.bookingId}）`,
        title: "配送に遅れが生じています",
        lead: "本件のお荷物について、予定より配送が遅れております。現在 BondEx が配送業者に状況を確認しています。",
        note: `お客様・ホテルへの個別対応は不要です（区間 ${legTag}）。進展があり次第、改めてご連絡します。お急ぎの場合は ${SUPPORT} までご連絡ください。`,
      }
  }
}

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string))
}

/** 詳細テーブルの1行。 */
function row(label: string, value: string): string {
  if (!value) return ""
  return `<tr>
    <td style="padding:7px 0;color:${MUTED};font-size:12px;white-space:nowrap;vertical-align:top;width:120px;">${esc(label)}</td>
    <td style="padding:7px 0;color:${INK};font-size:13px;font-weight:600;vertical-align:top;">${esc(value)}</td>
  </tr>`
}

export function buildAgencyStatusEmail(
  kind: StatusEmailKind,
  data: StatusEmailData,
  locale: "ja" | "en" = "ja",
): { subject: string; html: string; text: string } {
  const en = locale === "en"
  const c = copyFor(kind, data, en)
  const L = en
    ? { booking: "Booking no.", tour: "Tour no.", guest: "Guest", route: "Route", ship: "Ship date", eta: "Est. arrival", tracking: "Tracking no.", track: "View delivery status", operatedBy: "Operated by JOJO Inc." }
    : { booking: "予約番号", tour: "ツアー番号", guest: "お客様", route: "区間", ship: "発送日", eta: "到着予定", tracking: "追跡番号", track: "配送状況を確認", operatedBy: "運営：株式会社JOJO" }

  const greeting = en
    ? `Dear ${esc(data.contactPerson || data.agencyName)},`
    : `${esc(data.contactPerson ? `${data.contactPerson} 様` : `${data.agencyName} ご担当者様`)}`

  const legLabel = data.legCount && data.legCount > 1 ? `${data.bookingId}（区間 ${data.legIndex + 1}/${data.legCount}）` : data.bookingId
  const tracking = (data.trackingNumbers || []).filter(Boolean).join(" / ")

  const rows =
    row(L.booking, legLabel) +
    row(L.tour, data.tourNumber || "") +
    row(L.guest, `${data.representative} 様`) +
    // 区間は横並びだと折り返して読みづらいので、発送元→お届け先を縦に積む
    `<tr><td style="padding:7px 0;color:${MUTED};font-size:12px;white-space:nowrap;vertical-align:top;width:120px;">${esc(L.route)}</td>` +
    `<td style="padding:7px 0;color:${INK};font-size:13px;font-weight:600;vertical-align:top;line-height:1.8;">${esc(data.fromHotel)}<br><span style="color:${MUTED};font-weight:400;">↓</span><br>${esc(data.toHotel)}</td></tr>` +
    row(L.ship, data.shipmentDate) +
    (kind === "issued" || kind === "delay" ? row(L.eta, data.expectedArrival || "") : "") +
    (tracking ? row(L.tracking, tracking) : "")

  const trackBtn =
    (kind === "picked_up" || kind === "delivered") && data.trackUrl
      ? `<tr><td style="padding-top:18px;">
           <a href="${esc(data.trackUrl)}" style="display:inline-block;background:${c.accent};color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:11px 20px;border-radius:6px;">${L.track} →</a>
         </td></tr>`
      : ""

  const noteBox = c.note
    ? `<tr><td style="padding-top:16px;">
         <div style="background:${kind === "delay" ? "#FFFBEB" : "#F8FAFC"};border-left:3px solid ${c.accent};border-radius:4px;padding:12px 14px;color:${INK};font-size:12.5px;line-height:1.7;">${esc(c.note)}</div>
       </td></tr>`
    : ""

  const html = `<!DOCTYPE html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#F1F5F9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid ${HAIR};border-radius:12px;overflow:hidden;">
        <tr><td style="padding:22px 28px 0 28px;">
          <img src="${LOGO_URL}" alt="BondEx" width="116" style="display:block;width:116px;height:auto;">
        </td></tr>
        <tr><td style="padding:14px 28px 0 28px;"><div style="height:3px;width:100%;background:${c.accent};border-radius:2px;"></div></td></tr>
        <tr><td style="padding:18px 28px 0 28px;">
          <div style="font-size:19px;font-weight:700;color:${INK};line-height:1.4;">${esc(c.title)}</div>
        </td></tr>
        <tr><td style="padding:12px 28px 0 28px;">
          <div style="font-size:13px;color:${INK};line-height:1.5;">${greeting}</div>
          <div style="font-size:13.5px;color:#334155;line-height:1.8;margin-top:8px;">${esc(c.lead)}</div>
        </td></tr>
        <tr><td style="padding:16px 28px 0 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${HAIR};border-bottom:1px solid ${HAIR};">
            ${rows}
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${trackBtn}${noteBox}</table>
        </td></tr>
        <tr><td style="padding:22px 28px 24px 28px;">
          <div style="border-top:1px solid ${HAIR};padding-top:14px;">
            <div style="font-size:12px;font-weight:700;color:${INK};">BondEx</div>
            <div style="font-size:11px;color:${MUTED};line-height:1.6;">${esc(L.operatedBy)}<br>${SUPPORT}</div>
          </div>
        </td></tr>
      </table>
      <div style="font-size:10.5px;color:#94A3B8;margin-top:12px;">© ${new Date().getFullYear()} 株式会社JOJO / BondEx</div>
    </td></tr>
  </table>
</body></html>`

  // text 版 (HTML 非対応クライアント用フォールバック)
  const textLines = [
    c.title,
    "",
    greeting.replace(/<[^>]+>/g, ""),
    c.lead,
    "",
    `${L.booking}: ${legLabel}`,
    data.tourNumber ? `${L.tour}: ${data.tourNumber}` : "",
    `${L.guest}: ${data.representative} 様`,
    `${L.route}:`,
    `  ${data.fromHotel}`,
    `   ↓`,
    `  ${data.toHotel}`,
    `${L.ship}: ${data.shipmentDate}`,
    tracking ? `${L.tracking}: ${tracking}` : "",
    data.trackUrl && (kind === "picked_up" || kind === "delivered") ? `${L.track}: ${data.trackUrl}` : "",
    c.note ? `\n${c.note}` : "",
    "",
    `— BondEx（${L.operatedBy}） ${SUPPORT}`,
  ].filter((l) => l !== "")
  return { subject: c.subject, html, text: textLines.join("\n") }
}
