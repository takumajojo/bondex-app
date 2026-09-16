import { NextRequest, NextResponse } from "next/server"
import { get } from "@/lib/photos-store"

export const runtime = "nodejs"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const photo = get(id)
  if (!photo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  // Content-Type はクライアント申告値由来。非ASCII等が混ざると Response 構築で throw するため、
  // ASCII の image/<subtype> だけをそのまま出し、外れる値は octet-stream に落とす。
  const safeType = /^image\/[a-z0-9.+-]+$/.test(photo.mediaType)
    ? photo.mediaType
    : "application/octet-stream"
  return new NextResponse(new Uint8Array(photo.buffer), {
    status: 200,
    headers: {
      "Content-Type": safeType,
      "Cache-Control": "private, max-age=3600",
    },
  })
}
