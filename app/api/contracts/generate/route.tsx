import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { ContractDocument } from "@/lib/contract-pdf"

export const runtime = "nodejs"
export const maxDuration = 30

function formatJpDate(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/**
 * 代理店業務委託契約書 PDF を生成する.
 *
 * GET /api/contracts/generate?agency=My+Japan+Planner
 *   agency name (agencies テーブルから情報補完)
 */
export async function GET(req: NextRequest) {
  try {
    const limit = rateLimit(req, "contracts-generate")
    if (!limit.ok) return limit.response

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
    }
    const sb = getSupabase()
    if (!sb) {
      return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })
    }

    const agencyName = req.nextUrl.searchParams.get("agency")?.trim() || ""
    if (!agencyName) {
      return NextResponse.json({ error: "agency is required" }, { status: 400 })
    }

    const { data: agencyRow, error } = await sb
      .from("agencies")
      .select("name, contact_person, billing_address")
      .eq("name", agencyName)
      .maybeSingle()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!agencyRow) {
      return NextResponse.json({ error: "Agency not found" }, { status: 404 })
    }

    const today = new Date()
    const contractNumber = `BDX-CONTRACT-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}-${(agencyName.length % 100).toString().padStart(3, "0")}`

    const doc = (
      <ContractDocument
        data={{
          contractNumber,
          effectiveDate: formatJpDate(today),
          agency: {
            name: agencyRow.name,
            // 代表者役職・氏名・住所は契約時に手書きしてもらう前提でテンプレに空欄を残す
            representativeTitle: undefined,
            representativeName: agencyRow.contact_person ?? undefined,
            address: agencyRow.billing_address ?? undefined,
          },
          bondex: {
            companyName: "株式会社JOJO",
            representativeTitle: "代表取締役",
            representativeName: "谷口 琢真",
            address: "〒158-0092 東京都世田谷区野毛1-9-12",
            phone: "+81-90-1680-1142",
            email: "support@bondex.express",
            bankInfo: "三菱UFJ銀行 田園調布駅前支店 普通 0145653 株式会社JOJO",
          },
          pricePerSuitcaseYen: 5000,
          serviceBrandName: "BondEx",
        }}
      />
    )

    const buf = await renderToBuffer(doc)
    const fileName = `bondex-contract-${agencyName.replace(/\s+/g, "_")}-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}.pdf`
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
