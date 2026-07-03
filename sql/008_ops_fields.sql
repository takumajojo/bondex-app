-- 008: 運用フィールド追加 (2026-07-03 堀部FB第2弾のランオペ運用対応)
--   guest_language        : 発行時のバウチャー言語 (en / zh)。再発行時に同じ言語で出すため
--   pickup_alert_sent_at  : 集荷漏れアラートの送信済みマーク (二重通知防止)
-- Supabase SQL Editor で実行してください。

alter table shipments add column if not exists guest_language text;
alter table shipments add column if not exists pickup_alert_sent_at timestamptz;

comment on column shipments.guest_language is 'バウチャー言語 (en/zh)。null は en 扱い';
comment on column shipments.pickup_alert_sent_at is '集荷漏れアラート送信日時 (cron sync-tracking が設定)';
