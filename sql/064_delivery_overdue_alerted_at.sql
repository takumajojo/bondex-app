-- 064: shipments.delivery_overdue_alerted_at を sql/ に再整合 (コードとスキーマの整合・Phase 0)
--
-- 背景: この列は本番 DB に既に存在する (適用済みマイグレーション 20260918042008
--   "043_delivery_overdue_alerted_at"・2026-09-18)。しかし sql/ には対応ファイルが無い
--   (sql/043 は 043_shipment_change_requests.sql に充てられ、番号が衝突していた)。
--   lib/shipments-db.ts (markDeliveryOverdueAlerted 付近) と app/api/cron/sync-tracking/route.ts が
--   「配送遅延アラートを一度だけ送る」判定でこの列を使用している
--   (delivery_overdue_alerted_at IS NULL を条件に読み、送信後に now() を書く)。
--   sql/ から DB を新規構築すると列が欠落し、上記コードが実行時に壊れる。再構築用に追補する。
--
-- 本番へは再適用不要 (既に存在)。IF NOT EXISTS により本番で実行しても no-op で安全。
-- ※ Phase 0 (2026-11-04) ではこのファイルを本番へ適用していない (調査・整合のみ・本番 DB 書き込み禁止)。

alter table public.shipments
  add column if not exists delivery_overdue_alerted_at timestamptz;

comment on column public.shipments.delivery_overdue_alerted_at is
  '配送遅延アラートを送信した時刻 (一度きり通知の二重送信防止)。NULL=未通知。';
