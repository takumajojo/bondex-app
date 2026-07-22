/**
 * 配送キャリア設定 (佐川 / ヤマト)。
 *
 * BondEx はスーツケース配送で佐川を主軸にする (安価)。既定=佐川、必要時ヤマトに切替。
 * Ship&co の carrier type / service、配達時間帯コード、発行可能リードタイムを一元管理する。
 *
 * リードタイム (maxLeadDays) = 出荷予定日を「送り状発行日から何日先まで」指定できるか:
 *   - ヤマト: 30日 (Ship&co ES003001「出荷予定日は送り状発行日から30日以内」)
 *   - 佐川  : 50日 (佐川 e飛伝III「出荷予定日 当日〜50日先」)。
 *             ※ Ship&co API が同値を通すかは本番発行 (test:false) で要確認。暫定値。
 */

export type Carrier = "sagawa" | "yamato"

export const DEFAULT_CARRIER: Carrier = "sagawa"

export interface CarrierConfig {
  id: Carrier
  labelJa: string
  labelEn: string
  /** バウチャー等の書類に印字する正式名 (英+和)。 */
  voucherLabel: string
  /** Ship&co /carriers の type (アカウント照合用) */
  shipandcoType: string
  /** Ship&co create 時の service 名 */
  shipandcoService: string
  /** 出荷予定日を発行日から何日先まで指定できるか */
  maxLeadDays: number
  /** Ship&co の配達時間帯コード (キャリアで体系が異なる) */
  timeSlots: readonly string[]
  /** 配達希望日の指定可能範囲 (発送日からのオフセット日数)。
   *  佐川/ヤマトとも常温便は「発送翌日〜7日」。実際の到達可否 (長距離の翌日不可等) は
   *  Ship&co が発行時に検証するため、ここは粗いレンジガード。 */
  deliveryRule: { minOffsetDays: number; maxOffsetDays: number }
}

export const CARRIERS: Record<Carrier, CarrierConfig> = {
  sagawa: {
    id: "sagawa",
    labelJa: "佐川急便",
    labelEn: "Sagawa",
    voucherLabel: "Sagawa Express 佐川急便",
    shipandcoType: "sagawa",
    shipandcoService: "sagawa_regular",
    maxLeadDays: 50,
    timeSlots: ["not-specified", "before-noon", "12-14", "14-16", "16-18", "18-20", "18-21", "19-21"],
    deliveryRule: { minOffsetDays: 1, maxOffsetDays: 7 },
  },
  yamato: {
    id: "yamato",
    labelJa: "ヤマト運輸",
    labelEn: "Yamato",
    voucherLabel: "Yamato Transport ヤマト運輸",
    // Ship&co /carriers 上は "yamato" または "yamato_takkyubin"
    shipandcoType: "yamato",
    shipandcoService: "yamato_regular",
    maxLeadDays: 30,
    timeSlots: ["not-specified", "before-noon", "before-ten", "before-five", "14-16", "16-18", "18-20", "19-21"],
    deliveryRule: { minOffsetDays: 1, maxOffsetDays: 7 },
  },
}

/** 文字列 → CarrierConfig。未知/未指定は既定 (佐川)。 */
export function carrierConfig(c: string | null | undefined): CarrierConfig {
  return c === "yamato" ? CARRIERS.yamato : CARRIERS.sagawa
}

export function normalizeCarrier(c: unknown): Carrier {
  return c === "yamato" ? "yamato" : "sagawa"
}

export function isCarrier(c: unknown): c is Carrier {
  return c === "sagawa" || c === "yamato"
}

/** 両キャリアの配達時間帯の和集合 (代理店の希望値バリデーション用)。 */
export const ALL_TIME_SLOTS: readonly string[] = Array.from(
  new Set<string>([...CARRIERS.sagawa.timeSlots, ...CARRIERS.yamato.timeSlots]),
)

/** 配達時間帯コードの表示ラベル (両キャリア分を一元管理)。 */
export const TIME_SLOT_LABELS: Record<string, { ja: string; en: string }> = {
  "not-specified": { ja: "指定なし（日付確実）", en: "Not specified (guarantees the date)" },
  "before-noon": { ja: "午前中（推奨）", en: "Before noon (recommended)" },
  "before-ten": { ja: "10時まで", en: "Before 10:00" },
  "before-five": { ja: "17時まで", en: "Before 17:00" },
  "12-14": { ja: "12時〜14時", en: "12:00–14:00" },
  "14-16": { ja: "14時〜16時", en: "14:00–16:00" },
  "16-18": { ja: "16時〜18時", en: "16:00–18:00" },
  "18-20": { ja: "18時〜20時", en: "18:00–20:00" },
  "18-21": { ja: "18時〜21時", en: "18:00–21:00" },
  "19-21": { ja: "19時〜21時", en: "19:00–21:00" },
}

export function slotLabel(slot: string, locale: "ja" | "en"): string {
  return TIME_SLOT_LABELS[slot]?.[locale] ?? slot
}
