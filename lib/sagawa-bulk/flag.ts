/**
 * P1-B feature flag。既定 OFF。本番有効化は承認後に env SAGAWA_BULK_ALERT_ENABLED="true" を設定する。
 * OFF の間は、再集計・通知・Operator 画面のいずれも副作用を出さない (既存フローに一切触れない)。
 */
export function sagawaBulkAlertEnabled(): boolean {
  return process.env.SAGAWA_BULK_ALERT_ENABLED === "true"
}
