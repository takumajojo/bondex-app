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
  /** 'fit' | 'group' (sql/021)。団体は Biz-Logi で送らない。 */
  booking_type?: string | null
  from_hotel: string
  from_hotel_ja: string | null
  from_place_id: string | null
  from_residence: unknown
  to_hotel: string
  to_hotel_ja: string | null
  to_place_id: string | null
  to_residence: unknown
  tracking_numbers: unknown
  /** 集荷元ホテルのチェックイン日 (任意)。 */
  origin_check_in?: string | null
  /** 配送先ホテルのチェックイン日 (列名は from_ だが中身は配送先・lib/shipments-db.ts)。 */
  from_check_in?: string | null
  /** 配送先ホテルのチェックアウト日 (任意)。 */
  to_check_out?: string | null
  /**
   * 集荷元ホテルのチェックアウト日 (任意・読み込み時に補う)。予約には集荷元のチェックアウト日の列が無い
   * (shipments.origin_check_out はどこからも書かれない) ため、同じ予約の1つ前の区間の配送先チェックアウト日を使う。
   */
  origin_check_out?: string | null
  /** 予約に登録された発送元・到着ホテルの都道府県 (代理店の入力時に保存)。Google の住所の都道府県と一致しなければ送らない。 */
  from_prefecture?: string | null
  to_prefecture?: string | null
  /** 'b2b' | 'b2c' (sql/061)。 */
  channel?: string | null
}

export const PICKUP_SHIPMENT_COLUMNS =
  "id, booking_id, leg_index, status, carrier, shipment_date, expected_arrival, delivery_time, representative, booking_name, tour_number, suitcase_count, booking_type, from_hotel, from_hotel_ja, from_place_id, from_residence, to_hotel, to_hotel_ja, to_place_id, to_residence, tracking_numbers, origin_check_in, from_check_in, to_check_out, from_prefecture, to_prefecture, origin_check_out, channel"

export interface LegInputEnv {
  kokyakuCode: string
  /** 荷物連絡先 (BondEx)。送り状の依頼主電話と記事に載せる。 */
  contactPhone: string
  placesKey?: string
  /** テスト用: Places 取得の差し替え。 */
  fetchPlace?: typeof fetchHotelPlaceDetailsJa
}

/** Google Places 1回の照会の時間制限。送信処理全体を API ルートの上限 (60秒) に収めるため (監査 P1-4)。 */
export const PLACES_TIMEOUT_MS = 8_000

/** 確認画面に出す、Google の住所 (整える前) と送る住所。ホテルの同一性を運営が目で確かめるため。 */
export interface PartySource {
  /** 予約に登録された名称 (英語・日本語) */
  registeredName: string
  registeredNameJa: string | null
  /** Google の場所の名称と住所 (整える前)。個人宅は null */
  placeName: string | null
  placeAddress: string | null
  placeId: string | null
}

export type LegInputResult =
  | { ok: true; input: PickupLegInput; sources: { origin: PartySource; destination: PartySource }; guestOverridden: boolean }
  | { ok: false; errors: string[] }

/**
 * 佐川の宛名欄 (25文字×2行) に収まらないとき、運営が確認画面で入力する佐川向けの名称 (監査 P1-7)。
 * 自動では切り詰めない (別のホテルと誤認されるのを避けるため)。入力した値はその依頼にだけ使い、記録に残す。
 */
export interface NameOverrides {
  originName?: string | null
  destinationName?: string | null
  guestName?: string | null
}

export function cleanOverrides(raw: unknown): NameOverrides {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const pick = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : null)
  return { originName: pick(o.originName), destinationName: pick(o.destinationName), guestName: pick(o.guestName) }
}

