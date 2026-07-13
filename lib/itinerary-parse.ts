import Anthropic from "@anthropic-ai/sdk"
import { saveParseLog, sha256Hex } from "@/lib/parse-log-db"

/**
 * 旅程表 (PDF/画像) を AI で解析して { guest, shipments } を返す共有ロジック。
 *
 * 運営 (/api/itinerary/parse) と代理店 (/api/agency/itinerary/parse) の両方から使う。
 * 認証は各ルート側で行う (運営=OPERATOR_PASSWORD / 代理店=Supabase JWT)。
 */

export const MAX_ITINERARY_BYTES = 10 * 1024 * 1024 // 10MB

export const ACCEPTED_MEDIA_TYPES = [
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

Rules for "recipient" (重要):
- ALWAYS use ONE specific representative individual — never a family/group name
- The representative is the FIRST adult listed in the Guest Information section
  (typically the head of the family, e.g. "Mr. Michael Johnson" for the Johnson Family)
- Format the recipient as "<Title> <First> <Last>" — include the title (Mr./Mrs./Ms./Dr.) if present
- If no title is given, use just the full name (e.g. "Michael Johnson")
- NEVER write "Johnson Family", "The Smith Group", "Tanaka Sama" etc. — always one person
- The same representative is used for ALL shipment legs in the itinerary

Rules for hotel names (重要):
- Output ONLY the hotel's own name. NEVER include the OTA/booking-channel name as a prefix or suffix.
- Strip any leading channel name like "Expedia / ", "Booking.com / ", "Agoda / ", "Hotels.com / ",
  "Rakuten Travel / ", "JTB / ", "Trip.com / ", "Booking / " — and any parenthetical channel
  suffix like " (Expedia)", " (Booking.com)".
- Example: "Expedia / ANA InterContinental Tokyo" → "ANA InterContinental Tokyo"
- Example: "Hilton Kyoto (Booking.com)" → "Hilton Kyoto"

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
              description:
                'Recipient name on the waybill — must be ONE representative individual (the first adult listed in Guest Information), formatted as "<Title> <First> <Last>" e.g. "Mr. Michael Johnson". NEVER use family/group names like "Johnson Family".',
            },
          },
          required: ["shipmentDate", "expectedArrival", "from", "to", "recipient"],
        },
      },
    },
    required: ["guest", "shipments"],
  },
}

const OTA_CHANNELS = [
  "Expedia",
  "Booking\\.com",
  "Booking",
  "Agoda",
  "Hotels\\.com",
  "Rakuten Travel",
  "Rakuten",
  "JTB",
  "Trip\\.com",
  "Ctrip",
  "Airbnb",
]
const OTA_PREFIX_RE = new RegExp(`^\\s*(?:${OTA_CHANNELS.join("|")})\\s*[\\/|:\\-–—]\\s*`, "i")
const OTA_SUFFIX_RE = new RegExp(
  `\\s*[\\(\\[][\\s]*(?:${OTA_CHANNELS.join("|")})[\\s]*[\\)\\]]\\s*$`,
  "i",
)

function cleanHotelName(name: unknown): string {
  if (typeof name !== "string") return ""
  let s = name.trim()
  for (let i = 0; i < 3; i++) {
    const before = s
    s = s.replace(OTA_PREFIX_RE, "").replace(OTA_SUFFIX_RE, "").trim()
    if (s === before) break
  }
  return s
}

function scrubOtaPrefixes(input: unknown): unknown {
  if (!input || typeof input !== "object") return input
  const obj = input as { shipments?: unknown }
  if (!Array.isArray(obj.shipments)) return input
  const shipments = obj.shipments.map((s) => {
    if (!s || typeof s !== "object") return s
    const sh = s as { from?: { hotel?: unknown }; to?: { hotel?: unknown } }
    if (sh.from && typeof sh.from === "object" && "hotel" in sh.from) {
      sh.from.hotel = cleanHotelName(sh.from.hotel)
    }
    if (sh.to && typeof sh.to === "object" && "hotel" in sh.to) {
      sh.to.hotel = cleanHotelName(sh.to.hotel)
    }
    return sh
  })
  return { ...obj, shipments }
}

export type ParseItineraryResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: string }

/**
 * 旅程表ファイルを解析する。認証は呼び出し側で済ませておくこと。
 * opts.agency は学習ログ (parse_log) 用の代理店名。
 */
export async function parseItineraryFile(
  file: Blob,
  opts?: { agency?: string; fileName?: string },
): Promise<ParseItineraryResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, status: 500, error: "ANTHROPIC_API_KEY not configured" }
  }
  const mediaType = file.type || ""
  if (!ACCEPTED_MEDIA_TYPES.includes(mediaType as (typeof ACCEPTED_MEDIA_TYPES)[number])) {
    return {
      ok: false,
      status: 400,
      error: `Unsupported media type: ${mediaType}. Accepted: PDF, JPEG, PNG, WEBP, GIF`,
    }
  }
  if (file.size > MAX_ITINERARY_BYTES) {
    return { ok: false, status: 400, error: "File exceeds 10MB limit" }
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const base64 = buf.toString("base64")
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const isPdf = mediaType === "application/pdf"
  const documentBlock = isPdf
    ? {
        type: "document" as const,
        source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 },
      }
    : {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
          data: base64,
        },
      }

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
            { type: "text", text: "Parse this itinerary and call the extract_itinerary tool." },
          ],
        },
      ],
    })

    const toolUse = message.content.find((c) => c.type === "tool_use")
    if (!toolUse || toolUse.type !== "tool_use") {
      return { ok: false, status: 502, error: "Model did not return tool_use" }
    }

    const cleaned = scrubOtaPrefixes(toolUse.input)

    await saveParseLog({
      agency: opts?.agency ?? "",
      file_name: opts?.fileName ?? "",
      file_hash: sha256Hex(buf),
      file_size: buf.length,
      file_type: mediaType,
      ai_raw_output: cleaned,
    })

    return { ok: true, data: cleaned }
  } catch (err) {
    return { ok: false, status: 502, error: err instanceof Error ? err.message : "Anthropic error" }
  }
}
