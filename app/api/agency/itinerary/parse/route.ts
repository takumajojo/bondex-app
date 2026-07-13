import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { resolveAgencyFromRequest } from "@/lib/agency-auth"
import { parseItineraryFile } from "@/lib/itinerary-parse"

export const runtime = "nodejs"

/**
 * 旅程表 (PDF/画像) の AI 解析 (代理店用)。
 *
 *   POST /api/agency/itinerary/parse   (multipart/form-data, field: file)
 *   Authorization: Bearer <Supabase access token>
 *
 * /api/agency/* は middleware の OPERATOR_PASSWORD 対象外なので、ここで代理店 JWT を検証する。
 * 発行 (送り状) は伴わないため Ship&co 課金は発生しない。解析ロジックは運営と共通
 * (lib/itinerary-parse.ts)。学習ログの agency は認証した自社名に固定。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "agency-itinerary-parse")
  if (!limit.ok) return limit.response

  const auth = await resolveAgencyFromRequest(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // 承認待ち・停止中は AI 解析 (課金) を叩かせない
  if (auth.agency.status === "pending" || auth.agency.status === "suspended") {
    return NextResponse.json({ error: "Account not active" }, { status: 403 })
  }

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

  const result = await parseItineraryFile(file, {
    agency: auth.agency.name,
    fileName: (file as File).name || "",
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
