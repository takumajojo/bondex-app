import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"

const MAX_BYTES = 10 * 1024 * 1024 // 10MB — PDF 旅程表は画像より大きくなりがち

const ACCEPTED_MEDIA_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const

const SYSTEM_PROMPT = `You are an expert itinerary parser for BondEx, a luggage forwarding service for inbound tourists in Japan.

Given a travel itinerary document (PDF or image), extract:
1. Guest information (family name and individual travelers)
2. Luggage forwarding schedule — every leg where luggage must be shipped from one hotel to another

Rules for extracting shipments:
- If the document has an explicit "Luggage Forwarding Schedule" table, use it as the authoritative source
- Otherwise, infer shipments from notes like "Forward luggage to X", "Luggage will be sent to Y", "Luggage waiting at hotel"
- Skip "arrival in Japan", "departure from Japan", and any hop where the traveler stays at the same hotel
- Date format: ISO 8601 YYYY-MM-DD. If only month/day given (e.g. "June 10"), infer the year from context (default to next occurrence of that date from today)
- shipmentDate is the date luggage is HANDED OVER at the from-hotel
- expectedArrival is the date luggage SHOULD ARRIVE at the to-hotel (often 1-3 days after shipmentDate)
- Use the recipient's FAMILY NAME for "Johnson Family" style aggregations, or the lead traveler name

Always call the extract_itinerary tool exactly once with your final answer. Do not output any other text.`

const TOOL_SCHEMA = {
  name: "extract_itinerary",
  description:
    "Extract guest information and luggage forwarding schedule from an itinerary document.",
  input_schema: {
    type: "object" as const,
    properties: {
      guest: {
        type: "object",
        description: "Guest party information",
        properties: {
          familyName: {
            type: "string",
            description: 'Family name or party name (e.g. "Johnson Family")',
          },
          travelerCount: {
            type: "integer",
            minimum: 1,
            description: "Total number of travelers in the party",
          },
          travelers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Full name without title" },
                title: {
                  type: "string",
                  description: 'Title if given (Mr., Mrs., Ms., Dr., etc.). Empty string if none.',
                },
                type: { type: "string", enum: ["adult", "child"] },
                age: {
                  type: "integer",
                  description: "Age if explicitly given, otherwise omit",
                },
              },
              required: ["name", "title", "type"],
            },
          },
        },
        required: ["familyName", "travelerCount", "travelers"],
      },
      shipments: {
        type: "array",
        description: "Each luggage forwarding leg from one hotel to another",
        items: {
          type: "object",
          properties: {
            shipmentDate: {
              type: "string",
              description: "ISO date (YYYY-MM-DD) when luggage is handed over at the from-hotel",
            },
            expectedArrival: {
              type: "string",
              description: "ISO date (YYYY-MM-DD) when luggage should arrive at the to-hotel",
            },
            from: {
              type: "object",
              properties: {
                hotel: { type: "string" },
                address: { type: "string", description: "Full address if available, empty string if not" },
                city: { type: "string", description: "City name (e.g. Tokyo, Hakone, Kyoto)" },
              },
              required: ["hotel", "address", "city"],
            },
            to: {
              type: "object",
              properties: {
                hotel: { type: "string" },
                address: { type: "string" },
                city: { type: "string" },
              },
              required: ["hotel", "address", "city"],
            },
            recipient: {
              type: "string",
              description: 'Recipient name as it should appear on the waybill (e.g. "Johnson Family")',
            },
          },
          required: ["shipmentDate", "expectedArrival", "from", "to", "recipient"],
        },
      },
    },
    required: ["guest", "shipments"],
  },
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "itinerary-parse")
  if (!limit.ok) return limit.response

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 })
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

  const mediaType = file.type || ""
  if (!ACCEPTED_MEDIA_TYPES.includes(mediaType as (typeof ACCEPTED_MEDIA_TYPES)[number])) {
    return NextResponse.json(
      { error: `Unsupported media type: ${mediaType}. Accepted: PDF, JPEG, PNG, WEBP, GIF` },
      { status: 400 },
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 10MB limit" }, { status: 400 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const base64 = buf.toString("base64")

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // Build content block: PDF uses document type, images use image type.
  const isPdf = mediaType === "application/pdf"
  const documentBlock = isPdf
    ? ({
        type: "document" as const,
        source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 },
      })
    : ({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
          data: base64,
        },
      })

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "tool", name: "extract_itinerary" },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            documentBlock,
            {
              type: "text",
              text: "Parse this itinerary and call the extract_itinerary tool.",
            },
          ],
        },
      ],
    })

    const toolUse = message.content.find((c) => c.type === "tool_use")
    if (!toolUse || toolUse.type !== "tool_use") {
      return NextResponse.json({ error: "Model did not return tool_use" }, { status: 502 })
    }

    return NextResponse.json(toolUse.input)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Anthropic error"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
