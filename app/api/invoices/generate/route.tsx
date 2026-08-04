import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { buildMonthlyInvoice } from "@/lib/invoice-build"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 月次請求書 PDF 生成 (BondEx → 代理店) の手動DL。
 *
 * GET /api/invoices/generate?agency=My+Japan+Planner&month=2026-06
 *   month: YYYY-MM。その月の shipments (issued / picked_up / in_transit / delivered) を集計。
 *
 * 実際の組み立ては lib/invoice-build.ts に集約 (cron/monthly-invoices と共通・税込内税表示)。
 * BondEx admin (/operator) 限定 — middleware で認証済み。
 */
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

  const built = await buildMonthlyInvoice(sb, agency, monthRaw)
  if (!built.ok || !built.buffer) {
    const status = built.reason === "no_shipments" ? 404 : 500
    const error =
      built.reason === "no_shipments"
        ? "No shipments found for this agency and month"
        : built.reason || "Failed to build invoice"
    return NextResponse.json({ error }, { status })
  }

  return new NextResponse(new Uint8Array(built.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${built.fileName}"`,
      "Cache-Control": "no-store",
    },
  })
}
