import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { buildVoucherFileName } from "@/lib/utils"

export const runtime = "nodejs"
export const maxDuration = 30

// Ship&co serves Yamato labels from Google Cloud Storage with an opaque
// filename (e.g. "ZsFmgweHhnuAaiW6J.pdf"). Cross-origin resources ignore the
// anchor `download` attribute in most browsers, so the only reliable way to
// hand the operator a well-named file is to fetch it server-side (same
// origin as our app) and re-serve it with our own Content-Disposition.
const ALLOWED_LABEL_HOST = "storage.googleapis.com"

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "voucher-label")
  if (!limit.ok) return limit.response

  const url = req.nextUrl.searchParams.get("url")?.trim() || ""
  const bookingId = req.nextUrl.searchParams.get("bookingId")?.trim() || ""
  const tourNumber = req.nextUrl.searchParams.get("tourNumber")?.trim() || undefined
  const representativeLabel = req.nextUrl.searchParams.get("representative")?.trim() || ""
  const legLabel = req.nextUrl.searchParams.get("leg")?.trim() || ""

  if (!url || !bookingId) {
    return NextResponse.json({ error: "url and bookingId are required" }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 })
  }
  // ship&co ラベルのみ許可 — 任意 URL のプロキシ悪用 (SSRF) を防ぐ
  if (parsed.hostname !== ALLOWED_LABEL_HOST) {
    return NextResponse.json({ error: "url not allowed" }, { status: 400 })
  }

  const upstream = await fetch(parsed.toString())
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "failed to fetch label" }, { status: 502 })
  }

  const baseName = buildVoucherFileName({
    bookingId,
    tourNumber,
    representativeLabel,
    kind: "voucher",
  }).replace(/\.pdf$/, "")
  const fileName = legLabel ? `${baseName}_${legLabel}_Yamato.pdf` : `${baseName}_Yamato.pdf`

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  })
}
