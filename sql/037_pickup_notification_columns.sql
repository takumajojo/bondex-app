-- ダッシュボードの「集荷されました」通知 (2026-09-16 谷口さん)。適用済み (Supabase migration pickup_notification_columns)。
-- picked_up_at : 集荷ライン(picked_up)を初めて越えた時刻。sync-tracking が記録する。
-- pickup_ack_at: 運営が通知を「確認」で既読にした時刻 (非NULL=通知に出さない)。
alter table shipments add column if not exists picked_up_at timestamptz;
alter table shipments add column if not exists pickup_ack_at timestamptz;

-- 既に集荷済/以降だが picked_up_at 未記録の行を updated_at で補完。
update shipments
  set picked_up_at = updated_at
  where picked_up_at is null and status in ('picked_up','in_transit','delivered');

-- バックフィルで付いた過去分(配達済み or 本日より前の集荷)は既読にして通知から除外し、
-- 本日の実集荷だけ未読で残す。以降は sync-tracking が新規集荷を未読で積む。
update shipments set pickup_ack_at = now()
  where pickup_ack_at is null and picked_up_at is not null
    and (status = 'delivered'
         or (picked_up_at at time zone 'Asia/Tokyo')::date < (now() at time zone 'Asia/Tokyo')::date);