export function overridesNote(o: NameOverrides): string | null {
  const parts = [
    o.originName ? `発送元「${o.originName}」` : "",
    o.destinationName ? `到着先「${o.destinationName}」` : "",
    o.guestName ? `旅行者「${o.guestName}」` : "",
  ].filter(Boolean)
  return parts.length ? `佐川の宛名を運営が指定: ${parts.join("・")}` : null
}

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
  registeredPrefecture: string | null | undefined,
): Promise<{ ok: true; party: PickupHotel; phone: string; source: PartySource } | { ok: false; error: string }> {
  // ホテルは場所の ID だけで特定する。名前での検索 (候補の1件目を採用) は推測になるので、Biz-Logi では使わない (2026-11-04 監査 H1)
  if (!placeId) {
    return { ok: false, error: `${label}: 「${nameJa || name}」はホテルの場所 (Google の場所 ID) が予約に登録されていません。名前からの推測はしません。予約のホテルを候補から選び直してから確認してください` }
  }
  if (!env.placesKey) return { ok: false, error: `${label}: GOOGLE_MAPS_API_KEY が未設定のため住所を解決できません` }
  const fetchPlace = env.fetchPlace ?? fetchHotelPlaceDetailsJa
  let d: Awaited<ReturnType<typeof fetchHotelPlaceDetailsJa>>
  try {
    d = await fetchPlace(name, env.placesKey, placeId, { timeoutMs: PLACES_TIMEOUT_MS })
  } catch (e) {
    return { ok: false, error: `${label}: 住所の照会が完了しませんでした (${e instanceof Error ? e.name : "error"})。時間をおいて再度確認してください` }
  }
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
  // 予約の都道府県と、Google の住所の都道府県が一致すること (場所 ID の選び違いで別の県へ依頼しない・2026-11-06)。
  // 予約に都道府県が無ければ照合できないので送らない。推測では直さない
  const regPref = (registeredPrefecture ?? "").normalize("NFKC").trim()
  if (!regPref) {
    return { ok: false, error: `${label}: 予約に「${nameJa || name}」の都道府県が登録されていません。Google の住所 (${prefecture}) と照合できないため送りません。予約のホテルを候補から選び直してください` }
  }
  if (regPref !== prefecture.normalize("NFKC").trim()) {
    return { ok: false, error: `${label}: 予約の都道府県 (${regPref}) と、Google の場所の住所の都道府県 (${prefecture}・${d.formattedAddress}) が違います。別のホテルを選んでいる可能性があるため送りません。予約のホテルを確かめてください` }
  }
  const hotelNameJa = (d.name || nameJa || name).trim()
  // 番地の後ろに付くホテル名・建物名は住所から外す (宛名側に「ホテル名 気付」で載せるため)
  let streetOnly = street
  if (d.name && streetOnly.includes(d.name)) streetOnly = streetOnly.split(d.name)[0].trim()
  // 空白の後ろ (番地の続き・建物名・階) は捨てない。以前は最初の空白より後ろを黙って捨てていた (2026-11-06 監査)。
  // 佐川の住所欄 (25文字×3行) に収まらなければ、電文を組む段階 (buildPickupDetail) で止まる (切り詰めない)
  streetOnly = streetOnly.replace(/[\s　]+/g, " ").trim()
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
    source: { registeredName: name, registeredNameJa: nameJa, placeName: d.name || null, placeAddress: d.formattedAddress, placeId },
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

export async function buildLegInput(row: PickupShipmentRow, env: LegInputEnv, overrides: NameOverrides = {}): Promise<LegInputResult> {
  const errors: string[] = []
  if ((row.carrier ?? "sagawa") !== "sagawa") errors.push(`配送会社が佐川ではありません (${row.carrier})`)
  const guest = (overrides.guestName || row.representative || row.booking_name || "").trim()
  if (!guest) errors.push("宛名に使う旅行者名 (代表者名) がありません")
  const count = row.suitcase_count ?? 0
  if (count < 1) errors.push("個数が1未満です")

  const fromRes = cleanResidence(row.from_residence)
  const toRes = cleanResidence(row.to_residence)
  const residenceSource = (name: string): PartySource => ({ registeredName: name, registeredNameJa: null, placeName: null, placeAddress: null, placeId: null })
  const [from, to] = await Promise.all([
    fromRes
      ? Promise.resolve({ ok: true as const, party: residenceParty(fromRes, env.contactPhone), phone: env.contactPhone, source: residenceSource(row.from_hotel) })
      : hotelParty(row.from_hotel, row.from_hotel_ja, row.from_place_id, env, "発送元", row.from_prefecture),
    toRes
      ? Promise.resolve({ ok: true as const, party: residenceParty(toRes, env.contactPhone), phone: env.contactPhone, source: residenceSource(row.to_hotel) })
      : hotelParty(row.to_hotel, row.to_hotel_ja, row.to_place_id, env, "到着先", row.to_prefecture),
  ])
  if (!from.ok) errors.push(from.error)
  if (!to.ok) errors.push(to.error)
  if (to.ok && !to.party.tel) errors.push("到着ホテルの電話番号を取得できませんでした")
  if (row.delivery_time && !BONDEX_SLOT_TO_SHITEI_TIME[row.delivery_time]) {
    errors.push(`配達時間帯 ${row.delivery_time} を佐川のコードへ変換できません`)
  }
  // 配達予定日は予約の値をそのまま送る。集荷日以前など矛盾があれば、黙って外さずに止める (send-safety の scheduleCheck)
  if (!row.expected_arrival) errors.push("予約に配達予定日がありません")
  if (errors.length || !from.ok || !to.ok) return { ok: false, errors }

  return {
    ok: true,
    input: {
      legRef: legRef(row),
      kokyakuCode: env.kokyakuCode,
      // 依頼主 (= 実集荷先) の電話は BondEx の荷物連絡先 (承認済み Excel の荷送人電話番号と同じ扱い)
      origin: { ...from.party, tel: env.contactPhone, ...(overrides.originName ? { name: overrides.originName } : {}) },
      destination: { ...to.party, ...(overrides.destinationName ? { name: overrides.destinationName } : {}) },
      guestName: guest,
      suitcaseCount: count,
      pickupDate: row.shipment_date,
      // 集荷時間帯は指定しない (Biz-Logi のコードに Excel の 11-12時 に当たる枠が無いため)
      pickupTimeCode: "00",
      // 予約の配達予定日をそのまま送る (以前は集荷日以前なら黙って外していた。矛盾は scheduleCheck が止める・2026-11-04 監査 D1/D2)
      deliveryDate: row.expected_arrival ?? undefined,
      deliverySlot: row.delivery_time ?? undefined,
      notes: pickupNotes(row, env.contactPhone),
      weight: null,
    },
    sources: { origin: from.source, destination: to.source },
    guestOverridden: !!overrides.guestName,
  }
}
