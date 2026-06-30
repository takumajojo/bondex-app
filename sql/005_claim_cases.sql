-- BondEx migration 005 — claim_cases (配送トラブル管理)
--
-- 紛失 / 毀損 / 遅配 / 誤配 等のクレーム案件を 1 件 = 1 行で記録.
-- BondEx は取次業なので一次補償は実運送人 (ヤマト) が行うが、
-- BondEx 側の窓口対応・進捗管理のために記録する.

create table if not exists claim_cases (
  id uuid primary key default uuid_generate_v4(),

  -- shipments への紐付け
  shipment_id uuid references shipments (id) on delete set null,
  booking_id  text,  -- shipment が削除されても残せるよう保存
  leg_index   int,

  -- 区分
  category text not null check (category in (
    'damage',          -- 毀損
    'loss',            -- 紛失
    'delay',           -- 遅配
    'wrong_delivery',  -- 誤配
    'other'            -- その他
  )),

  -- 報告者
  reported_by text check (reported_by in ('agency', 'traveler', 'hotel', 'bondex', 'yamato')),
  reporter_name    text,
  reporter_contact text,  -- 連絡先 (電話 or email)

  -- 詳細
  description       text not null,           -- 何が起きたか
  resolution        text,                    -- 対応内容
  claim_amount_yen  int,                     -- 申請額 (円)
  yamato_case_number text,                   -- ヤマトクレーム番号

  -- ステータス
  status text not null default 'open' check (status in (
    'open',           -- 受付済
    'investigating',  -- 調査中
    'resolved',       -- 解決済
    'closed',         -- 案件クローズ
    'rejected'        -- 却下
  )),

  -- タイムスタンプ
  occurred_at  timestamptz,                       -- 事象発生日時 (任意)
  reported_at  timestamptz not null default now(),
  resolved_at  timestamptz,                       -- 解決日時 (resolved/closed 時)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- インデックス
create index if not exists claim_cases_status_idx     on claim_cases (status);
create index if not exists claim_cases_booking_idx    on claim_cases (booking_id);
create index if not exists claim_cases_shipment_idx   on claim_cases (shipment_id);
create index if not exists claim_cases_created_at_idx on claim_cases (created_at desc);

-- updated_at 自動更新
drop trigger if exists claim_cases_set_updated_at on claim_cases;
create trigger claim_cases_set_updated_at
  before update on claim_cases
  for each row execute function set_updated_at();

-- RLS は当面 OFF (BondEx 管理のみアクセス、middleware 認証で保護)
alter table claim_cases disable row level security;
