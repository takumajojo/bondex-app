/**
 * ホテル (Google Places) の住所取得と、日本の住所文字列の構造分解。
 *
 * 送り状発行 (app/api/shipandco/create) と、予約入力時のリードタイム照会 (/api/lead-time) で
 * **同じ郵便番号**を使うために切り出した共通実装。郵便番号の導出規則:
 *   formatted_address の 〒 → 無ければ address_components の postal_code。
 * サーバー専用 (GOOGLE_MAPS_API_KEY を使う)。
 */

const PLACES_BASE = "https://maps.googleapis.com/maps/api/place"

/**
 * 47 都道府県の明示リスト. あいまい正規表現の代わりに使用.
 * 「京都府」を「京都」と誤抽出する旧 bug 防止のため.
 */
export const JP_PREFECTURES = [
  "北海道",
  "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const

/**
 * 日本の住所文字列から 市区郡町村 と 番地以下 を抽出する.
 * Google の formatted_address (例: "〒261-8501 千葉県千葉市美浜区浜田1-7 アパホテル...")
 * を入力とし、Yamato が必要とする構造に分解.
 *
 * 対応パターン:
 *   - 政令市 + 区  : 千葉市美浜区, 大阪市北区, 京都市中京区, 福岡市博多区
 *   - 東京23区     : 港区, 渋谷区, 新宿区
 *   - 郡 + 町村    : 足柄下郡箱根町, 那須郡那須町
 *   - 単独市       : 雲仙市, 厚木市, 浦安市
 *   - 町村単独     : (rare)
 */
export function parseJpAddressString(addr: string): {
  zip: string
  prefecture: string
  cityWard: string
  street: string
} {
  const original = (addr || "").trim()

  // 〒XXX-XXXX を抽出 (位置を問わず)
  const zipM = /〒\s*(\d{3}-?\d{4})/.exec(original)
  const zip = zipM ? zipM[1].replace(/-/g, "") : ""

  // 都道府県を文字列のどこからでも検索 (Google が英語/ホテル名先頭で返すケースに対応)
  // 例: "Comic & Books, クインテッサホテル, 福岡県福岡市中央区..." でも "福岡県" を見つけられる
  let prefecture = ""
  let prefStart = -1
  for (const p of JP_PREFECTURES) {
    const idx = original.indexOf(p)
    if (idx !== -1 && (prefStart === -1 || idx < prefStart)) {
      prefecture = p
      prefStart = idx
    }
  }

  // 都道府県が見つからなかった = 日本以外 or パース不能
  if (!prefecture) {
    return { zip, prefecture: "", cityWard: "", street: original }
  }

  // 都道府県の直後から市区郡町村を抽出
  let s = original.slice(prefStart + prefecture.length).trim()
  // 先頭にあるかもしれない数字やノイズを skip しない (本来は無いはず)

  // 市区郡町村を抽出 — 優先順位順に試す
  let cityWard = ""
  let m: RegExpExecArray | null

  // ① 政令市 + 区 (千葉市美浜区, 大阪市北区, 京都市中京区, 福岡市博多区)
  m = /^([^市区郡町村\s]+市)([^市区郡町村\s]+区)/u.exec(s)
  if (m) {
    cityWard = m[1] + m[2]
    s = s.slice(m[0].length).trim()
  }
  // ② 郡 + 町/村 (足柄下郡箱根町)
  if (!cityWard) {
    m = /^([^市区郡町村\s]+郡)([^市区郡町村\s]+[町村])/u.exec(s)
    if (m) {
      cityWard = m[1] + m[2]
      s = s.slice(m[0].length).trim()
    }
  }
  // ③ 単独市 (雲仙市, 厚木市)
  if (!cityWard) {
    m = /^([^市区郡町村\s]+市)/u.exec(s)
    if (m) {
      cityWard = m[1]
      s = s.slice(m[0].length).trim()
    }
  }
  // ④ 単独区 (港区, 渋谷区)
  if (!cityWard) {
    m = /^([^市区郡町村\s]+区)/u.exec(s)
    if (m) {
      cityWard = m[1]
      s = s.slice(m[0].length).trim()
    }
  }
  // ⑤ 単独町/村
  if (!cityWard) {
    m = /^([^市区郡町村\s]+[町村])/u.exec(s)
    if (m) {
      cityWard = m[1]
      s = s.slice(m[0].length).trim()
    }
  }

  return {
    zip,
    prefecture,
    cityWard,
    street: s.trim(),
  }
}
export interface AddressComponent {
  long_name: string
  short_name: string
  types: string[]
}

export function pickComponent(components: AddressComponent[], type: string): string {
  return components.find((c) => c.types.includes(type))?.long_name ?? ""
}

export interface HotelPlaceDetails {
  placeId: string
  name?: string
  formattedAddress: string
  components: AddressComponent[]
  internationalPhone?: string
}

/**
 * Google Places (language=ja) でホテルの詳細を取る。placeId があれば text search を省く。
 * 失敗時は null。
 */
export async function fetchHotelPlaceDetailsJa(
  hotelName: string,
  apiKey: string,
  placeId?: string,
): Promise<HotelPlaceDetails | null> {
  // place_id がフロントから渡されている場合は text search をスキップして直接 details へ.
  // (operator / 代理店が autocomplete から選択したホテル — 確定済み)
  let resolvedPlaceId = placeId
  if (!resolvedPlaceId) {
    // Step 1: findplacefromtext (日本語)
    const searchUrl = new URL(`${PLACES_BASE}/findplacefromtext/json`)
    searchUrl.searchParams.set("input", hotelName)
    searchUrl.searchParams.set("inputtype", "textquery")
    searchUrl.searchParams.set("fields", "place_id,name")
    searchUrl.searchParams.set("language", "ja")
    searchUrl.searchParams.set("region", "jp")
    searchUrl.searchParams.set("key", apiKey)

    const searchRes = await fetch(searchUrl.toString())
    if (!searchRes.ok) return null
    const searchData = (await searchRes.json()) as {
      status?: string
      candidates?: Array<{ place_id?: string; name?: string }>
    }
    const candidate = searchData.candidates?.[0]
    if (!candidate?.place_id) return null
    resolvedPlaceId = candidate.place_id
  }

  // Step 2: details (日本語) で formatted_address + address_components + phone を取得
  const detailsUrl = new URL(`${PLACES_BASE}/details/json`)
  detailsUrl.searchParams.set("place_id", resolvedPlaceId)
  detailsUrl.searchParams.set(
    "fields",
    "name,formatted_address,address_components,international_phone_number",
  )
  detailsUrl.searchParams.set("language", "ja")
  detailsUrl.searchParams.set("key", apiKey)

  const detailsRes = await fetch(detailsUrl.toString())
  if (!detailsRes.ok) return null
  const detailsData = (await detailsRes.json()) as {
    result?: {
      name?: string
      formatted_address?: string
      address_components?: AddressComponent[]
      international_phone_number?: string
    }
  }
  const result = detailsData.result
  const components = result?.address_components ?? []
  const formattedAddress = result?.formatted_address ?? ""
  if (components.length === 0 && !formattedAddress) return null
  return {
    placeId: resolvedPlaceId,
    name: result?.name,
    formattedAddress,
    components,
    internationalPhone: result?.international_phone_number,
  }
}

/** Places 詳細から郵便番号 (7桁・ハイフンなし) を導く。取れなければ ""。送り状発行と同一規則。 */
export function zipFromPlaceDetails(d: Pick<HotelPlaceDetails, "formattedAddress" | "components">): string {
  return parseJpAddressString(d.formattedAddress).zip || pickComponent(d.components, "postal_code").replace(/-/g, "")
}

// placeId → 郵便番号 のプロセス内キャッシュ (予約入力中の再照会で Places を何度も叩かない)。
const zipCache = new Map<string, { zip: string; at: number }>()
const ZIP_CACHE_MS = 24 * 60 * 60 * 1000

/** ホテルの郵便番号だけを取る (予約入力時のリードタイム照会用)。不明なら null。 */
export async function resolveHotelZip(placeId: string, apiKey: string): Promise<string | null> {
  const hit = zipCache.get(placeId)
  if (hit && Date.now() - hit.at < ZIP_CACHE_MS) return hit.zip || null
  const d = await fetchHotelPlaceDetailsJa("", apiKey, placeId).catch(() => null)
  if (!d) return null
  const zip = zipFromPlaceDetails(d)
  zipCache.set(placeId, { zip, at: Date.now() })
  return zip || null
}
