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

const SYSTEM_PROMPT = `You verify whether a hotel name matches a given postal address in Japan.

Process:
1. Use the web_search tool to look up the hotel name (in Japanese if applicable) and check if its official location matches the given address.
2. Prefer authoritative sources: the hotel's official website, the hotel's Google Maps listing, or major booking sites (Booking.com, Expedia, Rakuten Travel).
3. Note that Japanese addresses may be written in different formats (with/without postal code, kanji vs romaji). Treat them as matching if the postal code OR the full street address agrees.
4. After research, call the report_verification tool with your conclusion.

Confidence levels:
- "high": you found an authoritative source (official site / Google Maps) confirming the address
- "medium": you found multiple secondary sources agreeing
- "low": you could not find a clear authoritative match (do not block — just note for the operator)`

const VERIFICATION_TOOL = {
  name: "report_verification",
  description: "Report the hotel-address verification result.",
  input_schema: {
    type: "object" as const,
    properties: {
      matched: {
        type: "boolean",
        description: "true if the hotel name and address match according to authoritative sources",
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "Confidence level — 'high' for official sources, 'low' if no clear match found",
      },
      citationUrl: {
        type: "string",
        description: "URL of the single most authoritative source you used (prefer official hotel website or Google Maps)",
      },
      sourceTitle: {
        type: "string",
        description: "Title or short label of the citation source (e.g. 'Hyatt Regency Hakone — Official Site')",
      },
      reasoning: {
        type: "string",
        description: "1-2 sentence explanation of why you concluded matched or not matched",
      },
    },
    required: ["matched", "confidence", "citationUrl", "sourceTitle", "reasoning"],
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
