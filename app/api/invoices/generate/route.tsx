import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { InvoiceDocument, type InvoiceLineItem } from "@/lib/invoice-pdf"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 月次請求書 PDF 生成 (BondEx → 代理店).
 *
 * GET /api/invoices/generate?agency=My+Japan+Planner&month=2026-06
 *   month: YYYY-MM. その月の shipments (issued / picked_up / in_transit / delivered) を集計.
 *
 * BondEx admin (/operator) 限定 — middleware で 認証済み.
 */

function formatJpDate(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

function endOfNextMonth(year: number, month: number): Date {
  // month は 1-12. 翌月末日を返す.
  return new Date(year, month + 1, 0)
}

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "invoices-generate")
  if (!limit.ok) return limit.response

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  }
  const sb = getSupabase()
  if (!sb) {
    return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })
  }

  const agency = req.nextUrl.searchParams.get("agency")?.trim() || ""
  const monthRaw = req.nextUrl.searchParams.get("month")?.trim() || ""

  if (!agency || !/^\d{4}-\d{2}$/.test(monthRaw)) {
    return NextResponse.json(
      { error: "agency and month (YYYY-MM) are required" },
      { status: 400 },
    )
  }
  const [yearStr, monthStr] = monthRaw.split("-")
  const year = Number(yearStr)
  const month = Number(monthStr)
  const fromDate = `${monthRaw}-01`
  const toDate = `${monthRaw}-31`  // 月末より後でも OK (date 比較なら問題なし)

  // 該当月の shipments を取得 — 失敗/キャンセル除外
  const { data, error } = await sb
    .from("shipments")
    .select(
      "booking_id, leg_index, shipment_date, from_hotel, to_hotel, representative, suitcase_count, amount_yen, status",
    )
    .eq("agency", agency)
    .gte("shipment_date", fromDate)
    .lte("shipment_date", toDate)
    .in("status", ["issued", "picked_up", "in_transit", "delivered"])
    .order("shipment_date", { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "No shipments found for this agency and month" },
      { status: 404 },
    )
  }

  // 代理店情報を取得 (連絡先など)
  const { data: agencyRow } = await sb
    .from("agencies")
    .select("name, contact_person, billing_address")
    .eq("name", agency)
    .maybeSingle()

  // 請求書番号: INV-YYYYMM-{agencyHash3}
  const agencyHash = Math.abs(
    agency.split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0),
  )
    .toString(36)
    .slice(0, 4)
    .toUpperCase()
  const invoiceNumber = `INV-${yearStr}${monthStr}-${agencyHash}`

  const items: InvoiceLineItem[] = data.map((s) => ({
    shipmentDate: s.shipment_date,
    bookingRef: `${s.booking_id}-L${(s.leg_index ?? 0) + 1}`,
    fromHotel: s.from_hotel ?? "",
    toHotel: s.to_hotel ?? "",
    representative: s.representative ?? "",
    suitcaseCount: s.suitcase_count ?? 0,
    amountYen: s.amount_yen ?? 0,
  }))

  const issuedDate = formatJpDate(new Date())
  const dueDate = formatJpDate(endOfNextMonth(year, month))
  const period = `${year}年${month}月分`

  const doc = (
    <InvoiceDocument
      data={{
        invoiceNumber,
        issuedDate,
        period,
        dueDate,
        agency: {
          name: agency,
          contactPerson: agencyRow?.contact_person ?? undefined,
          billingAddress: agencyRow?.billing_address ?? undefined,
        },
        bondex: {
          companyName: "株式会社JOJO",
          address: "〒158-0092 東京都世田谷区野毛1-9-12",
          phone: "+81-90-1680-1142",
          email: "support@bondex.express",
          bankInfo: "三菱UFJ銀行 ◯◯支店 普通 1234567 カ）ジョジョ",
          // 適格請求書登録番号は取得後にここを差し替える
        },
        items,
        taxRate: 0.10,
      }}
    />
  )

  const buf = await renderToBuffer(doc)
  const fileName = `bondex-invoice-${invoiceNumber}.pdf`
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  })
}
