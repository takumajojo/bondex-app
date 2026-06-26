import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const maxDuration = 30

/**
 * 住所検証 + 補完 API.
 *
 * 戦略:
 *   1) Google Places API で hotelName を検索 (findplacefromtext + details)
 *      → formatted_address と公式 website URL を取得 (高速・高信頼)
 *   2) 見つからなかった時のみ Anthropic Claude + web search にフォールバック
 *
 * 入力:  { hotelName: string, address?: string }
 * 出力:  { matched, confidence, canonicalAddress, citationUrl, sourceTitle, reasoning }
 *
 * 住所の入力が空 / 都市名のみのときは「enrichment」モード — 見つかれば matched=true。
 */

interface VerifyResult {
  matched: boolean
  confidence: "high" | "medium" | "low"
  canonicalAddress: string
  citationUrl: string
  sourceTitle: string
  reasoning: string
}

// ---------------------------------------------------------------------------
// Google Places — 主軸
// ---------------------------------------------------------------------------

const PLACES_BASE = "https://maps.googleapis.com/maps/api/place"

async function lookupViaGooglePlaces(
  hotelName: string,
  address: string,
  lang: "en" | "ja",
): Promise<VerifyResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return null

  // Step 1: findplacefromtext で候補を取得
  const searchUrl = new URL(`${PLACES_BASE}/findplacefromtext/json`)
  searchUrl.searchParams.set("input", hotelName)
  searchUrl.searchParams.set("inputtype", "textquery")
  searchUrl.searchParams.set(
    "fields",
    "place_id,name,formatted_address,types",
  )
  searchUrl.searchParams.set("language", lang)
  searchUrl.searchParams.set("region", "jp")
  searchUrl.searchParams.set("locationbias", "ipbias")
  searchUrl.searchParams.set("key", apiKey)

  const searchRes = await fetch(searchUrl.toString())
  if (!searchRes.ok) return null
  const searchData = (await searchRes.json()) as {
    status?: string
    candidates?: Array<{
      place_id?: string
      name?: string
      formatted_address?: string
      types?: string[]
    }>
  }
  if (searchData.status !== "OK" || !Array.isArray(searchData.candidates)) return null
  const candidate = searchData.candidates[0]
  if (!candidate?.place_id) return null

  // Step 2: details で website を取得 (citationUrl 用)
  const detailsUrl = new URL(`${PLACES_BASE}/details/json`)
  detailsUrl.searchParams.set("place_id", candidate.place_id)
  detailsUrl.searchParams.set(
    "fields",
    "name,formatted_address,website,international_phone_number,url",
  )
  detailsUrl.searchParams.set("language", lang)
  detailsUrl.searchParams.set("key", apiKey)

  const detailsRes = await fetch(detailsUrl.toString())
  if (!detailsRes.ok) {
    // details 失敗時も candidate の情報で返す
    return {
      matched: true,
      confidence: "high",
      canonicalAddress: candidate.formatted_address ?? "",
      citationUrl: `https://www.google.com/maps/place/?q=place_id:${candidate.place_id}`,
      sourceTitle: `${candidate.name ?? hotelName} — Google Maps`,
      reasoning: `Found via Google Places: ${candidate.name ?? hotelName}`,
    }
  }
  const detailsData = (await detailsRes.json()) as {
    status?: string
    result?: {
      name?: string
      formatted_address?: string
      website?: string
      url?: string
    }
  }
  const result = detailsData.result ?? {}

  const canonicalAddress = result.formatted_address ?? candidate.formatted_address ?? ""
  const citationUrl =
    result.website ||
    result.url ||
    `https://www.google.com/maps/place/?q=place_id:${candidate.place_id}`
  const sourceTitle = result.website
    ? `${result.name ?? hotelName} — Official Site`
    : `${result.name ?? hotelName} — Google Maps`

  // matched: 入力住所が短い (city only / empty) なら enrichment 成功 → true
  // 入力住所がフル住所なら canonical との一致度を簡易チェック
  let matched = true
  const inputTrimmed = address.trim()
  if (inputTrimmed.length > 15) {
    // フル住所っぽい場合、共通要素 (郵便番号 or 主要トークン) で照合
    const inputLower = inputTrimmed.toLowerCase()
    const canonLower = canonicalAddress.toLowerCase()
    const zipMatch =
      (inputTrimmed.match(/\d{3}-?\d{4}/) ?? [])[0]
        ?.replace(/-/g, "")
        ?.padStart(7, "0") ?? ""
    const zipInCanon = (canonicalAddress.match(/\d{3}-?\d{4}/) ?? [])[0]?.replace(/-/g, "") ?? ""
    if (zipMatch && zipInCanon && zipMatch === zipInCanon) {
      matched = true
    } else {
      // 簡易: 部分文字列の重なり
      const inputTokens = inputLower.split(/\s+|,/).filter((t) => t.length >= 3)
      const overlapping = inputTokens.filter((t) => canonLower.includes(t)).length
      matched = overlapping >= Math.min(2, Math.floor(inputTokens.length / 2))
    }
  }

  return {
    matched,
    confidence: "high",
    canonicalAddress,
    citationUrl,
    sourceTitle,
    reasoning: `Resolved via Google Places: ${result.name ?? candidate.name ?? hotelName}`,
  }
}

