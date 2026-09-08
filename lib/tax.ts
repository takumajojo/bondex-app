/**
 * 消費税の計算を1か所に集約する。
 *
 * 前提 (2026-08-28 谷口さん確定):
 *   BondEx の料金 ¥5,000 / 個は **税抜** の単価である。
 *   DB の `shipments.amount_yen` は「個数 × 単価」= **税抜小計** を保持する
 *   (この意味は変えない。DB マイグレーション不要)。
 *   消費税は「請求書」「カード課金」「代理店への金額通知」の境界で加算する。
 *
 * 端数処理は請求書PDF (lib/invoice-pdf.tsx の外税パス) と揃えて切り捨て。
 * ここを唯一の情報源にすることで、請求書の金額とカード課金額のズレを防ぐ。
 */
export const TAX_RATE = 0.1

/** 税抜額から消費税額を求める (切り捨て)。 */
export function taxOf(netYen: number): number {
  return Math.floor(netYen * TAX_RATE)
}

/** 税抜額から税込額を求める。 */
export function grossOf(netYen: number): number {
  return netYen + taxOf(netYen)
}
