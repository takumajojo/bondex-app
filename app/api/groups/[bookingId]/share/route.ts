import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { createGroupShare } from "@/lib/group-shares"

export const runtime = "nodejs"

/**
 * POST /api/groups/[bookingId]/share — 添乗員向け共有リンクの発行 (運営)。
 *   body: { days?: number (1-90・既定14) }
 *   → { url, expiresAt }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const limit = rateLimit(req, "groups-share")
  if (!limit.ok) return limit.response
  const { bookingId } = await params
  if (!/^BDX-[\dA-Z]+(-[\dA-Z]+)?$/i.test(bookingId)) {
    return NextResponse.json({ error: "invalid bookingId" }, { status: 400 })
  }
  let body: { days?: unknown } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    /* body 無しは既定値 */
  }
  const days = Math.min(90, Math.max(1, Math.floor(Number(body.days) || 14)))
  const r = await createGroupShare(bookingId.toUpperCase(), days, "operator")
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({
    ok: true,
    url: `https://bondex.express/g/${r.token}`,
    expiresAt: r.expiresAt,
  })
}
