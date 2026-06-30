-- BondEx migration 004 — parse_log table for itinerary parsing learning
--
-- 設計:
--   每回 itinerary parse の入力 (file metadata) と出力 (AI raw JSON) を記録.
--   将来的に operator が approve した結果を few-shot example として
--   次回の parse に注入する基盤を作る.
--
-- 当面は記録のみ (UI / few-shot 取得は次フェーズ).

create table if not exists parse_log (
  id uuid primary key default uuid_generate_v4(),

  -- 識別
  agency      text,             -- どの代理店がアップロードしたか (operator settings の tourCompany)
  file_name   text,
  file_hash   text,             -- SHA256 — 同じファイルの再アップ判定用
  file_size   int,
  file_type   text,             -- "application/pdf", "image/png" 等

  -- パース結果
  ai_raw_output       jsonb,    -- AI が返した extract_itinerary の input そのまま
  operator_corrected  jsonb,    -- 後段で operator が編集したもの (現状は null、将来対応)

  -- 学習用フラグ
  approved boolean not null default false,  -- few-shot に使ってよいか (operator が approve)
  notes text,                                -- approve した理由など、運用メモ

  -- タイムスタンプ
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- インデックス: agency + approved の組み合わせで few-shot 取得時に使う
create index if not exists parse_log_agency_idx     on parse_log (agency);
create index if not exists parse_log_approved_idx   on parse_log (approved) where approved = true;
create index if not exists parse_log_created_at_idx on parse_log (created_at desc);
create index if not exists parse_log_file_hash_idx  on parse_log (file_hash);

-- updated_at 自動更新
drop trigger if exists parse_log_set_updated_at on parse_log;
create trigger parse_log_set_updated_at
  before update on parse_log
  for each row execute function set_updated_at();

-- RLS は当面 OFF (service_role でアクセス)
alter table parse_log disable row level security;
