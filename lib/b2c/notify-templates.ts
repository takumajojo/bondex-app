/**
 * B2C の旅行者への通知の文面（Stage 4）。日本語で予約した人には日本語、英語の人には英語。
 *
 * - メールは件名と本文（テキスト）。WhatsApp は Meta の承認済みのテンプレートの名前と差し込み値
 *   （こちらから送る通知はテンプレートでしか送れない。文面の案は docs/b2c/B2C_NOTIFICATION_TEMPLATES.md）。
 * - 「確定」と書くのは booking_confirmed だけ。確認待ち（awaiting_hotel）では確定を約束しない。
 * - 料金はいまは請求していないこと、請求は集荷の後であることを毎回書く。
 * - 連絡先は lib/contact-links.ts の公式のものだけ（推測の連絡先を書かない）。
 */
import { SUPPORT_EMAIL } from "@/lib/contact-links"

export type B2cNotifyKind =
  | "booking_confirmed"
  | "awaiting_hotel"
  | "cancelled"
  | "reminder_eve"
  | "reminder_day"
  // Stage 5: 集荷の後の請求
  | "payment_action_required"
  | "payment_received"
  | "refund_issued"
export type B2cCancelReason = "guest" | "hotel_refused" | "hotel_unsupported" | "confirmation_timeout" | "card_timeout" | "ops"
export type Lang = "ja" | "en"

export interface B2cNotifyData {
  lang: Lang
  orderNumber: number
  guestName: string
  originName: string
  destName: string
  pickupDate: string // YYYY-MM-DD
  deliveryDate: string
  pieces: number
  totalGrossYen: number
  confirmationDueAt: string | null
  cancelReason: B2cCancelReason | null
  myBookingUrl: string
  frontDeskUrl: string
  /** 支払・返金の通知の額（税込） */
  amountYen?: number | null
  /** 支払のリンク（My Booking と同じ秘密のリンク） */
  payUrl?: string
}

