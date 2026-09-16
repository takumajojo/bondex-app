import { renderToBuffer } from "@react-pdf/renderer"
import type { SupabaseClient } from "@supabase/supabase-js"
import { InvoiceDocument, type InvoiceLineItem } from "@/lib/invoice-pdf"
import type { ShipmentRecord } from "@/lib/shipments-db"
import { TAX_RATE, grossOf } from "@/lib/tax"

/**
 * 月次請求書の組み立て — 手動DL (api/invoices/generate) と自動送付
 * (cron/monthly-invoices) の両方が使う単一ソース。
 *
 * 料金は契約上 ¥5,000「税抜」なので taxInclusive:false で外税表示する
 * (税抜小計に消費税を上乗せする)。対象は当月に発送された
 * issued/picked_up/in_transit/delivered の区間 (失敗・キャンセルは除外)。
 */

const BONDEX_BILLING = {
  companyName: "株式会社JOJO",
  address: "〒158-0092 東京都世田谷区野毛1-9-12",
  email: "support@bondex.express",
  bankInfo: "三菱UFJ銀行 田園調布駅前支店 普通 0145653 株式会社JOJO",
  // 適格請求書登録番号は取得後にここへ
}

const MONTHS_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

/** 年月日を言語別に整形。ja=「2026年7月1日」/ en=「Jul 1, 2026」 */
function fmtDate(year: number, month1: number, day: number, locale: "ja" | "en"): string {
  return locale === "en"
    ? `${MONTHS_EN[month1 - 1]} ${day}, ${year}`
    : `${year}年${month1}月${day}日`
}

function formatJpDate(d: Date, locale: "ja" | "en" = "ja"): string {
  return fmtDate(d.getFullYear(), d.getMonth() + 1, d.getDate(), locale)
}

/** 対象期間を言語別に。ja(monthly)=「2026年7月分」/ ja=「2026年7月」/ en=「July 2026」 */
const MONTHS_EN_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
function fmtPeriod(year: number, month1: number, locale: "ja" | "en", monthly: boolean): string {
  return locale === "en"
    ? `${MONTHS_EN_FULL[month1 - 1]} ${year}`
    : `${year}年${month1}月${monthly ? "分" : ""}`
}

export interface BuildInvoiceResult {
  ok: boolean
  reason?: string
  invoiceNumber?: string
  fileName?: string
  buffer?: Buffer
  itemCount?: number
  /** 請求総額 (税込・円)。税抜小計 + 消費税。 */
  totalYen?: number
  agencyEmail?: string | null
  agencyContactPerson?: string | null
  period?: string
  dueDate?: string
}

/**
 * @param month "YYYY-MM"
 */
export async function buildMonthlyInvoice(
  sb: SupabaseClient,
  agencyName: string,
  month: string,
): Promise<BuildInvoiceResult> {
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, reason: "invalid month" }
  const [yearStr, monthStr] = month.split("-")
  const year = Number(yearStr)
  const mon = Number(monthStr)
  const fromDate = `${month}-01`
  const lastDay = new Date(year, mon, 0).getDate()
  const toDate = `${month}-${String(lastDay).padStart(2, "0")}`

  const { data, error } = await sb
    .from("shipments")
    .select(
      "booking_id, leg_index, shipment_date, from_hotel, to_hotel, representative, tour_number, suitcase_count, amount_yen, status",
    )
    .eq("agency", agencyName)
    .gte("shipment_date", fromDate)
    .lte("shipment_date", toDate)
    .in("status", ["issued", "picked_up", "in_transit", "delivered"])
    .order("shipment_date", { ascending: true })

  if (error) return { ok: false, reason: error.message }
  if (!data || data.length === 0) return { ok: false, reason: "no_shipments" }

  const { data: agencyRow } = await sb
    .from("agencies")
    .select("name, contact_person, contact_email, billing_address, is_domestic, locale")
    .eq("name", agencyName)
    .maybeSingle()

  // 代理店の登録言語で請求書を出し分ける (英語圏の代理店は英語の請求書)。
  const locale: "ja" | "en" = agencyRow?.locale === "en" ? "en" : "ja"

  const agencyHash = Math.abs(
    agencyName.split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0),
  )
    .toString(36)
    .slice(0, 4)
    .toUpperCase()
  const invoiceNumber = `INV-${yearStr}${monthStr}-${agencyHash}`

  const items: InvoiceLineItem[] = data.map((s) => ({
    shipmentDate: s.shipment_date,
    bookingRef: `${s.booking_id}-L${(s.leg_index ?? 0) + 1}`,
    tourNumber: s.tour_number || undefined,
    fromHotel: s.from_hotel ?? "",
    toHotel: s.to_hotel ?? "",
    representative: s.representative ?? "",
    suitcaseCount: s.suitcase_count ?? 0,
    amountYen: s.amount_yen ?? 0,
  }))

  const netYen = items.reduce((sum, it) => sum + it.amountYen, 0) // 税抜小計
  // 海外事業者は消費税対象外 (税を上乗せしない)。国内は外税。
  const taxExempt = agencyRow?.is_domestic === false
  const totalYen = taxExempt ? netYen : grossOf(netYen) // 請求総額

  // 発行日は JST。サーバUTCのまま new Date() だと 0:00-8:59 JST に前日表記になる (適格請求書の日付ずれ)。
  const issuedDate = formatJpDate(new Date(Date.now() + 9 * 3600 * 1000), locale)
  const closingDate = formatJpDate(new Date(year, mon, 0), locale) // 当月末
  const dueDate = formatJpDate(new Date(year, mon + 1, 0), locale) // 翌月末払い
  const period = fmtPeriod(year, mon, locale, true)

  const doc = (
    <InvoiceDocument
      data={{
        invoiceNumber,
        issuedDate,
        period,
        dueDate,
        agency: {
          name: agencyName,
          contactPerson: agencyRow?.contact_person ?? undefined,
          billingAddress: agencyRow?.billing_address ?? undefined,
        },
        bondex: BONDEX_BILLING,
        closingDate,
        items,
        taxRate: TAX_RATE,
        taxInclusive: false, // 単価は税抜 — 外税表示 (国内は消費税を上乗せ)
        taxExempt, // 海外事業者は消費税対象外
        locale,
      }}
    />
  )

  const buffer = await renderToBuffer(doc)
  return {
    ok: true,
    invoiceNumber,
    fileName: `bondex-invoice-${invoiceNumber}.pdf`,
    buffer,
    itemCount: items.length,
    totalYen,
    agencyEmail: agencyRow?.contact_email ?? null,
    agencyContactPerson: agencyRow?.contact_person ?? null,
    period,
    dueDate,
  }
}

