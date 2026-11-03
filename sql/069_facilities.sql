-- ホテル受付可否の共通台帳 (B2B・B2C 共用) (2026-11-04 谷口さん承認・段階B)。未適用。
-- 設計: docs/hotel-acceptance-design-20261104.md (第2版)
--
-- 方針
--  - 施設は BondEx 内部の ID (facilities.id) で持ち、Google の place_id は対応表 (facility_place_ids) で結ぶ。
--    place_id が変わっても同じ施設に結び付けられる。1つの place_id は1つの施設だけ (重複登録の防止)。
--  - 集荷元 (pickup) と配送先 (delivery) の受付可否を別々に持つ: accepted / conditional / unknown / rejected。
--  - Google Places 由来の施設名・住所・レビューは保存しない (Google Maps Platform 利用規約 3.2.3)。
--    表示名・住所は行政データ・運営の入力からだけ入れる (name_source に google は無い)。
--  - Google の情報から作る判定 (source が *_google) は、法務確認が終わるまで記録させない (facility_settings)。
--  - 状態の変更は facility_set_status だけ。履歴 (facility_checks) を必ず残し、トリガーが
--    「同じトランザクションで記録した履歴の行」と一致する変更だけを通す (セッション変数を認可の根拠にしない)。
--  - 自動の判定 (バッチ・予約時の一次判定) は、運営が確認していない施設の unknown → rejected (確度 high) だけ。
--    運営が確認した施設は自動で変えない (確認待ちの印を付けるだけ)。
--  - B2C の既存の条件 (両ホテルが確認済みでないと確定しない) は、b2c_facility_status() で同じ意味を返す。
--    B2C ブランチの b2c_facilities は、統合時にこの台帳へ置き換える (手順は MyClaudecode/docs/bizlogi-stage-ab-report-20261104.md 6章)。

create table if not exists public.facility_settings (
  id                      boolean primary key default true check (id),
  -- Google の情報から作る判定の記録 (予約時の一次判定・月次調査) を許すか。法務確認まで false。
  google_derived_enabled  boolean not null default false,
  updated_by              text,
  updated_at              timestamptz not null default now()
);
insert into public.facility_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.facilities (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null default 'hotel' check (kind in ('hotel', 'residence')),
  -- BondEx の表示用。Google 以外の情報源からだけ入れる。
  display_name         text,
  display_address      text,
  name_source          text check (name_source in ('municipal', 'operator', 'agency_input', 'legacy')),
  -- 個人宅 (民泊物件を含む) の照合用の正規化住所。運営が承認した物件だけ登録する。
  residence_key        text unique,
  pickup_status        text not null default 'unknown' check (pickup_status   in ('accepted', 'conditional', 'unknown', 'rejected')),
  delivery_status      text not null default 'unknown' check (delivery_status in ('accepted', 'conditional', 'unknown', 'rejected')),
  pickup_conditions    text,
  delivery_conditions  text,
  pickup_decided_by    text check (pickup_decided_by   in ('operator', 'auto')),
  delivery_decided_by  text check (delivery_decided_by in ('operator', 'auto')),
  reject_reason        text check (reject_reason in
                         ('minpaku', 'unmanned', 'no_front', 'residence', 'no_luggage', 'hotel_refused', 'closed', 'other')),
  confidence           text check (confidence in ('high', 'medium', 'low')),
  review_state         text not null default 'none' check (review_state in ('none', 'pending')),
  review_reason        text,
  last_surveyed_at     timestamptz,
  last_checked_at      timestamptz,
  checked_by           text,
  next_survey_at       timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (kind <> 'residence' or residence_key is not null),
  check (pickup_status   <> 'conditional' or pickup_conditions   is not null),
  check (delivery_status <> 'conditional' or delivery_conditions is not null),
  check ((pickup_status <> 'rejected' and delivery_status <> 'rejected') or reject_reason is not null)
);
create index if not exists facilities_review_idx on public.facilities (review_state) where review_state = 'pending';

create table if not exists public.facility_place_ids (
  place_id       text primary key,
  facility_id    uuid not null references public.facilities(id) on delete restrict,
  is_current     boolean not null default true,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);
create unique index if not exists facility_place_ids_one_current on public.facility_place_ids (facility_id) where is_current;

