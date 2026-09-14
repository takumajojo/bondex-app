-- 配送依頼のホテル変更機能 (設計案2)。追加のみ・既存挙動に影響なし。
-- 適用済み (Supabase migration hotel_change_schema, 2026-09-14)。

-- 変更受付締切: 発送日の2営業日前 18:00 JST を app (lib/change-deadline.ts) が計算して保存。
alter table shipments add column if not exists change_deadline_at timestamptz;

-- ホテル変更の監査履歴 (正規化テーブル)。
create table if not exists shipment_hotel_changes (
  id            uuid primary key default gen_random_uuid(),
  shipment_id   uuid not null references shipments(id) on delete cascade,
  booking_id    text not null,
  leg_index     int  not null,
  side          text not null check (side in ('pickup','guest')),
  old_hotel     text,
  new_hotel     text,
  old_hotel_ja  text,
  new_hotel_ja  text,
  old_place_id  text,
  new_place_id  text,
  over_deadline boolean not null default false,
  reason        text,
  old_slip_task boolean not null default false,
  changed_by    text,
  agency        text,
  changed_at    timestamptz not null default now()
);
create index if not exists idx_shipment_hotel_changes_booking  on shipment_hotel_changes(booking_id);
create index if not exists idx_shipment_hotel_changes_shipment on shipment_hotel_changes(shipment_id);
