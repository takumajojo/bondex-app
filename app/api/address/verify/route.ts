import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const maxDuration = 30

/**
 * AI 住所検証 API.
 * 入力: { hotelName, address }
 * 処理: Claude Sonnet 4.6 + web_search でホテルと住所の整合性を検証
 * 出力: { matched, confidence, citationUrl, sourceTitle, reasoning }
 *
 * confidence は "high" | "medium" | "low"
 * matched=false の時、UI 側で警告表示する想定。
 */

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
      matched: {
        type: "boolean",
        description: "true if the input address matches or if we successfully enriched an empty/city-only address with an authoritative one",
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "Confidence level",
      },
      canonicalAddress: {
        type: "string",
        description: "The full official address you found for this hotel (English preferred, include postal code if available)",
      },
      citationUrl: {
        type: "string",
        description: "URL of the most authoritative source used",
      },
      sourceTitle: {
        type: "string",
        description: "Title or short label of the citation source",
      },
      reasoning: {
        type: "string",
        description: "1-2 sentence explanation",
      },
    },
    required: ["matched", "confidence", "canonicalAddress", "citationUrl", "sourceTitle", "reasoning"],
  },
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "address-verify")
  if (!limit.ok) return limit.response

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 })
  }

  let body: { hotelName?: unknown; address?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const hotelName = typeof body.hotelName === "string" ? body.hotelName.trim() : ""
  const address = typeof body.address === "string" ? body.address.trim() : ""

  if (!hotelName || !address) {
    return NextResponse.json({ error: "hotelName and address are required" }, { status: 400 })
  }

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
              text: `Hotel name: ${hotelName}\nGiven address: ${address}\n\nVerify whether this hotel exists at this address, then call report_verification.`,
            },
          ],
        },
      ],
    })

    const toolUse = message.content.find(
      (c) => c.type === "tool_use" && c.name === "report_verification",
    )
    if (!toolUse || toolUse.type !== "tool_use") {
      return NextResponse.json(
        { error: "Model did not return a verification result" },
        { status: 502 },
      )
    }
    return NextResponse.json(toolUse.input)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Anthropic error"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
