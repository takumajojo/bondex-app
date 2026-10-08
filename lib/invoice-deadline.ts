/**
 * 契約上「請求書の発行期限」が標準(翌月10日)より厳しい代理店の設定。
 *
 * 標準は第5条第1項の「翌月10日まで」。一部の代理店は月次締めの都合で前倒しを求める。
 *   - TRAPOL株式会社: 契約第5条第1項を「翌月第2営業日まで」に修正 (2026-10・BDX-CONTRACT-202610-010)。
 *
 * この期限を守れるよう /api/cron/invoice-deadline が毎朝監視し、ops へアラートを出す。
 * name は agencies.name と完全一致させること。将来、代理店マスタの項目に移してもよい。
 */
export interface InvoiceDeadlineRule {
  /** 請求書を発行・送付すべき期限 = 当月の第 nthBusinessDay 営業日 (土日祝を除く)。 */
  nthBusinessDay: number
  /** 根拠条項 (アラート文言用)。 */
  article: string
}

export const INVOICE_DEADLINE_RULES: Record<string, InvoiceDeadlineRule> = {
  "TRAPOL株式会社": { nthBusinessDay: 2, article: "契約第5条第1項" },
}
