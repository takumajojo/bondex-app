import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"

const API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? ""
const BASE = "https://maps.googleapis.com/maps/api/place"

type AC = { long_name: string; short_name: string; types: string[] }

function get(components: AC[], type: string): string {
  return components.find((c) => c.types.includes(type))?.long_name ?? ""
}

/**
 * Parse Google Places address_components for Japanese addresses.
 *
 * province = administrative_area_level_1 (都道府県)
 * city     = locality (市) — empty for Tokyo 23-ward area
 * address1 = locality + sublocality_level_1 (区) + sublocality_level_2 (町)
 *            + sublocality_level_3 (丁目) + sublocality_level_4 (番地)
 *            + premise (号) — joined without separators
 * address2 = "" (filled by user if needed)
 */
function parseJpAddress(components: AC[]): {
  province: string
  city: string
  address1: string
  address2: string
  zip: string
} {
  const province   = get(components, "administrative_area_level_1")
  const locality   = get(components, "locality")
  const sub1       = get(components, "sublocality_level_1")
  const sub2       = get(components, "sublocality_level_2")
  const sub3       = get(components, "sublocality_level_3")
  const sub4       = get(components, "sublocality_level_4")
  const premise    = get(components, "premise")
  const streetNum  = get(components, "street_number")
  const postalCode = get(components, "postal_code")

  const address1 = [locality, sub1, sub2, sub3, sub4, premise || streetNum]
    .filter(Boolean)
    .join("")

  return { province, city: locality, address1, address2: "", zip: postalCode }
}

export async function GET(req: NextRequest) {
  const limit = rateLimit(req, "places")
  if (!limit.ok) return limit.response

  if (!API_KEY) return NextResponse.json({ error: "GOOGLE_MAPS_API_KEY not set" }, { status: 500 })

  const { searchParams } = req.nextUrl
  const q        = searchParams.get("q")
  const place_id = searchParams.get("place_id")

  if (q) {
    const acUrl = new URL(`${BASE}/autocomplete/json`)
    acUrl.searchParams.set("input", q)
    acUrl.searchParams.set("language", "ja")
    acUrl.searchParams.set("region", "jp")
    acUrl.searchParams.set("types", searchParams.get("types") ?? "establishment")
    const components = searchParams.get("components")
    if (components) acUrl.searchParams.set("components", components)
    acUrl.searchParams.set("key", API_KEY)
    const res  = await fetch(acUrl.toString(), { next: { revalidate: 0 } })
    const data = await res.json()
    const predictions = ((data.predictions ?? []) as any[]).map((p) => ({
      place_id: p.place_id as string,
      name: (p.structured_formatting?.main_text ?? p.description) as string,
      secondary: (p.structured_formatting?.secondary_text ?? "") as string,
    }))
    return NextResponse.json({ predictions })
  }

  if (place_id) {
    const fields = "name,place_id,formatted_address,address_components,types,international_phone_number"
    const url  = `${BASE}/details/json?place_id=${encodeURIComponent(place_id)}&fields=${fields}&language=ja&key=${API_KEY}`
    const res  = await fetch(url, { next: { revalidate: 0 } })
    const data = await res.json()
    const result = data.result as any
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 })

    const components: AC[] = result.address_components ?? []
    const { province, city, address1, address2, zip } = parseJpAddress(components)
    const placeTypes: string[] = result.types ?? []
    const destType = placeTypes.includes("airport") ? "airport" : "hotel"

    return NextResponse.json({
      id: place_id,
      name: result.name as string,
      destType,
      province,
      city,
      address1,
      address2,
      zip,
      country: "JP",
      phone: (result.international_phone_number ?? "") as string,
      address_components: components,
    })
  }

  return NextResponse.json({ error: "missing q or place_id" }, { status: 400 })
}
