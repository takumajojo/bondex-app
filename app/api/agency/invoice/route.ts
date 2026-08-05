import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { getSupabase } from "@/lib/supabase"
import { getShipment } from "@/lib/shipments-db"
import { buildChargeInvoice } from "@/lib/invoice-build"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * GET /api/agency/invoice?shipment_id=<id>
 *
 * 代理店ポータルから、カード決済済み区間の「請求書 兼 領収書」を取得する。
 * 認証: Authorization: Bearer <Supabase access token> (代理店本人)。
 * 自社の shipment のみ (agency 名一致) かつ charged_at がある区間のみ許可。
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "agency-invoice")
  if (!limit.ok) return limit.response

  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const shipmentId = req.nextUrl.searchParams.get("shipment_id")?.trim() || ""
  if (!shipmentId) {
    return NextResponse.json({ error: "shipment_id is required" }, { status: 400 })
  }

  const shipment = await getShipment(shipmentId)
  if (!shipment) return NextResponse.json({ error: "not found" }, { status: 404 })

  // なりすまし防止: 自社の区間のみ
  if (shipment.agency !== auth.agency.name) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  // カード決済済みのみ (未決済の区間に領収書は出せない)
  if (!shipment.charged_at) {
    return NextResponse.json({ error: "この区間はまだ決済されていません。" }, { status: 404 })
  }

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "DB unavailable" }, { status: 500 })

  const built = await buildChargeInvoice(sb, shipment)
  if (!built.ok || !built.buffer) {
    return NextResponse.json({ error: built.reason || "failed to build" }, { status: 500 })
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
