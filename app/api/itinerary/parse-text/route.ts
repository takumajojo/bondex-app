import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { parseItineraryText } from "@/lib/itinerary-parse"

export const runtime = "nodejs"

/**
 * 依頼メール等の「テキスト本文」を AI 解析する（運営用）。
 * 認証は middleware の operator ゲート（/api/* 既定deny・本ルートは公開未登録）。
 * ファイル版 /api/itinerary/parse と同じスキーマ・モデルを共有（lib/itinerary-parse.ts）。
 *
 *   POST /api/itinerary/parse-text  { text: string, agency?: string }
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "itinerary-parse")
  if (!limit.ok) return limit.response

  let body: { text?: unknown; agency?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const text = typeof body.text === "string" ? body.text : ""
  if (!text.trim()) {
    return NextResponse.json({ error: "Missing 'text' field" }, { status: 400 })
  }
  const agency = typeof body.agency === "string" ? body.agency.trim() : ""

  const result = await parseItineraryText(text, { agency })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
