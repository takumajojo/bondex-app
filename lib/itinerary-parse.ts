import Anthropic from "@anthropic-ai/sdk"
import * as XLSX from "xlsx"
import { saveParseLog, sha256Hex } from "@/lib/parse-log-db"

/**
 * 旅程表 (PDF/画像/Excel/CSV) を AI で解析して { guest, shipments } を返す共有ロジック。
 *
 * 運営 (/api/itinerary/parse) と代理店 (/api/agency/itinerary/parse) の両方から使う。
 * 認証は各ルート側で行う (運営=OPERATOR_PASSWORD / 代理店=Supabase JWT)。
 *
 * Excel/CSV は Claude API が直接受け取れないため、サーバー側で CSV テキストに
 * 変換してテキストブロックとして渡す (全シートをシート名付きで連結)。
 */

export const MAX_ITINERARY_BYTES = 10 * 1024 * 1024 // 10MB
const MAX_SPREADSHEET_TEXT = 150_000 // 変換後テキストの上限 (トークン暴発防止)

export const ACCEPTED_MEDIA_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const

// スプレッドシート系 (Excel / CSV)。ブラウザが type を空で送ることがあるため拡張子でも判定。
const SPREADSHEET_MEDIA_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "text/csv",
] as const
const SPREADSHEET_EXTS = ["xlsx", "xls", "csv"] as const

function fileExt(name: string | undefined): string {
  const n = (name ?? "").toLowerCase()
  const i = n.lastIndexOf(".")
  return i >= 0 ? n.slice(i + 1) : ""
}

/** Excel/CSV のバッファを CSV テキストに変換 (全シート・シート名付き)。 */
function spreadsheetToText(buf: Buffer, ext: string): string {
  if (ext === "csv") {
    return buf.toString("utf8")
  }
  const wb = XLSX.read(buf, { type: "buffer" })
  const parts: string[] = []
  for (const name of wb.SheetNames.slice(0, 10)) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false })
    if (csv.trim()) parts.push(`=== Sheet: ${name} ===\n${csv}`)
  }
  return parts.join("\n\n")
}

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
- to.checkIn / to.checkOut: if the itinerary's accommodation info states the guest's check-in and
  check-out dates at the DESTINATION (to) hotel, copy them (ISO YYYY-MM-DD). to.checkIn is the customer's
  arrival date at the destination hotel. Leave them as "" (empty) if the itinerary does not state them —
  do NOT guess.

CRITICAL — mapping "Luggage transfer <A> - <B>" lines (most common failure):
- Lines such as "Luggage transfer Tokyo - Kyoto", "Luggage transfer Kyoto to Osaka",
  "Luggage forwarding: Tokyo → Kyoto", or "手荷物配送 東京→京都" are EXPLICIT, AUTHORITATIVE
  leg definitions. Each such line is exactly ONE shipment.
- The ORIGIN city is the FIRST place named (<A>); the DESTINATION city is the SECOND place named (<B>).
- Set from.city = <A> and to.city = <B>, copied EXACTLY from that line. Do not change or reorder them.
- Then pick the correct hotels from the itinerary BY CITY:
  - from.hotel = the hotel the guests stay at IN city <A> (the hotel they check out of / hand the bags over at).
  - to.hotel   = the hotel the guests stay at IN city <B> (the destination hotel they move to).
- The destination hotel MUST be physically located in city <B>. NEVER substitute a hotel from a
  neighbouring or later city. (e.g. for "Tokyo - Kyoto" the destination must be the KYOTO hotel,
  NOT a Hakone hotel; for "Kyoto - Osaka" it must be the OSAKA hotel, NOT a Hiroshima hotel.)
- Do NOT simply pair consecutive hotels in the itinerary order. Trust the transfer line's two cities.
- If the itinerary lists several hotels for one city, choose the one whose stay dates match the transfer timing.
- If you truly cannot find a hotel located in the named city, leave that hotel as "" (empty) rather than
  guessing a hotel from a different city. It is better to leave it blank than to send luggage to the wrong city.
- Sanity check before answering: for every shipment, confirm from.city and to.city are the exact two
  cities named in its transfer line, and that each hotel's city matches.

