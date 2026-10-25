/**
 * 個人宅（ホテルではない配送元/配送先）の住所。
 *
 * ホテルは Google Places 検索で住所・電話を自動解決するが、個人宅は検索に出ないため
 * 代理店が構造化フィールドで直接入力する。佐川/ヤマトは「郵便番号↔住所」の一致を厳格に
 * チェックするので、都道府県・市区町村・番地を分けて受け取り、送り状用の住所を確実に組む。
 *
 * この型は frontend(発送依頼フォーム) / booking API / shipandco/create / operator 再発行で共用する。
 */
export type ResidenceAddress = {
  /** 氏名（受取人 or 発送人）。送り状の宛名。 */
  name: string
  /** 電話番号。集荷・再配達の連絡に使うため個人宅では必須。 */
  phone: string
  /** 郵便番号（7桁・ハイフンあり/なしどちらでも受け付け、内部で数字のみに正規化）。 */
  zip: string
  /** 都道府県（例: 東京都）。 */
  prefecture: string
  /** 市区町村（例: 渋谷区 / 京都市南区）。 */
  city: string
  /** 番地・町名（例: 神南1-2-3）。 */
  street: string
  /** 建物名・部屋番号／物件名（日本語）。民泊・バケーションレンタルの物件名として使う（例: 京都駅ゲストハウス道 #102）。任意。 */
  building: string
  /**
   * 物件名（英語）。民泊・バケーションレンタル向け。お客様が読むバウチャーで
   * building（日本語）より優先して施設名として表示する（例: Kyoto Station Guesthouse Michi #102）。任意。
   */
  propertyNameEn?: string
  /**
   * 住所（英語・1行）。民泊・バケーションレンタル向け。お客様（外国人ゲスト）が読む
   * 英語バウチャーでは日本語住所ではなくこの英語住所を表示する
   * （例: 53 Motohakone, Hakone-machi, Ashigarashimo-gun, Kanagawa 250-0522, Japan）。任意。
   * ※ 送り状（佐川）側は従来どおり構造化した日本語住所を使う（日本の配送業者向け）。
   */
  addressEn?: string
}

export const EMPTY_RESIDENCE: ResidenceAddress = {
  name: "",
  phone: "",
  zip: "",
  prefecture: "",
  city: "",
  street: "",
  building: "",
  propertyNameEn: "",
  addressEn: "",
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

/** 郵便番号を数字のみ（7桁想定）に正規化。 */
export function normalizeZip(zip: string): string {
  return zip.replace(/[^\d]/g, "")
}

/**
 * 任意の入力を ResidenceAddress に正規化（trim）。オブジェクトでなければ null。
 * 検証はしない（residenceError を別途使う）。
 */
export function cleanResidence(raw: unknown): ResidenceAddress | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  return {
    name: str(o.name),
    phone: str(o.phone),
    zip: str(o.zip),
    prefecture: str(o.prefecture),
    city: str(o.city),
    street: str(o.street),
    building: str(o.building),
    propertyNameEn: str(o.propertyNameEn),
    addressEn: str(o.addressEn),
  }
}

/**
 * 民泊・バケーションレンタルの物件名（施設名）。英語優先・無ければ日本語(building)。
 * どちらも無ければ空文字（＝住所のみ表示）。バウチャー/画面の施設名表示に使う。
 */
export function residencePropertyName(raw: unknown, locale: "ja" | "en" = "en"): string {
  const r = cleanResidence(raw)
  if (!r) return ""
  const en = (r.propertyNameEn || "").trim()
  const ja = (r.building || "").trim()
  return locale === "en" ? en || ja : ja || en
}

/** 必須フィールドのキー（呼び出し側で言語別ラベルに変換する）。 */
export type ResidenceField = "name" | "phone" | "zip" | "prefecture" | "city" | "street"

/** ResidenceField の日本語ラベル（サーバーのエラー文言・バリデーション用）。 */
export const RESIDENCE_FIELD_LABELS_JA: Record<ResidenceField, string> = {
  name: "氏名",
  phone: "電話番号",
  zip: "郵便番号（7桁）",
  prefecture: "都道府県",
  city: "市区町村",
  street: "番地・町名",
}

