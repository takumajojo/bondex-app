/**
 * staging（Vercel の Preview・BONDEX_ENV=staging）だけで使う、Google Places の代わりの架空のホテル（2026-11-07・R1）。
 *
 * 目的: Google Maps の鍵を staging に入れずに、B2C の予約（ホテルの検索・選択・住所・郵便番号・配送日数）を通しで試す。
 * 有効にする条件（全部）:
 *   - STAGING_PLACES_MOCK=true
 *   - BONDEX_ENV=staging
 *   - 本番の配置ではない（lib/env-guard.ts isProductionDeployment が false）
 * 本番の配置で STAGING_PLACES_MOCK を入れると、起動の守り（lib/env-guard.ts placesMockViolations）が起動を止める。
 * 有効でない時は、どの関数も何もしない（今までの Google の呼び出しはそのまま）。
 *
 * データ:
 *   - 架空のホテル 3つ。名前に【試験用・架空】/ [TEST ONLY] を付け、ID は bdx-staging-mock- で始める（実在のホテル・Google の ID ではない）。
 *   - 住所の丁目・番地は実在しない番号。郵便番号だけは配送日数の表（sagawa_zip_offices・sagawa_office_lead_times）に
 *     ある地域の番号を使い、3つの組み合わせの配送日数（1日）が引けるようにした（staging の DB で確認）。
 *   - 電話・ウェブサイトは持たない（ホテルへの連絡・電話番号の調べにつながらない）。
 * 本番で模擬の ID が来た時は、Google を呼ばずに「見つからない」にする（isMockPlaceId・本番の DB に保存させない）。
 */
import { isProductionDeployment } from "@/lib/env-guard"

type Env = Record<string, string | undefined>

export const PLACES_MOCK_FLAG = "STAGING_PLACES_MOCK"
export const MOCK_PLACE_ID_PREFIX = "bdx-staging-mock-"

export interface MockHotel {
  placeId: string
  nameJa: string
  nameEn: string
  /** Google の formatted_address と同じ形（〒 から始まる） */
  addressJa: string
  addressEn: string
  zip: string
  prefecture: string
  city: string
  /** 検索で当てる語（小文字） */
  keywords: string[]
}

export const MOCK_HOTELS: readonly MockHotel[] = [
  {
    placeId: `${MOCK_PLACE_ID_PREFIX}tokyo-0001`,
    nameJa: "【試験用・架空】BondEx テストホテル 東京",
    nameEn: "[TEST ONLY] BondEx Mock Hotel Tokyo",
    addressJa: "〒111-0031 東京都台東区千束9-99-1",
    addressEn: "9-99-1 Senzoku, Taito City, Tokyo 111-0031, Japan (TEST ONLY - fictional)",
    zip: "1110031",
    prefecture: "東京都",
    city: "台東区",
    keywords: ["tokyo", "東京", "台東"],
  },
  {
    placeId: `${MOCK_PLACE_ID_PREFIX}kyoto-0002`,
    nameJa: "【試験用・架空】BondEx テストホテル 京都",
    nameEn: "[TEST ONLY] BondEx Mock Hotel Kyoto",
    addressJa: "〒600-8005 京都府京都市下京区立売東町999",
    addressEn: "999 Tachiurihigashicho, Shimogyo Ward, Kyoto 600-8005, Japan (TEST ONLY - fictional)",
    zip: "6008005",
    prefecture: "京都府",
    city: "京都市下京区",
    keywords: ["kyoto", "京都", "下京"],
  },
  {
    placeId: `${MOCK_PLACE_ID_PREFIX}osaka-0003`,
    nameJa: "【試験用・架空】BondEx テストホテル 大阪",
    nameEn: "[TEST ONLY] BondEx Mock Hotel Osaka",
    addressJa: "〒531-0041 大阪府大阪市北区天神橋9-99-3",
    addressEn: "9-99-3 Tenjinbashi, Kita Ward, Osaka 531-0041, Japan (TEST ONLY - fictional)",
    zip: "5310041",
    prefecture: "大阪府",
    city: "大阪市北区",
    keywords: ["osaka", "大阪", "天神橋"],
  },
]

/** 模擬を使うか。staging（本番の配置でない・BONDEX_ENV=staging）で STAGING_PLACES_MOCK=true の時だけ。 */
export function placesMockEnabled(env: Env = process.env): boolean {
  return env[PLACES_MOCK_FLAG] === "true" && env.BONDEX_ENV === "staging" && !isProductionDeployment(env)
}

export function isMockPlaceId(placeId: string | null | undefined): boolean {
  return typeof placeId === "string" && placeId.startsWith(MOCK_PLACE_ID_PREFIX)
}

export function mockHotelById(placeId: string | null | undefined): MockHotel | null {
  return MOCK_HOTELS.find((h) => h.placeId === placeId) ?? null
}

/** 検索の語に当たる架空のホテル。当たらなければ 3つ全部（試験の人がいつでも選べるように）。 */
export function searchMockHotels(query: string): MockHotel[] {
  const q = query.trim().toLowerCase()
  const hit = MOCK_HOTELS.filter((h) => h.keywords.some((k) => q.includes(k)) || h.nameJa.toLowerCase().includes(q) || h.nameEn.toLowerCase().includes(q))
  return hit.length > 0 ? hit : [...MOCK_HOTELS]
}

/** Google の address_components と同じ形（lib/hotel-place.ts の pickComponent・zipFromPlaceDetails で読める） */
export function mockAddressComponents(h: MockHotel): Array<{ long_name: string; short_name: string; types: string[] }> {
  const zipHyphen = `${h.zip.slice(0, 3)}-${h.zip.slice(3)}`
  return [
    { long_name: zipHyphen, short_name: zipHyphen, types: ["postal_code"] },
    { long_name: h.prefecture, short_name: h.prefecture, types: ["administrative_area_level_1", "political"] },
    // Google と同じく、政令市の区は locality (市) と sublocality_level_1 (区) に分ける (例: 京都市・下京区)
    ...(/^(.+?市)(.+区)$/.test(h.city)
      ? [
          { long_name: h.city.replace(/^(.+?市)(.+区)$/, "$1"), short_name: h.city.replace(/^(.+?市)(.+区)$/, "$1"), types: ["locality", "political"] },
          { long_name: h.city.replace(/^(.+?市)(.+区)$/, "$2"), short_name: h.city.replace(/^(.+?市)(.+区)$/, "$2"), types: ["sublocality", "sublocality_level_1", "political"] },
        ]
      : [{ long_name: h.city, short_name: h.city, types: ["locality", "political"] }]),
    { long_name: "日本", short_name: "JP", types: ["country", "political"] },
  ]
}

let announced = false
/** 模擬を使っていることを、サーバーのログに 1回だけ出す（開発者が分かるように。値・個人情報は出さない）。 */
export function announcePlacesMock(): void {
  if (announced) return
  announced = true
  console.warn("[places-mock] staging の架空のホテル（Google Places の代わり）を使っています。Google は呼びません。")
}
