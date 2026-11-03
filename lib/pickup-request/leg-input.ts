// 区間 (shipments の1行) を Biz-Logi の集荷依頼 (lib/bizlogi/pickup.ts の PickupLegInput) に変換する。
//
// 中身は現行の手動依頼 (佐川承認済み Excel・output/sagawa-pickup/build_sheet.py) にそろえる:
//   荷送人 = 発送元ホテル (実集荷先)・「ホテル名 気付 / ゲスト名様」・電話は BondEx の荷物連絡先
//   荷受人 = 到着ホテル・電話はホテル代表 (Google Places)
//   記事 = BondEx手荷物配送 / 品名 スーツケース / 荷物連絡先BondEx / 電話 / ツアー番号・時間帯
//   サイズ = 送らない (佐川側で自動付与。Excel にもサイズ欄は無い)
// 住所はホテルなら Google Places (日本語) から、個人宅なら入力された構造化住所から組む。
// 解決できないものは推測で埋めず、エラーとして運営に返す。

import { fetchHotelPlaceDetailsJa, parseJpAddressString, pickComponent } from "@/lib/hotel-place"
import { normalizeBanchi, stripKyotoRouteName } from "@/lib/jp-address"
import { cleanResidence, type ResidenceAddress } from "@/lib/residence"
import type { PickupHotel, PickupLegInput } from "@/lib/bizlogi/pickup"
import { BONDEX_SLOT_TO_SHITEI_TIME } from "@/lib/bizlogi/shipping"

export interface PickupShipmentRow {
  id: string
  booking_id: string
  leg_index: number
  status: string
  carrier: string | null
  shipment_date: string
  expected_arrival: string | null
  delivery_time: string | null
  representative: string | null
  booking_name: string | null
  tour_number: string | null
  suitcase_count: number | null
  from_hotel: string
  from_hotel_ja: string | null
  from_place_id: string | null
  from_residence: unknown
  to_hotel: string
  to_hotel_ja: string | null
  to_place_id: string | null
  to_residence: unknown
  tracking_numbers: unknown
}

export const PICKUP_SHIPMENT_COLUMNS =
  "id, booking_id, leg_index, status, carrier, shipment_date, expected_arrival, delivery_time, representative, booking_name, tour_number, suitcase_count, from_hotel, from_hotel_ja, from_place_id, from_residence, to_hotel, to_hotel_ja, to_place_id, to_residence, tracking_numbers"

export interface LegInputEnv {
  kokyakuCode: string
  /** 荷物連絡先 (BondEx)。送り状の依頼主電話と記事に載せる。 */
  contactPhone: string
  placesKey?: string
  /** テスト用: Places 取得の差し替え。 */
  fetchPlace?: typeof fetchHotelPlaceDetailsJa
}

export type LegInputResult = { ok: true; input: PickupLegInput } | { ok: false; errors: string[] }

/** 区間の参照番号 (例: BDX-8QRV2Y-L1)。管理番号はここから記号を除いて作る。 */
export function legRef(row: Pick<PickupShipmentRow, "booking_id" | "leg_index">): string {
  return `${row.booking_id}-L${row.leg_index + 1}`
}

/** 環境変数から変換に必要な値を読む。足りなければ不足しているキーを返す。 */
export function legInputEnvFromProcess(env: Record<string, string | undefined> = process.env): LegInputEnv | { missing: string[] } {
  const kokyakuCode = (env.BIZLOGI_KOKYAKU_CODE || "").trim()
  const contactPhone = (env.BONDEX_SENDER_PHONE || env.BONDEX_SUPPORT_PHONE || "").trim()
  const missing: string[] = []
  if (!kokyakuCode) missing.push("BIZLOGI_KOKYAKU_CODE")
  if (!contactPhone) missing.push("BONDEX_SENDER_PHONE (または BONDEX_SUPPORT_PHONE)")
  if (missing.length) return { missing }
  return { kokyakuCode, contactPhone, placesKey: env.GOOGLE_MAPS_API_KEY }
}

function residenceParty(r: ResidenceAddress, contactPhone: string): PickupHotel {
  return {
    name: (r.building || r.name).trim(),
    postalCode: r.zip,
    address: `${r.prefecture}${r.city}${normalizeBanchi(stripKyotoRouteName(r.street, r.prefecture))}`,
    // 個人宅の電話は送り状に出さない (Ship&co 経路と同じ方針)。BondEx の連絡先を載せる。
    tel: contactPhone,
  }
}

