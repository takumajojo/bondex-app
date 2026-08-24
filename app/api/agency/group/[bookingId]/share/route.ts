import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { createGroupShare } from "@/lib/group-shares"
import { buildGroupView } from "@/lib/group-view"

export const runtime = "nodejs"

/**
 * POST /api/agency/group/[bookingId]/share — 添乗員向け共有リンクの発行 (代理店・自社予約のみ)。
 *   body: { days?: number (1-90・既定14) } → { url, expiresAt }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const limit = rateLimit(req, "agency-group-share")
  if (!limit.ok) return limit.response
  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { bookingId } = await params
  if (!/^BDX-[\dA-Z]+(-[\dA-Z]+)?$/i.test(bookingId)) {
    return NextResponse.json({ error: "invalid bookingId" }, { status: 400 })
  }
  const bid = bookingId.toUpperCase()

  // 所有権チェック (他社の予約に共有リンクを発行させない)
  const view = await buildGroupView(bid)
  if (view.status !== 200 || view.payload.agency !== auth.agency.name) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  let body: { days?: unknown } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    /* 既定値 */
  }
  const days = Math.min(90, Math.max(1, Math.floor(Number(body.days) || 14)))
  const r = await createGroupShare(bid, days, auth.agency.name)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({
    ok: true,
    url: `https://bondex.express/g/${r.token}`,
    expiresAt: r.expiresAt,
  })
}
