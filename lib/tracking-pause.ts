/**
 * 配送追跡（Ship&co 照会）の一時停止フラグ。
 *
 * 背景（2026-10）: 佐川急便が情報流出対応で荷物追跡（配送状況照会）を停止中のため、
 * Ship&co への追跡照会が HTTP 429/失敗を返し続け、
 *   (1) エラーログが蓄積し続ける
 *   (2) 集荷/配達が追跡から自動前進しないため「集荷漏れ」「配達遅延」アラートが誤発報する
 * という問題が起きる。
 *
 * これを避けるため、停止中は
 *   - 追跡同期 cron（app/api/cron/sync-tracking）
 *   - 未達アラート（集荷漏れ/配達遅延）
 *   - 番号入力時の即時照会（lib/tracking/reconcile）
 * をスキップする。
 *
 * 佐川の追跡は 2026-10-24 に復旧（谷口さんへのヒアリング）。既定を再開（false）に戻した。
 * 再度停止が必要になったら、環境変数 TRACKING_SYNC_PAUSED=true を設定する（env が優先）か、
 * このファイルの既定を true に戻す（コード変更＋再デプロイ）。
 *
 * ※ app/api/operator/track-test（手動の追跡テスト）は、停止対象から除外している（復旧確認用）。
 */
export const TRACKING_SYNC_PAUSED: boolean =
  process.env.TRACKING_SYNC_PAUSED != null
    ? process.env.TRACKING_SYNC_PAUSED.toLowerCase() === "true"
    : false
