import { NextRequest, NextResponse } from "next/server"
import { PDFDocument } from "pdf-lib"
import { rateLimit } from "@/lib/rate-limit"
import { buildVoucherFileName, carrierFileLabel } from "@/lib/utils"
import { getSupabase } from "@/lib/supabase"

export const runtime = "nodejs"
export const maxDuration = 30

// A5 (pt, 72dpi): 148mm × 210mm。短辺=A5_SHORT / 長辺=A5_LONG。
const A5_SHORT = 419.528 // 148mm
const A5_LONG = 595.276 // 210mm
// プリンタの印字不可領域 (端~3mm) で切れないよう、内側に最小限インセットする。
const PRINT_MARGIN = 8.5 // ~3mm

/**
 * Ship&co の A5 送り状 PDF を「正確な A5 ページ」に載せ直して返す。
 *
 * 目的: 送り状は A5 で出力されるが、A5 用紙に印刷しても端が切れる/ずれることがある。
 * 原因は (1) ビューアの「用紙に合わせる」による微妙な拡大縮小・シフト、
 * (2) プリンタの印字不可領域 (用紙端 ~3mm) で端の内容が欠ける、の2つ。
 * ここで **中身をソースと同じ向きの正確な A5 ページへ、端から少しだけ内側に入れて中央配置** し直す。
 * これで A5 用紙に「実際のサイズ(100%)」で印刷すれば端が切れず、常にきれいに出る。
 * 拡大はしない (scale<=1)。複数枚口 (2/2 等) も全ページ処理。
 */
async function normalizeToA5(srcBytes: ArrayBuffer): Promise<Uint8Array> {
  const src = await PDFDocument.load(srcBytes)
  const out = await PDFDocument.create()
  // embedPdf は別ドキュメントのページを安全に取り込む (リソースも複製)。全ページを対象にする。
  const embedded = await out.embedPdf(src, src.getPageIndices())
  for (const emb of embedded) {
    // ソースの向き (横長/縦長) に合わせて A5 の向きを決める。
    const landscape = emb.width >= emb.height
    const pageW = landscape ? A5_LONG : A5_SHORT
    const pageH = landscape ? A5_SHORT : A5_LONG
    const page = out.addPage([pageW, pageH])
    // 端の欠け防止のインセット内に収める。元が A5 ならごく僅かに縮小するだけ。拡大はしない。
    const scale = Math.min(1, (pageW - 2 * PRINT_MARGIN) / emb.width, (pageH - 2 * PRINT_MARGIN) / emb.height)
    const w = emb.width * scale
    const h = emb.height * scale
    page.drawPage(emb, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h })
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
  // paper=a5 → 送り状を正確な A5 ページに載せ直し、画面表示 (inline) で返す (A5 用紙のきれい印刷用)。
  const paperA5 = req.nextUrl.searchParams.get("paper")?.trim().toLowerCase() === "a5"

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

  // A5 きれい印刷: 正確な A5 ページに載せ直して inline 表示 (印刷ダイアログをそのまま印刷できる)。
  if (paperA5) {
    try {
      const srcBytes = await upstream.arrayBuffer()
      const a5 = await normalizeToA5(srcBytes)
      const a5Name = fileName.replace(/\.pdf$/, "_A5.pdf")
      return new NextResponse(Buffer.from(a5), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${a5Name}"`,
          "Cache-Control": "no-store",
        },
      })
    } catch (e) {
      // 正規化に失敗しても発行済みラベルは渡せるように、原本 (A5) にフォールバック。
      console.error("[voucher/label] A5 正規化に失敗、A5 原本にフォールバック:", e instanceof Error ? e.message : e)
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
