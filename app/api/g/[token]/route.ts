import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveShareToken } from "@/lib/group-shares"
import { buildGroupView } from "@/lib/group-view"

export const runtime = "nodejs"

/**
 * GET /api/g/[token] — 添乗員向けの公開・読み取り専用 団体ビュー。
 * 期限付きトークンで該当団体だけを返す (料金/請求データは元々含まれない)。
 * middleware の公開許可リスト (/api/g/) 配下。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limit = rateLimit(req, "group-share-view")
  if (!limit.ok) return limit.response

  const { token } = await params
  const bookingId = await resolveShareToken(token)
  // 無効・期限切れ・失効は一律 404 (トークンの存在を推測させない)
  if (!bookingId) return NextResponse.json({ error: "not found" }, { status: 404 })

  const r = await buildGroupView(bookingId)
  if (r.status !== 200) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json(r.payload)
}
