import { NextRequest, NextResponse } from "next/server"
import { get } from "@/lib/photos-store"

export const runtime = "nodejs"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const photo = get(id)
  if (!photo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return new NextResponse(new Uint8Array(photo.buffer), {
    status: 200,
    headers: {
      "Content-Type": photo.mediaType,
      "Cache-Control": "private, max-age=3600",
    },
  })
}
