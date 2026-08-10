import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { buildVoucherFileName, carrierFileLabel } from "@/lib/utils"
import { getSupabase } from "@/lib/supabase"

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

  // ファイル名にはこの区間の実際のキャリア (佐川/ヤマト) を反映する。DB から引けなければ
  // 既定 (佐川) にフォールバック。leg は "L1" 形式なので leg_index=番号-1 に変換して照合。
  let carrier: string | null = null
  try {
    const legIndex = /^L(\d+)$/i.exec(legLabel)?.[1]
    const sb = getSupabase()
    if (sb && legIndex) {
      const { data } = await sb
        .from("shipments")
        .select("carrier")
        .eq("booking_id", bookingId)
        .eq("leg_index", Number(legIndex) - 1)
        .maybeSingle()
      carrier = (data?.carrier as string | undefined) ?? null
    }
  } catch {
    /* 取得失敗時は既定(佐川)にフォールバック */
  }
  const carrierName = carrierFileLabel(carrier)

  const baseName = buildVoucherFileName({
    bookingId,
    tourNumber,
    representativeLabel,
    kind: "label",
  }).replace(/\.pdf$/, "")
  const fileName = legLabel ? `${baseName}_${legLabel}_${carrierName}.pdf` : `${baseName}_${carrierName}.pdf`

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  })
}
