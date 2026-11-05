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
 * 団体通常配送のボリューム割引 (Phase 1)。既定 OFF (feature flag)。
 * 判定単位は **配送区間 (leg) ごとの個数** (= shipments 1行の suitcase_count)。予約全体の合計では判定しない
 * (2026-11-04 谷口さん決定)。往復 (例: 往路13個 + 復路13個) を 26個として合算して割引対象にはしない
 * — 各 leg は 13個 < 25個 で対象外。
 */
export const GROUP_DISCOUNT = {
  /** この個数以上で割引対象 (団体通常配送のみ)。 */
  minPieces: 25,
  /** 割引率 (%)。 */
  percent: 8,
} as const

/**
 * 団体割引の feature flag。**既定 OFF**。本番有効化は承認後に env で明示する
 * (GROUP_DISCOUNT_ENABLED="true")。env 未設定/`"true"` 以外は無効 = 現行料金と1円も変わらない。
 */
export function groupDiscountEnabled(): boolean {
  return process.env.GROUP_DISCOUNT_ENABLED === "true"
}

/**
 * 割引レジームの境界時刻。**この時刻以降に作成された予約だけ**を割引対象にし、
 * 既存予約への遡及適用 (有効化後の個数変更で割引が付いてしまう事故) を防ぐ。
 * GROUP_DISCOUNT_ENABLED_AT (ISO 文字列)。未設定なら割引は一切効かない (安全側)。
 */
export function groupDiscountEnabledAt(): Date | null {
  const v = process.env.GROUP_DISCOUNT_ENABLED_AT
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

/**
 * 予約作成時刻 bookingCreatedAt に対し、団体割引レジームが有効か。
 * enabled かつ 境界時刻が設定済み かつ 予約作成が境界以降 のときだけ true。
 * bookingCreatedAt が不明 (null/未指定) のときは false = 割引しない (安全側・遡及防止)。
 */
export function groupDiscountRegimeActive(
  bookingCreatedAt: string | Date | null | undefined,
): boolean {
  if (!groupDiscountEnabled()) return false
  const at = groupDiscountEnabledAt()
  if (!at || !bookingCreatedAt) return false
  const created = bookingCreatedAt instanceof Date ? bookingCreatedAt : new Date(bookingCreatedAt)
  return !isNaN(created.getTime()) && created.getTime() >= at.getTime()
}

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
 * 1区間の税抜請求小計 (amount_yen 相当) を返す **単一入口**。全ての金額算出経路 (発行・個数是正・
 * 受付概算・内部オペシート) はこれを通す。割引が効くのは次の両方を満たすときだけ:
 *   (1) レジーム有効 = groupDiscountRegimeActive(bookingCreatedAt) (env 有効 + 予約作成が境界以降)
 *   (2) 適用可 = isGroupVolumeDiscountApplicable (団体25個以上・契約単価なし・非チャーター)
 * それ以外は pieces × resolveUnitPriceYen をそのまま返す ＝ **OFF 時は現行料金と1円も変わらない**。
 * 割引は税抜小計に適用して切り捨て (消費税は呼び出し側の taxOf で算出)。
 * bookingCreatedAt を渡さない/不明なら割引は効かない (既存予約への遡及防止・安全側)。
 */
export function lineSubtotalYen(opts: {
  bookingType: BookingType
  pieces: number
  agencyUnitPriceYen: number | null | undefined
  discountable?: boolean
  bookingCreatedAt?: string | Date | null
}): number {
  const base = opts.pieces * resolveUnitPriceYen(opts.agencyUnitPriceYen)
  if (groupDiscountRegimeActive(opts.bookingCreatedAt) && isGroupVolumeDiscountApplicable(opts)) {
    return Math.floor((base * (100 - GROUP_DISCOUNT.percent)) / 100)
  }
  return base
}

/** 予約全体の概算金額 (受付メール等)。割引は leg ごとに適用して合算する (往復を合算して判定しない)。 */
export interface BookingAmount extends AmountBreakdown {
  /** いずれかの leg で団体割引が適用されたか (表示の出し分け用)。 */
  discountApplied: boolean
}

/**
 * 予約全体 (複数 leg) の税抜/税込を、各 leg の lineSubtotalYen を合算して算出する。
 * 消費税は合算後の税抜小計に 1 回だけ taxOf を当てる (請求書 invoice-build と同じ基準)。
 * pieces 合計が 0 以下なら null。
 */
export function estimateBookingTotals(opts: {
  legs: Array<{ pieces: number }>
  bookingType: BookingType
  agencyUnitPriceYen: number | null | undefined
  bookingCreatedAt?: string | Date | null
  discountable?: boolean
}): BookingAmount | null {
  const pieces = opts.legs.reduce((s, l) => s + (l.pieces || 0), 0)
  if (pieces <= 0) return null
  const unit = resolveUnitPriceYen(opts.agencyUnitPriceYen)
  let net = 0
  let baseNet = 0
  for (const l of opts.legs) {
    const p = l.pieces || 0
    baseNet += p * unit
    net += lineSubtotalYen({
      bookingType: opts.bookingType,
      pieces: p,
      agencyUnitPriceYen: opts.agencyUnitPriceYen,
      discountable: opts.discountable,
      bookingCreatedAt: opts.bookingCreatedAt,
    })
  }
  const tax = taxOf(net)
  return { pieces, unit, net, tax, gross: net + tax, discountApplied: net < baseNet }
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
