import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { regenerateVoucherPdf } from "@/lib/voucher-regen"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 代理店による自社バウチャーの再発行 (再ダウンロード)。
 *
 *   GET /api/agency/voucher?booking_id=BDX-260630-428
 *   Authorization: Bearer <Supabase access token>
 *
 * middleware の OPERATOR_PASSWORD ゲート対象外 (/api/agency/* は public) なので、
 * ここで Supabase JWT を検証し、かつ「その予約が自社のものか」を必ず確認する。
 * 他社の booking_id を渡されても forbidden で弾く (漏洩防止)。
 */
export async function GET(req: NextRequest) {
  try {
    const limit = rateLimit(req, "agency-voucher")
    if (!limit.ok) return limit.response

    const auth = await resolveAgencyFromRequest(req)
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const bookingId = req.nextUrl.searchParams.get("booking_id")?.trim() || ""
    if (!/^BDX-[\dA-Z]+-[\dA-Z]+$/i.test(bookingId)) {
      return NextResponse.json({ error: "Invalid booking_id" }, { status: 400 })
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
    }
    const sb = getSupabase()
    if (!sb) {
      return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })
    }

    const outcome = await regenerateVoucherPdf(sb, bookingId, {
      expectedAgency: auth.agency.name,
    })
    if (!outcome.ok) {
      // 他社の予約 or 存在しない → どちらも 404 相当で存在を秘匿
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return new NextResponse(new Uint8Array(outcome.buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${outcome.fileName}"`,
        "X-Booking-Id": bookingId,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
