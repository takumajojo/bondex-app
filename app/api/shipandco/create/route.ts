import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * Ship&co API ラッパー — 1区間ぶんの Yamato 送り状を発行する.
 *
 * 入力 JSON:
 * {
 *   refNumber: string,         // 予約番号 BDX-XXX-LN
 *   shipmentDate: "YYYY-MM-DD",
 *   suitcaseCount: number,
 *   from: { hotel, recipient },
 *   to:   { hotel, recipient },
 * }
 *
 * 処理:
 * 1. Google Places (language=ja) でホテル住所を構造化抽出 (zip / province / city / address1 / address2 / phone)
 * 2. Ship&co 形式の payload を組み立て
 * 3. POST https://api.shipandco.com/v1/shipments
 *
 * 出力:
 *   { id, label, trackingNumbers, carrier, method, estimatedDeliveryDate }
 */

const SHIPANDCO_BASE = "https://api.shipandco.com/v1"
const PLACES_BASE = "https://maps.googleapis.com/maps/api/place"

const FALLBACK_PHONE = "0000000000"
const FALLBACK_ZIP = "0000000"

interface YamatoAddress {
  full_name: string
  company: string
  email?: string
  phone: string
  country: string
  zip: string
  province: string
  city: string
  address1: string
  address2: string
  extra?: string
}

interface AddressComponent {
  long_name: string
  short_name: string
  types: string[]
}

interface CreateBody {
  refNumber?: unknown
  shipmentDate?: unknown
  suitcaseCount?: unknown
  from?: unknown
  to?: unknown
}

// in-memory cache for carrier_id
let cachedCarrierId: string | null = null
let cachedAt = 0
const CARRIER_CACHE_MS = 10 * 60 * 1000

async function getYamatoCarrierId(token: string): Promise<string | null> {
  const now = Date.now()
  if (cachedCarrierId && now - cachedAt < CARRIER_CACHE_MS) return cachedCarrierId
  const res = await fetch(`${SHIPANDCO_BASE}/carriers`, {
    headers: { "x-access-token": token, "Content-Type": "application/json" },
  })
  if (!res.ok) return null
  const data = (await res.json()) as Array<{ id?: string; type?: string; state?: string }>
  if (!Array.isArray(data)) return null
  const yamato = data.find(
    (c) => (c.type === "yamato" || c.type === "yamato_takkyubin") && c.state !== "disabled",
  )
  if (!yamato?.id) return null
  cachedCarrierId = yamato.id
  cachedAt = now
  return cachedCarrierId
}

function pickComponent(components: AddressComponent[], type: string): string {
  return components.find((c) => c.types.includes(type))?.long_name ?? ""
}

