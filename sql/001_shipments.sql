-- BondEx 管理ダッシュボード Phase A — 初期スキーマ
--
-- 単一テーブル `shipments`. 1区間 = 1行.
-- bookingId (BDX-260629-XXX) でグループ化された複数 leg を保持する.
--
-- ステータス: pending → issued → picked_up → in_transit → delivered
--             ⏎ failed (Yamato 発行失敗), cancelled (キャンセル)
--
-- 利用方法: Supabase のダッシュボードで SQL Editor を開いてこのファイルの中身を実行.

create extension if not exists "uuid-ossp";

create table if not exists shipments (
  id uuid primary key default uuid_generate_v4(),

  -- ブッキング識別子
  booking_id    text not null,             -- BDX-260629-783
  leg_index     int  not null default 0,   -- 1始まりだとアプリ側で都合悪いので 0始まり

  -- 代理店・旅行者情報
  agency           text not null,           -- 代理店 (tourCompany)
  representative   text not null,           -- 代表者名 (Mr. Jack Costanzo)
  traveler_count   int  not null default 1,
  booking_name     text,                    -- ホテル予約名 (optional)

  -- 区間情報
  shipment_date     date not null,           -- 集荷予定日
  expected_arrival  date not null,           -- 到着希望日
  from_hotel        text not null,
  from_city         text,
  from_place_id     text,                    -- Google Places place_id
  from_check_in     date,                    -- 発送元チェックイン日 (optional)
  to_hotel          text not null,
  to_city           text,
  to_place_id       text,
  to_check_out      date,                    -- 発送先チェックアウト日 (optional)
  recipient         text not null,
  suitcase_count    int  not null default 1,
  amount_yen        int  not null default 0, -- suitcase_count * 5000

  -- ヤマト発行結果
  yamato_tracking   jsonb,                   -- 追跡番号の配列 (e.g. ["123456789012"])
  yamato_label_url  text,                    -- Ship&co の PDF URL
  yamato_issuable_from date,                 -- deferred のとき: いつから発行可能か
  ship_ref_number   text,                    -- Ship&co に送った ref_number

  -- ステータス
  status            text not null default 'issued'
    check (status in ('pending', 'issued', 'picked_up', 'in_transit', 'delivered', 'failed', 'cancelled')),
  error_message     text,

  -- 備考
  notes             text,

  -- タイムスタンプ
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- インデックス: ダッシュボードでよく使う検索条件
create index if not exists shipments_agency_idx       on shipments (agency);
create index if not exists shipments_shipment_date_idx on shipments (shipment_date desc);
create index if not exists shipments_status_idx       on shipments (status);
create index if not exists shipments_booking_id_idx   on shipments (booking_id);
create index if not exists shipments_created_at_idx   on shipments (created_at desc);

-- updated_at 自動更新トリガー
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists shipments_set_updated_at on shipments;
create trigger shipments_set_updated_at
  before update on shipments
  for each row execute function set_updated_at();

-- RLS は当面 OFF (operator 共通パスワードで middleware ゲート済み).
-- 代理店別ログインを導入する Phase B で row level security を有効化.
alter table shipments disable row level security;
