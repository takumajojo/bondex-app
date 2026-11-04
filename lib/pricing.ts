// BondEx 料金の唯一の情報源 (2026-09-10 谷口さん指示)。
//
// LP の料金表示・比較表の価格・CTA 補足・特商法ページの販売価格は、すべてこの値から生成する。
// 「4,980 → 4,500」「50 → 100」「10% → 15%」等の変更は、ここ1箇所を直せば全体に反映される。
// ※ これは「新規リード向けの表示価格」。実際の請求は契約 (lib/contract-content.ts の
//   CONTRACT_PRICE_YEN) と各代理店の署名済み契約で決まるため、ここを変えても実課金は変わらない。
//   実課金を動かす場合は契約・課金側を別途更新すること。
import { taxOf } from "./tax"

export const PRICING = {
  /** 通常料金 (1個あたり・税別) */
  regularPrice: 4980,
  /** 初回トライアル (1個あたり・税別) */
  trialPrice: 3980,
  /** トライアル対象数 (1社につき最初の N 個) */
  trialLimit: 2,
  /** ボリューム割引の閾値 (月間 N 個以上) */
  volumeThreshold: 50,
  /** ボリューム割引率 (%) */
  volumeDiscount: 10,
} as const

/**
 * 代理店の単価 (税抜・円/個) を解決する。
 * 代理店に unit_price_yen が設定されていればそれを、無ければ全体既定 (4,980) を返す。
 * 請求額 (amount_yen) の算出・見積表示・バウチャー総額のすべてでこの関数を通す
 * (単価の散在を防ぎ、代理店別単価を1箇所で効かせるため・2026-10-21 谷口さん指示)。
 */
export function resolveUnitPriceYen(agencyUnitPriceYen: number | null | undefined): number {
  return typeof agencyUnitPriceYen === "number" && agencyUnitPriceYen > 0
    ? agencyUnitPriceYen
    : PRICING.regularPrice
}

export interface AmountBreakdown {
  pieces: number
  unit: number
  net: number
  tax: number
  gross: number
}

/**
 * 概算・確定金額の内訳 (税抜単価・税抜小計・消費税・税込) を、実課金と同じ基準で算出する単一ロジック。
 * 単価は resolveUnitPriceYen を通す ＝ 発行時 (shipandco/create) と同じ値になり、受付メールの概算と
 * 実請求がズレない (旧: 受付メールだけ CONTRACT_PRICE_YEN 固定でズレていた)。
 * 消費税は国内/海外とも +10% (taxOf・2026-10-05 税理士確認)。pieces<=0 は呼び出し側で除外すること。
 */
export function estimateTotals(
  pieces: number,
  agencyUnitPriceYen: number | null | undefined,
): AmountBreakdown {
  const unit = resolveUnitPriceYen(agencyUnitPriceYen)
  const net = pieces * unit
  const tax = taxOf(net)
  return { pieces, unit, net, tax, gross: net + tax }
}

export type BookingType = "fit" | "group"

/**
 * 団体通常配送のボリューム割引。**Phase 0 では未適用 (enabled=false)** ＝ 現行料金を1円も変えない。
 * Phase 2 で有効化予定の料金ルール (2026-11-04 Phase 0 ブリーフ) を、割引ロジックだけ先に実装・テストして
 * 据え置く (値・判定単位が確定するまで dormant)。有効化は enabled を true にし、各課金経路の
 * 「pieces × resolveUnitPriceYen」を lineSubtotalYen へ差し替える 1 ステップで行う。
 */
export const GROUP_DISCOUNT = {
  /**
   * この個数以上で割引対象 (団体通常配送のみ)。
   * 判定単位は **配送区間 (leg) ごとの個数** (= shipments 1行の suitcase_count)。予約全体の合計では判定しない
   * (2026-11-04 谷口さん決定)。往復 (例: 往路13個 + 復路13個) を 26個として合算して割引対象にはしない
   * — 各 leg は 13個 < 25個 で対象外。
   */
  minPieces: 25,
  /** 割引率 (%)。 */
  percent: 8,
  /** Phase 0 は false = 全経路で未適用。Phase 2 で true にして有効化する。 */
  enabled: false,
} as const

/**
 * 団体ボリューム割引の適用可否 (将来ルール・単体でtestable)。pieces は **当該配送区間 (leg) の個数**
 * (予約合計ではない・往復は区間ごとに評価し合算しない)。
 *  - discountable === false (チャーター等) は常に対象外。
 *  - 団体通常配送 (bookingType==="group") 以外 (FIT) は対象外。
 *  - 代理店別契約単価がある場合は割引と併用しない (契約単価を優先)。
 *  - 上記を満たし pieces >= GROUP_DISCOUNT.minPieces のとき対象。
 * ※ GROUP_DISCOUNT.enabled とは独立 (ルールの純粋判定)。実際に効かせるかは lineSubtotalYen が enabled で門番する。
 */
export function isGroupVolumeDiscountApplicable(opts: {
  bookingType: BookingType
  pieces: number
  agencyUnitPriceYen: number | null | undefined
  discountable?: boolean
}): boolean {
  if (opts.discountable === false) return false
  if (opts.bookingType !== "group") return false
  const hasContractUnit = typeof opts.agencyUnitPriceYen === "number" && opts.agencyUnitPriceYen > 0
  if (hasContractUnit) return false
  return opts.pieces >= GROUP_DISCOUNT.minPieces
}

/**
 * 1区間の税抜請求小計 (amount_yen 相当) を返す「将来の」単一入口。
 * Phase 0 (GROUP_DISCOUNT.enabled=false): 現行どおり pieces × resolveUnitPriceYen をそのまま返す
 *   (割引は一切かからない)。既存経路はまだこの関数に差し替えていない (behavior 不変のため)。
 * Phase 2 (enabled=true): 団体かつ割引対象なら規定小計から GROUP_DISCOUNT.percent% を控除 (端数切り捨て)。
 */
export function lineSubtotalYen(opts: {
  bookingType: BookingType
  pieces: number
  agencyUnitPriceYen: number | null | undefined
  discountable?: boolean
}): number {
  const base = opts.pieces * resolveUnitPriceYen(opts.agencyUnitPriceYen)
  if (GROUP_DISCOUNT.enabled && isGroupVolumeDiscountApplicable(opts)) {
    return Math.floor((base * (100 - GROUP_DISCOUNT.percent)) / 100)
  }
  return base
}

/** 円表示 (例: 4980 → "¥4,980")。全表示の唯一の整形元。 */
export function formatYen(n: number): string {
  return "¥" + n.toLocaleString("ja-JP")
}

/**
 * 文中の "{limit}" 等のプレースホルダを PRICING 由来の値で置換する。
 * 数字を i18n 辞書へベタ書きせず、テンプレート文＋この関数で組み立てるための小道具。
 * 例: fill("最初の{limit}個まで", { limit: PRICING.trialLimit }) → "最初の2個まで"
 */
export function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`))
}
