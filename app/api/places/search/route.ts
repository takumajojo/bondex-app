import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"

/**
 * Google Places Text Search ベースのホテル候補検索 API.
 *
 * 入力: { query: string, lang?: "ja" | "en" }
 * 出力: { candidates: Array<{ placeId, name, address, city, prefecture }> }
 *
 * 用途: operator がホテル名を入力するときの autocomplete サジェスト.
 * Yamato 連携時は `placeId` を使って Place Details を再取得するため、
 * テキスト検索のあいまい一致による誤住所を避けられる.
 *
 * 設計判断:
 *   - `type=lodging` でホテル/旅館に絞り込み (フィルタが効きすぎる場合は後日緩める)
 *   - language=ja で日本語表記を取得 (operator が JP locale でも EN locale でも一貫した表示)
 *   - 上位 8 件まで返す (UI 側で 5 件に絞っても良い)
 *   - 短すぎる query (2文字未満) は空配列で即返す (API 浪費防止)
 */

const PLACES_BASE = "https://maps.googleapis.com/maps/api/place"

interface SearchCandidate {
  placeId: string
  name: string
  address: string
  city: string       // 例: "港区" / "京都市中京区"
  prefecture: string // 例: "東京都" / "京都府"
}

/**
 * Google の formatted_address から「都道府県 + 市区郡町村」を抽出する.
 * 例: "〒108-8611 東京都港区高輪4-10-30" → { prefecture: "東京都", city: "港区" }
 *
 * 失敗時は両方とも空文字を返す (UI 側で fallback 表示する).
 */
function parseJpAddress(formattedAddr: string): { prefecture: string; city: string } {
  const noZip = formattedAddr.replace(/^〒\s*\d{3}-?\d{4}\s*/, "").trim()
  // 都道府県: ○○県 / ○○府 / ○○都 / ○○道 (北海道を含む)
  const prefRe = /^(.+?[県府都]|北海道)/u
  const prefM = prefRe.exec(noZip)
  if (!prefM) return { prefecture: "", city: "" }
  const prefecture = prefM[1]
  const afterPref = noZip.slice(prefecture.length)
  // 市区郡町村: 最初の "市"/"区"/"郡"/"町"/"村" の文字までを取る
  // ただし "○○市××区" のような複合 (政令指定都市) も拾えるよう貪欲気味に
  const cityRe = /^(.+?[市区郡町村])((?:.+?区)?)/u
  const cityM = cityRe.exec(afterPref)
  if (!cityM) return { prefecture, city: "" }
  const city = cityM[1] + (cityM[2] || "")
  return { prefecture, city }
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "places-search")
  if (!limit.ok) return limit.response

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY not configured", candidates: [] },
      { status: 500 },
    )
  }

  let body: { query?: unknown; lang?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON", candidates: [] }, { status: 400 })
  }

  const query = typeof body.query === "string" ? body.query.trim() : ""
  if (!query || query.length < 2) {
    return NextResponse.json({ candidates: [] })
  }
  const lang: "ja" | "en" = body.lang === "en" ? "en" : "ja"

  const url = new URL(`${PLACES_BASE}/textsearch/json`)
  url.searchParams.set("query", query)
  url.searchParams.set("language", lang)
  url.searchParams.set("region", "jp")
  url.searchParams.set("type", "lodging")
  url.searchParams.set("key", apiKey)

  let res: Response
  try {
    res = await fetch(url.toString())
  } catch {
    return NextResponse.json({ error: "Places API unreachable", candidates: [] }, { status: 502 })
  }
  if (!res.ok) {
    return NextResponse.json({ error: "Places API error", candidates: [] }, { status: 502 })
  }
  const data = (await res.json()) as {
    status?: string
    results?: Array<{
      place_id?: string
      name?: string
      formatted_address?: string
    }>
  }
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    return NextResponse.json(
      { error: `Places API status: ${data.status}`, candidates: [] },
      { status: 502 },
    )
  }

  const candidates: SearchCandidate[] = (data.results ?? [])
    .filter((r) => r.place_id && r.name && r.formatted_address)
    .slice(0, 8)
    .map((r) => {
      const parsed = parseJpAddress(r.formatted_address!)
      return {
        placeId: r.place_id!,
        name: r.name!,
        address: r.formatted_address!,
        city: parsed.city,
        prefecture: parsed.prefecture,
      }
    })

  return NextResponse.json({ candidates })
}
