import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { regenerateVoucherPdf } from "@/lib/voucher-regen"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 既存の発行済データから Voucher PDF を再生成する (運営用).
 *
 * GET /api/voucher/regenerate?booking_id=BDX-260630-428
 *
 * 用途:
 *   - 旅行者が voucher PDF を紛失した
 *   - ホテル側に再送付したい
 *   - 印刷ミス
 *
 * 認証: middleware で OPERATOR_PASSWORD ゲート済み (全予約アクセス可)。
 * 代理店向けの自社限定再発行は /api/agency/voucher を参照。
 * 注: Yamato 送り状の再発行はこちらでは行わない (Ship&co 側で取得).
 */
export async function GET(req: NextRequest) {
  try {
    const limit = rateLimit(req, "voucher-regenerate")
    if (!limit.ok) return limit.response

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
    }
    const sb = getSupabase()
    if (!sb) {
      return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })
    }

    const bookingId = req.nextUrl.searchParams.get("booking_id")?.trim() || ""
    if (!/^BDX-[\dA-Z]+-[\dA-Z]+$/i.test(bookingId)) {
      return NextResponse.json({ error: "Invalid booking_id" }, { status: 400 })
    }

    // 既定でガイド同梱。?howto=0 のときだけ省く。
    const includeHowto = req.nextUrl.searchParams.get("howto") !== "0"
    const outcome = await regenerateVoucherPdf(sb, bookingId, { includeHowto })
    if (!outcome.ok) {
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
