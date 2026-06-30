-- BondEx Phase B-1 — 代理店アカウント + RLS
--
-- 設計:
--   agencies          : 代理店マスタ (name は shipments.agency に一致)
--   user_agencies     : Supabase Auth user と agency の紐付け (1 user = 1 agency)
--   shipments         : RLS 有効化 — agency 列で代理店ごとに分離
--   service_role 接続 : RLS bypass — BondEx 管理 (/operator) はこれで全件アクセス
--   anon + JWT 接続   : RLS effective — 代理店 (/agency) は自社分のみ

-- =====================================================
-- agencies テーブル
-- =====================================================
create table if not exists agencies (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null unique,    -- 'My Japan Planner' (shipments.agency と一致)
  contact_email   text,
  contact_phone   text,
  contact_person  text,                    -- 担当者名
  billing_address text,                    -- 請求書送付先
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists agencies_set_updated_at on agencies;
create trigger agencies_set_updated_at
  before update on agencies
  for each row execute function set_updated_at();

-- =====================================================
-- user_agencies テーブル (Auth user ↔ agency 1:1)
-- =====================================================
create table if not exists user_agencies (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  agency_id  uuid not null references agencies (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists user_agencies_agency_idx on user_agencies (agency_id);

-- =====================================================
-- shipments に RLS 適用
-- =====================================================
alter table shipments enable row level security;

-- 既存ポリシーがあれば削除 (idempotent)
drop policy if exists "agencies see only their shipments" on shipments;
drop policy if exists "service role full access" on shipments;

-- 代理店 user は自社の shipments のみ閲覧可能
create policy "agencies see only their shipments"
  on shipments
  for select
  to authenticated
  using (
    agency = (
      select a.name
      from agencies a
      join user_agencies ua on ua.agency_id = a.id
      where ua.user_id = auth.uid()
    )
  );

-- service_role は全件アクセス可 (BondEx 管理画面用)
-- 注: service_role を使った API ルートは RLS を bypass するので、追加ポリシーは不要だが
--     明示のため anon/authenticated 以外は許可しないことを表しておく.

-- agencies テーブルも RLS — 代理店 user は自社の情報のみ閲覧可
alter table agencies enable row level security;
drop policy if exists "agencies see own info" on agencies;
create policy "agencies see own info"
  on agencies
  for select
  to authenticated
  using (
    id = (select agency_id from user_agencies where user_id = auth.uid())
  );

-- user_agencies は self-only
alter table user_agencies enable row level security;
drop policy if exists "users see own linking" on user_agencies;
create policy "users see own linking"
  on user_agencies
  for select
  to authenticated
  using (user_id = auth.uid());

-- =====================================================
-- セットアップ用 — 既存代理店を登録 (テスト用、運用時は手動 insert)
-- =====================================================
-- 例: My Japan Planner を登録
-- insert into agencies (name, contact_email, contact_person)
-- values ('My Japan Planner', 'karen@myjapanplanner.com', 'Karen Fujita')
-- on conflict (name) do nothing;
--
-- その代理店ユーザーを作成 (Authentication > Users > Add user で作成後):
-- insert into user_agencies (user_id, agency_id)
-- select '<auth.users.id>', id from agencies where name = 'My Japan Planner';
