// staging の架空のホテル (lib/places-mock.ts・2026-11-07 R1) の守りと動きの試験。
//   実行: npx tsx scripts/test-staging-guard/places-mock.ts
// 外へは何も送らない (fetch を止めて、呼ばれた先を数える)。DB は使わない (Supabase の変数を入れない)。
//   1. 本番の配置で STAGING_PLACES_MOCK を入れると、起動の守りが止める (instrumentation でプロセスを終了)
//   2. 有効になるのは Preview・staging で STAGING_PLACES_MOCK=true の時だけ。それ以外の値・環境では無効
//   3. 有効の時: 検索・詳細・郵便番号・英語の名前・配送日数の郵便番号が、Google を 1回も呼ばずに架空のホテルを返す
//   4. 無効の時 (本番と同じ): 今までどおり Google を呼ぶ。模擬の ID では Google を呼ばずに「見つからない」
//   5. データ: 名前・ID・住所が試験用と分かる・電話/サイトを持たない・郵便番号が 3つとも別の地域
const fetched: string[] = []
globalThis.fetch = (async (input: RequestInfo | URL) => {
  fetched.push(String(input instanceof Request ? input.url : input))
  return new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [], candidates: [] }), { status: 200, headers: { "content-type": "application/json" } })
}) as typeof fetch

