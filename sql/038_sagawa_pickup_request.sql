-- 佐川への集荷依頼の連絡タスク (2026-09-16 谷口さん)。適用済み (Supabase migration sagawa_pickup_request_todo)。
-- 集荷の前日までに佐川へ集荷依頼の連絡が必要。今日のTODOに「佐川へ集荷依頼」を出す。
-- pickup_requested_at: 運営が佐川へ集荷依頼を連絡した時刻 (非NULL=TODOから消える)。
alter table shipments add column if not exists pickup_requested_at timestamptz;
