/**
 * 佐川急便の運賃表（株式会社JOJO / BondEx 特別割引・税抜・元払）＝ BondEx の配送原価。
 * 適用: 2026-10-21〜2027-10-20。お客様コード 16031040-000。原本: ~/Downloads/jojo様_運賃表.pdf。
 *
 * スーツケース1個 = サイズ140(20kg迄)のレートで計算する
 *  (2026-10-21 谷口さん明言: 実物が160でも佐川は基本140で集荷・請求してくれる)。
 * 届け先の都道府県 → 地帯(12区分) → 140レート × 個数 = その区間の佐川原価(税抜)。
 */

export const SAGAWA_RATE_EFFECTIVE_FROM = "2026-10-21"
/** スーツケース既定サイズ (140=20kg迄)。 */
export const SUITCASE_SIZE = 140

export type SagawaZone =
  | "minami_kyushu"
  | "kita_kyushu"
  | "shikoku"
  | "chugoku"
  | "kansai"
  | "hokuriku"
  | "tokai"
  | "shinetsu"
  | "kanto"
  | "minami_tohoku"
  | "kita_tohoku"
  | "hokkaido"

export const ZONE_LABEL_JA: Record<SagawaZone, string> = {
  minami_kyushu: "南九州",
  kita_kyushu: "北九州",
  shikoku: "四国",
  chugoku: "中国",
  kansai: "関西",
  hokuriku: "北陸",
  tokai: "東海",
  shinetsu: "信越",
  kanto: "関東",
  minami_tohoku: "南東北",
  kita_tohoku: "北東北",
  hokkaido: "北海道",
}

/** 税抜運賃(元払・円)。サイズ140(スーツケース既定)と160のみ保持。他サイズは原本PDF参照。 */
const RATE_140: Record<SagawaZone, number> = {
  minami_kyushu: 2220,
  kita_kyushu: 2220,
  shikoku: 2110,
  chugoku: 2000,
  kansai: 1890,
  hokuriku: 1790,
  tokai: 1790,
  shinetsu: 1790,
  kanto: 1790,
  minami_tohoku: 1790,
  kita_tohoku: 1890,
  hokkaido: 2220,
}
const RATE_160: Record<SagawaZone, number> = {
  minami_kyushu: 2681,
  kita_kyushu: 2681,
  shikoku: 2572,
  chugoku: 2454,
  kansai: 2336,
  hokuriku: 2218,
  tokai: 2218,
  shinetsu: 2218,
  kanto: 2218,
  minami_tohoku: 2218,
  kita_tohoku: 2336,
  hokkaido: 2681,
}

function rateFor(zone: SagawaZone, size: number): number {
  return size >= 160 ? RATE_160[zone] : RATE_140[zone]
}

/** 都道府県(正式名・例「東京都」「京都府」) → 地帯。沖縄県・不明は null (別途料金)。 */
const PREF_ZONE: Record<string, SagawaZone> = {
  熊本県: "minami_kyushu", 宮崎県: "minami_kyushu", 鹿児島県: "minami_kyushu",
  福岡県: "kita_kyushu", 佐賀県: "kita_kyushu", 長崎県: "kita_kyushu", 大分県: "kita_kyushu",
  徳島県: "shikoku", 香川県: "shikoku", 愛媛県: "shikoku", 高知県: "shikoku",
  鳥取県: "chugoku", 島根県: "chugoku", 岡山県: "chugoku", 広島県: "chugoku", 山口県: "chugoku",
  滋賀県: "kansai", 京都府: "kansai", 大阪府: "kansai", 兵庫県: "kansai", 奈良県: "kansai", 和歌山県: "kansai",
  富山県: "hokuriku", 石川県: "hokuriku", 福井県: "hokuriku",
  岐阜県: "tokai", 静岡県: "tokai", 愛知県: "tokai", 三重県: "tokai",
  新潟県: "shinetsu", 長野県: "shinetsu",
  茨城県: "kanto", 栃木県: "kanto", 群馬県: "kanto", 埼玉県: "kanto",
  千葉県: "kanto", 東京都: "kanto", 神奈川県: "kanto", 山梨県: "kanto",
  宮城県: "minami_tohoku", 山形県: "minami_tohoku", 福島県: "minami_tohoku",
  青森県: "kita_tohoku", 岩手県: "kita_tohoku", 秋田県: "kita_tohoku",
  北海道: "hokkaido",
  // 沖縄県 は別途料金 (表外) → null 扱い
}

export function prefectureZone(prefecture: string | null | undefined): SagawaZone | null {
  const p = (prefecture ?? "").trim()
  if (!p) return null
  return PREF_ZONE[p] ?? null
}

export interface SagawaCost {
  /** 佐川原価(税抜・円) = レート × 個数。 */
  yen: number
  zone: SagawaZone
  /** 都道府県から地帯を特定できず、関東レートで代用したか (沖縄・離島・未入力など)。 */
  fallback: boolean
}

/**
 * 区間の佐川原価(税抜・円)。1個=サイズ140 × 個数。
 * 地帯が特定できない場合は関東レートで代用し fallback=true を返す (集計で注記するため)。
 */
export function sagawaCostYen(
  prefecture: string | null | undefined,
  pieces: number,
  size: number = SUITCASE_SIZE,
): SagawaCost {
  const z = prefectureZone(prefecture)
  const zone: SagawaZone = z ?? "kanto"
  const yen = rateFor(zone, size) * Math.max(0, Math.floor(pieces || 0))
  return { yen, zone, fallback: z === null }
}