async function hotelParty(
  name: string,
  nameJa: string | null,
  placeId: string | null,
  env: LegInputEnv,
  label: string,
): Promise<{ ok: true; party: PickupHotel; phone: string } | { ok: false; error: string }> {
  if (!env.placesKey) return { ok: false, error: `${label}: GOOGLE_MAPS_API_KEY が未設定のため住所を解決できません` }
  const fetchPlace = env.fetchPlace ?? fetchHotelPlaceDetailsJa
  const d = await fetchPlace(name, env.placesKey, placeId ?? undefined)
  if (!d) return { ok: false, error: `${label}: 「${name}」の住所を Google Places で解決できませんでした` }
  const parsed = parseJpAddressString(d.formattedAddress)
  let { zip, prefecture, cityWard, street } = parsed
  if (!zip) zip = pickComponent(d.components, "postal_code").replace(/-/g, "")
  if (!prefecture) prefecture = pickComponent(d.components, "administrative_area_level_1")
  if (!cityWard) {
    const re = parseJpAddressString(d.components.map((c) => c.long_name).join(""))
    cityWard = re.cityWard
    if (!street) street = re.street
    if (!prefecture) prefecture = re.prefecture
  }
  if (!zip || !prefecture || !cityWard) {
    return { ok: false, error: `${label}: 「${name}」の郵便番号・都道府県・市区町村を特定できませんでした (${d.formattedAddress})` }
  }
  const hotelNameJa = (d.name || nameJa || name).trim()
  // 番地の後ろに付くホテル名・建物名は住所から外す (宛名側に「ホテル名 気付」で載せるため)
  let streetOnly = street
  if (d.name && streetOnly.includes(d.name)) streetOnly = streetOnly.split(d.name)[0].trim()
  if (streetOnly.includes(" ")) streetOnly = streetOnly.split(/\s+/)[0]
  const phone = (d.internationalPhone || "").replace(/^\+81[\s-]?/, "0").replace(/[^\d-]/g, "")
  return {
    ok: true,
    party: {
      name: hotelNameJa,
      postalCode: zip,
      address: `${prefecture}${cityWard}${normalizeBanchi(stripKyotoRouteName(streetOnly, prefecture))}`,
      tel: phone,
    },
    phone,
  }
}

/** 記事欄 (各17文字)。現行の承認済み Excel の記事欄1〜5と同じ内容。 */
export function pickupNotes(row: Pick<PickupShipmentRow, "tour_number" | "delivery_time">, contactPhone: string): string[] {
  const slot: Record<string, string> = {
    "before-noon": "午前中着",
    "12-14": "12-14時",
    "14-16": "14-16時",
    "16-18": "16-18時",
    "18-20": "18-20時",
    "18-21": "18-21時",
    "19-21": "19-21時",
  }
  const fifth = [row.tour_number ? `ツアー${row.tour_number}` : "", slot[row.delivery_time ?? ""] ?? ""]
    .filter(Boolean)
    .join(" ")
  const notes = ["BondEx手荷物配送", "品名 スーツケース", "荷物連絡先BondEx", contactPhone]
  if (fifth) notes.push(Array.from(fifth).slice(0, 17).join(""))
  return notes
}

export async function buildLegInput(row: PickupShipmentRow, env: LegInputEnv): Promise<LegInputResult> {
  const errors: string[] = []
  if ((row.carrier ?? "sagawa") !== "sagawa") errors.push(`配送会社が佐川ではありません (${row.carrier})`)
  const guest = (row.representative || row.booking_name || "").trim()
  if (!guest) errors.push("宛名に使う旅行者名 (代表者名) がありません")
  const count = row.suitcase_count ?? 0
  if (count < 1) errors.push("個数が1未満です")

  const fromRes = cleanResidence(row.from_residence)
  const toRes = cleanResidence(row.to_residence)
  const [from, to] = await Promise.all([
    fromRes
      ? Promise.resolve({ ok: true as const, party: residenceParty(fromRes, env.contactPhone), phone: env.contactPhone })
      : hotelParty(row.from_hotel, row.from_hotel_ja, row.from_place_id, env, "発送元"),
    toRes
      ? Promise.resolve({ ok: true as const, party: residenceParty(toRes, env.contactPhone), phone: env.contactPhone })
      : hotelParty(row.to_hotel, row.to_hotel_ja, row.to_place_id, env, "到着先"),
  ])
  if (!from.ok) errors.push(from.error)
  if (!to.ok) errors.push(to.error)
  if (to.ok && !to.party.tel) errors.push("到着ホテルの電話番号を取得できませんでした")
  if (row.delivery_time && !BONDEX_SLOT_TO_SHITEI_TIME[row.delivery_time]) {
    errors.push(`配達時間帯 ${row.delivery_time} を佐川のコードへ変換できません`)
  }
  if (errors.length || !from.ok || !to.ok) return { ok: false, errors }

  return {
    ok: true,
    input: {
      legRef: legRef(row),
      kokyakuCode: env.kokyakuCode,
      // 依頼主 (= 実集荷先) の電話は BondEx の荷物連絡先 (承認済み Excel の荷送人電話番号と同じ扱い)
      origin: { ...from.party, tel: env.contactPhone },
      destination: to.party,
      guestName: guest,
      suitcaseCount: count,
      pickupDate: row.shipment_date,
      // 集荷時間帯は指定しない (Biz-Logi のコードに Excel の 11-12時 に当たる枠が無いため)
      pickupTimeCode: "00",
      // expected_arrival は配達希望日が無いと発送日で埋められている (create/route.ts)。その場合は指定しない。
      deliveryDate: row.expected_arrival && row.expected_arrival > row.shipment_date ? row.expected_arrival : undefined,
      deliverySlot: row.delivery_time ?? undefined,
      notes: pickupNotes(row, env.contactPhone),
      weight: null,
    },
  }
}
