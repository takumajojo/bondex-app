-- 021: FIT/Group 区分 + 団体の個荷 (group_luggage)
--
-- 設計: Group は新しい親テーブルではなく「既存の予約 (booking_id + legs) に
-- booking_type='group' のタグを付けたもの」。発行(Ship&co)・追跡同期・課金・
-- バウチャー・追跡ページは一切変更せずそのまま動く。
-- 荷物1個=ゲスト1人の対応は子テーブル group_luggage が持ち、
-- 個々の荷物ステータスは yamato_tracking_detail から導出する(保存しない)。
-- 既存行はすべて booking_type='fit' になり、FIT の挙動は不変。

alter table shipments
  add column if not exists booking_type text not null default 'fit'
    check (booking_type in ('fit','group')),
  add column if not exists tour_leader_name     text,
  add column if not exists tour_leader_phone    text,
  add column if not exists tour_leader_whatsapp text;

create index if not exists shipments_booking_type_idx on shipments (booking_type);

-- 団体の個荷: 1行 = 1スーツケース (booking_id + leg_index + luggage_no)
-- tracking_number が null の間は yamato_tracking[luggage_no-1] を既定の対応とする
-- (発行時のラベル連番と一致)。物理的に貼り替えた場合はここに確定値を保存して上書き。
create table if not exists group_luggage (
  id              uuid primary key default uuid_generate_v4(),
  booking_id      text not null,
  leg_index       int  not null default 0,
  luggage_no      int  not null,
  guest_name      text not null default '',
  tracking_number text,
  manual_status   text check (manual_status is null or manual_status in
                    ('pending','issued','picked_up','in_transit','delivered','issue')),
  issue_note      text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (booking_id, leg_index, luggage_no)
);
create index if not exists group_luggage_booking_idx  on group_luggage (booking_id);
create index if not exists group_luggage_tracking_idx on group_luggage (tracking_number);

drop trigger if exists group_luggage_set_updated_at on group_luggage;
create trigger group_luggage_set_updated_at
  before update on group_luggage
  for each row execute function set_updated_at();

-- RLS: 代理店は自社予約の個荷のみ閲覧可 (書き込みはサーバー(service_role)経由のみ)
alter table group_luggage enable row level security;
drop policy if exists "agencies see own group luggage" on group_luggage;
create policy "agencies see own group luggage" on group_luggage
  for select to authenticated
  using (exists (
    select 1 from shipments s
    where s.booking_id = group_luggage.booking_id
      and s.agency = (select a.name from agencies a
                      join user_agencies ua on ua.agency_id = a.id
                      where ua.user_id = auth.uid())
  ));
