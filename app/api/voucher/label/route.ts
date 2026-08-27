import { NextRequest, NextResponse } from "next/server"
import { PDFDocument } from "pdf-lib"
import { rateLimit } from "@/lib/rate-limit"
import { buildVoucherFileName, carrierFileLabel } from "@/lib/utils"
import { getSupabase } from "@/lib/supabase"

export const runtime = "nodejs"
export const maxDuration = 30

// A4 縦 (pt, 72dpi): 210mm × 297mm。
const A4_W = 595.276
const A4_H = 841.89
const A4_MARGIN = 14 // ~5mm。ラベル外周に最小限の余白を残す。

/**
 * Ship&co の A5 送り状 PDF を A4 に「等倍・中央配置」で載せ替えて返す。
 *
 * 目的: 送り状は A5 で出力される。A5 の PDF をオフィスの A4 プリンタで印刷すると、
 * ビューアの「用紙に合わせる」が A5→A4 に自動拡大してレイアウトがずれる。
 * ここで **中身は原寸のまま A4 ページに載せ替える** ことで、印刷ダイアログが
 * 「用紙に合わせる」でも「実寸」でも拡大縮小の余地がなくなり、常にきれいに出る。
 * 拡大はせず (scale<=1)、A4 に収まらない場合のみ縮小する。複数枚口 (2/2 等) も全ページ処理。
 */
async function normalizeA5toA4(srcBytes: ArrayBuffer): Promise<Uint8Array> {
  const src = await PDFDocument.load(srcBytes)
  const out = await PDFDocument.create()
  // embedPdf は別ドキュメントのページを安全に取り込む (リソースも複製)。全ページを対象にする。
  const embedded = await out.embedPdf(src, src.getPageIndices())
  for (const emb of embedded) {
    const page = out.addPage([A4_W, A4_H])
    const scale = Math.min(1, (A4_W - 2 * A4_MARGIN) / emb.width, (A4_H - 2 * A4_MARGIN) / emb.height)
    const w = emb.width * scale
    const h = emb.height * scale
    page.drawPage(emb, { x: (A4_W - w) / 2, y: (A4_H - h) / 2, width: w, height: h })
  }
  return out.save()
}

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
  // paper=a4 → A5 を A4 に等倍・中央で載せ替え、画面表示 (inline) で返す (きれい印刷用)。
  const paperA4 = req.nextUrl.searchParams.get("paper")?.trim().toLowerCase() === "a4"

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

  // ファイル名用に、この区間のキャリア・旅程番号・代表者を DB から引く (印刷ページ経由では
  // クエリに乗らないため)。引けなければクエリ値/既定(佐川)にフォールバック。
  // leg は "L1" 形式なので leg_index=番号-1 に変換して照合。
  let carrier: string | null = null
  let dbTour: string | null = null
  let dbRep: string | null = null
  try {
    const legIndex = /^L(\d+)$/i.exec(legLabel)?.[1]
    const sb = getSupabase()
    if (sb && legIndex) {
      const { data } = await sb
        .from("shipments")
        .select("carrier, tour_number, representative")
        .eq("booking_id", bookingId)
        .eq("leg_index", Number(legIndex) - 1)
        .maybeSingle()
      carrier = (data?.carrier as string | undefined) ?? null
      dbTour = (data?.tour_number as string | undefined) ?? null
      dbRep = (data?.representative as string | undefined) ?? null
    }
  } catch {
    /* 取得失敗時はクエリ値/既定にフォールバック */
  }
  const carrierName = carrierFileLabel(carrier)

  // 旅程番号は必ず含める: クエリ優先、無ければ DB 値。
  const baseName = buildVoucherFileName({
    bookingId,
    tourNumber: tourNumber || dbTour || undefined,
    representativeLabel: representativeLabel || dbRep || "",
    kind: "label",
  }).replace(/\.pdf$/, "")
  const fileName = legLabel ? `${baseName}_${legLabel}_${carrierName}.pdf` : `${baseName}_${carrierName}.pdf`

  // A4 きれい印刷: A5 を A4 に載せ替えて inline 表示 (印刷ダイアログをそのまま印刷できる)。
  if (paperA4) {
    try {
      const srcBytes = await upstream.arrayBuffer()
      const a4 = await normalizeA5toA4(srcBytes)
      const a4Name = fileName.replace(/\.pdf$/, "_A4.pdf")
      return new NextResponse(Buffer.from(a4), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${a4Name}"`,
          "Cache-Control": "no-store",
        },
      })
    } catch (e) {
      // 正規化に失敗しても発行済みラベルは渡せるように、原本 (A5) にフォールバック。
      console.error("[voucher/label] A4 正規化に失敗、A5 原本にフォールバック:", e instanceof Error ? e.message : e)
      const passthrough = await fetch(parsed.toString())
      if (passthrough.ok && passthrough.body) {
        return new NextResponse(passthrough.body, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${fileName}"`,
            "Cache-Control": "no-store",
          },
        })
      }
      return NextResponse.json({ error: "failed to normalize label" }, { status: 502 })
    }
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  })
}
