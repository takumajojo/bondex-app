import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { findDuplicateBookings } from "@/lib/shipments-db"
import { isSupabaseConfigured } from "@/lib/supabase"

export const runtime = "nodejs"
export const maxDuration = 15

/**
 * POST /api/shipments/duplicate-check — 二重発行の事前チェック
 *   body: { names: string[], dates: ["YYYY-MM-DD", ...] }
 *   → { configured, matches: [...] }
 *
 * 同じ氏名 (代表者 or 受取人) + 同じ発送日の既存予約 (キャンセル除く) を返す。
 * 発行を止めるものではなく、operator に「それでも発行するか」を確認させる用途。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "shipments-dup-check")
  if (!limit.ok) return limit.response

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ configured: false, matches: [] })
  }

  let body: { names?: unknown; dates?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON", matches: [] }, { status: 400 })
  }
  const names = Array.isArray(body.names)
    ? body.names.filter((n): n is string => typeof n === "string").slice(0, 10)
    : []
  const dates = Array.isArray(body.dates)
    ? body.dates.filter((d): d is string => typeof d === "string").slice(0, 10)
    : []

  try {
    const matches = await findDuplicateBookings({ names, dates })
    return NextResponse.json({ configured: true, matches })
  } catch (err) {
    // チェック失敗で発行を止めない (警告機能はベストエフォート)
    console.error("[duplicate-check] failed:", err instanceof Error ? err.message : err)
    return NextResponse.json({ configured: true, matches: [] })
  }
}
