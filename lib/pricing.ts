// BondEx 料金の唯一の情報源 (2026-09-10 谷口さん指示)。
//
// LP の料金表示・比較表の価格・CTA 補足・特商法ページの販売価格は、すべてこの値から生成する。
// 「4,980 → 4,500」「50 → 100」「10% → 15%」等の変更は、ここ1箇所を直せば全体に反映される。
// ※ これは「新規リード向けの表示価格」。実際の請求は契約 (lib/contract-content.ts の
//   CONTRACT_PRICE_YEN) と各代理店の署名済み契約で決まるため、ここを変えても実課金は変わらない。
//   実課金を動かす場合は契約・課金側を別途更新すること。
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
