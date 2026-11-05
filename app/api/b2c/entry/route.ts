import { NextRequest, NextResponse } from "next/server"
import { b2cGuard } from "@/lib/b2c/api-common"

export const runtime = "nodejs"

/** POST /api/b2c/entry { token } — 入口の URL が有効か。紹介元の名前だけを返す。 */
export async function POST(req: NextRequest) {
  const g = await b2cGuard(req, "b2c-entry")
  if (!g.ok) return g.res
  return NextResponse.json({ ok: true, referrerName: g.entry.referrerName })
}
