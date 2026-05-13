import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PROMPT = `You are a luggage size classifier. Analyze this luggage photo and determine which size category it belongs to:

- S: Cabin-size / carry-on (backpack, small suitcase) — total dimensions up to 100cm, up to 10kg
- M: Standard suitcase (medium suitcase, duffel bag) — up to 120cm, up to 15kg
- L: Large suitcase (large checked bag, golf bag) — up to 160cm, up to 25kg
- LL: Oversized (ski equipment, surfboard, extra-large case) — up to 200cm, up to 30kg

Reply with ONLY a JSON object in this exact format, nothing else:
{"size": "M", "confidence": 0.85}

size must be one of: S, M, L, LL
confidence must be a number between 0 and 1`

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 })
  }

  try {
    const { imageBase64, mediaType } = await req.json()

    if (!imageBase64 || !mediaType) {
      return NextResponse.json({ error: "Missing imageBase64 or mediaType" }, { status: 400 })
    }

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 64,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: PROMPT,
            },
          ],
        },
      ],
    })

    const text = message.content[0].type === "text" ? message.content[0].text.trim() : ""
    const result = JSON.parse(text)

    if (!["S", "M", "L", "LL"].includes(result.size)) {
      throw new Error("Invalid size returned")
    }

    return NextResponse.json({ size: result.size, confidence: result.confidence ?? 0.8 })
  } catch {
    return NextResponse.json({ size: "M", confidence: 0.5 })
  }
}
