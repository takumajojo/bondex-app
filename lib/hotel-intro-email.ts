/**
 * ホテル向け「今後のご連絡方法のご案内」紹介メール (2026-09-13 谷口さん)。
 *
 * 新規の配送ホテルに電話し、今後メールで受け取り依頼を送ってよいか確認 → 担当者から
 * メールアドレスをもらったら、BondEx から当該ホテル宛に「今後はこのメールへご連絡します」
 * という紹介メールを送る。社外(ホテル)宛の送信なので、運用担当がプレビューを確認して
 * ワンクリックで送る (自動送信はしない)。差出人は support@bondex.express。
 *
 * 体裁は代理店向けステータス通知メール (lib/agency-status-email.ts) と揃える。
 */

const BRAND = "#C8102E"
const INK = "#0F172A"
const MUTED = "#64748B"
const HAIR = "#E5E7EB"
const LOGO_URL = "https://bondex.express/bondex-logo.png"
const SUPPORT = "support@bondex.express"
const DEFAULT_SERVICE_URL = "https://bondex.express"

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string))
}

export interface HotelIntroEmailInput {
  /** ホテル名 (日本語表記があれば優先)。 */
  hotelName: string
  /** サービス紹介の URL。既定は https://bondex.express。 */
  serviceUrl?: string
}

export function buildHotelIntroEmail(
  input: HotelIntroEmailInput,
): { subject: string; html: string; text: string } {
  const hotel = input.hotelName?.trim() || "ご担当者"
  const serviceUrl = input.serviceUrl && /^https?:\/\//i.test(input.serviceUrl) ? input.serviceUrl : DEFAULT_SERVICE_URL
  const subject = "【BondEx】お荷物お受け取りのご連絡方法について"

  const lead =
    "お世話になっております。手荷物配送サービス「BondEx（ボンデックス）」でございます。このたびはお客様のお荷物のお受け取りにご協力いただき、誠にありがとうございます。"
  const main =
    "つきましては、今後、お客様（旅行会社様）よりご依頼のお荷物について、<b>発送の前日にメールにて</b>お受け取りのご連絡を差し上げます（本メールアドレス宛にお送りいたします）。"
  const aboutTitle = "BondEx とは"
  const about =
    "旅行会社様のご依頼で、旅行者のお荷物をホテル間・空港⇄ホテルで配送する手荷物配送サービスです。ホテルの皆さまには、お荷物のお預かり・お渡しをお願いしております（お受け取りは簡単なご確認のみ）。"
  const closing = `ご不明な点は ${SUPPORT} までお気軽にお問い合わせください。今後ともどうぞよろしくお願い申し上げます。`

  const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#F1F5F9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid ${HAIR};border-radius:12px;overflow:hidden;">
        <tr><td style="padding:22px 28px 0 28px;">
          <img src="${LOGO_URL}" alt="BondEx" width="116" style="display:block;width:116px;height:auto;">
        </td></tr>
        <tr><td style="padding:14px 28px 0 28px;"><div style="height:3px;width:100%;background:${BRAND};border-radius:2px;"></div></td></tr>
        <tr><td style="padding:18px 28px 0 28px;">
          <div style="font-size:19px;font-weight:700;color:${INK};line-height:1.4;">今後のお荷物お受け取りのご連絡について</div>
        </td></tr>
        <tr><td style="padding:12px 28px 0 28px;">
          <div style="font-size:13px;color:${INK};line-height:1.5;">${esc(hotel)} ご担当者様</div>
          <div style="font-size:13.5px;color:#334155;line-height:1.8;margin-top:8px;">${esc(lead)}</div>
          <div style="font-size:13.5px;color:#334155;line-height:1.8;margin-top:10px;">${main}</div>
        </td></tr>
        <tr><td style="padding:16px 28px 0 28px;">
          <div style="background:#F8FAFC;border-left:3px solid ${BRAND};border-radius:4px;padding:12px 14px;">
            <div style="font-size:12px;font-weight:700;color:${INK};">${esc(aboutTitle)}</div>
            <div style="font-size:12.5px;color:#334155;line-height:1.7;margin-top:5px;">${esc(about)}</div>
            <div style="margin-top:8px;"><a href="${esc(serviceUrl)}" style="color:${BRAND};font-size:12.5px;font-weight:600;text-decoration:none;">${esc(serviceUrl)} ↗</a></div>
          </div>
        </td></tr>
        <tr><td style="padding:16px 28px 0 28px;">
          <div style="font-size:13px;color:#334155;line-height:1.8;">${esc(closing)}</div>
        </td></tr>
        <tr><td style="padding:22px 28px 24px 28px;">
          <div style="border-top:1px solid ${HAIR};padding-top:14px;">
            <div style="font-size:12px;font-weight:700;color:${INK};">BondEx</div>
            <div style="font-size:11px;color:${MUTED};line-height:1.6;">運営：株式会社JOJO<br>${SUPPORT}</div>
          </div>
        </td></tr>
      </table>
      <div style="font-size:10.5px;color:#94A3B8;margin-top:12px;">© ${new Date().getFullYear()} 株式会社JOJO / BondEx</div>
    </td></tr>
  </table>
</body></html>`

  const text = [
    "今後のお荷物お受け取りのご連絡について",
    "",
    `${hotel} ご担当者様`,
    "",
    lead,
    "",
    main.replace(/<[^>]+>/g, ""),
    "",
    `■ ${aboutTitle}`,
    about,
    serviceUrl,
    "",
    closing,
    "",
    "— BondEx（運営：株式会社JOJO）",
    SUPPORT,
  ].join("\n")

  return { subject, html, text }
}
