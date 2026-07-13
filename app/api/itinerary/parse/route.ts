import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { parseItineraryFile } from "@/lib/itinerary-parse"

export const runtime = "nodejs"

/**
 * 旅程表 (PDF/画像) の AI 解析 (運営用)。
 * 認証は middleware の OPERATOR_PASSWORD ゲート。
 * 解析ロジック本体は lib/itinerary-parse.ts に共通化 (代理店ルートと共有)。
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "itinerary-parse")
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

  // 学習用 — どの代理店からの parse か (operator UI が agency パラメータを送る)
  const agency = typeof form.get("agency") === "string" ? (form.get("agency") as string).trim() : ""
  const fileName = (file as File).name || ""

  const result = await parseItineraryFile(file, { agency, fileName })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
