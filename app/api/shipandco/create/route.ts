import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import {
  deliveryDateErrorCode,
  getDeliverableRange,
} from "@/lib/yamato-delivery"
import { saveShipment } from "@/lib/shipments-db"

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
 * 0. 出荷予定日をバリデーション (ヤマト30日制約: ES003001 の事前ガード)
 *      - 不正日付 → 400 { code: "SHIPMENT_DATE_INVALID" }
 *      - 過去日付 → 400 { code: "SHIPMENT_DATE_PAST" }
 *      - 30日超   → 200 { status: "deferred", issuableFrom } (Ship&co を呼ばない)
 * 1. Google Places (language=ja) でホテル住所を構造化抽出 (zip / province / city / address1 / address2 / phone)
 * 2. Ship&co 形式の payload を組み立て
 * 3. POST https://api.shipandco.com/v1/shipments
 *
 * 出力 (発行成功時):
 *   { status: "issued", id, label, trackingNumbers, carrier, method, estimatedDeliveryDate }
 * 出力 (発行延期時):
 *   { status: "deferred", shipmentDate, issuableFrom, daysUntilIssuable }
 *
 * 詳細設計: docs/shipment-deferred-design.md
 */

const SHIPANDCO_BASE = "https://api.shipandco.com/v1"
const PLACES_BASE = "https://maps.googleapis.com/maps/api/place"

const FALLBACK_PHONE = "0000000000"
const FALLBACK_ZIP = "0000000"

// ヤマト制約: 出荷予定日は送り状発行日 (= 今日) から30日以内 (ES003001)
const MAX_LEAD_DAYS = 30
const MS_PER_DAY = 86_400_000

// JST 基準の今日 (YYYY-MM-DD)。Vercel は UTC 稼働なので日付ズレを防ぐ。
function jstTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

