import { NextRequest, NextResponse } from "next/server"
import { PDFDocument } from "pdf-lib"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"

export const runtime = "nodejs"
export const maxDuration = 60

// Ship&co の Yamato ラベルは GCS 配信 (label proxy と同じ許可ホスト)
const ALLOWED_LABEL_HOST = "storage.googleapis.com"

/**
 * GET /api/voucher/labels?booking_id=BDX-XXXXXX-XXX
 *
 * 予約の全区間の送り状 PDF を 1 つに結合して返す (区間が多い予約の
 * 一括印刷用)。キャンセル済み区間と未発行区間はスキップする。
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "voucher-labels-bundle")
  if (!limit.ok) return limit.response

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  }
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase unavailable" }, { status: 500 })

  const bookingId = req.nextUrl.searchParams.get("booking_id")?.trim() || ""
  if (!/^BDX-[\dA-Z]+-[\dA-Z]+$/i.test(bookingId)) {
    return NextResponse.json({ error: "invalid booking_id" }, { status: 400 })
  }

  const { data, error } = await sb
    .from("shipments")
    .select("leg_index, yamato_label_url, status")
    .eq("booking_id", bookingId)
    .neq("status", "cancelled")
    .order("leg_index", { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const urls = (data ?? [])
    .map((r) => r.yamato_label_url as string | null)
    .filter((u): u is string => !!u)
    .filter((u) => {
      try {
        return new URL(u).hostname === ALLOWED_LABEL_HOST
      } catch {
        return false
      }
    })
  if (urls.length === 0) {
    return NextResponse.json({ error: "発行済みの送り状がありません" }, { status: 404 })
  }

  try {
    const merged = await PDFDocument.create()
    for (const u of urls) {
      const res = await fetch(u)
      if (!res.ok) continue
      const src = await PDFDocument.load(await res.arrayBuffer())
      const pages = await merged.copyPages(src, src.getPageIndices())
      pages.forEach((pg) => merged.addPage(pg))
    }
    if (merged.getPageCount() === 0) {
      return NextResponse.json({ error: "送り状の取得に失敗しました" }, { status: 502 })
    }
    const bytes = await merged.save()
    return new NextResponse(new Uint8Array(bytes) as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="BondEx_${bookingId}_Yamato_Labels.pdf"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "merge failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
