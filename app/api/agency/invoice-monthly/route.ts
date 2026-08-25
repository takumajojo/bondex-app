import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { getSupabase } from "@/lib/supabase"
import { buildMonthlyInvoice } from "@/lib/invoice-build"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * GET /api/agency/invoice-monthly?month=YYYY-MM
 *
 * 代理店ポータルの「月別ご利用状況」から、自社の月次請求書PDFをセルフDLする。
 * 認証: Supabase JWT (代理店本人)。自社名で buildMonthlyInvoice を実行するため
 * 他社の請求書は構造的に取得できない。
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "agency-invoice-monthly")
  if (!limit.ok) return limit.response

  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const en = auth.agency.locale === "en"

  const month = req.nextUrl.searchParams.get("month")?.trim() || ""
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month (YYYY-MM) is required" }, { status: 400 })
  }

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase unavailable" }, { status: 500 })

  const built = await buildMonthlyInvoice(sb, auth.agency.name, month)
  if (!built.ok || !built.buffer) {
    return NextResponse.json(
      {
        error: en
          ? "No billable shipments in this month."
          : "この月のご請求対象がありません。",
      },
      { status: 404 },
    )
  }

  return new NextResponse(new Uint8Array(built.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${built.fileName ?? `bondex-invoice-${month}.pdf`}"`,
      "Cache-Control": "no-store",
    },
  })
}
