import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { sendMail } from "@/lib/mailer"

export const runtime = "nodejs"

/**
 * GET /api/agencies — 代理店マスタの一覧
 * (BondEx 管理ダッシュボード — 請求書発行の選択肢 + 承認管理)
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
      .select("id, name, contact_email, contact_person, contact_phone, country, is_domestic, payment_method, status, card_on_file, created_via, created_at")
      .order("created_at", { ascending: false })

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

/**
 * PATCH /api/agencies — 代理店の承認 / 却下 / 停止
 *   body: { id, status: 'active' | 'suspended' | 'pending' }
 * (却下 = suspended として扱う。完全削除は行わない)
 */
const ALLOWED_STATUS = ["active", "suspended", "pending"] as const

export async function PATCH(req: NextRequest) {
  const limit = rateLimit(req, "agencies-patch")
  if (!limit.ok) return limit.response

  const sb = getSupabase()
  if (!sb) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  }

  let body: { id?: unknown; status?: unknown }
  try {
    body = (await req.json()) as { id?: unknown; status?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const id = typeof body.id === "string" ? body.id.trim() : ""
  const status = typeof body.status === "string" ? body.status.trim() : ""
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })
  if (!(ALLOWED_STATUS as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "status must be active / suspended / pending" }, { status: 400 })
  }

  const { data, error } = await sb
    .from("agencies")
    .update({ status })
    .eq("id", id)
    .select("id, name, status, contact_email")
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 承認(active化)時は代理店へ「承認されました」通知。best-effort(失敗しても承認は成立)。
  if (status === "active" && data?.contact_email) {
    try {
      await sendMail({
        to: data.contact_email,
        replyTo: process.env.ALERT_EMAIL || "support@bondex.express",
        subject: "【BondEx】アカウントが承認されました",
        text: [
          `${data.name} 御中`,
          "",
          "平素より大変お世話になっております。BondEx（株式会社JOJO）でございます。",
          "アカウントのご登録が承認されました。ログインして発行依頼をご利用いただけます。",
          "",
          "▼ ログイン",
          "https://bondex.express/agency/login",
          "",
          "初回のご利用前に、契約書へのご署名をお願いしております（ポータルの「契約書に署名」から）。",
          "",
          "ご不明な点は support@bondex.express までお問い合わせください。",
        ].join("\n"),
      })
    } catch (e) {
      console.error("[agencies] 承認通知メール失敗:", e instanceof Error ? e.message : e)
    }
  }

  return NextResponse.json({ ok: true, agency: data })
}
