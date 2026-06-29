import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import {
  deliveryDateErrorCode,
  getDeliverableRange,
} from "@/lib/yamato-delivery"

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
  // "日本、" prefix / "Japan," prefix を除去
  let s = (addr || "").replace(/^(?:日本[、,]?|Japan,)\s*/, "").trim()

  // 〒XXX-XXXX を抽出
  const zipM = /^〒\s*(\d{3}-?\d{4})\s*/.exec(s)
  const zip = zipM ? zipM[1].replace(/-/g, "") : ""
  if (zipM) s = s.slice(zipM[0].length).trim()

  // 都道府県を抽出 (北海道 / 〇〇県 / 〇〇府 / 〇〇都)
  const prefM = /^(.+?[県府都]|北海道)/u.exec(s)
  const prefecture = prefM ? prefM[1] : ""
  if (prefM) s = s.slice(prefecture.length).trim()

  // 市区郡町村を抽出 — 優先順位順に試す:
  //   ①政令市+区 (千葉市美浜区)
  //   ②郡+町/村  (足柄下郡箱根町)
  //   ③単独市    (雲仙市)
  //   ④単独区    (港区)
  //   ⑤町/村単独 (rare)
  let cityWard = ""
  let m: RegExpExecArray | null

  // ① 政令市 + 区
  m = /^([^市区郡町村]+市)([^市区郡町村]+区)/u.exec(s)
  if (m) {
    cityWard = m[1] + m[2]
    s = s.slice(m[0].length).trim()
  }
  // ② 郡 + 町/村
  if (!cityWard) {
    m = /^([^市区郡町村]+郡)([^市区郡町村]+[町村])/u.exec(s)
    if (m) {
      cityWard = m[1] + m[2]
      s = s.slice(m[0].length).trim()
    }
  }
  // ③ 単独市
  if (!cityWard) {
    m = /^([^市区郡町村]+市)/u.exec(s)
    if (m) {
      cityWard = m[1]
      s = s.slice(m[0].length).trim()
    }
  }
  // ④ 単独区
  if (!cityWard) {
    m = /^([^市区郡町村]+区)/u.exec(s)
    if (m) {
      cityWard = m[1]
      s = s.slice(m[0].length).trim()
    }
  }
  // ⑤ 単独町/村
  if (!cityWard) {
    m = /^([^市区郡町村]+[町村])/u.exec(s)
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
  deliveryDate?: unknown  // 配達希望日 = チェックイン日 (Yamato setup.delivery_date)
  suitcaseCount?: unknown
  from?: unknown
  to?: unknown
  productName?: unknown  // 例: "スーツケース" / "段ボール" / "ゴルフバッグ"
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

  // Yamato 送り状の構造マッピング (Ship&co の field 対応が判明したため確定):
  //   province → 都道府県                  (例: 長崎県)
  //   city     → 市区郡町村                (例: 雲仙市)
  //   address1 → consignee_address3 = 町・番地 (例: 小浜町雲仙320)  ← 市区郡町村を入れると ES001014 "長すぎ"
  //   address2 → consignee_address2 = 市区郡町村 (例: 雲仙市)        ← 空だと EF011022 "市区郡町村なし"
  //   company  → 建物名/会社 (ホテル名)
  //
  // エラー履歴:
  //   - EF011022 (consignee_address2 で市区郡町村なし) → address2 に cityWard を入れて解決
  //   - ES001014 (consignee_address3 = address1 が長すぎ) → address1 から cityWard を抜いて streetOnly のみに
  return {
    full_name: fullName,
    company: isSender ? SENDER_COMPANY : (result?.name ?? hotelName),
    phone,
    country: "JP",
    zip: zip || FALLBACK_ZIP,
    province: prefecture,
    city: cityWard,
    // address1 (= 町・番地) は 市区郡町村 を含めない. streetOnly が空ならホテル名で fallback (1文字以上必須のため).
    address1: streetOnly || result?.name?.slice(0, 20) || hotelName.slice(0, 20) || "1番地",
    // address2 (= 市区郡町村) — Yamato parser が必ずここから 市区郡町村 を抽出する.
    address2: cityWard,
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
  const rawDeliveryDate = typeof body.deliveryDate === "string" ? body.deliveryDate.trim() : ""
  // 配達希望日 = チェックイン日。形式不正なら未指定扱い (Yamato 標準配送日になる)
  const deliveryDate = rawDeliveryDate && isValidYmd(rawDeliveryDate) ? rawDeliveryDate : ""
  const suitcaseCount = Math.max(1, Math.floor(Number(body.suitcaseCount) || 1))

  const fromInput = (body.from ?? {}) as { hotel?: string; recipient?: string; placeId?: string }
  const toInput = (body.to ?? {}) as { hotel?: string; recipient?: string; placeId?: string }
  const fromHotel = (fromInput.hotel ?? "").trim()
  const toHotel = (toInput.hotel ?? "").trim()
  const fromPlaceId = (fromInput.placeId ?? "").trim() || undefined
  const toPlaceId = (toInput.placeId ?? "").trim() || undefined

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
    // issuableFrom 以降に (将来の自動バッチが) 発行する。
    return NextResponse.json({
      status: "deferred",
      shipmentDate,
      issuableFrom: issuableFromYmd(shipmentDate),
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

  // 解決結果を Vercel ログに残す (EF011022 など再発時の根本特定用)
  console.log("[shipandco] resolved addresses", {
    from: fromAddr ? { city: fromAddr.city, address1: fromAddr.address1, address2: fromAddr.address2 } : null,
    to: toAddr ? { city: toAddr.city, address1: toAddr.address1, address2: toAddr.address2 } : null,
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
      ...(deliveryDate ? { delivery_date: deliveryDate } : {}),
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
    if (!res.ok) {
      // Ship&co の error detail を呼び出し元に返す
      const detail = data ?? text
      // ES003001 (30日制約) を検出したら code に正規化。
      // 事前ガードで通常は届かないが、JST/サーバー時刻のズレ等の保険。
      const detailStr = typeof detail === "string" ? detail : JSON.stringify(detail)
      const code = /ES003001|30日以内/.test(detailStr) ? "SHIPANDCO_DATE_WINDOW" : undefined
      return NextResponse.json(
        {
          error: `Ship&co error (${res.status})`,
          code,
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
