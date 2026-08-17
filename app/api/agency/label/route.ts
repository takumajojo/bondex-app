import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { getSupabase } from "@/lib/supabase"
import { buildVoucherFileName, carrierFileLabel } from "@/lib/utils"

export const runtime = "nodejs"
export const maxDuration = 30

/**
 * 代理店用: 自社の送り状PDFを取得する (A5印刷ページから fetch)。
 *
 *   GET /api/agency/label?booking_id=BDX-XXXX&leg_index=0
 *   Authorization: Bearer <Supabase access token>
 *
 * Ship&co ラベルは GCS 配信でCORS不可のため、同一オリジンでプロキシして返す。
 * 認証した代理店の**自社の予約に紐づく送り状のみ**返す (他社ラベルの漏洩防止)。
 * 任意URLのプロキシ悪用(SSRF)防止のため、URLはクライアントから受け取らず、DBに保存された
 * yamato_label_url を使い、ホストを storage.googleapis.com に限定する。
 */
const ALLOWED_LABEL_HOST = "storage.googleapis.com"

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "agency-label")
  if (!limit.ok) return limit.response

  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const bookingId = req.nextUrl.searchParams.get("booking_id")?.trim() || ""
  const legIndex = Number(req.nextUrl.searchParams.get("leg_index"))
  if (!bookingId || !Number.isInteger(legIndex) || legIndex < 0) {
    return NextResponse.json({ error: "booking_id and leg_index are required" }, { status: 400 })
  }

  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })

  // 自社の予約に限定して送り状URL＋ファイル名用メタを引く
  const { data, error } = await sb
    .from("shipments")
    .select("yamato_label_url, agency, tour_number, representative, carrier")
    .eq("booking_id", bookingId)
    .eq("leg_index", legIndex)
    .eq("agency", auth.agency.name)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const url = data?.yamato_label_url
  if (!url) return NextResponse.json({ error: "送り状がまだありません。" }, { status: 404 })

  // ファイル名: 既存ルール(buildVoucherFileName) + 区間 + キャリア。旅程番号を必ず含める。
  //   例: BondEx_<旅程番号>_<予約番号>_<代表者>_Label_L1_Sagawa.pdf
  const base = buildVoucherFileName({
    bookingId,
    tourNumber: (data.tour_number as string | null) ?? undefined,
    representativeLabel: (data.representative as string | null) ?? "",
    kind: "label",
  }).replace(/\.pdf$/, "")
  const fileName = `${base}_L${legIndex + 1}_${carrierFileLabel(data.carrier as string | undefined)}.pdf`

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json({ error: "invalid label url" }, { status: 500 })
  }
  if (parsed.hostname !== ALLOWED_LABEL_HOST) {
    return NextResponse.json({ error: "label url not allowed" }, { status: 400 })
  }

  const upstream = await fetch(parsed.toString())
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "failed to fetch label" }, { status: 502 })
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      // inline(印刷ページで表示) だが、DLボタン用にファイル名も入れておく
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  })
}
