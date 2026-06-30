import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"

export const runtime = "nodejs"

/**
 * GET /api/agencies — 代理店マスタの一覧
 * (BondEx 管理ダッシュボード — 請求書発行 UI で代理店選択肢を作るため)
 */
export async function GET(req: NextRequest) {
  try {
    const limit = rateLimit(req, "agencies-list")
    if (!limit.ok) return limit.response

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ agencies: [], configured: false })
    }
    const sb = getSupabase()
    if (!sb) {
      return NextResponse.json({ agencies: [], configured: false })
    }
    const { data, error } = await sb
      .from("agencies")
      .select("id, name, contact_email, contact_person")
      .order("name", { ascending: true })

    if (error) {
      return NextResponse.json(
        { agencies: [], error: error.message, configured: true },
        { status: 500 },
      )
    }
    return NextResponse.json({ agencies: data ?? [], configured: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ agencies: [], error: msg }, { status: 500 })
  }
}
