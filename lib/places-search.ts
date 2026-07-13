/**
 * Google Places Text Search ベースの日本国内ホテル候補検索の共通ロジック。
 *
 * 運営 (/api/places/search) と代理店 (/api/agency/places/search) の両方から使う。
 * 認証は各ルート側で行う (運営=OPERATOR_PASSWORD / 代理店=Supabase JWT)。
 */

const PLACES_BASE = "https://maps.googleapis.com/maps/api/place"

export interface PlaceCandidate {
  placeId: string
  name: string
  address: string
  city: string // 例: "港区" / "京都市中京区"
  prefecture: string // 例: "東京都" / "京都府"
}

/**
 * Google の formatted_address から「都道府県 + 市区郡町村」を抽出する。
 * 例: "〒108-8611 東京都港区高輪4-10-30" → { prefecture: "東京都", city: "港区" }
 */
export function parseJpAddress(formattedAddr: string): { prefecture: string; city: string } {
  const noZip = formattedAddr.replace(/^〒\s*\d{3}-?\d{4}\s*/, "").trim()
  const prefRe = /^(.+?[県府都]|北海道)/u
  const prefM = prefRe.exec(noZip)
  if (!prefM) return { prefecture: "", city: "" }
  const prefecture = prefM[1]
  const afterPref = noZip.slice(prefecture.length)
  const cityRe = /^(.+?[市区郡町村])((?:.+?区)?)/u
  const cityM = cityRe.exec(afterPref)
  if (!cityM) return { prefecture, city: "" }
  const city = cityM[1] + (cityM[2] || "")
  return { prefecture, city }
}

export type PlacesSearchResult =
  | { ok: true; candidates: PlaceCandidate[] }
  | { ok: false; status: number; error: string }

export async function searchPlaces(query: string, lang: "ja" | "en"): Promise<PlacesSearchResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return { ok: false, status: 500, error: "GOOGLE_MAPS_API_KEY not configured" }

  const q = query.trim()
  if (!q || q.length < 2) return { ok: true, candidates: [] }

  const url = new URL(`${PLACES_BASE}/textsearch/json`)
  url.searchParams.set("query", q)
  url.searchParams.set("language", lang)
  url.searchParams.set("region", "jp")
  url.searchParams.set("type", "lodging")
  url.searchParams.set("key", apiKey)

  let res: Response
  try {
    res = await fetch(url.toString())
  } catch {
    return { ok: false, status: 502, error: "Places API unreachable" }
  }
  if (!res.ok) return { ok: false, status: 502, error: "Places API error" }

  const data = (await res.json()) as {
    status?: string
    results?: Array<{ place_id?: string; name?: string; formatted_address?: string }>
  }
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    return { ok: false, status: 502, error: `Places API status: ${data.status}` }
  }

  // 日本国内のホテルのみ (region=jp はバイアスに過ぎないので住所文字列で確定フィルタ)
  const isJapan = (addr: string) =>
    addr.includes("日本") || addr.includes("Japan") || /〒?\s*\d{3}-\d{4}/.test(addr)

  const candidates: PlaceCandidate[] = (data.results ?? [])
    .filter((r) => r.place_id && r.name && r.formatted_address)
    .filter((r) => isJapan(r.formatted_address!))
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

  return { ok: true, candidates }
}