create table if not exists public.facility_source_records (
  id                  uuid primary key default gen_random_uuid(),
  source              text not null,
  source_key          text not null,
  name                text,
  address             text,
  normalized_address  text,
  category            text,
  facility_id         uuid references public.facilities(id) on delete set null,
  match_score         numeric,
  matched_at          timestamptz,
  content_hash        text,
  license             text,
  source_url          text,
  fetched_at          timestamptz,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  removed_at          timestamptz,
  unique (source, source_key)
);

create table if not exists public.facility_checks (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  side         text not null check (side in ('pickup', 'delivery', 'both')),
  old_status   text,
  new_status   text,
  source       text not null check (source in
                 ('operator', 'hotel_reply', 'incident', 'batch_municipal', 'batch_google', 'batch_website', 'booking_google')),
  evidence     jsonb not null default '{}'::jsonb,
  confidence   text check (confidence in ('high', 'medium', 'low')),
  reason       text not null,
  checked_by   text not null,
  checked_at   timestamptz not null default now(),
  -- この記録と同じトランザクションの状態変更だけを、facilities のトリガーが通す
  check_txid   bigint not null default txid_current()
);
create index if not exists facility_checks_facility_idx on public.facility_checks (facility_id, checked_at desc);

create table if not exists public.survey_regions (
  region_code       text primary key,
  prefecture        text not null,
  name              text not null,
  priority          int  not null default 3 check (priority between 1 and 3),
  planned_month     int  check (planned_month between 1 and 12),
  last_surveyed_at  timestamptz,
  survey_status     text not null default 'not_surveyed' check (survey_status in ('not_surveyed', 'in_progress', 'surveyed')),
  facilities_found  int  not null default 0,
  candidates_found  int  not null default 0,
  sources_used      text[] not null default '{}'
);

alter table public.facility_settings       enable row level security;
alter table public.facilities              enable row level security;
alter table public.facility_place_ids      enable row level security;
alter table public.facility_source_records enable row level security;
alter table public.facility_checks         enable row level security;
alter table public.survey_regions          enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 状態の列は facility_set_status (同じトランザクションの履歴の行) からだけ変えられる
create or replace function public.facilities_status_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
begin
  if tg_op = 'INSERT' then
    if new.pickup_status <> 'unknown' or new.delivery_status <> 'unknown' then
      raise exception 'facility_status_guard: 新しい施設は unknown で登録し、facility_set_status で状態を変えてください';
    end if;
    return new;
  end if;
  if new.pickup_status is distinct from old.pickup_status
     or new.delivery_status is distinct from old.delivery_status
     or new.pickup_decided_by is distinct from old.pickup_decided_by
     or new.delivery_decided_by is distinct from old.delivery_decided_by then
    select exists (
      select 1 from public.facility_checks c
       where c.facility_id = new.id and c.check_txid = txid_current()
         and (new.pickup_status   is not distinct from old.pickup_status   or (c.side in ('pickup', 'both')   and c.new_status = new.pickup_status))
         and (new.delivery_status is not distinct from old.delivery_status or (c.side in ('delivery', 'both') and c.new_status = new.delivery_status))
    ) into v_ok;
    if not v_ok then
      raise exception 'facility_status_guard: 受付可否は facility_set_status で変えてください (履歴が必要)';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists facilities_status_guard on public.facilities;
create trigger facilities_status_guard before insert or update on public.facilities
  for each row execute function public.facilities_status_guard();

-- Google の情報から作る判定は、法務確認まで記録させない (設定で止める)
create or replace function public.facility_checks_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source in ('batch_google', 'booking_google')
     and not coalesce((select google_derived_enabled from public.facility_settings where id), false) then
    raise exception 'google_derived_disabled: Google の情報から作る判定は、法務確認が終わるまで記録できません';
  end if;
  new.check_txid := txid_current();
  return new;
end;
$$;
drop trigger if exists facility_checks_guard on public.facility_checks;
create trigger facility_checks_guard before insert on public.facility_checks
  for each row execute function public.facility_checks_guard();

-- 履歴は書き換え・削除させない
create or replace function public.facility_checks_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'facility_checks_immutable: 判定の履歴は変更・削除できません';
end;
$$;
drop trigger if exists facility_checks_immutable on public.facility_checks;
create trigger facility_checks_immutable before update or delete on public.facility_checks
  for each row execute function public.facility_checks_immutable();

