-- P1-B 佐川急便 大口集荷 事前連絡管理 (2026-11-04)。
-- 同一集荷元ホテル × 同一集荷日 で合計20個以上になる「集荷単位」を管理する。
-- 佐川・世田谷営業所への大口事前連絡 (状態②) を、集荷依頼 (状態① = shipments.pickup_requested_at) と
-- Biz-Logi登録 (状態③ = 将来) から独立して管理する。既存 pickup_requested_at は流用しない。
--
-- 安全方針:
--  - 追加型のみ。既存テーブル/データの変更・削除は一切しない。
--  - RLS を有効化し policy を付けない = service_role のみ (代理店には一切見せない)。
--  - feature flag SAGAWA_BULK_ALERT_ENABLED が OFF の間は、アプリ側がこれらのテーブルに書き込まない。
--  - **本番DBには未適用** (Phase 0/064 と同じく、承認後に別途適用する冪等ファイル)。
--  - set_updated_at() は sql/001 で定義済みのものを再利用 (再定義しない)。

-- 集荷単位 (ホテル × 集荷日)。unique(hotel_key, pickup_date)。
create table if not exists public.sagawa_bulk_pickups (
  id uuid primary key default gen_random_uuid(),
  -- 集計キー: 'pid:<place_id>' (高信頼) または 'name:<正規化名>' (名称のみ=要確認)。
  hotel_key text not null,
  key_source text not null check (key_source in ('place_id', 'name')),
  -- place_id 由来は確実に同一と判断できる。名称由来は Operator 確認対象。
  confident boolean not null default false,
  pickup_date date not null,
  hotel_label text,                       -- 表示用 (最新の集荷元名)
  from_prefecture text,
  from_city text,
  total_pieces int not null default 0,
  leg_count int not null default 0,
  agency_count int not null default 0,
  booking_count int not null default 0,        -- distinct 予約数 (同一予約の複数区間は 1 と数える)
  -- 検知カテゴリ (両立しうる): 大口 (合計20個以上=佐川事前連絡) / 重複 (同一ホテル同日に複数予約)。
  is_bulk boolean not null default false,
  is_duplicate boolean not null default false,
  -- 構成 (対象leg集合 + 個数 + pickup_time + 日付 + hotel_key) の安定ハッシュ。再集計の差分検知に使う。
  member_hash text not null,
  -- pending=検知済未連絡 / notified=佐川へ連絡済 / needs_reconfirm=連絡後に要再確認の変更あり /
  -- stale=集荷日を過ぎても未対応 / cleared=20個未満に減少 or 消滅 (履歴として残す)
  status text not null default 'pending'
    check (status in ('pending', 'notified', 'needs_reconfirm', 'stale', 'cleared')),
  -- 状態② 佐川への大口事前連絡。状態① (pickup_requested_at)・③ (Biz-Logi) とは独立。
  notified_at timestamptz,
  notified_by text,
  notified_snapshot jsonb,                -- 連絡時に佐川へ伝えた内容 (日付/ホテル/個数/pickup_time/構成)
  notified_method text,                   -- 佐川への連絡方法 (電話/メール/FAX 等・Operator 入力)
  sagawa_reply text,                      -- 佐川側の回答・確認内容 (集荷可否/車両手配 等・証跡)
  needs_recontact boolean not null default false, -- Operator が「要再連絡」と判断したフラグ
  -- メール通知の冪等化 (D5)。
  notify_state text not null default 'idle'
    check (notify_state in ('idle', 'pending', 'sent', 'failed')),
  notify_key text,                        -- 不変の冪等キー (hotel_key|pickup_date|member_hash|kind)
  notify_kind text,                       -- 現在処理中の通知種別 (initial|change|eve|day)
  notify_claimed_at timestamptz,          -- lease (他プロセスが送信中)
  notify_attempt_owner text,              -- 送信を claim した run のトークン
  notify_error text,
  last_alerted_at timestamptz,            -- 前日/当日リマインドの最終送信記録
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hotel_key, pickup_date)
);

create index if not exists sagawa_bulk_pickups_date_idx on public.sagawa_bulk_pickups (pickup_date);
-- 未対応のホットキュー (通知/TODO 対象)。
create index if not exists sagawa_bulk_pickups_open_idx on public.sagawa_bulk_pickups (pickup_date)
  where status in ('pending', 'needs_reconfirm', 'stale');

drop trigger if exists sagawa_bulk_pickups_set_updated_at on public.sagawa_bulk_pickups;
create trigger sagawa_bulk_pickups_set_updated_at before update on public.sagawa_bulk_pickups
  for each row execute function set_updated_at();

-- 既に旧版を適用済みの環境にも列を足せるよう冪等 ALTER (新規 create では no-op)。
alter table public.sagawa_bulk_pickups add column if not exists booking_count int not null default 0;
alter table public.sagawa_bulk_pickups add column if not exists is_bulk boolean not null default false;
alter table public.sagawa_bulk_pickups add column if not exists is_duplicate boolean not null default false;
alter table public.sagawa_bulk_pickups add column if not exists notified_method text;
alter table public.sagawa_bulk_pickups add column if not exists sagawa_reply text;
alter table public.sagawa_bulk_pickups add column if not exists needs_recontact boolean not null default false;

alter table public.sagawa_bulk_pickups enable row level security;
-- policy なし = service_role のみ (代理店・authenticated には一切見せない)。

-- 集荷単位 ↔ shipment の対応 (構成メンバー)。removed_at で履歴を残す。
create table if not exists public.sagawa_bulk_pickup_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.sagawa_bulk_pickups(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  booking_id text not null,
  leg_index int not null default 0,
  agency text,
  pieces int not null default 0,
  pickup_time text,
  added_at timestamptz not null default now(),
  removed_at timestamptz,                 -- 集荷単位から外れた時刻 (個数減/キャンセル/日付・ホテル変更)
  unique (group_id, shipment_id)
);
create index if not exists sagawa_bulk_pickup_members_group_idx on public.sagawa_bulk_pickup_members (group_id);
create index if not exists sagawa_bulk_pickup_members_shipment_idx on public.sagawa_bulk_pickup_members (shipment_id);

-- 変更・連絡履歴 (追記のみ)。
create table if not exists public.sagawa_bulk_pickup_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.sagawa_bulk_pickups(id) on delete cascade,
  -- detected|increased|decreased|membership_changed|pickup_time_changed|notified|reconfirm_needed|
  -- reminded_eve|reminded_day|cleared|stale|operator_note
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sagawa_bulk_pickup_events_group_idx on public.sagawa_bulk_pickup_events (group_id, created_at);

alter table public.sagawa_bulk_pickup_members enable row level security;
alter table public.sagawa_bulk_pickup_events enable row level security;
-- policy なし = service_role のみ。
