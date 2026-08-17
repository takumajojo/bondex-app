/**
 * 荷物の品目。送り状(佐川/ヤマト)の品名欄に出る。既定はスーツケース。
 * 「その他」は代理店が自由記述したものをそのまま品名に使う。
 *
 * 品名は日本語で出す(佐川ラベルは日本語)。フォームの表示だけ locale で出し分ける。
 * 共用: フォーム(agency/new) / booking API / operator 再発行。
 */
export type ItemTypeKey = "suitcase" | "parcel" | "ski" | "golf" | "other"

export const ITEM_TYPES: { key: ItemTypeKey; ja: string; en: string; product: string }[] = [
  { key: "suitcase", ja: "スーツケース", en: "Suitcase", product: "スーツケース" },
  { key: "parcel", ja: "小包", en: "Parcel", product: "小包" },
  { key: "ski", ja: "スキー", en: "Ski", product: "スキー" },
  { key: "golf", ja: "ゴルフ", en: "Golf", product: "ゴルフ" },
  { key: "other", ja: "その他", en: "Other", product: "" },
]

export const ITEM_TYPE_KEYS = ITEM_TYPES.map((t) => t.key)

/**
 * 品名(送り状に出る日本語)を解決する。
 *  - preset(スーツケース/小包/スキー/ゴルフ) → 固定の日本語品名
 *  - その他 → 自由記述をそのまま(空なら「手荷物」)
 * 送り状の品名欄は文字数制限があるため 20 字で切る。
 */
export function itemProductName(key: string | null | undefined, other?: string | null): string {
  if (key === "other") {
    const o = (other ?? "").trim()
    return (o || "手荷物").slice(0, 20)
  }
  const t = ITEM_TYPES.find((x) => x.key === key)
  return (t?.product || "スーツケース").slice(0, 20)
}
