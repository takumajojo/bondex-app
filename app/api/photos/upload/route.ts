import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { put } from "@/lib/photos-store"

export const runtime = "nodejs"

const MAX_BYTES = 5 * 1024 * 1024 // 5MB

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "photos-upload")
  if (!limit.ok) return limit.response

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: "Invalid multipart/form-data" }, { status: 400 })
  }

  const file = form.get("file")
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 })
  }

  const mediaType = file.type || ""
  if (!mediaType.startsWith("image/")) {
    return NextResponse.json({ error: "Only image/* is accepted" }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 5MB limit" }, { status: 400 })
  }

  const arrayBuf = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuf)
  const photoId = crypto.randomUUID()
  put(photoId, { buffer, mediaType })

  return NextResponse.json({
    photoId,
    url: `/api/photos/${photoId}`,
  })
}