// Google Places (language=ja) でホテルを検索し、Yamato 形式の構造化住所を返す.
// 失敗時はホテル名のみのフォールバックを返す (Ship&co は zip 必須なので最終的に弾かれる)
async function resolveYamatoAddress(
  hotelName: string,
  recipient: string,
  apiKey: string,
): Promise<YamatoAddress> {
  const fallback: YamatoAddress = {
    full_name: recipient || "Front Desk",
    company: hotelName,
    phone: FALLBACK_PHONE,
    country: "JP",
    zip: FALLBACK_ZIP,
    province: "",
    city: "",
    address1: "1番地",
    address2: hotelName || "",
  }

  // Step 1: findplacefromtext (日本語)
  const searchUrl = new URL(`${PLACES_BASE}/findplacefromtext/json`)
  searchUrl.searchParams.set("input", hotelName)
  searchUrl.searchParams.set("inputtype", "textquery")
  searchUrl.searchParams.set("fields", "place_id,name")
  searchUrl.searchParams.set("language", "ja")
  searchUrl.searchParams.set("region", "jp")
  searchUrl.searchParams.set("key", apiKey)

  const searchRes = await fetch(searchUrl.toString())
  if (!searchRes.ok) return fallback
  const searchData = (await searchRes.json()) as {
    status?: string
    candidates?: Array<{ place_id?: string; name?: string }>
  }
  const candidate = searchData.candidates?.[0]
  if (!candidate?.place_id) return fallback

  // Step 2: details (日本語) で address_components と phone を取得
  const detailsUrl = new URL(`${PLACES_BASE}/details/json`)
  detailsUrl.searchParams.set("place_id", candidate.place_id)
  detailsUrl.searchParams.set(
    "fields",
    "name,address_components,international_phone_number",
  )
  detailsUrl.searchParams.set("language", "ja")
  detailsUrl.searchParams.set("key", apiKey)

  const detailsRes = await fetch(detailsUrl.toString())
  if (!detailsRes.ok) return fallback
  const detailsData = (await detailsRes.json()) as {
    result?: {
      name?: string
      address_components?: AddressComponent[]
      international_phone_number?: string
    }
  }
  const result = detailsData.result
  const components = result?.address_components ?? []
  if (components.length === 0) return fallback

  // 日本の住所コンポーネント
  const zip = pickComponent(components, "postal_code").replace(/-/g, "")
  const prefecture = pickComponent(components, "administrative_area_level_1") // 例: 東京都
  const locality = pickComponent(components, "locality") // 例: 港区 (Tokyo 23区は locality に入る)
  const sub1 = pickComponent(components, "sublocality_level_1") // 港区 or 赤坂
  const sub2 = pickComponent(components, "sublocality_level_2") // 赤坂
  const sub3 = pickComponent(components, "sublocality_level_3") // 1丁目
  const sub4 = pickComponent(components, "sublocality_level_4") // 12-33
  const premise = pickComponent(components, "premise")
  const streetNumber = pickComponent(components, "street_number")

  // address1: 市区町村より下の住所 (丁目・番地)
  // address2: 建物名 (ホテル名)
  // Yamato: address2 必須 (なければホテル名で埋める)
  const cityForYamato = locality || sub1 || prefecture || ""
  const streetParts = [sub2, sub3, sub4, premise, streetNumber].filter(Boolean)
  // locality と sub1 が異なる場合 (Tokyo の港区/赤坂のパターン), sub1 も住所の一部
  if (locality && sub1 && locality !== sub1) {
    streetParts.unshift(sub1)
  }
  const address1 = streetParts.join("") || "1番地"

  // 国際電話形式 (+81-XX-XXXX-XXXX) を Yamato 用 (E.164) に整形
  let phone = result?.international_phone_number ?? ""
  phone = phone.replace(/[^\d+]/g, "")
  if (!phone) phone = FALLBACK_PHONE

  return {
    full_name: recipient || result?.name || hotelName,
    company: result?.name ?? hotelName,
    phone,
    country: "JP",
    zip: zip || FALLBACK_ZIP,
    province: prefecture,
    city: cityForYamato,
    address1,
    address2: result?.name ?? hotelName,
  }
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "shipandco-create")
  if (!limit.ok) return limit.response

  const token = process.env.SHIPANDCO_API_KEY
  if (!token) {
    return NextResponse.json({ error: "SHIPANDCO_API_KEY not configured" }, { status: 500 })
  }
  const placesKey = process.env.GOOGLE_MAPS_API_KEY
  if (!placesKey) {
    return NextResponse.json({ error: "GOOGLE_MAPS_API_KEY not configured" }, { status: 500 })
  }

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const refNumber = typeof body.refNumber === "string" ? body.refNumber.trim() : ""
  const shipmentDate = typeof body.shipmentDate === "string" ? body.shipmentDate.trim() : ""
  const suitcaseCount = Math.max(1, Math.floor(Number(body.suitcaseCount) || 1))

  const fromInput = (body.from ?? {}) as { hotel?: string; recipient?: string }
  const toInput = (body.to ?? {}) as { hotel?: string; recipient?: string }
  const fromHotel = (fromInput.hotel ?? "").trim()
  const toHotel = (toInput.hotel ?? "").trim()

  if (!refNumber || !shipmentDate || !fromHotel || !toHotel) {
    return NextResponse.json(
      { error: "refNumber, shipmentDate, from.hotel and to.hotel are required" },
      { status: 400 },
    )
  }

  // Google Places で構造化住所を取得
  const [fromAddr, toAddr] = await Promise.all([
    resolveYamatoAddress(fromHotel, fromInput.recipient ?? "Front Desk", placesKey),
    resolveYamatoAddress(toHotel, toInput.recipient ?? "Front Desk", placesKey),
  ])

  const carrierId = await getYamatoCarrierId(token)
  if (!carrierId) {
    return NextResponse.json(
      { error: "Yamato carrier not registered in Ship&co dashboard" },
      { status: 502 },
    )
  }

  const payload = {
    from_address: fromAddr,
    to_address: toAddr,
    setup: {
      carrier_id: carrierId,
      service: "yamato_regular",
      ref_number: refNumber,
      shipment_date: shipmentDate,
      pack_amount: suitcaseCount,
      pack_size: 60, // ヤマト60サイズ相当をデフォルト (実運用では荷物サイズで調整)
      test: true, // POC 固定
    },
    products: Array.from({ length: suitcaseCount }).map((_, i) => ({
      name: `Luggage ${i + 1}`,
      quantity: 1,
      price: 5000,
    })),
  }

  try {
    const res = await fetch(`${SHIPANDCO_BASE}/shipments`, {
      method: "POST",
      headers: {
        "x-access-token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })
    const text = await res.text()
    let data: unknown = null
    try {
      if (text) data = JSON.parse(text)
    } catch {
      // non-JSON
    }
    if (!res.ok) {
      // Ship&co の error detail を呼び出し元に返す
      const detail = data ?? text
      return NextResponse.json(
        {
          error: `Ship&co error (${res.status})`,
          detail,
          sentPayload: payload, // デバッグ用 (POC のみ — production では削除)
        },
        { status: 502 },
      )
    }
    const d = data as {
      id?: string
      delivery?: {
        carrier?: string
        method?: string
        tracking_numbers?: string[]
        label?: string
        estimated_delivery_date?: string
      }
    }
    return NextResponse.json({
      id: d.id ?? "",
      label: d.delivery?.label ?? "",
      trackingNumbers: d.delivery?.tracking_numbers ?? [],
      carrier: d.delivery?.carrier ?? "",
      method: d.delivery?.method ?? "",
      estimatedDeliveryDate: d.delivery?.estimated_delivery_date ?? "",
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ship&co network error"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