/**
 * カード決済1件ごとの「請求書 兼 領収書」。集荷完了で off_session 課金した
 * 直後、または代理店ポータルからの再取得時に、その区間 (shipment) 単体で作る。
 * 金額は amount_yen (税抜小計) を外税表示。charged_at を決済日として領収表示する。
 */
export async function buildChargeInvoice(
  sb: SupabaseClient,
  shipment: ShipmentRecord,
): Promise<BuildInvoiceResult> {
  // 明細は税抜小計 (amount_yen)。総額は実際に課金した税込額 (charge_amount_yen)。
  // charge_amount_yen が無い過去データは税抜小計から算出する。
  const netYen = shipment.amount_yen ?? 0
  if (netYen <= 0) return { ok: false, reason: "no_amount" }

  const { data: agencyRow } = await sb
    .from("agencies")
    .select("name, contact_person, contact_email, billing_address, is_domestic, locale")
    .eq("name", shipment.agency)
    .maybeSingle()

  // 代理店の登録言語で出し分け (英語圏はカード領収書も英語)。
  const locale: "ja" | "en" = agencyRow?.locale === "en" ? "en" : "ja"

  // 海外事業者は消費税対象外。実課金額(charge_amount_yen)があれば総額に使う。
  const taxExempt = agencyRow?.is_domestic === false
  const grossYen = shipment.charge_amount_yen ?? (taxExempt ? netYen : grossOf(netYen))

  // 決済日 (JST)。charged_at が無ければ発行日を使う。
  const chargedAt = shipment.charged_at ? new Date(shipment.charged_at) : new Date()
  const chargedJst = new Date(chargedAt.getTime() + 9 * 3600 * 1000)
  const paidDate = fmtDate(
    chargedJst.getUTCFullYear(),
    chargedJst.getUTCMonth() + 1,
    chargedJst.getUTCDate(),
    locale,
  )
  const ymd = chargedJst.toISOString().slice(0, 10).replace(/-/g, "")

  const shortId = shipment.id.replace(/-/g, "").slice(0, 6).toUpperCase()
  const invoiceNumber = `INV-${ymd}-${shortId}`

  const items: InvoiceLineItem[] = [
    {
      shipmentDate: shipment.shipment_date,
      bookingRef: `${shipment.booking_id}-L${shipment.leg_index + 1}`,
      tourNumber: shipment.tour_number || undefined,
      fromHotel: shipment.from_hotel ?? "",
      toHotel: shipment.to_hotel ?? "",
      representative: shipment.representative ?? "",
      suitcaseCount: shipment.suitcase_count ?? 0,
      amountYen: netYen,
    },
  ]

  // 発行日は決済日(JST)に統一。chargedAt(UTC)のままだと paidDate とズレ、深夜帯に前日表記になる。
  const issuedDate = formatJpDate(chargedJst, locale)
  // 対象期間は発送月
  const sm = /^(\d{4})-(\d{2})/.exec(shipment.shipment_date || "")
  const period = sm ? fmtPeriod(Number(sm[1]), Number(sm[2]), locale, false) : issuedDate

  const doc = (
    <InvoiceDocument
      data={{
        invoiceNumber,
        issuedDate,
        period,
        dueDate: paidDate, // 支払い済みのため期限は決済日で埋める (表示は paid ブロック優先)
        agency: {
          name: shipment.agency,
          contactPerson: agencyRow?.contact_person ?? undefined,
          billingAddress: agencyRow?.billing_address ?? undefined,
        },
        bondex: BONDEX_BILLING,
        items,
        taxRate: TAX_RATE,
        taxInclusive: false,
        taxExempt, // 海外事業者は消費税対象外
        locale,
        paid: {
          method: locale === "en" ? "Credit card" : "クレジットカード",
          date: paidDate,
          reference: shipment.stripe_payment_intent_id ?? undefined,
        },
      }}
    />
  )

  const buffer = await renderToBuffer(doc)
  return {
    ok: true,
    invoiceNumber,
    fileName: `bondex-receipt-${invoiceNumber}.pdf`,
    buffer,
    itemCount: 1,
    totalYen: grossYen,
    agencyEmail: agencyRow?.contact_email ?? null,
    agencyContactPerson: agencyRow?.contact_person ?? null,
    period,
    dueDate: paidDate,
  }
}