let pass = 0, fail = 0
const check = (name: string, ok: boolean, info = "") => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name} ${info}`) } }

const KEYS = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "BONDEX_ENV", "STAGING_PLACES_MOCK", "GOOGLE_MAPS_API_KEY", "APP_BASE_URL", "MAIL_TEST_CAPTURE",
  "STAGING_SUPABASE_REF", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "NEXT_RUNTIME"]
const setEnv = (e: Record<string, string>) => { for (const k of KEYS) delete process.env[k]; Object.assign(process.env, e) }
const PROD = { VERCEL: "1", VERCEL_ENV: "production", VERCEL_URL: "bondex-poc-main-abc.vercel.app" }
const PREVIEW = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "bondex-poc-main-git-x.vercel.app" }
// staging の起動の守りを通る最小の設定 (試験用の偽物。実在の鍵ではない)
const STAGING_OK = {
  BONDEX_ENV: "staging", STAGING_SUPABASE_REF: "oeucjrmuigtfnwowvzwr", MAIL_TEST_CAPTURE: "1", APP_BASE_URL: "https://preview.invalid",
  NEXT_PUBLIC_SUPABASE_URL: "https://oeucjrmuigtfnwowvzwr.supabase.co",
}

;(async () => {
  const guard = await import("../../lib/env-guard")
  const mock = await import("../../lib/places-mock")
  const { register } = await import("../../instrumentation")
  const places = await import("../../lib/places-search")
  const hotelPlace = await import("../../lib/hotel-place")
  const leadTime = await import("../../lib/lead-time-check")
  const site = await import("../../lib/hotel-website-phone")
  const booking = await import("../../lib/b2c/booking-service")

  const realExit = process.exit
  const tryRegister = () => {
    let code: number | null = null
    process.env.NEXT_RUNTIME = "nodejs"
    process.exit = ((c?: number) => { code = c ?? 0; throw new Error("exit") }) as typeof process.exit
    try { register() } catch { /* exit */ } finally { process.exit = realExit; delete process.env.NEXT_RUNTIME }
    return code
  }
  const msgOf = (e: Record<string, string>) => { try { guard.assertEnvironmentSafe(e); return "" } catch (x) { return x instanceof Error ? x.message : String(x) } }

  console.log("1. 本番の配置では模擬を有効にできない (起動を止める)")
  for (const v of ["true", "1", "yes", "TRUE"]) {
    setEnv({ ...PROD, STAGING_PLACES_MOCK: v })
    check(`本番 + STAGING_PLACES_MOCK=${v}: 起動の守りの理由に出る`, /STAGING_PLACES_MOCK: 本番の配置では使えない/.test(msgOf(process.env as Record<string, string>)))
    check(`本番 + STAGING_PLACES_MOCK=${v}: 起動の時にプロセスを止める`, tryRegister() === 1)
    check(`本番 + STAGING_PLACES_MOCK=${v}: 模擬は無効のまま`, mock.placesMockEnabled() === false)
  }
  setEnv({ ...PROD, BONDEX_ENV: "production", STAGING_PLACES_MOCK: "true" })
  check("本番 (BONDEX_ENV=production) + true: 止める", tryRegister() === 1 && !mock.placesMockEnabled())
  setEnv({ ...PROD, BONDEX_ENV: "staging", STAGING_PLACES_MOCK: "true" })
  check("本番の 3つ + BONDEX_ENV=staging (本番ではない扱い) + true: 本番の判定にならず、staging の条件で判定される", guard.isProductionDeployment() === false)
  setEnv({ ...PROD })
  check("本番 + 未設定: 起動の守りは今までどおり (理由 0件)", guard.environmentViolations().length === 0 && tryRegister() === null)
  setEnv({ ...PROD, STAGING_PLACES_MOCK: "false" })
  check("本番 + false: 理由 0件 (無効の意味)", guard.placesMockViolations().length === 0 && !mock.placesMockEnabled())

  console.log("2. 有効になるのは Preview・staging で true の時だけ")
  setEnv({ ...PREVIEW, ...STAGING_OK, STAGING_PLACES_MOCK: "true" })
  check("Preview + staging + true: 有効・守りの理由なし", mock.placesMockEnabled() && guard.placesMockViolations().length === 0)
  check("Preview + staging + true: 起動できる", tryRegister() === null, msgOf(process.env as Record<string, string>))
  setEnv({ ...PREVIEW, ...STAGING_OK, STAGING_PLACES_MOCK: "1" })
  check("Preview + staging + 1: 無効・起動を止める (値は true だけ)", !mock.placesMockEnabled() && tryRegister() === 1)
  setEnv({ ...PREVIEW, ...STAGING_OK })
  check("Preview + staging + 未設定: 無効", !mock.placesMockEnabled())
  setEnv({ STAGING_PLACES_MOCK: "true" })
  check("手元 (BONDEX_ENV なし) + true: 無効・守りの理由あり", !mock.placesMockEnabled() && guard.placesMockViolations().some((x) => /BONDEX_ENV=staging/.test(x)))
  setEnv({ VERCEL_ENV: "development", BONDEX_ENV: "staging", STAGING_PLACES_MOCK: "true" })
  check("Development + staging + true: 有効", mock.placesMockEnabled())

  console.log("3. 有効の時: Google を呼ばずに架空のホテルを返す")
  setEnv({ ...PREVIEW, ...STAGING_OK, STAGING_PLACES_MOCK: "true" })
  fetched.length = 0
  const sAll = await places.searchPlaces("hotel", "ja")
  check("検索: 当たらない語でも 3つ返す", sAll.ok && sAll.candidates.length === 3)
  const sKyoto = await places.searchPlaces("Kyoto station", "en")
  check("検索: 京都の語で京都の 1つ (英語の名前・住所)", sKyoto.ok && sKyoto.candidates.length === 1 && sKyoto.candidates[0].placeId === "bdx-staging-mock-kyoto-0002" && /TEST ONLY/.test(sKyoto.candidates[0].name))
  const sShort = await places.searchPlaces("x", "ja")
  check("検索: 1文字は 0件 (今までと同じ)", sShort.ok && sShort.candidates.length === 0)
  check("検索の候補の形が今までと同じ (placeId・name・address・city・prefecture)", sAll.ok && sAll.candidates.every((c) => ["placeId", "name", "address", "city", "prefecture"].every((k) => typeof (c as unknown as Record<string, unknown>)[k] === "string")))
  const d = await hotelPlace.fetchHotelPlaceDetailsJa("", "", "bdx-staging-mock-tokyo-0001")
  check("詳細: 東京の架空のホテル・電話なし", !!d && d.name === "【試験用・架空】BondEx テストホテル 東京" && !d.internationalPhone)
  check("詳細: 郵便番号を今までの規則で導ける", !!d && hotelPlace.zipFromPlaceDetails(d) === "1110031")
  check("詳細: 住所を今までの分解で読める (都道府県・市区)", !!d && hotelPlace.parseJpAddressString(d.formattedAddress).prefecture === "東京都" && hotelPlace.parseJpAddressString(d.formattedAddress).cityWard === "台東区")
  check("詳細: 都道府県の部品", !!d && hotelPlace.pickComponent(d.components, "administrative_area_level_1") === "東京都")
  const dk = await hotelPlace.fetchHotelPlaceDetailsJa("", "", "bdx-staging-mock-kyoto-0002")
  check("詳細: 政令市は Google と同じく locality=京都市・sublocality_level_1=下京区", !!dk && hotelPlace.pickComponent(dk.components, "locality") === "京都市" && hotelPlace.pickComponent(dk.components, "sublocality_level_1") === "下京区")
  check("詳細: 東京 23区は locality=台東区 (分けない)", !!d && hotelPlace.pickComponent(d.components, "locality") === "台東区")
  check("詳細: Biz-Logi の住所の分解 (formatted_address) で 京都市下京区・立売東町999", !!dk && hotelPlace.parseJpAddressString(dk.formattedAddress).cityWard === "京都市下京区" && hotelPlace.parseJpAddressString(dk.formattedAddress).street === "立売東町999")
  check("詳細: 名前での検索 (place_id なし) も架空のホテル", (await hotelPlace.fetchHotelPlaceDetailsJa("大阪", ""))?.placeId === "bdx-staging-mock-osaka-0003")
  check("詳細: 知らない ID は null", (await hotelPlace.fetchHotelPlaceDetailsJa("", "", "ChIJ_real_looking_id_123")) === null)
  check("郵便番号 (配送日数の照会): 京都", (await hotelPlace.resolveHotelZip("bdx-staging-mock-kyoto-0002", "")) === "6008005")
  check("配送日数の照会の郵便番号: 鍵なしでも大阪を引ける", (await leadTime.resolveEndpointZip({ placeId: "bdx-staging-mock-osaka-0003" } as never)) === "5310041")
  check("英語の名前", (await places.getPlaceNameByLang("bdx-staging-mock-osaka-0003", "en")) === "[TEST ONLY] BondEx Mock Hotel Osaka")
  check("公式サイト・電話の調べ: しない (null)", (await site.getOfficialWebsite("bdx-staging-mock-tokyo-0001")) === null && (await site.resolvePlaceIdByName("【試験用・架空】BondEx テストホテル 東京")) === null)
  const h = await booking.resolveHotel("bdx-staging-mock-kyoto-0002")
  check("B2C のホテルの確定 (resolveHotel): 郵便番号・都道府県・状態 unknown", !!h && h.postalCode === "6008005" && h.prefecture === "京都府" && h.status === "unknown")
  check("3 の間、Google (maps.googleapis.com) を 1回も呼んでいない", fetched.filter((u) => u.includes("googleapis.com")).length === 0, fetched.join(","))

  console.log("4. 無効の時 (本番と同じ): 今までどおり。模擬の ID では Google を呼ばない")
  setEnv({ ...PROD, GOOGLE_MAPS_API_KEY: "test-not-a-real-key" })
  fetched.length = 0
  check("模擬の ID の詳細: null・Google を呼ばない", (await hotelPlace.fetchHotelPlaceDetailsJa("", "test-not-a-real-key", "bdx-staging-mock-tokyo-0001")) === null && fetched.length === 0)
  check("模擬の ID の英語の名前: null・Google を呼ばない", (await places.getPlaceNameByLang("bdx-staging-mock-tokyo-0001", "en")) === null && fetched.length === 0)
  check("模擬の ID の公式サイト: null・Google を呼ばない", (await site.getOfficialWebsite("bdx-staging-mock-tokyo-0001")) === null && fetched.length === 0)
  check("模擬の ID の B2C のホテル: null (予約に入らない)", (await booking.resolveHotel("bdx-staging-mock-kyoto-0002")) === null && fetched.length === 0)
  await places.searchPlaces("Kyoto hotel", "ja")
  check("検索: 今までどおり Google の Text Search を呼ぶ", fetched.some((u) => u.includes("/place/textsearch/json")))
  fetched.length = 0
  await hotelPlace.fetchHotelPlaceDetailsJa("", "test-not-a-real-key", "ChIJabcdefghij")
  check("詳細: 今までどおり Google の Details を呼ぶ", fetched.some((u) => u.includes("/place/details/json")))
  setEnv({ ...PROD })
  const noKey = await places.searchPlaces("Kyoto hotel", "ja")
  check("鍵が無い時: 今までどおり 500 (模擬に切り替わらない)", !noKey.ok && noKey.status === 500)

  console.log("5. データ")
  const H = mock.MOCK_HOTELS
  check("3つ", H.length === 3)
  check("名前に【試験用・架空】と [TEST ONLY]", H.every((x) => x.nameJa.startsWith("【試験用・架空】") && x.nameEn.startsWith("[TEST ONLY]")))
  check("ID は bdx-staging-mock- で始まり、B2C の ID の形の検査を通る", H.every((x) => mock.isMockPlaceId(x.placeId) && /^[A-Za-z0-9_-]{10,300}$/.test(x.placeId)))
  check("ID は Google の場所の ID の形 (ChIJ…) ではない", H.every((x) => !/^ChIJ/.test(x.placeId)))
  check("英語の住所に fictional の印", H.every((x) => /TEST ONLY - fictional/.test(x.addressEn)))
  check("郵便番号は 7桁で 3つとも別", H.every((x) => /^\d{7}$/.test(x.zip)) && new Set(H.map((x) => x.zip)).size === 3)
  check("電話・サイトの項目を持たない", H.every((x) => !("phone" in x) && !("website" in x)))
  check("都道府県が 3つとも別 (都道府県をまたぐ配送の日程を試せる)", new Set(H.map((x) => x.prefecture)).size === 3)

  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail ? 1 : 0)
})()
