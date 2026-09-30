import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
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
 * 代理店セルフ: 自社の「通知メール(複数)」「ログインユーザー(複数)」を管理する。
 * 認証は Authorization: Bearer <Supabase access token>。resolveAgencyFromRequest で
 * 自社 agency を解決するので、他社は一切操作できない。
 *
 *   GET    /api/agency/contacts                       → { emails, users }
 *   POST   /api/agency/contacts   { action:"add_email", email } | { action:"invite_user", email }
 *   DELETE /api/agency/contacts   { action:"remove_email", emailId } | { action:"remove_user", userId }
 */
export async function GET(req: NextRequest) {
  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  const [emails, users] = await Promise.all([listAgencyEmails(sb, auth.agency.id), listAgencyUsers(sb, auth.agency.id)])
  return NextResponse.json({ emails, users })
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "agency-contacts-self")
  if (!limit.ok) return limit.response
  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })

  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }) }
  const action = String(body.action || "")
  const agencyId = auth.agency.id

  if (action === "add_email") {
    const r = await addAgencyEmail(sb, agencyId, String(body.email || ""), { createdBy: "agency" })
    if (!r.ok) return NextResponse.json({ error: r.error || "追加に失敗しました" }, { status: r.duplicate ? 409 : 400 })
    return NextResponse.json({ ok: true, emails: await listAgencyEmails(sb, agencyId) })
  }
  if (action === "invite_user") {
    const r = await inviteAgencyUser(sb, agencyId, String(body.email || ""), {
      agencyName: auth.agency.name,
      locale: auth.agency.locale === "en" ? "en" : "ja",
    })
    if (!r.ok) return NextResponse.json({ error: r.error || "招待に失敗しました" }, { status: 400 })
    return NextResponse.json({ ok: true, note: r.error ?? null, invited: !!r.invited, linkedExisting: !!r.linkedExisting, users: await listAgencyUsers(sb, agencyId) })
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}

export async function DELETE(req: NextRequest) {
  const limit = rateLimit(req, "agency-contacts-self")
  if (!limit.ok) return limit.response
  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })

  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }) }
  const action = String(body.action || "")
  const agencyId = auth.agency.id

  if (action === "remove_email") {
    const r = await removeAgencyEmail(sb, agencyId, String(body.emailId || ""))
    if (!r.ok) return NextResponse.json({ error: r.error || "削除に失敗しました" }, { status: 400 })
    return NextResponse.json({ ok: true, emails: await listAgencyEmails(sb, agencyId) })
  }
  if (action === "remove_user") {
    const targetUserId = String(body.userId || "")
    // 自分自身は外せない(ロックアウト防止)
    if (targetUserId === auth.userId) return NextResponse.json({ error: "自分自身は削除できません" }, { status: 400 })
    const r = await removeAgencyUser(sb, agencyId, targetUserId)
    if (!r.ok) return NextResponse.json({ error: r.error || "削除に失敗しました" }, { status: 400 })
    return NextResponse.json({ ok: true, users: await listAgencyUsers(sb, agencyId) })
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