// ---------------------------------------------------------------------------
// Anthropic web search — フォールバック
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You verify and/or enrich the address of a Japanese hotel.

Inputs:
- hotelName: the hotel's name (English or Japanese)
- address: the address claimed for this hotel — may be a full street address, just a city ("Tokyo"), or empty.

Process:
1. Use the web_search tool to look up the hotel and find its OFFICIAL postal address.
2. Prefer authoritative sources: the hotel's official website, Google Maps listing, or major booking sites (Booking.com, Expedia, Rakuten Travel).
3. Always populate canonicalAddress with the full street address you found, in English where possible, including postal code if available.

Confidence levels:
- "high": you found an authoritative source (official site / Google Maps)
- "medium": you found multiple secondary sources agreeing
- "low": you could not find a clear authoritative source

matched logic:
- If the input address is empty OR only a city/region: set matched = true if you found ANY authoritative address (we are enriching, not verifying).
- If the input address is a full street address: set matched = true if it agrees with the canonicalAddress you found.
- Otherwise matched = false.

After research, call the report_verification tool with your conclusion.`

const VERIFICATION_TOOL = {
  name: "report_verification",
  description: "Report the hotel-address verification + enrichment result.",
  input_schema: {
    type: "object" as const,
    properties: {
      matched: { type: "boolean" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      canonicalAddress: { type: "string" },
      citationUrl: { type: "string" },
      sourceTitle: { type: "string" },
      reasoning: { type: "string" },
    },
    required: ["matched", "confidence", "canonicalAddress", "citationUrl", "sourceTitle", "reasoning"],
  },
}

async function lookupViaAnthropic(
  hotelName: string,
  address: string,
): Promise<VerifyResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [
        {
          type: "web_search_20250305" as const,
          name: "web_search",
          max_uses: 3,
        } as unknown as Anthropic.Tool,
        VERIFICATION_TOOL,
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Hotel name: ${hotelName}\nGiven address: ${address || "(empty)"}\n\nFind this hotel's official address and call report_verification.`,
            },
          ],
        },
      ],
    })
    const toolUse = message.content.find(
      (c) => c.type === "tool_use" && c.name === "report_verification",
    )
    if (!toolUse || toolUse.type !== "tool_use") return null
    const v = toolUse.input as VerifyResult
    return v
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "address-verify")
  if (!limit.ok) return limit.response

  let body: { hotelName?: unknown; address?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const hotelName = typeof body.hotelName === "string" ? body.hotelName.trim() : ""
  const address = typeof body.address === "string" ? body.address.trim() : ""
  const langRaw = (body as { lang?: unknown }).lang
  const lang: "en" | "ja" = langRaw === "ja" ? "ja" : "en"

  if (!hotelName) {
    return NextResponse.json({ error: "hotelName is required" }, { status: 400 })
  }

  // (1) Google Places を試す
  try {
    const placesResult = await lookupViaGooglePlaces(hotelName, address, lang)
    if (placesResult) {
      return NextResponse.json(placesResult)
    }
  } catch {
    // ignore — fall through to Anthropic
  }

  // (2) Anthropic web search にフォールバック
  const anthropicResult = await lookupViaAnthropic(hotelName, address)
  if (anthropicResult) {
    return NextResponse.json(anthropicResult)
  }

  // (3) 両方失敗
  return NextResponse.json(
    {
      matched: false,
      confidence: "low",
      canonicalAddress: "",
      citationUrl: "",
      sourceTitle: "",
      reasoning: "Neither Google Places nor web search could resolve this hotel",
    },
    { status: 200 },
  )
}