Rules for "recipient" (重要):
- ALWAYS use ONE specific representative individual — never a family/group name
- The representative is the FIRST adult listed in the Guest Information section
  (typically the head of the family, e.g. "Mr. Michael Johnson" for the Johnson Family)
- Format the recipient as "<Title> <First> <Last>" — include the title (Mr./Mrs./Ms./Dr.) if present
- If no title is given, use just the full name (e.g. "Michael Johnson")
- NEVER write "Johnson Family", "The Smith Group", "Tanaka Sama" etc. — always one person
- The same representative is used for ALL shipment legs in the itinerary

Rules for GUEST ROSTER documents (名簿・重要):
- The document may be a GUEST ROSTER / name list (e.g. columns like No / Guest Name / Gender /
  "Luggage Request" / Bags) instead of an itinerary. This is a VALID input.
- In that case, extract the roster into "luggageRoster": one entry per guest who REQUESTS luggage
  delivery. Respect request marks: include only rows marked YES / ○ / ✓ / 1+ bags; EXCLUDE rows
  marked NO / × / 0 bags. If there is no request column at all, include every listed guest.
- "bags" = the number of bags for that guest if a Bags/個数 column exists (default 1).
- Set guest.travelerCount to the TOTAL number of people on the roster (including non-requesters).
- A roster has no hotels/dates — in that case return shipments as an EMPTY array []. Do NOT invent
  hotels or dates. (If the document contains BOTH a roster and an itinerary, extract both.)

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
                checkIn: {
                  type: "string",
                  description:
                    "ISO date (YYYY-MM-DD) the guest CHECKS IN to this destination hotel (the customer's arrival date at the to-hotel), taken from the itinerary's accommodation dates. Empty string if the itinerary does not state it.",
                },
                checkOut: {
                  type: "string",
                  description:
                    "ISO date (YYYY-MM-DD) the guest CHECKS OUT of this destination hotel, taken from the itinerary's accommodation dates. Empty string if not stated.",
                },
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
      luggageRoster: {
        type: "array",
        description:
          "Only for guest-roster documents: guests who REQUEST luggage delivery (rows marked YES/○/1+ bags). Empty array if the document is a normal itinerary without a roster.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Guest full name" },
            bags: { type: "integer", minimum: 1, description: "Number of bags (default 1)" },
          },
          required: ["name"],
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
  const ext = fileExt(opts?.fileName)
  const isSpreadsheet =
    (SPREADSHEET_MEDIA_TYPES as readonly string[]).includes(mediaType) ||
    (SPREADSHEET_EXTS as readonly string[]).includes(ext)
  if (
    !isSpreadsheet &&
    !ACCEPTED_MEDIA_TYPES.includes(mediaType as (typeof ACCEPTED_MEDIA_TYPES)[number])
  ) {
    return {
      ok: false,
      status: 400,
      error: `Unsupported media type: ${mediaType}. Accepted: PDF, JPEG, PNG, WEBP, GIF, Excel (.xlsx/.xls), CSV`,
    }
  }
  if (file.size > MAX_ITINERARY_BYTES) {
    return { ok: false, status: 400, error: "File exceeds 10MB limit" }
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let documentBlock:
    | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
    | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string } }
    | { type: "text"; text: string }
  if (isSpreadsheet) {
    // Excel/CSV → CSV テキストに変換して渡す (Claude API はスプレッドシートを直接受けない)
    let text = ""
    try {
      text = spreadsheetToText(buf, ext === "csv" || mediaType === "text/csv" ? "csv" : ext || "xlsx")
    } catch {
      return { ok: false, status: 400, error: "Could not read the spreadsheet file" }
    }
    if (!text.trim()) {
      return { ok: false, status: 400, error: "The spreadsheet appears to be empty" }
    }
    documentBlock = {
      type: "text",
      text: `Itinerary / roster spreadsheet content (converted to CSV):\n\n${text.slice(0, MAX_SPREADSHEET_TEXT)}`,
    }
  } else {
    const base64 = buf.toString("base64")
    const isPdf = mediaType === "application/pdf"
    documentBlock = isPdf
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
