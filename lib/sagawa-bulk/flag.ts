/**
 * P1-B feature flags (2段階・いずれも既定 OFF・本番有効化は承認後に env を設定)。
 *
 * ① SAGAWA_BULK_ALERT_ENABLED = 「検知」フラグ
 *    - 集荷単位の再集計 / 大口・重複の検知 / Operator 表示 / 佐川連絡履歴の管理
 *    - OFF の間は再集計・DB書込・Operator表示・メールのいずれも副作用を出さない (既存フローに一切触れない)。
 *
 * ② SAGAWA_BULK_EMAIL_ENABLED = 「メール送信」フラグ
 *    - 初回通知 / 条件変更通知 / 前日リマインド / 当日アラート の実送信
 *    - メール送信は ①②の両方が ON のときだけ許可する (既定 OFF)。
 *    - 検知だけを ON にしても、メールは一切送られない (安全な段階導入のため)。
 */
export function sagawaBulkAlertEnabled(): boolean {
  return process.env.SAGAWA_BULK_ALERT_ENABLED === "true"
}

/**
 * メール送信フラグ。検知フラグ (SAGAWA_BULK_ALERT_ENABLED) と
 * メールフラグ (SAGAWA_BULK_EMAIL_ENABLED) の両方が ON のときのみ true (既定 OFF)。
 * 検知だけ ON のときは false = メールを送らない。
 */
export function sagawaBulkEmailEnabled(): boolean {
  return sagawaBulkAlertEnabled() && process.env.SAGAWA_BULK_EMAIL_ENABLED === "true"
}