// 2つの YYYY-MM-DD の日数差 (to - from)。カレンダー日として UTC 0時基準で計算。
function dayDiff(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`)
  const b = Date.parse(`${toYmd}T00:00:00Z`)
  return Math.round((b - a) / MS_PER_DAY)
}

// shipmentDate − MAX_LEAD_DAYS の YYYY-MM-DD (deferred 区間の発行解禁日)
function issuableFromYmd(shipmentDate: string): string {
  const t = Date.parse(`${shipmentDate}T00:00:00Z`) - MAX_LEAD_DAYS * MS_PER_DAY
  return new Date(t).toISOString().slice(0, 10)
}

function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const t = Date.parse(`${s}T00:00:00Z`)
  if (Number.isNaN(t)) return false
  // 2026-02-31 のような不正日を弾く (パース後に正規化されて元と一致するか)
  return new Date(t).toISOString().slice(0, 10) === s
}

// "2026-07-11" → "7/11着" (記事欄用の短縮形)
function formatYmdShortJp(ymd: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ""
  return `${parseInt(m[1], 10)}/${parseInt(m[2], 10)}着`
}

// 苗字のみ抽出 ("Mr. Jack Costanzo" → "Costanzo")。
// 品名欄の文字数節約用. 入力が日本語名 / 1単語の場合はそのまま返す.
function lastNameOnly(fullName: string): string {
  const trimmed = fullName.trim()
  if (!trimmed) return ""
  // Mr./Mrs./Ms./Dr. 等の敬称を除去してから最後の単語を取る
  const noTitle = trimmed.replace(/^(Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?)\s+/i, "")
  const parts = noTitle.split(/\s+/).filter(Boolean)
  return parts[parts.length - 1] || trimmed
}

/**
 * 47 都道府県の明示リスト. あいまい正規表現の代わりに使用.
 * 「京都府」を「京都」と誤抽出する旧 bug 防止のため.
 */
const JP_PREFECTURES = [
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

// Yamato (Ship&co) 構造 — Ship&co の field マッピング:
//   province : 都道府県 (例: 千葉県)
//   city     : 市区郡町村 (例: 千葉市美浜区) ← Yamato 補助
//   address1 : 番地以下 = consignee_address3 (例: 浜田1-7) ← cityWard 含めると ES001014
//   address2 : 市区郡町村 = consignee_address2 (例: 千葉市美浜区) ← 空だと EF011022
//   company  : 建物名 / ホテル名
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
  extra: string
}

interface AddressComponent {
  long_name: string
  short_name: string
  types: string[]
}

interface CreateBody {
  refNumber?: unknown
  shipmentDate?: unknown
  deliveryDate?: unknown
  /** 配達時間帯 (Ship&co の setup.time)。未指定は午前中 (before-noon) がデフォルト。 */
  deliveryTime?: unknown
  suitcaseCount?: unknown
  from?: unknown
  to?: unknown
  productName?: unknown
  // 管理ダッシュボード用メタ情報
  bookingId?: unknown
  legIndex?: unknown
  agency?: unknown
  representative?: unknown
  travelerCount?: unknown
  bookingName?: unknown
  fromCheckIn?: unknown
  toCheckOut?: unknown
  specialNote?: unknown
  tourNumber?: unknown
  groupName?: unknown
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

// 依頼主 (sender) は BondEx 固定 (ES001023 ご依頼主名が長すぎ対策).
// Yamato は shipper_name に full_name と company を結合した値を使う可能性があるため両方短くする.
const SENDER_FULL_NAME = "BondEx"
const SENDER_COMPANY = "BondEx"

// Google Places (language=ja) でホテルを検索し、Yamato 形式の構造化住所を返す.
// 失敗時はホテル名のみのフォールバックを返す (Ship&co は zip 必須なので最終的に弾かれる)
/**
 * 住所解決の結果. null は呼び出し側で 400 エラーに変換する.
 * Yamato は 市区郡町村 必須なので、解決できない場合はガベージを送らずフェイルファスト.
 */
async function resolveYamatoAddress(
  hotelName: string,
  recipient: string,
  apiKey: string,
  isSender: boolean = false,
  placeId?: string,
): Promise<YamatoAddress | null> {
  // place_id がフロントから渡されている場合は text search をスキップして直接 details へ.
  // (operator が autocomplete から選択したホテル — 確定済み)
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

  // 主軸: formatted_address (例: "〒261-8501 千葉県千葉市美浜区浜田1-7") を正規表現で構造分解
  const parsed = parseJpAddressString(formattedAddress)
  let { zip, prefecture, cityWard, street } = parsed

  // Vercel ログ用 — Google から受け取った生の formatted_address と分解結果
  console.log("[shipandco] parseJpAddressString", {
    hotelName,
    formattedAddress,
    parsed: { zip, prefecture, cityWard, street },
  })

  // フォールバック: 個別 component から補完 (formatted_address が無いケース)
  if (!zip) zip = pickComponent(components, "postal_code").replace(/-/g, "")
  if (!prefecture) prefecture = pickComponent(components, "administrative_area_level_1")

  // formatted_address からの抽出が失敗 (旧 Places API レスポンスなど) なら最終 fallback:
  // address_components の long_name を連結して再パース
  if (!cityWard) {
    const joinedAddr = components.map((c) => c.long_name).join("")
    const refallback = parseJpAddressString(joinedAddr)
    cityWard = refallback.cityWard
    if (!street) street = refallback.street
    if (!prefecture) prefecture = refallback.prefecture
  }

  // ヤマトに不完全な住所を送らない (EF011022 への確実な事前ガード)
  if (!cityWard) {
    console.warn("[shipandco] cityWard derivation failed", {
      hotelName,
      formattedAddress,
      prefecture,
      street,
    })
    return null
  }

  // streetOnly: formatted_address パースで取れた street 部分.
  // 末尾にホテル名 (建物名) が含まれていれば除去 — ex: "浜田1-7 アパホテル..." → "浜田1-7"
  let streetOnly = street
  if (result?.name && streetOnly.includes(result.name)) {
    streetOnly = streetOnly.split(result.name)[0].trim()
  }
  // 空白以降を切り捨て (建物名がスペース区切りで続く場合の保険)
  if (streetOnly.includes(" ")) {
    streetOnly = streetOnly.split(/\s+/)[0]
  }

  // 国際電話形式 (+81-XX-XXXX-XXXX) を E.164 に正規化
  let phone = result?.international_phone_number ?? ""
  phone = phone.replace(/[^\d+]/g, "")
  if (!phone) phone = FALLBACK_PHONE

  // ご依頼主 (sender) = "BondEx" 固定 (ES001023 長すぎ対策)
  // お届け先様名 (recipient) = 宿泊者名 (運送業法上 必須)。
  //   recipient が空の場合のみ ホテル名にフォールバック.
  const fullName = isSender
    ? SENDER_FULL_NAME
    : (recipient.trim() || result?.name || hotelName)

  // 完全な住所パス (city + address1 を結合した形)
  const fullAddress = cityWard + streetOnly

  // Yamato 送り状の構造マッピング (Ship&co の本当の field 対応 — 過去動いていた d345ef9 を確認):
  //   province → 都道府県                        (例: 大分県)
  //   address1 → consignee_address3 = 短い建物/番地  (例: 由布市)         ← cityWard を入れる (短い)
  //   address2 → consignee_address2 = full address  (例: 由布市湯布院町川南1243) ← Yamato parser がここから 市区郡町村 を抽出
  //   city     → 補助 (Yamato は使わないが整合性のため設定)
  //   company  → ホテル名
  //
  // エラー履歴と確定マッピング:
  //   - EF011022 (consignee_address2 missing): address2 に fullPath を入れることで解消
  //   - ES001014 (consignee_address3 too long): address1 を短く (cityWard のみ) することで解消
  //   - 推測で逆マッピングを試して再発させていたため、過去動作実績のある d345ef9 の構造に確定回帰
  const fullPath = fullAddress || cityWard
  return {
    full_name: fullName,
    company: isSender ? SENDER_COMPANY : (result?.name ?? hotelName),
    phone,
    country: "JP",
    zip: zip || FALLBACK_ZIP,
    province: prefecture,
    city: cityWard,
    address1: cityWard,
    address2: fullPath,
    extra: "",
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
  // 配達時間帯: 旅行会社の要望により AM (午前中) 指定を標準とする。
  // 明示指定があれば許可リスト内でそれを採用。エリア・サービスによる可否は
  // ヤマト側で判定されるため、実荷物での検証が必要 (拒否時は Ship&co がエラーを返す)。
  const YAMATO_TIME_SLOTS = [
    "not-specified", "before-noon", "before-ten", "before-five",
    "14-16", "16-18", "18-20", "19-21",
  ] as const
  const rawDeliveryTime = typeof body.deliveryTime === "string" ? body.deliveryTime.trim() : ""
  const deliveryTime = (YAMATO_TIME_SLOTS as readonly string[]).includes(rawDeliveryTime)
    ? rawDeliveryTime
    : "before-noon"

  const rawDeliveryDate = typeof body.deliveryDate === "string" ? body.deliveryDate.trim() : ""
  // 配達希望日 = チェックイン日。形式不正なら未指定扱い (Yamato 標準配送日になる)
  const deliveryDate = rawDeliveryDate && isValidYmd(rawDeliveryDate) ? rawDeliveryDate : ""
  const suitcaseCount = Math.max(1, Math.floor(Number(body.suitcaseCount) || 1))

  const fromInput = (body.from ?? {}) as { hotel?: string; recipient?: string; placeId?: string; city?: string }
  const toInput = (body.to ?? {}) as { hotel?: string; recipient?: string; placeId?: string; city?: string }
  const fromHotel = (fromInput.hotel ?? "").trim()
  const toHotel = (toInput.hotel ?? "").trim()
  const fromPlaceId = (fromInput.placeId ?? "").trim() || undefined
  const toPlaceId = (toInput.placeId ?? "").trim() || undefined

  // 管理ダッシュボード用メタ情報
  const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim() : ""
  const legIndex = typeof body.legIndex === "number" ? body.legIndex : 0
  const agency = typeof body.agency === "string" ? body.agency.trim() : ""
  const representative = typeof body.representative === "string" ? body.representative.trim() : ""
  const travelerCount = typeof body.travelerCount === "number" ? body.travelerCount : 1
  const bookingName = typeof body.bookingName === "string" ? body.bookingName.trim() : ""
  const fromCheckIn = typeof body.fromCheckIn === "string" ? body.fromCheckIn.trim() : ""
  const toCheckOut = typeof body.toCheckOut === "string" ? body.toCheckOut.trim() : ""
  const specialNote = typeof body.specialNote === "string" ? body.specialNote.trim() : ""
  const tourNumber = typeof body.tourNumber === "string" ? body.tourNumber.trim() : ""
  const groupName = typeof body.groupName === "string" ? body.groupName.trim() : ""

  if (!refNumber || !shipmentDate || !fromHotel || !toHotel) {
    return NextResponse.json(
      { error: "refNumber, shipmentDate, from.hotel and to.hotel are required" },
      { status: 400 },
    )
  }

  // 出荷予定日のバリデーション (ヤマト30日制約への事前ガード)
  // 無駄な Ship&co 呼び出しと ES003001 エラーを未然に防ぐ。
  if (!isValidYmd(shipmentDate)) {
    return NextResponse.json(
      { error: "shipmentDate must be a valid YYYY-MM-DD date", code: "SHIPMENT_DATE_INVALID" },
      { status: 400 },
    )
  }
  const gap = dayDiff(jstTodayYmd(), shipmentDate)
  if (gap < 0) {
    // 過去日付 — 発行不可
    return NextResponse.json(
      {
        error: "shipmentDate is in the past",
        code: "SHIPMENT_DATE_PAST",
        shipmentDate,
      },
      { status: 400 },
    )
  }
  if (gap > MAX_LEAD_DAYS) {
    // 30日超 — 今は発行できない。Ship&co を呼ばず deferred を返す。
    const issuableFrom = issuableFromYmd(shipmentDate)
    // 管理ダッシュボードに pending として登録 (issuableFrom 以降に自動発行する想定)
    await saveShipment({
      booking_id: bookingId || refNumber,
      leg_index: legIndex,
      agency,
      representative,
      traveler_count: travelerCount,
      booking_name: bookingName || null,
      tour_number: tourNumber || null,
      group_name: groupName || null,
      shipment_date: shipmentDate,
      expected_arrival: deliveryDate || null,
      from_hotel: fromHotel,
      from_place_id: fromPlaceId ?? null,
      from_check_in: fromCheckIn || null,
      to_hotel: toHotel,
      to_place_id: toPlaceId ?? null,
      to_check_out: toCheckOut || null,
      recipient: (toInput.recipient ?? "").trim(),
      suitcase_count: suitcaseCount,
      amount_yen: suitcaseCount * 5000,
      ship_ref_number: refNumber,
      yamato_issuable_from: issuableFrom,
      status: "pending",
      notes: specialNote || null,
    })
    return NextResponse.json({
      status: "deferred",
      shipmentDate,
      issuableFrom,
      daysUntilIssuable: gap - MAX_LEAD_DAYS,
    })
  }

  // 配達希望日 (deliveryDate) のヤマト配達ルール検証
  // 宅急便 (常温): shipmentDate + 1日 〜 +7日 のみ指定可能
  // 範囲外を Ship&co に送るとエラーになるので事前に弾く
  if (deliveryDate) {
    const delivErr = deliveryDateErrorCode(deliveryDate, shipmentDate, "standard")
    if (delivErr) {
      const range = getDeliverableRange(shipmentDate, "standard")
      return NextResponse.json(
        {
          error: "deliveryDate is outside the Yamato deliverable window",
          code: delivErr,
          shipmentDate,
          deliveryDate,
          deliverableRange: range,
        },
        { status: 400 },
      )
    }
  }

  // Google Places で構造化住所を取得
  const [fromAddr, toAddr] = await Promise.all([
    resolveYamatoAddress(fromHotel, fromInput.recipient ?? "Front Desk", placesKey, true, fromPlaceId),  // sender = BondEx
    resolveYamatoAddress(toHotel, toInput.recipient ?? "Front Desk", placesKey, false, toPlaceId),     // recipient = hotel
  ])

  // 解決結果を Vercel ログに残す (再発時の根本特定用) — 全フィールドを出力する
  console.log("[shipandco] resolved addresses", {
    fromHotel,
    toHotel,
    from: fromAddr,
    to: toAddr,
  })

  // 住所解決失敗時 — ヤマトに不完全な住所を送らずに 400 で早期エラー.
  // 操作員にホテル名の修正を促す (例: "Ace hotel kyoto" → 正式な "Ace Hotel Kyoto").
  if (!fromAddr || !toAddr) {
    const failed: string[] = []
    if (!fromAddr) failed.push(`発送元: "${fromHotel}"`)
    if (!toAddr) failed.push(`発送先: "${toHotel}"`)
    return NextResponse.json(
      {
        error: "Could not resolve hotel address via Google Places",
        code: "ADDRESS_RESOLUTION_FAILED",
        failed,
        hint: "ホテル名の表記を見直してください (正式名称、半角/全角統一など)。",
      },
      { status: 400 },
    )
  }

  const carrierId = await getYamatoCarrierId(token)
  if (!carrierId) {
    return NextResponse.json(
      { error: "Yamato carrier not registered in Ship&co dashboard" },
      { status: 502 },
    )
  }

  // 品名 (Yamato 送り状の品名欄、文字数制限 ~28 字):
  //   "スーツケース {苗字} 様" の形式 — 短くして切れないようにする.
  //   日付は記事欄 (ref_number) で表示する.
  const rawProductName = typeof body.productName === "string" ? body.productName.trim() : ""
  const productName = rawProductName || "スーツケース"
  const recipientName = (toInput.recipient ?? "").trim()
  const recipientLastName = lastNameOnly(recipientName)
  const productNameFull = recipientLastName
    ? `${productName} ${recipientLastName} 様`
    : productName

  // 記事欄 (ref_number): "BDX-260629-903-L1 7/11着" の形式で BondEx 番号 + 配達日を集約.
  const dateSuffix = deliveryDate ? formatYmdShortJp(deliveryDate) : ""
  const refNumberWithDate = dateSuffix ? `${refNumber} ${dateSuffix}` : refNumber

  const payload = {
    from_address: fromAddr,
    to_address: toAddr,
    setup: {
      carrier_id: carrierId,
      service: "yamato_regular",
      ref_number: refNumberWithDate,  // BDX-XXX-LN + " 7/11着"
      shipment_date: shipmentDate,
      // 配達希望日 (チェックイン日) — 指定すると Yamato は当日まで荷物を保持して配達.
      // 旅行者がチェックイン前に届いて受取拒否されるのを防ぐ.
      // 公式ドキュメント上の正式フィールドは "date" (JP 国内のみ)。従来送っていた
      // "delivery_date" はドキュメントに存在しない (無視されていた可能性が高い) ため
      // 両方送り、実荷物での検証後に delivery_date を削除する。
      ...(deliveryDate ? { date: deliveryDate, delivery_date: deliveryDate } : {}),
      // 配達時間帯 — 標準で午前中 (before-noon)。
      time: deliveryTime,
      pack_amount: suitcaseCount,
      test: true, // POC 固定
    },
    // 品名は1行に集約 (スーツケース / 代表者名 / チェックイン日). 個数は quantity で持たせる.
    products: [
      {
        name: productNameFull,
        quantity: suitcaseCount,
        price: 5000,
        weight: 10, // kg/個
      },
    ],
  }

  // POC デバッグ用: payload を console に出す (Vercel の Functions ログで確認可)
  console.log("[shipandco] payload:", JSON.stringify(payload, null, 2))

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
    // 共通のメタ情報 (DB 保存用)
    const baseRecord = {
      booking_id: bookingId || refNumber,
      leg_index: legIndex,
      agency,
      representative,
      traveler_count: travelerCount,
      booking_name: bookingName || null,
      tour_number: tourNumber || null,
      group_name: groupName || null,
      shipment_date: shipmentDate,
      expected_arrival: deliveryDate || null,
      from_hotel: fromHotel,
      from_city: fromAddr?.city || (fromInput.city ?? "") || null,
      from_place_id: fromPlaceId ?? null,
      from_check_in: fromCheckIn || null,
      to_hotel: toHotel,
      to_city: toAddr?.city || (toInput.city ?? "") || null,
      to_place_id: toPlaceId ?? null,
      to_check_out: toCheckOut || null,
      recipient: (toInput.recipient ?? "").trim(),
      suitcase_count: suitcaseCount,
      amount_yen: suitcaseCount * 5000,
      ship_ref_number: refNumber,
      notes: specialNote || null,
    }

    if (!res.ok) {
      const detail = data ?? text
      const detailStr = typeof detail === "string" ? detail : JSON.stringify(detail)
      const code = /ES003001|30日以内/.test(detailStr) ? "SHIPANDCO_DATE_WINDOW" : undefined
      // 失敗も DB に記録 — ダッシュボードで再試行できるように
      await saveShipment({ ...baseRecord, status: "failed", error_message: detailStr.slice(0, 500) })
      return NextResponse.json(
        {
          error: `Ship&co error (${res.status})`,
          code,
          detail,
          sentPayload: payload,
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
    // 成功 — Yamato 送り状情報も保存
    await saveShipment({
      ...baseRecord,
      status: "issued",
      yamato_tracking: d.delivery?.tracking_numbers ?? null,
      yamato_label_url: d.delivery?.label ?? null,
    })
    return NextResponse.json({
      status: "issued",
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
