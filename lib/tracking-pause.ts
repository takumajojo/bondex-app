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
 * 既定は停止（true）。佐川の追跡が復旧したら解除する:
 *   - このファイルの既定を false に戻す（コード変更＋再デプロイ）か、
 *   - 環境変数 TRACKING_SYNC_PAUSED=false を設定する（env が優先）。
 *
 * ※ 追跡が止まっている間も、集荷/配達の確定は運用画面の手入力・即時照会の手動運用で対応する。
 * ※ app/api/operator/track-test（手動の追跡テスト）は、復旧確認用に停止対象から除外している。
 */
export const TRACKING_SYNC_PAUSED: boolean =
  process.env.TRACKING_SYNC_PAUSED != null
    ? process.env.TRACKING_SYNC_PAUSED.toLowerCase() === "true"
    : true
