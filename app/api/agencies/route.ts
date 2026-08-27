import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { sendMail } from "@/lib/mailer"
import { isHotelNotificationMode } from "@/lib/hotel-notification"

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
      .select("id, name, contact_email, contact_person, contact_phone, country, is_domestic, locale, payment_method, status, contract_status, card_on_file, billing_exempt, hotel_notification_mode, created_via, created_at")
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
 * PATCH /api/agencies — 代理店の承認 / 却下 / 停止 / やり取り言語の変更
 *   body: { id, status?: 'active'|'suspended'|'pending', locale?: 'ja'|'en' }
 * status か locale の少なくとも一方が必要。(却下 = suspended。完全削除は行わない)
 */
const ALLOWED_STATUS = ["active", "suspended", "pending"] as const

export async function PATCH(req: NextRequest) {
  const limit = rateLimit(req, "agencies-patch")
  if (!limit.ok) return limit.response

  const sb = getSupabase()
  if (!sb) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  }

  let body: { id?: unknown; status?: unknown; locale?: unknown; hotelNotificationMode?: unknown }
  try {
    body = (await req.json()) as { id?: unknown; status?: unknown; locale?: unknown; hotelNotificationMode?: unknown }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const id = typeof body.id === "string" ? body.id.trim() : ""
  const status = typeof body.status === "string" ? body.status.trim() : ""
  const localeRaw = typeof body.locale === "string" ? body.locale.trim() : ""
  const locale = localeRaw === "ja" || localeRaw === "en" ? localeRaw : ""
  const hasMode = body.hotelNotificationMode !== undefined
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })
  if (!status && !locale && !hasMode) {
    return NextResponse.json({ error: "status, locale or hotelNotificationMode is required" }, { status: 400 })
  }
  if (status && !(ALLOWED_STATUS as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "status must be active / suspended / pending" }, { status: 400 })
  }
  if (hasMode && !isHotelNotificationMode(body.hotelNotificationMode)) {
    return NextResponse.json({ error: "hotelNotificationMode must be guest_only / pickup_only / dual" }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (status) update.status = status
  if (locale) update.locale = locale
  if (hasMode) update.hotel_notification_mode = body.hotelNotificationMode

  const { data, error } = await sb
    .from("agencies")
    .update(update)
    .eq("id", id)
    .select("id, name, status, contact_email, locale")
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 承認(active化)時は代理店へ「承認されました」通知（代理店の言語で送る）。best-effort。
  if (status === "active" && data?.contact_email) {
    const loc = data.locale === "en" ? "en" : "ja"
    const text =
      loc === "en"
        ? [
            `Dear ${data.name},`,
            "",
            "Your BondEx account has been approved. You can now log in and submit issuance requests.",
            "",
            "▼ Log in",
            "https://bondex.express/agency/login",
            "",
            "Before your first use, please sign the service agreement (from “Sign the contract” in the portal).",
            "",
            "Questions? Contact us at support@bondex.express.",
            "— BondEx / JOJO Inc.",
          ].join("\n")
        : [
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
          ].join("\n")
    try {
      await sendMail({
        to: data.contact_email,
        replyTo: process.env.ALERT_EMAIL || "support@bondex.express",
        subject: loc === "en" ? "[BondEx] Your account is approved" : "【BondEx】アカウントが承認されました",
        text,
      })
    } catch (e) {
      console.error("[agencies] 承認通知メール失敗:", e instanceof Error ? e.message : e)
    }
  }

  return NextResponse.json({ ok: true, agency: data })
}
