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
  /** 建物名・部屋番号（任意）。 */
  building: string
}

export const EMPTY_RESIDENCE: ResidenceAddress = {
  name: "",
  phone: "",
  zip: "",
  prefecture: "",
  city: "",
  street: "",
  building: "",
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
  }
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
