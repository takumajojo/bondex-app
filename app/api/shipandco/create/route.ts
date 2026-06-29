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

// Yamato (Ship&co) 構造:
//   province : 都道府県 (京都府)
//   address1 : 市区郡町村 (京都市)
//   address2 : 完全な住所パス (京都市中京区下丸屋町412) ← 市区郡町村 + 番地以下
//   full_name / company : 建物・ホテル名 (ヒルトン京都)
// 旧 backend (動作実績あり) と同じマッピング.
interface YamatoAddress {
  full_name: string
  company: string
  email?: string
  phone: string
  country: string
  zip: string
  province: string
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
    full_name: hotelName,
    company: hotelName,
    phone: FALLBACK_PHONE,
    country: "JP",
    zip: FALLBACK_ZIP,
    province: "",
    address1: "1番地",
    address2: "1番地",
    extra: "",
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

  // 旧 backend と同じマッピング:
  //   address1 = 市区郡町村 (例: "京都市") — 短い、城市のみ
  //   address2 = 完全な住所パス (例: "京都市中京区下丸屋町412") — 市区郡町村 + 番地以下を含む
  //   full_name / company = ホテル名
  const cityForYamato = locality || sub1 || prefecture || ""

  // 完全な住所パス: locality + sub1〜4 + premise + street_number を順に結合 (重複は除外)
  const pathParts = [locality, sub1, sub2, sub3, sub4, premise, streetNumber].filter(Boolean)
  const uniqueParts: string[] = []
  for (const p of pathParts) {
    if (uniqueParts[uniqueParts.length - 1] !== p) uniqueParts.push(p)
  }
  const fullPath = uniqueParts.join("")

  // 国際電話形式 (+81-XX-XXXX-XXXX) を E.164 に正規化
  let phone = result?.international_phone_number ?? ""
  phone = phone.replace(/[^\d+]/g, "")
  if (!phone) phone = FALLBACK_PHONE

  // Yamato は full_name に日本語名 (建物・代表者) を期待。
  // 旅行者ローマ字名だと弾かれることがあるのでホテル名にフォールバック.
  const fullName = result?.name ?? hotelName

  return {
    full_name: fullName,
    company: result?.name ?? hotelName,
    phone,
    country: "JP",
    zip: zip || FALLBACK_ZIP,
    province: prefecture,
    address1: cityForYamato || fullPath || "1番地",
    address2: fullPath || cityForYamato || "1番地",
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
      test: true, // POC 固定
    },
    // Yamato は products の weight を見るので、各 suitcase に重量を持たせる
    products: Array.from({ length: suitcaseCount }).map((_, i) => ({
      name: `Luggage ${i + 1}`,
      quantity: 1,
      price: 5000,
      weight: 10, // kg/個 — 実運用では旅程表パース結果から取れる
    })),
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
