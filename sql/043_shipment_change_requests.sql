-- 予約の訂正／代理店変更を「申請 → 承認」で扱うためのテーブル (設計案A・2026-09-28)。
-- 追加のみ・既存挙動に影響なし。
--
-- 目的:
--  1) 運営(operator)の直接訂正は承認済みとして即時反映し、ここに監査行 (status='approved') を残す。
--  2) 代理店(agency)からの変更で「変更受付締切(change_deadline_at)を過ぎたもの」は即時反映せず、
--     status='pending' で積む。BondEx が承認するまで受理しない (谷口さん指示 2026-09-28)。
--
-- 既存の shipment_hotel_changes (sql/033) と同じ流儀: 正規化した old/new + over_deadline + reason
--  + 実行者 + agency を持ち、参照先 shipment 削除時は cascade。

create table if not exists shipment_change_requests (
  id            uuid primary key default gen_random_uuid(),
  shipment_id   uuid not null references shipments(id) on delete cascade,
  booking_id    text not null,
  leg_index     int  not null,
  -- 申請元: agency=代理店セルフ / operator=運営直接訂正
  requested_by  text not null check (requested_by in ('agency','operator')),
  -- 申請者の識別 (代理店名 or 'operator')
  requester     text,
  -- 対象予約の代理店 (突合用・申請時点のスナップショット)
  agency        text,
  -- 変更内容(新値)と変更前スナップショット。キーは shipments のカラム名に対応する。
  --   例: {"shipment_date":"2026-09-29","expected_arrival":"2026-09-30"}
  fields        jsonb   not null default '{}'::jsonb,
  before        jsonb   not null default '{}'::jsonb,
  -- 変更受付締切を過ぎた申請か (true のとき承認が必須)
  over_deadline boolean not null default false,
  reason        text,
  status        text    not null default 'pending'
                  check (status in ('pending','approved','rejected')),
  decided_by    text,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_shipment_change_requests_booking  on shipment_change_requests(booking_id);
create index if not exists idx_shipment_change_requests_shipment on shipment_change_requests(shipment_id);
-- 承認待ちキューの取得を速くする (status='pending' の部分索引)。
create index if not exists idx_shipment_change_requests_pending
  on shipment_change_requests(created_at) where status = 'pending';

-- RLS: 既定deny。読み書きは service_role 経由の API ルートのみ (anon/agency の直接アクセスは不可)。
alter table shipment_change_requests enable row level security;