-- ─────────────────────────────────────────────────────────────────────────────
-- place_id から施設を引く (無ければ unknown で登録)。施設名・住所は入れない (Google 由来のため)。
create or replace function public.facility_register_place(p_place_id text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_place_id is null or p_place_id !~ '^[A-Za-z0-9_-]+$' or length(p_place_id) not between 10 and 300 then
    raise exception 'invalid_place_id';
  end if;
  select facility_id into v_id from public.facility_place_ids where place_id = p_place_id;
  if found then
    update public.facility_place_ids set last_seen_at = now() where place_id = p_place_id;
    return v_id;
  end if;
  insert into public.facilities (kind) values ('hotel') returning id into v_id;
  begin
    insert into public.facility_place_ids (place_id, facility_id) values (p_place_id, v_id);
  exception when unique_violation then
    -- 同時に同じ place_id が登録された。作った施設は使わず、先に登録された施設を返す。
    delete from public.facilities where id = v_id;
    select facility_id into v_id from public.facility_place_ids where place_id = p_place_id;
  end;
  return v_id;
end;
$$;

-- Google の place_id が変わった (または同じ施設の別 ID が見つかった) ときに、施設へ新しい ID を結ぶ。
-- 古い ID は残す (過去の予約の結び付けを保つ)。別の施設に結ばれている ID は付け替えない (統合は運営の判断)。
create or replace function public.facility_link_place(p_facility_id uuid, p_place_id text, p_actor text)
returns table (ok boolean, reason text)
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if btrim(coalesce(p_actor, '')) = '' then return query select false, 'actor_required'::text; return; end if;
  if p_place_id is null or p_place_id !~ '^[A-Za-z0-9_-]+$' or length(p_place_id) not between 10 and 300 then return query select false, 'invalid_place_id'::text; return; end if;
  perform 1 from public.facilities where id = p_facility_id for update;
  if not found then return query select false, 'facility_not_found'::text; return; end if;
  select facility_id into v_owner from public.facility_place_ids where place_id = p_place_id;
  if found and v_owner <> p_facility_id then return query select false, 'place_id_in_use'::text; return; end if;
  update public.facility_place_ids set is_current = false where facility_id = p_facility_id and is_current and place_id <> p_place_id;
  insert into public.facility_place_ids (place_id, facility_id, is_current) values (p_place_id, p_facility_id, true)
  on conflict (place_id) do update set is_current = true, last_seen_at = now();
  return query select true, 'linked'::text;
end;
$$;

-- 承認済みの個人宅 (民泊物件を含む) を登録する。運営が受け渡しの条件を確認した物件だけ。
create or replace function public.facility_register_residence(p_residence_key text, p_display_address text, p_actor text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if btrim(coalesce(p_residence_key, '')) = '' or btrim(coalesce(p_actor, '')) = '' then raise exception 'residence_key_and_actor_required'; end if;
  select id into v_id from public.facilities where residence_key = p_residence_key;
  if found then return v_id; end if;
  insert into public.facilities (kind, residence_key, display_address, name_source)
  values ('residence', p_residence_key, p_display_address, 'operator') returning id into v_id;
  return v_id;
end;
$$;

-- 受付可否の変更。履歴を必ず残す。
--   運営 (operator / hotel_reply / incident): どの状態にも変えられる。
--   自動 (batch_* / booking_google): 運営が確認していない unknown を、確度 high のときだけ rejected にできる。
--     それ以外は状態を変えず、履歴と「確認待ち」の印だけを残す (運営が確認した施設を自動で止めない)。
create or replace function public.facility_set_status(
  p_facility_id uuid, p_side text, p_status text, p_conditions text, p_reject_reason text,
  p_source text, p_evidence jsonb, p_confidence text, p_reason text, p_actor text
) returns table (ok boolean, applied boolean, reason text)
language plpgsql security definer set search_path = public as $$
declare
  f public.facilities;
  v_auto boolean := p_source in ('batch_municipal', 'batch_google', 'batch_website', 'booking_google');
  v_sides text[] := case p_side when 'both' then array['pickup', 'delivery'] else array[p_side] end;
  v_side text;
  v_cur text;
  v_decided text;
  v_apply boolean := true;
  v_review text;
begin
  if p_side not in ('pickup', 'delivery', 'both') then return query select false, false, 'invalid_side'::text; return; end if;
  if p_status not in ('accepted', 'conditional', 'unknown', 'rejected') then return query select false, false, 'invalid_status'::text; return; end if;
  if btrim(coalesce(p_reason, '')) = '' or btrim(coalesce(p_actor, '')) = '' then
    return query select false, false, 'reason_and_actor_required'::text; return;
  end if;
  if p_status = 'conditional' and btrim(coalesce(p_conditions, '')) = '' then return query select false, false, 'conditions_required'::text; return; end if;
  if p_status = 'rejected' and p_reject_reason is null then return query select false, false, 'reject_reason_required'::text; return; end if;

  select * into f from public.facilities where id = p_facility_id for update;
  if not found then return query select false, false, 'facility_not_found'::text; return; end if;

  if v_auto then
    -- 自動は rejected だけ・確度 high だけ・対象の側が unknown・どちらの側も運営が確認していないときだけ
    foreach v_side in array v_sides loop
      v_cur := case v_side when 'pickup' then f.pickup_status else f.delivery_status end;
      v_decided := case v_side when 'pickup' then f.pickup_decided_by else f.delivery_decided_by end;
      if p_status <> 'rejected' or coalesce(p_confidence, '') <> 'high' or v_cur <> 'unknown' or v_decided = 'operator' then
        v_apply := false;
      end if;
    end loop;
    -- 片側でも運営が確認した施設は「未確認の施設」ではないので、自動では変えない
    if f.kind = 'residence' or f.pickup_decided_by = 'operator' or f.delivery_decided_by = 'operator' then v_apply := false; end if;
  end if;

  -- 履歴 (状態を変えない場合も残す)。google 由来はトリガーが設定を見て止める。
  insert into public.facility_checks (facility_id, side, old_status, new_status, source, evidence, confidence, reason, checked_by)
  values (f.id, p_side,
          case p_side when 'pickup' then f.pickup_status when 'delivery' then f.delivery_status else f.pickup_status || '/' || f.delivery_status end,
          case when v_apply then p_status else null end,
          p_source, coalesce(p_evidence, '{}'::jsonb), p_confidence, btrim(p_reason), btrim(p_actor));

  if not v_apply then
    v_review := case
      when f.pickup_decided_by = 'operator' or f.delivery_decided_by = 'operator' then '運営の確認済みの判定と食い違う情報: '
      else '自動判定の確度が低い情報: ' end || btrim(p_reason);
    update public.facilities set review_state = 'pending', review_reason = left(v_review, 500), last_surveyed_at = now()
     where id = f.id;
    return query select true, false, 'review_requested'::text; return;
  end if;

  update public.facilities set
    pickup_status       = case when 'pickup'   = any (v_sides) then p_status else pickup_status end,
    delivery_status     = case when 'delivery' = any (v_sides) then p_status else delivery_status end,
    pickup_conditions   = case when 'pickup'   = any (v_sides) then case when p_status = 'conditional' then p_conditions end else pickup_conditions end,
    delivery_conditions = case when 'delivery' = any (v_sides) then case when p_status = 'conditional' then p_conditions end else delivery_conditions end,
    pickup_decided_by   = case when 'pickup'   = any (v_sides) then case when v_auto then 'auto' else 'operator' end else pickup_decided_by end,
    delivery_decided_by = case when 'delivery' = any (v_sides) then case when v_auto then 'auto' else 'operator' end else delivery_decided_by end,
    reject_reason       = case when p_status = 'rejected' then p_reject_reason
                               when (case when 'pickup' = any (v_sides) then p_status else pickup_status end) <> 'rejected'
                                and (case when 'delivery' = any (v_sides) then p_status else delivery_status end) <> 'rejected' then null
                               else reject_reason end,
    confidence          = p_confidence,
    review_state        = case when v_auto then 'pending' else 'none' end,
    review_reason       = case when v_auto then left('自動で受付不可にしました。確認してください: ' || btrim(p_reason), 500) end,
    last_checked_at     = case when v_auto then last_checked_at else now() end,
    checked_by          = case when v_auto then checked_by else btrim(p_actor) end,
    last_surveyed_at    = case when v_auto then now() else last_surveyed_at end
  where id = f.id;
  return query select true, true, 'applied'::text;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 判定。予約・ホテル変更・変更申請・送信の直前で同じ関数を呼ぶ (組み込みは段階D)。
--   allow                 対応可能、または未確認で疑いなし (判断7: 通常どおり受ける)
--   allow_with_conditions 条件付き (条件を表示)
--   needs_review          未確認で疑いあり (Operator 確認。確認まで集荷依頼を送らない)
--   deny                  受付不可
create or replace function public.facility_gate(p_place_id text, p_side text)
returns table (result text, facility_id uuid, status text, conditions text, reject_reason text)
language plpgsql stable security definer set search_path = public as $$
declare
  f public.facilities;
  v_status text;
begin
  if p_side not in ('pickup', 'delivery') then raise exception 'invalid_side'; end if;
  select x.* into f from public.facilities x join public.facility_place_ids p on p.facility_id = x.id where p.place_id = p_place_id;
  if not found then
    return query select 'allow'::text, null::uuid, 'unknown'::text, null::text, null::text; return;
  end if;
  v_status := case p_side when 'pickup' then f.pickup_status else f.delivery_status end;
  return query select
    case v_status
      when 'accepted' then 'allow'
      when 'conditional' then 'allow_with_conditions'
      when 'rejected' then 'deny'
      else case when f.review_state = 'pending' then 'needs_review' else 'allow' end
    end,
    f.id, v_status,
    case p_side when 'pickup' then f.pickup_conditions else f.delivery_conditions end,
    f.reject_reason;
end;
$$;

-- 個人宅 (民泊物件を含む) は原則受付不可 (判断5)。運営が承認した物件 (accepted / conditional) だけ通す。
create or replace function public.facility_gate_residence(p_residence_key text, p_side text)
returns table (result text, facility_id uuid, status text, conditions text, reject_reason text)
language plpgsql stable security definer set search_path = public as $$
declare
  f public.facilities;
  v_status text;
begin
  if p_side not in ('pickup', 'delivery') then raise exception 'invalid_side'; end if;
  select * into f from public.facilities where residence_key = p_residence_key and kind = 'residence';
  if not found then
    return query select 'deny'::text, null::uuid, 'unknown'::text, null::text, 'residence'::text; return;
  end if;
  v_status := case p_side when 'pickup' then f.pickup_status else f.delivery_status end;
  return query select
    case v_status when 'accepted' then 'allow' when 'conditional' then 'allow_with_conditions' else 'deny' end,
    f.id, v_status,
    case p_side when 'pickup' then f.pickup_conditions else f.delivery_conditions end,
    coalesce(f.reject_reason, 'residence');
end;
$$;

-- B2C の既存の条件 (両ホテルとも「確認済み」でないと予約を確定しない) を同じ意味で返す。
--   verified    … 集荷元・配送先とも運営が対応可能と確認した
--   unsupported … どちらかが受付不可
--   unknown     … それ以外 (条件付き・未確認を含む。B2C は運営の確認まで確定しない)
create or replace function public.b2c_facility_status(p_place_id text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when x.pickup_status = 'rejected' or x.delivery_status = 'rejected' then 'unsupported'
      when x.pickup_status = 'accepted' and x.delivery_status = 'accepted'
       and x.pickup_decided_by = 'operator' and x.delivery_decided_by = 'operator' then 'verified'
      else 'unknown' end
      from public.facilities x join public.facility_place_ids p on p.facility_id = x.id
     where p.place_id = p_place_id), 'unknown');
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 実行権限: サーバ (service_role) だけ
revoke all on function public.facility_register_place(text) from public, anon, authenticated;
revoke all on function public.facility_link_place(uuid, text, text) from public, anon, authenticated;
revoke all on function public.facility_register_residence(text, text, text) from public, anon, authenticated;
revoke all on function public.facility_set_status(uuid, text, text, text, text, text, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.facility_gate(text, text) from public, anon, authenticated;
revoke all on function public.facility_gate_residence(text, text) from public, anon, authenticated;
revoke all on function public.b2c_facility_status(text) from public, anon, authenticated;
revoke all on function public.facilities_status_guard() from public, anon, authenticated;
revoke all on function public.facility_checks_guard() from public, anon, authenticated;
grant execute on function public.facility_register_place(text) to service_role;
grant execute on function public.facility_link_place(uuid, text, text) to service_role;
grant execute on function public.facility_register_residence(text, text, text) to service_role;
grant execute on function public.facility_set_status(uuid, text, text, text, text, text, jsonb, text, text, text) to service_role;
grant execute on function public.facility_gate(text, text) to service_role;
grant execute on function public.facility_gate_residence(text, text) to service_role;
grant execute on function public.b2c_facility_status(text) to service_role;
