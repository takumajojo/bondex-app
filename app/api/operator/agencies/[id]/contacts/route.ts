import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import {
  listAgencyEmails,
  addAgencyEmail,
  removeAgencyEmail,
  listAgencyUsers,
  inviteAgencyUser,
  removeAgencyUser,
} from "@/lib/agency-contacts"

export const runtime = "nodejs"
export const maxDuration = 30

/**
 * 運営専用: 代理店の「通知メール(複数)」と「ログインユーザー(複数)」を管理する。
 * middleware operator ゲート配下 (default-deny)。
 *
 *   GET    /api/operator/agencies/[id]/contacts            → { emails:{primary,additional[]}, users[] }
 *   POST   /api/operator/agencies/[id]/contacts            body: { action:"add_email", email, label? }
 *                                                                { action:"invite_user", email }
 *   DELETE /api/operator/agencies/[id]/contacts            body: { action:"remove_email", emailId }
 *                                                                { action:"remove_user", userId }
 */
async function agencyInfo(sb: ReturnType<typeof getSupabase>, agencyId: string) {
  if (!sb) return null
  const { data } = await sb.from("agencies").select("id, name, locale").eq("id", agencyId).maybeSingle()
  return data as { id: string; name: string | null; locale: string | null } | null
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const agencyId = (id || "").trim()
  if (!agencyId) return NextResponse.json({ error: "agency id required" }, { status: 400 })
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  const [emails, users] = await Promise.all([listAgencyEmails(sb, agencyId), listAgencyUsers(sb, agencyId)])
  return NextResponse.json({ emails, users })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limit = rateLimit(req, "agency-contacts")
  if (!limit.ok) return limit.response
  const { id } = await ctx.params
  const agencyId = (id || "").trim()
  if (!agencyId) return NextResponse.json({ error: "agency id required" }, { status: 400 })
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })

  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }) }
  const action = String(body.action || "")

  if (action === "add_email") {
    const r = await addAgencyEmail(sb, agencyId, String(body.email || ""), { label: (body.label as string) ?? null, createdBy: "operator" })
    if (!r.ok) return NextResponse.json({ error: r.error || "追加に失敗しました" }, { status: r.duplicate ? 409 : 400 })
    return NextResponse.json({ ok: true, emails: await listAgencyEmails(sb, agencyId) })
  }
  if (action === "invite_user") {
    const ag = await agencyInfo(sb, agencyId)
    if (!ag) return NextResponse.json({ error: "agency not found" }, { status: 404 })
    const r = await inviteAgencyUser(sb, agencyId, String(body.email || ""), {
      agencyName: ag.name ?? undefined,
      locale: ag.locale === "en" ? "en" : "ja",
    })
    if (!r.ok) return NextResponse.json({ error: r.error || "招待に失敗しました" }, { status: 400 })
    return NextResponse.json({ ok: true, note: r.error ?? null, invited: !!r.invited, linkedExisting: !!r.linkedExisting, users: await listAgencyUsers(sb, agencyId) })
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limit = rateLimit(req, "agency-contacts")
  if (!limit.ok) return limit.response
  const { id } = await ctx.params
  const agencyId = (id || "").trim()
  if (!agencyId) return NextResponse.json({ error: "agency id required" }, { status: 400 })
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })

  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }) }
  const action = String(body.action || "")

  if (action === "remove_email") {
    const r = await removeAgencyEmail(sb, agencyId, String(body.emailId || ""))
    if (!r.ok) return NextResponse.json({ error: r.error || "削除に失敗しました" }, { status: 400 })
    return NextResponse.json({ ok: true, emails: await listAgencyEmails(sb, agencyId) })
  }
  if (action === "remove_user") {
    const r = await removeAgencyUser(sb, agencyId, String(body.userId || ""))
    if (!r.ok) return NextResponse.json({ error: r.error || "削除に失敗しました" }, { status: 400 })
    return NextResponse.json({ ok: true, users: await listAgencyUsers(sb, agencyId) })
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
