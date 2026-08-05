import { renderToBuffer } from "@react-pdf/renderer"
import type { SupabaseClient } from "@supabase/supabase-js"
import { InvoiceDocument, type InvoiceLineItem } from "@/lib/invoice-pdf"
import type { ShipmentRecord } from "@/lib/shipments-db"

/**
 * 月次請求書の組み立て — 手動DL (api/invoices/generate) と自動送付
 * (cron/monthly-invoices) の両方が使う単一ソース。
 *
 * 料金は契約上 ¥5,000「税込」なので taxInclusive:true で内税表示する
 * (税抜額に 10% を上乗せしない = 過大請求を防ぐ)。対象は当月に発送された
 * issued/picked_up/in_transit/delivered の区間 (失敗・キャンセルは除外)。
 */

const BONDEX_BILLING = {
  companyName: "株式会社JOJO",
  address: "〒158-0092 東京都世田谷区野毛1-9-12",
  email: "support@bondex.express",
  bankInfo: "三菱UFJ銀行 田園調布駅前支店 普通 0145653 株式会社JOJO",
  // 適格請求書登録番号は取得後にここへ
}

function formatJpDate(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export interface BuildInvoiceResult {
  ok: boolean
  reason?: string
  invoiceNumber?: string
  fileName?: string
  buffer?: Buffer
  itemCount?: number
  /** 請求総額 (税込・円)。 */
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
    .select("name, contact_person, contact_email, billing_address")
    .eq("name", agencyName)
    .maybeSingle()

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

  const totalYen = items.reduce((sum, it) => sum + it.amountYen, 0) // 税込

  const issuedDate = formatJpDate(new Date())
  const closingDate = formatJpDate(new Date(year, mon, 0)) // 当月末
  const dueDate = formatJpDate(new Date(year, mon + 1, 0)) // 翌月末払い
  const period = `${year}年${mon}月分`

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
        taxRate: 0.1,
        taxInclusive: true, // ¥5,000 は税込 — 内税表示 (過大請求防止)
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
 * 金額は amount_yen (税込) を内税表示。charged_at を決済日として領収表示する。
 */
export async function buildChargeInvoice(
  sb: SupabaseClient,
  shipment: ShipmentRecord,
): Promise<BuildInvoiceResult> {
  const amountYen = shipment.charge_amount_yen ?? shipment.amount_yen ?? 0
  if (amountYen <= 0) return { ok: false, reason: "no_amount" }

  const { data: agencyRow } = await sb
    .from("agencies")
    .select("name, contact_person, contact_email, billing_address")
    .eq("name", shipment.agency)
    .maybeSingle()

  // 決済日 (JST)。charged_at が無ければ発行日を使う。
  const chargedAt = shipment.charged_at ? new Date(shipment.charged_at) : new Date()
  const chargedJst = new Date(chargedAt.getTime() + 9 * 3600 * 1000)
  const paidDate = `${chargedJst.getUTCFullYear()}年${chargedJst.getUTCMonth() + 1}月${chargedJst.getUTCDate()}日`
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
      amountYen,
    },
  ]

  const issuedDate = formatJpDate(new Date(chargedAt))
  // 対象期間は発送月
  const sm = /^(\d{4})-(\d{2})/.exec(shipment.shipment_date || "")
  const period = sm ? `${Number(sm[1])}年${Number(sm[2])}月` : issuedDate

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
        taxRate: 0.1,
        taxInclusive: true,
        paid: {
          method: "クレジットカード",
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
    totalYen: amountYen,
    agencyEmail: agencyRow?.contact_email ?? null,
    agencyContactPerson: agencyRow?.contact_person ?? null,
    period,
    dueDate: paidDate,
  }
}
