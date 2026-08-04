import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"

export const runtime = "nodejs"
export const maxDuration = 30

/**
 * 導入相談 / 問い合わせ (contact_inquiries) の運営用一覧・対応済み更新。
 * middleware の operator ゲート配下 (要 OPERATOR_PASSWORD)。
 * 公開フォーム POST /api/contact が service_role で保存した行を読む。
 */

export async function GET(req: NextRequest) {
  try {
    const limit = rateLimit(req, "inquiries-list")
    if (!limit.ok) return limit.response
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ configured: false, inquiries: [] })
    }
    const sb = getSupabase()
    if (!sb) return NextResponse.json({ configured: false, inquiries: [] })

    const { data, error } = await sb
      .from("contact_inquiries")
      .select("id, company, name, email, message, source, handled, created_at")
      .order("created_at", { ascending: false })
      .limit(200)

    if (error) {
      return NextResponse.json({ configured: true, inquiries: [], error: error.message }, { status: 500 })
    }
    return NextResponse.json({ configured: true, inquiries: data ?? [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ configured: false, inquiries: [], error: msg }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const limit = rateLimit(req, "inquiries-update")
    if (!limit.ok) return limit.response
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
    }
    const sb = getSupabase()
    if (!sb) return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })

    const body = (await req.json()) as Record<string, unknown>
    const id = typeof body.id === "string" ? body.id : ""
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
    const handled = body.handled === true

    const { error } = await sb.from("contact_inquiries").update({ handled }).eq("id", id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