export interface RenderedEmail {
  subject: string
  text: string
}
export interface RenderedWhatsApp {
  template: string
  languageCode: "ja" | "en_US"
  params: string[]
}

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`

export function fmtDay(ymd: string, lang: Lang): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  return lang === "ja"
    ? d.toLocaleDateString("ja-JP", { timeZone: "UTC", month: "long", day: "numeric", weekday: "short" })
    : d.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
}

export function fmtDueJst(iso: string, lang: Lang): string {
  const s = new Date(iso).toLocaleString(lang === "ja" ? "ja-JP" : "en-GB", {
    timeZone: "Asia/Tokyo", month: lang === "ja" ? "long" : "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  })
  return lang === "ja" ? `${s}（日本時間）` : `${s} (Japan time)`
}

function summary(d: B2cNotifyData): string[] {
  if (d.lang === "ja") {
    return [
      `受付番号: ${d.orderNumber}`,
      `集荷: ${fmtDay(d.pickupDate, "ja")} 11:00 まで／${d.originName}`,
      `お届け: ${fmtDay(d.deliveryDate, "ja")}／${d.destName}`,
      `個数: ${d.pieces}個`,
      `料金: ${yen(d.totalGrossYen)}（税込）。佐川急便の集荷の後に、ご登録のカードへ請求します。いまは請求されていません。`,
    ]
  }
  return [
    `Request number: ${d.orderNumber}`,
    `Pickup: ${fmtDay(d.pickupDate, "en")}, by 11:00 — ${d.originName}`,
    `Delivery: ${fmtDay(d.deliveryDate, "en")} — ${d.destName}`,
    `Bags: ${d.pieces}`,
    `Price: ${yen(d.totalGrossYen)} (tax included). We charge your registered card after Sagawa picks up your bags. Nothing has been charged yet.`,
  ]
}

function pickupSteps(d: B2cNotifyData): string[] {
  if (d.lang === "ja") {
    return [
      "集荷の日にすること",
      "1. 11:00 までに、お荷物をホテルのフロントに預けてください。",
      `2. 「BondEx の配送で、佐川急便が集荷に来ます」とお伝えください（受付番号 ${d.orderNumber}）。送り状は佐川急便が持参します。`,
      "3. 貴重品・壊れやすい物・現金・パスポートはお荷物に入れず、お手元でお持ちください（補償の対象外です）。",
      `ホテルのスタッフ向けの案内（フロントでお見せください）: ${d.frontDeskUrl}`,
    ]
  }
  return [
    "On pickup day",
    "1. Leave your bags at the hotel front desk by 11:00.",
    `2. Tell the staff: "BondEx delivery — Sagawa will pick these up" (request number ${d.orderNumber}). Sagawa brings the shipping labels.`,
    "3. Keep valuables, fragile items, cash and your passport with you. They are not covered.",
    `Note for the hotel staff (show it at the front desk): ${d.frontDeskUrl}`,
  ]
}

/** booking: "cancel" = 確認と取消の案内、"view" = 確認だけ（取消の締切の後に送るリマインド）、"none" = リンクなし */
function footer(d: B2cNotifyData, booking: "cancel" | "view" | "none" = "cancel"): string[] {
  const out: string[] = []
  if (booking === "cancel") out.push(d.lang === "ja" ? `ご予約の確認・取消（集荷の前日 18:30 まで）: ${d.myBookingUrl}` : `View or cancel your booking (until 18:30 JST the day before pickup): ${d.myBookingUrl}`)
  if (booking === "view") out.push(d.lang === "ja" ? `ご予約の確認: ${d.myBookingUrl}` : `View your booking: ${d.myBookingUrl}`)
  out.push(d.lang === "ja" ? `お問い合わせ: ${SUPPORT_EMAIL}` : `Questions: ${SUPPORT_EMAIL}`)
  out.push("BondEx")
  return out
}

function cancelSentence(d: B2cNotifyData): string {
  const ja: Record<B2cCancelReason, string> = {
    guest: "ご依頼により、ご予約を取り消しました。",
    hotel_refused: "ホテルでお荷物をお預かりできないとの回答があったため、ご予約を取り消しました。ご迷惑をおかけし申し訳ありません。",
    hotel_unsupported: "ご指定のホテルではお荷物をお預かりできないため、ご予約を取り消しました。ご迷惑をおかけし申し訳ありません。",
    confirmation_timeout: "期限までにホテルの確認が取れなかったため、ご予約を取り消しました。ご迷惑をおかけし申し訳ありません。",
    card_timeout: "カードの登録が完了しなかったため、受付を取り消しました。もう一度ご予約いただけます。",
    ops: "BondEx でご予約を取り消しました。詳しくはお問い合わせください。",
  }
  const en: Record<B2cCancelReason, string> = {
    guest: "Your booking has been cancelled as requested.",
    hotel_refused: "The hotel told us it cannot hold your bags, so we have cancelled your booking. We are sorry for the inconvenience.",
    hotel_unsupported: "The hotel you chose cannot hold bags for pickup, so we have cancelled your booking. We are sorry for the inconvenience.",
    confirmation_timeout: "We could not confirm with the hotel in time, so we have cancelled your booking. We are sorry for the inconvenience.",
    card_timeout: "Card registration was not completed, so your request has been cancelled. You are welcome to book again.",
    ops: "BondEx has cancelled your booking. Please contact us for details.",
  }
  const r = d.cancelReason ?? "ops"
  return d.lang === "ja" ? ja[r] : en[r]
}

export function renderEmail(kind: B2cNotifyKind, d: B2cNotifyData): RenderedEmail {
  const ja = d.lang === "ja"
  const hello = ja ? `${d.guestName} 様` : `Dear ${d.guestName},`
  const n = d.orderNumber
  switch (kind) {
    case "booking_confirmed":
      return {
        subject: ja ? `【BondEx】ご予約が確定しました（受付番号 ${n}）` : `BondEx: Your booking is confirmed (request ${n})`,
        text: [hello, "", ja ? "お荷物の配送のご予約が確定しました。" : "Your luggage delivery is confirmed.", "", ...summary(d), "", ...pickupSteps(d), "", ...footer(d)].join("\n"),
      }
    case "awaiting_hotel":
      return {
        subject: ja ? `【BondEx】ご予約を受け付けました・まだ確定していません（受付番号 ${n}）` : `BondEx: Request received — not confirmed yet (request ${n})`,
        text: [
          hello, "",
          ja ? "ご予約を受け付けました。まだ確定していません。" : "We have received your request. It is not confirmed yet.",
          ja
            ? `いまホテルに確認しています。${d.confirmationDueAt ? fmtDueJst(d.confirmationDueAt, "ja") : "期限"}までに確定し、メールと WhatsApp でお知らせします。期限までに確定できない場合は自動で取り消します。料金は一切かかりません。`
            : `We are checking with the hotel(s). We will confirm by ${d.confirmationDueAt ? fmtDueJst(d.confirmationDueAt, "en") : "the deadline"} and let you know by email and WhatsApp. If we cannot confirm by then, the request is cancelled automatically at no charge.`,
          ja ? "確定のお知らせが届くまでは、集荷の手配は行いません。" : "Pickup is not arranged until you receive the confirmation.",
          "", ...summary(d), "", ...footer(d),
        ].join("\n"),
      }
    case "cancelled":
      return {
        subject: ja ? `【BondEx】ご予約を取り消しました（受付番号 ${n}）` : `BondEx: Your booking has been cancelled (request ${n})`,
        text: [
          hello, "", cancelSentence(d),
          ja ? "料金は一切かかりません。カードへの請求もありません。" : "There is no charge. Your card will not be charged.",
          "", ja ? `受付番号: ${n}` : `Request number: ${n}`, "", ...footer(d, "none"),
        ].join("\n"),
      }
    case "reminder_eve":
      return {
        subject: ja ? `【BondEx】明日は集荷日です（受付番号 ${n}）` : `BondEx: Pickup is tomorrow (request ${n})`,
        text: [hello, "", ja ? `明日 ${fmtDay(d.pickupDate, "ja")} は集荷日です。` : `Tomorrow, ${fmtDay(d.pickupDate, "en")}, is your pickup day.`, "", ...pickupSteps(d), "", ...summary(d), "", ...footer(d, "view")].join("\n"),
      }
    case "reminder_day":
      return {
        subject: ja ? `【BondEx】本日は集荷日です・11:00 までにフロントへ（受付番号 ${n}）` : `BondEx: Pickup today — front desk by 11:00 (request ${n})`,
        text: [hello, "", ja ? "本日は集荷日です。11:00 までに、お荷物をホテルのフロントに預けてください。" : "Today is your pickup day. Please leave your bags at the front desk by 11:00.", "", ...pickupSteps(d), "", ...footer(d, "view")].join("\n"),
      }
    case "payment_action_required": {
      const amt = yen(d.amountYen ?? 0)
      return {
        subject: ja ? `【BondEx】お支払いの手続きをお願いします（受付番号 ${n}）` : `BondEx: Action needed to complete your payment (request ${n})`,
        text: [
          hello, "",
          ja
            ? `佐川急便がお荷物を集荷しました。ご登録のカードで ${amt}（税込）のお支払いができませんでした（カード会社による認証が必要、またはカードがご利用いただけない状態です）。`
            : `Sagawa has picked up your bags. We could not complete the payment of ${amt} (tax included) with your registered card (your card issuer needs you to confirm it, or the card cannot be used).`,
          ja ? "下のリンクから、本人認証または別のカードでお支払いください。お荷物の配送は続けています。" : "Please use the link below to confirm the payment or pay with another card. Your bags are still being delivered.",
          "",
          ja ? `お支払いのページ: ${d.payUrl}` : `Payment page: ${d.payUrl}`,
          ja ? "このリンクはお客様専用です。他の方に共有しないでください。" : "This link is only for you. Please do not share it.",
          "", ja ? `受付番号: ${n}` : `Request number: ${n}`, "", ...footer(d, "none"),
        ].join("\n"),
      }
    }
    case "payment_received":
      return {
        subject: ja ? `【BondEx】お支払いを受け付けました（受付番号 ${n}）` : `BondEx: Payment received (request ${n})`,
        text: [
          hello, "",
          ja ? `佐川急便の集荷の後に、${yen(d.amountYen ?? 0)}（税込）をご登録のカードで受け付けました。ありがとうございます。` : `After Sagawa picked up your bags, we received ${yen(d.amountYen ?? 0)} (tax included) with your card. Thank you.`,
          "", ja ? `受付番号: ${n}` : `Request number: ${n}`, "", ...footer(d, "view"),
        ].join("\n"),
      }
    case "refund_issued":
      return {
        subject: ja ? `【BondEx】返金しました（受付番号 ${n}）` : `BondEx: Refund issued (request ${n})`,
        text: [
          hello, "",
          ja ? `${yen(d.amountYen ?? 0)}（税込）をご利用のカードに返金しました。カード会社によって、明細に反映されるまで数日から数週間かかります。` : `We have refunded ${yen(d.amountYen ?? 0)} (tax included) to your card. Depending on your card issuer, it can take several days to a few weeks to appear on your statement.`,
          "", ja ? `受付番号: ${n}` : `Request number: ${n}`, "", ...footer(d, "view"),
        ].join("\n"),
      }
  }
}

/** WhatsApp の承認済みテンプレートの名前と差し込み値（{{1}}{{2}}… の順）。docs/b2c/B2C_NOTIFICATION_TEMPLATES.md と一致させる。 */
export function renderWhatsApp(kind: B2cNotifyKind, d: B2cNotifyData): RenderedWhatsApp {
  const languageCode = d.lang === "ja" ? "ja" : "en_US"
  const n = String(d.orderNumber)
  const p = fmtDay(d.pickupDate, d.lang)
  switch (kind) {
    case "booking_confirmed":
      return { template: "bondex_b2c_booking_confirmed", languageCode, params: [d.guestName, n, p, d.originName, fmtDay(d.deliveryDate, d.lang), d.destName, d.myBookingUrl] }
    case "awaiting_hotel":
      return { template: "bondex_b2c_awaiting_hotel", languageCode, params: [d.guestName, n, d.confirmationDueAt ? fmtDueJst(d.confirmationDueAt, d.lang) : "-", d.myBookingUrl] }
    case "cancelled":
      return { template: "bondex_b2c_cancelled", languageCode, params: [d.guestName, n, cancelSentence(d)] }
    case "reminder_eve":
      return { template: "bondex_b2c_pickup_tomorrow", languageCode, params: [d.guestName, n, p, d.originName, d.frontDeskUrl] }
    case "reminder_day":
      return { template: "bondex_b2c_pickup_today", languageCode, params: [d.guestName, n, d.originName, d.frontDeskUrl] }
    case "payment_action_required":
      return { template: "bondex_b2c_payment_required", languageCode, params: [d.guestName, n, yen(d.amountYen ?? 0), d.payUrl ?? d.myBookingUrl] }
    case "payment_received":
      return { template: "bondex_b2c_payment_received", languageCode, params: [d.guestName, n, yen(d.amountYen ?? 0)] }
    case "refund_issued":
      return { template: "bondex_b2c_refund_issued", languageCode, params: [d.guestName, n, yen(d.amountYen ?? 0)] }
  }
}