/** 英語ラベル（英語圏の代理店向けエラー文言用）。 */
export const RESIDENCE_FIELD_LABELS_EN: Record<ResidenceField, string> = {
  name: "name",
  phone: "phone number",
  zip: "postal code (7 digits)",
  prefecture: "prefecture",
  city: "city / ward",
  street: "street address",
}

/** locale で住所フィールドのラベルを返す。 */
export function residenceFieldLabel(field: ResidenceField, locale: "ja" | "en"): string {
  return (locale === "en" ? RESIDENCE_FIELD_LABELS_EN : RESIDENCE_FIELD_LABELS_JA)[field]
}

/**
 * 必須項目の検証。最初に不足しているフィールドのキーを返し、問題なければ null。
 * 建物名のみ任意。呼び出し側で RESIDENCE_FIELD_LABELS_JA 等でラベル化する。
 */
export function residenceError(r: ResidenceAddress): ResidenceField | null {
  if (!r.name.trim()) return "name"
  if (!r.phone.trim()) return "phone"
  if (!/^\d{7}$/.test(normalizeZip(r.zip))) return "zip"
  if (!r.prefecture.trim()) return "prefecture"
  if (!r.city.trim()) return "city"
  if (!r.street.trim()) return "street"
  return null
}

/** 個人宅かどうか（kind 値の正規化）。 */
export function isResidenceKind(v: unknown): boolean {
  return v === "residence"
}

/**
 * 個人宅住所を1行に整形（表示・メール・バウチャー用）。中身が無ければ空文字。
 * 体裁は lib/voucher-regen の residenceLine と統一。
 */
export function residenceOneLine(raw: unknown): string {
  const r = cleanResidence(raw)
  if (!r || (!r.street && !r.city)) return ""
  const zip = r.zip ? `〒${r.zip} ` : ""
  const bld = r.building ? ` ${r.building}` : ""
  return `${zip}${r.prefecture}${r.city}${r.street}${bld}`.trim()
}

/**
 * 住所のみを1行に整形（物件名／建物名は含めない）。中身が無ければ空文字。
 * バウチャーで「物件名（施設名）を見出し＋住所を補足」のように物件名と住所を
 * 分けて表示する用途に使う（residenceOneLine は物件名込みの1行表記）。
 */
export function residenceAddressLine(raw: unknown): string {
  const r = cleanResidence(raw)
  if (!r || (!r.street && !r.city)) return ""
  const zip = r.zip ? `〒${r.zip} ` : ""
  return `${zip}${r.prefecture}${r.city}${r.street}`.trim()
}

/**
 * 英語バウチャー用の住所1行。英語住所(addressEn)があればそれを、無ければ
 * 日本語住所(residenceAddressLine)にフォールバックする。
 * 外国人ゲスト向けバウチャーの住所表示に使う（送り状は別途・日本語構造化住所を使用）。
 */
export function residenceAddressLineEn(raw: unknown): string {
  const r = cleanResidence(raw)
  const en = (r?.addressEn || "").trim()
  return en || residenceAddressLine(raw)
}

/**
 * 区間の片側（発送元/お届け先）の表示名。
 * 個人宅（民泊など）なら住所を、そうでなければホテル名を返す。
 * ※ 発行時 DB の from_hotel/to_hotel には個人宅の「氏名」が入るため、
 *   表示では residence を優先し、氏名ではなく住所を見せる。
 */
export function endpointLabel(hotel: unknown, residenceRaw: unknown): string {
  const line = residenceOneLine(residenceRaw)
  if (line) return line
  return typeof hotel === "string" ? hotel.trim() : ""
}

/**
 * 代理店・顧客向け表示用の施設ラベル（英語ロケール対応）。
 * en=true（代理店ロケールが英語）かつ英語施設名(hotelEn)があれば英語名を優先し、
 * 無ければ日本語名にフォールバックする。請求書(lib/invoice-build) と同じ英語優先ポリシーを
 * 共通化し、集荷/配達通知メール等での英語名の「抜け」を防ぐための単一ヘルパー。
 * 個人宅（民泊）の場合は従来どおり住所を優先（endpointLabel に委譲）。
 */
export function endpointLabelLocalized(
  hotelJa: unknown,
  hotelEn: unknown,
  residenceRaw: unknown,
  en: boolean,
): string {
  const he = typeof hotelEn === "string" ? hotelEn.trim() : ""
  return endpointLabel(en && he ? he : hotelJa, residenceRaw)
}
