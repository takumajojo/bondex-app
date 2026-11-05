-- 集荷依頼中の区間の書き換え禁止と、変更申請の統合 (2026-11-04 谷口さん承認・段階A)。未適用。
-- 前提: sql/067 (pickup_requests・一時停止スイッチ) を先に適用する。ロックは無効で作り、sql/072 で有効にする。
--
-- 1. 変更申請は既存の shipment_change_requests (sql/043・本番に3件=すべて運営の訂正記録) に統合する。
--    種類 (kind)・段階 (stage)・佐川への連絡と回答・番号の扱いを足す。既存の status 列は残し、stage と同期する。
-- 2. shipments の更新前トリガーで、有効な集荷依頼がある集荷前の区間について、佐川に渡す内容
--    (日程・個数・発送元/到着先・代表者名・受取人・時間帯・取消) の書き換えを止める。
--    書き換えてよいのは apply_shipment_change だけ。セッション変数ではなく、
--    「同じトランザクションで反映中の、佐川が承認した申請」と「変える項目がその申請の項目だけ」を DB の行で確かめる。
-- 3. 取消済みの区間には問い合わせ番号を書かせない (どの経路でも)。
--
-- 有効な集荷依頼 = pickup_requests.state in (sending, accepted, unknown, needs_review, change_pending)。
-- 集荷済み以降 (picked_up / in_transit / delivered) は対象外 (集荷時の個数訂正・課金の訂正を止めない)。

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. 表を掴む順番を固定する (2026-11-04 移行リハーサル)。利用者の操作を流したまま適用すると、
--    「変更申請の表 → 区間の表」の順に掴む本 SQL と、「区間 → 変更申請」の順に読む画面の照会が
--    デッドロックし、どちらかが打ち切られた (scripts/test-integ/migration-rehearsal.sh)。
--    最初に 区間 → 集荷依頼 → 変更申請 の順でまとめて掴む。利用者の操作は適用の間 (1秒未満) だけ待つ
--    (lock_timeout を付けて流す。待ち切れなければ何も変えずに失敗する)。
-- 移行の表の確保 (2026-11-04 デッドロック対策・068)。関係する表を「待たずに」まとめて掴む (nowait)。
-- 掴めなければ何も持たずに 0.2秒待って掴み直す (待っている間は表を持たないので、利用者の操作とデッドロックしない)。
-- 掴んだ後は、この SQL が終わるまで (1秒未満) 利用者の操作のほうが待つだけで、失敗しない。
-- 10秒たっても掴めなければ、何も変えずに失敗する (少し待って流し直す)。1つのトランザクションの中で流すこと。
do $migration_lock$
declare
  targets text;
  deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  -- 存在する表だけ (例: 067 の前は pickup_requests が無い)
  select string_agg(t, ', ') into targets from unnest(array['public.shipments', 'public.pickup_requests', 'public.shipment_change_requests', 'public.operator_passkeys']) t where to_regclass(t) is not null;
  if targets is null then return; end if;
  loop
    begin
      execute format('lock table %s in access exclusive mode nowait', targets);
      return;
    exception when lock_not_available then
      -- 経過した時間で区切る（回数で数えると、1回ごとの手間の分だけ 10秒を超える: 実測 10.2〜12.4秒）
      if clock_timestamp() >= deadline then
        raise exception 'migration: 表 (%) を10秒以内に確保できませんでした。何も変えていません。少し待って流し直してください', targets;
      end if;
      perform pg_sleep(least(0.2, greatest(0.01, extract(epoch from (deadline - clock_timestamp())))));
    end;
  end loop;
end $migration_lock$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. shipment_change_requests の拡張
alter table public.shipment_change_requests
  add column if not exists kind                 text,
  add column if not exists stage                text,
  add column if not exists pickup_request_id    uuid references public.pickup_requests(id) on delete restrict,
  add column if not exists needs_sagawa         boolean not null default false,
  add column if not exists requested_actor      text,
  add column if not exists contact_note         text,
  add column if not exists contacted_by         text,
  add column if not exists contacted_at         timestamptz,
  add column if not exists answer_note          text,
  add column if not exists answered_by          text,
  add column if not exists answered_at          timestamptz,
  add column if not exists number_policy        text,
  add column if not exists new_shipping_number  text,
  add column if not exists old_shipping_number  text,
  add column if not exists old_tracking_numbers jsonb,
  add column if not exists old_tracking_detail  jsonb,
  add column if not exists large_lot            boolean not null default false,
  add column if not exists hotel_change_id      uuid,
  add column if not exists apply_txid           bigint,
  add column if not exists applied_by           text,
  add column if not exists applied_at           timestamptz,
  add column if not exists updated_at           timestamptz not null default now();

-- 既存行 (本番3件・すべて運営の訂正で approved) に種類と段階を付ける。中身は変えない。
update public.shipment_change_requests
   set kind  = coalesce(kind, case when requested_by = 'operator' and status = 'approved' then 'correction' else 'fields' end),
       stage = coalesce(stage, case status when 'pending' then 'requested' when 'approved' then 'applied' else 'rejected' end)
 where kind is null or stage is null;

alter table public.shipment_change_requests
  alter column kind set not null,
  alter column stage set not null;
alter table public.shipment_change_requests
  drop constraint if exists shipment_change_requests_kind_check,
  add constraint shipment_change_requests_kind_check check (kind in
    ('hotel_guest', 'hotel_pickup', 'dates', 'count', 'representative', 'cancel', 'number', 'rearrange', 'fields', 'correction')),
  drop constraint if exists shipment_change_requests_stage_check,
  add constraint shipment_change_requests_stage_check check (stage in
    ('requested', 'contacted', 'approved', 'rejected', 'applied', 'withdrawn')),
  drop constraint if exists shipment_change_requests_policy_check,
  add constraint shipment_change_requests_policy_check check (number_policy is null or number_policy in ('kept', 'changed'));

-- 申請者に B2C の旅行者 (guest) を足す (sql/043 は agency / operator だけ)
alter table public.shipment_change_requests drop constraint if exists shipment_change_requests_requested_by_check;
alter table public.shipment_change_requests add constraint shipment_change_requests_requested_by_check
  check (requested_by in ('agency', 'operator', 'guest'));

-- 1区間に進行中の申請は1件まで。運営の訂正の監査記録 (correction) と、旧来の代理店の締切後の申請 (fields) は
-- 対象外 (旧来の経路の動きを段階C まで変えないため)。
create unique index if not exists shipment_change_requests_one_open_per_leg
  on public.shipment_change_requests (shipment_id)
  where stage in ('requested', 'contacted', 'approved') and kind not in ('correction', 'fields');
create index if not exists shipment_change_requests_pickup_idx on public.shipment_change_requests (pickup_request_id);

-- 既存の画面・API (status を読む・書く) との互換: 挿入時は status から stage・kind を補い、
-- 更新時は stage → status を同期する。佐川への連絡が要る申請 (needs_sagawa) は status だけを書き換える
-- 旧来の承認 (change-requests/[id]) を受け付けない。段階の移り方もここで検証する。
create or replace function public.shipment_change_requests_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.kind := coalesce(new.kind, case when new.requested_by = 'operator' and new.status = 'approved' then 'correction' else 'fields' end);
    new.stage := coalesce(new.stage, case new.status when 'pending' then 'requested' when 'approved' then 'applied' else 'rejected' end);
    new.status := case when new.stage in ('requested', 'contacted', 'approved') then 'pending'
                       when new.stage = 'applied' then 'approved' else 'rejected' end;
    if new.apply_txid is not null then raise exception 'change_request_invalid: apply_txid on insert'; end if;
    return new;
  end if;

  -- 旧来の承認 (status だけを変える) は、佐川への連絡が要らない申請だけ。
  if new.stage is not distinct from old.stage and new.status is distinct from old.status then
    if old.needs_sagawa then
      raise exception 'change_request_needs_sagawa: 佐川への連絡が要る申請は、連絡・回答・反映の手順で進めてください';
    end if;
    new.stage := case new.status when 'pending' then old.stage when 'approved' then 'applied' else 'rejected' end;
  end if;

  if new.stage is distinct from old.stage then
    if not (
         (old.stage = 'requested' and new.stage in ('contacted', 'approved', 'rejected', 'withdrawn', 'applied'))
      or (old.stage = 'contacted' and new.stage in ('approved', 'rejected'))
      or (old.stage = 'approved'  and new.stage = 'applied')
    ) then
      raise exception 'change_request_invalid_stage: % → %', old.stage, new.stage;
    end if;
    if old.needs_sagawa and new.stage in ('approved', 'rejected') and old.stage <> 'contacted' then
      raise exception 'change_request_invalid_stage: 佐川への連絡の前に回答は記録できません';
    end if;
    if old.needs_sagawa and new.stage = 'applied' and old.stage <> 'approved' then
      raise exception 'change_request_invalid_stage: 佐川の承認の前に反映できません';
    end if;
    new.status := case when new.stage in ('requested', 'contacted', 'approved') then 'pending'
                       when new.stage = 'applied' then 'approved' else 'rejected' end;
  end if;

  -- 反映中の印は、承認済みの申請にだけ付けられる
  if new.apply_txid is distinct from old.apply_txid and new.apply_txid is not null and old.stage <> 'approved' then
    raise exception 'change_request_invalid: apply_txid requires an approved request';
  end if;
  -- 対象の区間・集荷依頼・中身は、作成後に付け替えさせない
  if new.shipment_id is distinct from old.shipment_id or new.pickup_request_id is distinct from old.pickup_request_id
     or new.kind is distinct from old.kind or new.needs_sagawa is distinct from old.needs_sagawa
     or (old.stage <> 'requested' and new.fields is distinct from old.fields) then
    raise exception 'change_request_immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists shipment_change_requests_guard on public.shipment_change_requests;
create trigger shipment_change_requests_guard
  before insert or update on public.shipment_change_requests
  for each row execute function public.shipment_change_requests_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. 申請の種類ごとに変えてよい項目
create or replace function public.change_kind_allowed_keys(p_kind text)
returns text[] language sql immutable as $$
  select case p_kind
    when 'hotel_guest'    then array['to_hotel', 'to_hotel_ja', 'to_place_id', 'to_city', 'to_prefecture']
    when 'hotel_pickup'   then array['from_hotel', 'from_hotel_ja', 'from_place_id', 'from_city', 'from_prefecture']
    when 'dates'          then array['shipment_date', 'expected_arrival', 'delivery_time']
    when 'count'          then array['suitcase_count']
    when 'representative' then array['representative', 'recipient']
    when 'cancel'         then array[]::text[]
    when 'number'         then array[]::text[]
    when 'rearrange'      then array['suitcase_count', 'shipment_date', 'expected_arrival', 'delivery_time']
    else null end;
$$;

-- 集荷依頼中に守る項目 (佐川に渡す内容)。'cancel' は status の取消への変更を表す。
create or replace function public.pickup_locked_changes(o public.shipments, n public.shipments)
returns text[] language sql immutable as $$
  select array_remove(array[
    case when n.shipment_date    is distinct from o.shipment_date    then 'shipment_date' end,
    case when n.expected_arrival is distinct from o.expected_arrival then 'expected_arrival' end,
    case when n.delivery_time    is distinct from o.delivery_time    then 'delivery_time' end,
    case when n.suitcase_count   is distinct from o.suitcase_count   then 'suitcase_count' end,
    case when n.from_hotel       is distinct from o.from_hotel       then 'from_hotel' end,
    case when n.from_hotel_ja    is distinct from o.from_hotel_ja    then 'from_hotel_ja' end,
    case when n.from_place_id    is distinct from o.from_place_id    then 'from_place_id' end,
    case when n.from_city        is distinct from o.from_city        then 'from_city' end,
    case when n.from_prefecture  is distinct from o.from_prefecture  then 'from_prefecture' end,
    case when n.from_residence   is distinct from o.from_residence   then 'from_residence' end,
    case when n.to_hotel         is distinct from o.to_hotel         then 'to_hotel' end,
    case when n.to_hotel_ja      is distinct from o.to_hotel_ja      then 'to_hotel_ja' end,
    case when n.to_place_id      is distinct from o.to_place_id      then 'to_place_id' end,
    case when n.to_city          is distinct from o.to_city          then 'to_city' end,
    case when n.to_prefecture    is distinct from o.to_prefecture    then 'to_prefecture' end,
    case when n.to_residence     is distinct from o.to_residence     then 'to_residence' end,
    case when n.representative   is distinct from o.representative   then 'representative' end,
    case when n.recipient        is distinct from o.recipient        then 'recipient' end,
    case when n.status = 'cancelled' and o.status is distinct from 'cancelled' then 'cancel' end,
    -- 問い合わせ番号: 最初の番号の記入 (空 → 番号) は止めない。入っている番号の書き換え・削除だけを止める
    -- (番号の変更は佐川の回答を記録した変更申請 = number_policy 'changed' の反映だけ)
    case when jsonb_typeof(o.tracking_numbers) = 'array' and jsonb_array_length(o.tracking_numbers) > 0
              and n.tracking_numbers is distinct from o.tracking_numbers then 'tracking_numbers' end
  ], null);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. shipments のトリガー
create or replace function public.shipments_pickup_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_changed text[];
  v_live uuid;
  c public.shipment_change_requests;
  v_allowed text[];
begin
  -- 取消済みの区間には番号を書かせない (経路を問わない)
  if new.status = 'cancelled'
     and jsonb_typeof(new.tracking_numbers) = 'array' and jsonb_array_length(new.tracking_numbers) > 0
     and new.tracking_numbers is distinct from old.tracking_numbers then
    raise exception 'pickup_lock_cancelled_number: 取消済みの区間に問い合わせ番号は保存できません';
  end if;

  -- 集荷済み以降は対象外
  if old.status not in ('requested', 'pending', 'issued') then return new; end if;

  v_changed := public.pickup_locked_changes(old, new);
  if coalesce(array_length(v_changed, 1), 0) = 0 then return new; end if;

  -- 行ロックの後に読むので、同時に確保された依頼も見える (READ COMMITTED・文ごとの新しいスナップショット)
  select r.id into v_live from public.pickup_requests r
   where r.shipment_id = new.id and r.state in ('sending', 'accepted', 'unknown', 'needs_review', 'change_pending')
   limit 1;
  if v_live is null then return new; end if;

  -- 例外: このトランザクションで反映中の、佐川が承認した申請があり、変える項目がその申請の項目だけ
  select * into c from public.shipment_change_requests x
   where x.shipment_id = new.id and x.stage = 'approved' and x.needs_sagawa
     and x.pickup_request_id = v_live and x.apply_txid = txid_current()
   limit 1;
  if found then
    v_allowed := public.change_kind_allowed_keys(c.kind);
    if c.kind = 'cancel' then v_allowed := array['cancel']; end if;
    if c.number_policy = 'changed' then v_allowed := v_allowed || array['tracking_numbers']; end if;
    if v_allowed is not null and v_changed <@ v_allowed then
      return new;
    end if;
    raise exception 'pickup_lock_field: 申請 (%) で変えられない項目です: %', c.kind, array_to_string(v_changed, ', ');
  end if;

  raise exception 'pickup_request_live: 佐川へ集荷依頼済みの区間です。変更申請から進めてください (変更しようとした項目: %)',
    array_to_string(v_changed, ', ');
end;
$$;

drop trigger if exists shipments_pickup_lock on public.shipments;
create trigger shipments_pickup_lock
  before update on public.shipments
  for each row execute function public.shipments_pickup_lock();

-- 本番移行 (2026-11-04 谷口さん指示): ロックは無効で作り、アプリの切替後に sql/072 で有効にする。
-- 無効の間は sql/067 の一時停止スイッチで集荷依頼の記録・送信も止まっている (有効な依頼が新しく増えない)。
-- 再実行しても、sql/072 で有効化済み (lock_enabled=true) なら有効のまま。
do $$
begin
  if not coalesce((select lock_enabled from public.pickup_request_settings where id), false) then
    alter table public.shipments disable trigger shipments_pickup_lock;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. 申請の登録・段階・反映 (sql/067 の受付後の変更を一般化して置き換える)

-- 問い合わせ番号が他の区間で使われていないか (shipments の番号・集荷依頼の記録の両方)
-- 顧客側採番 (sql/078) の台帳があれば、ほかの区間に払い出した番号も「使用中」に含める。
-- 台帳は 078 で作るので、ここでは表があるときだけ見る (068 と 078 をどの順で流し直しても同じ判定になる)。
create or replace function public.pickup_number_in_use(p_number text, p_shipment_id uuid)
returns boolean language plpgsql stable as $$
declare
  v boolean;
begin
  if exists (
    select 1 from public.shipments x
     where x.id <> p_shipment_id and jsonb_typeof(x.tracking_numbers) = 'array'
       and x.tracking_numbers ? p_number
  ) or exists (
    select 1 from public.pickup_requests r
     where r.shipment_id <> p_shipment_id and r.shipping_number = p_number
       and r.state not in ('void', 'failed')
  ) then
    return true;
  end if;
  if to_regclass('public.pickup_number_ledger') is not null then
    execute 'select exists (select 1 from public.pickup_number_ledger l where l.number = $1 and l.shipment_id <> $2)'
       into v using p_number, p_shipment_id;
    return coalesce(v, false);
  end if;
  return false;
end;
$$;

-- 申請の登録。集荷依頼が受付済みなら needs_sagawa=true (世田谷へ連絡 → 佐川の回答 → 反映)、
-- 依頼前なら needs_sagawa=false (運営の判断で承認 → 反映)。送信中・結果不明・要確認・変更対応中の依頼がある区間は受けない。
create or replace function public.create_shipment_change(
  p_shipment_id uuid, p_kind text, p_fields jsonb, p_reason text,
  p_source text, p_requester text, p_actor text
) returns table (ok boolean, change_id uuid, reason text)
language plpgsql security definer set search_path = public as $$
declare
  s public.shipments;
  r public.pickup_requests;
  v_allowed text[] := public.change_kind_allowed_keys(p_kind);
  v_fields jsonb := coalesce(p_fields, '{}'::jsonb);
  v_key text;
  v_before jsonb := '{}'::jsonb;
  v_id uuid;
  v_count int;
begin
  if v_allowed is null or p_kind in ('fields', 'correction') then
    return query select false, null::uuid, 'invalid_kind'::text; return;
  end if;
  -- guest = B2C の旅行者 (My Booking からの取消の希望。sql/071 の b2c_request_cancel だけが使う)
  if p_source not in ('agency', 'operator', 'guest') then return query select false, null::uuid, 'invalid_source'::text; return; end if;
  if btrim(coalesce(p_reason, '')) = '' then return query select false, null::uuid, 'reason_required'::text; return; end if;
  if jsonb_typeof(v_fields) <> 'object' then return query select false, null::uuid, 'invalid_fields'::text; return; end if;
  for v_key in select jsonb_object_keys(v_fields) loop
    if not (v_key = any (v_allowed)) then
      return query select false, null::uuid, ('field_not_allowed:' || v_key)::text; return;
    end if;
  end loop;
  if p_kind not in ('cancel', 'number') and v_fields = '{}'::jsonb then
    return query select false, null::uuid, 'fields_required'::text; return;
  end if;
  if p_kind = 'hotel_guest' and (btrim(coalesce(v_fields->>'to_hotel', '')) = '' or btrim(coalesce(v_fields->>'to_place_id', '')) = '') then
    return query select false, null::uuid, 'hotel_required'::text; return;
  end if;
  if p_kind = 'hotel_pickup' and (btrim(coalesce(v_fields->>'from_hotel', '')) = '' or btrim(coalesce(v_fields->>'from_place_id', '')) = '') then
    return query select false, null::uuid, 'hotel_required'::text; return;
  end if;
  if v_fields ? 'suitcase_count' then
    begin
      v_count := (v_fields->>'suitcase_count')::int;
    exception when others then
      return query select false, null::uuid, 'invalid_count'::text; return;
    end;
    if v_count < 1 or v_count > 99 then return query select false, null::uuid, 'invalid_count'::text; return; end if;
  end if;
  begin
    if v_fields ? 'shipment_date' then perform (v_fields->>'shipment_date')::date; end if;
    if v_fields ? 'expected_arrival' then perform (v_fields->>'expected_arrival')::date; end if;
  exception when others then
    return query select false, null::uuid, 'invalid_date'::text; return;
  end;
  if p_kind = 'representative' and btrim(coalesce(v_fields->>'representative', '')) = '' then
    return query select false, null::uuid, 'representative_required'::text; return;
  end if;

  select * into s from public.shipments where id = p_shipment_id for update;
  if not found then return query select false, null::uuid, 'shipment_not_found'::text; return; end if;
  if s.status = 'cancelled' then return query select false, null::uuid, 'shipment_cancelled'::text; return; end if;
  if s.status not in ('requested', 'pending', 'issued') then
    return query select false, null::uuid, 'picked_up_or_later'::text; return;
  end if;

  select * into r from public.pickup_requests x
   where x.shipment_id = p_shipment_id and x.state in ('sending', 'accepted', 'unknown', 'needs_review', 'change_pending')
   for update;
  if found and r.state <> 'accepted' then
    return query select false, null::uuid, ('request_' || r.state)::text; return;
  end if;
  if not found and p_kind in ('number', 'rearrange') then
    return query select false, null::uuid, 'no_live_request'::text; return;
  end if;

  select coalesce(jsonb_object_agg(k, to_jsonb(s) -> k), '{}'::jsonb) into v_before
    from jsonb_object_keys(v_fields) k;

  begin
    insert into public.shipment_change_requests
      (shipment_id, booking_id, leg_index, requested_by, requester, agency, fields, before, reason,
       kind, stage, pickup_request_id, needs_sagawa, requested_actor, large_lot)
    values
      (s.id, s.booking_id, s.leg_index, p_source, p_requester, s.agency, v_fields, v_before, btrim(p_reason),
       p_kind, 'requested', r.id, r.id is not null, p_actor, coalesce(v_count, 0) >= 20)
    returning id into v_id;
  exception when unique_violation then
    return query select false, null::uuid, 'open_change_exists'::text; return;
  end;
  return query select true, v_id, 'created'::text;
end;
$$;

-- 連絡・回答・取り下げ。佐川への連絡が要る申請は contact → approve/reject。要らない申請は approve/reject を直接。
create or replace function public.step_shipment_change(
  p_change_id uuid, p_step text, p_actor text, p_note text, p_number_policy text, p_new_number text
) returns table (ok boolean, stage text, reason text)
language plpgsql security definer set search_path = public as $$
declare
  c public.shipment_change_requests;
  r public.pickup_requests;
  v_num text := nullif(regexp_replace(coalesce(p_new_number, ''), '[^0-9]', '', 'g'), '');
begin
  select * into c from public.shipment_change_requests where id = p_change_id for update;
  if not found or c.kind = 'correction' then return query select false, null::text, 'not_found'::text; return; end if;
  if btrim(coalesce(p_actor, '')) = '' then return query select false, c.stage, 'actor_required'::text; return; end if;
  if c.pickup_request_id is not null then
    select * into r from public.pickup_requests where id = c.pickup_request_id for update;
  end if;

  if p_step = 'withdraw' then
    if c.stage <> 'requested' then return query select false, c.stage, 'state_mismatch'::text; return; end if;
    update public.shipment_change_requests set stage = 'withdrawn', answer_note = p_note, answered_by = p_actor, answered_at = now(),
           decided_by = p_actor, decided_at = now(), decision_note = p_note
     where id = c.id;
    return query select true, 'withdrawn'::text, 'ok'::text; return;
  end if;

  if btrim(coalesce(p_note, '')) = '' then return query select false, c.stage, 'note_required'::text; return; end if;

  if p_step = 'contact' then
    if not c.needs_sagawa then return query select false, c.stage, 'contact_not_needed'::text; return; end if;
    if c.stage <> 'requested' then return query select false, c.stage, 'state_mismatch'::text; return; end if;
    if r.state <> 'accepted' then return query select false, c.stage, ('request_' || r.state)::text; return; end if;
    update public.shipment_change_requests set stage = 'contacted', contacted_by = p_actor, contact_note = p_note, contacted_at = now()
     where id = c.id;
    update public.pickup_requests set state = 'change_pending', updated_at = now(),
           note = concat_ws(E'\n', note, p_actor || ': 変更申請 (' || c.kind || ') を世田谷へ連絡 (' || p_note || ')')
     where id = r.id;
    return query select true, 'contacted'::text, 'ok'::text; return;
  end if;

  if p_step = 'approve' then
    if c.needs_sagawa and c.stage <> 'contacted' then return query select false, c.stage, 'state_mismatch'::text; return; end if;
    if not c.needs_sagawa and c.stage <> 'requested' then return query select false, c.stage, 'state_mismatch'::text; return; end if;
    if c.needs_sagawa then
      if coalesce(p_number_policy, '') not in ('kept', 'changed') then
        return query select false, c.stage, 'number_policy_required'::text; return;
      end if;
      if c.kind in ('cancel', 'rearrange') and p_number_policy = 'changed' then
        return query select false, c.stage, 'number_not_expected'::text; return;
      end if;
      if p_number_policy = 'changed' then
        if v_num is null or v_num !~ '^[0-9]{10,12}$' then return query select false, c.stage, 'invalid_number'::text; return; end if;
        if v_num = r.shipping_number then return query select false, c.stage, 'same_number'::text; return; end if;
        if public.pickup_number_in_use(v_num, c.shipment_id) then return query select false, c.stage, 'number_in_use'::text; return; end if;
      end if;
      if p_number_policy = 'kept' and v_num is not null then return query select false, c.stage, 'number_not_expected'::text; return; end if;
      if c.kind = 'number' and p_number_policy <> 'changed' then return query select false, c.stage, 'number_policy_required'::text; return; end if;
    end if;
    update public.shipment_change_requests set stage = 'approved',
           number_policy = case when c.needs_sagawa then p_number_policy end,
           new_shipping_number = case when p_number_policy = 'changed' then v_num end,
           answered_by = p_actor, answer_note = p_note, answered_at = now(),
           decided_by = p_actor, decided_at = now(), decision_note = p_note
     where id = c.id;
    return query select true, 'approved'::text, 'ok'::text; return;
  end if;

  if p_step = 'reject' then
    if c.needs_sagawa and c.stage <> 'contacted' then return query select false, c.stage, 'state_mismatch'::text; return; end if;
    if not c.needs_sagawa and c.stage <> 'requested' then return query select false, c.stage, 'state_mismatch'::text; return; end if;
    update public.shipment_change_requests set stage = 'rejected', answered_by = p_actor, answer_note = p_note, answered_at = now(),
           decided_by = p_actor, decided_at = now(), decision_note = p_note
     where id = c.id;
    if c.needs_sagawa then
      -- 佐川が変更を受けなかった = 元の依頼のまま有効。区間の情報は変えない。
      update public.pickup_requests set state = 'accepted', updated_at = now(),
             note = concat_ws(E'\n', note, p_actor || ': 変更申請 (' || c.kind || ') は佐川の回答で不可 (' || p_note || ')')
       where pickup_requests.id = r.id and pickup_requests.state = 'change_pending';
    end if;
    return query select true, 'rejected'::text, 'ok'::text; return;
  end if;

  return query select false, c.stage, 'invalid_step'::text;
end;
$$;

-- 承認済みの申請を区間へ反映する (1トランザクション)。トリガーの例外はこの関数の中だけで成り立つ:
-- 申請の行に apply_txid = 今のトランザクション を付けてから区間を更新し、最後に applied にする。
-- 取消の反映の差し込み口。区間が他の仕組み (B2C の予約) にも属するとき、その仕組みの取消を同じトランザクションで行う。
-- 既定は何もしない (false = この区間は B2B だけ)。sql/071 が B2C 用に置き換える。
-- 再実行で置き換え済みの中身を既定に戻さないよう、無いときだけ作る。
do $$
begin
  if to_regprocedure('public.shipment_cancel_hook(uuid, uuid, text)') is null then
    execute $f$
      create function public.shipment_cancel_hook(p_shipment_id uuid, p_change_id uuid, p_actor text)
      returns boolean language plpgsql security definer set search_path = public as $b$
      begin
        return false;
      end;
      $b$
    $f$;
  end if;
end $$;
revoke all on function public.shipment_cancel_hook(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.apply_shipment_change(p_change_id uuid, p_actor text)
returns table (ok boolean, reason text, hotel_change_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  c public.shipment_change_requests;
  r public.pickup_requests;
  s public.shipments;
  f jsonb;
  v_hc uuid;
  v_cancel_task boolean;
  v_side text;
begin
  if btrim(coalesce(p_actor, '')) = '' then return query select false, 'actor_required'::text, null::uuid; return; end if;
  select * into c from public.shipment_change_requests where id = p_change_id for update;
  if not found or c.kind in ('fields', 'correction') then return query select false, 'not_found'::text, null::uuid; return; end if;
  if c.stage <> 'approved' then return query select false, ('state_' || c.stage)::text, null::uuid; return; end if;
  select * into s from public.shipments where id = c.shipment_id for update;
  if s.status = 'cancelled' then return query select false, 'shipment_cancelled'::text, null::uuid; return; end if;
  if s.status not in ('requested', 'pending', 'issued') then return query select false, 'picked_up_or_later'::text, null::uuid; return; end if;

  if c.needs_sagawa then
    select * into r from public.pickup_requests where id = c.pickup_request_id for update;
    if r.state <> 'change_pending' then return query select false, ('request_' || r.state)::text, null::uuid; return; end if;
    -- 申請の後に別の依頼に置き換わっていないか (有効な依頼はこの1件だけのはず)
    if exists (select 1 from public.pickup_requests x where x.shipment_id = s.id and x.id <> r.id
                 and x.state in ('sending', 'accepted', 'unknown', 'needs_review', 'change_pending')) then
      return query select false, 'request_replaced'::text, null::uuid; return;
    end if;
    if c.number_policy = 'changed' and public.pickup_number_in_use(c.new_shipping_number, c.shipment_id) then
      return query select false, 'number_in_use'::text, null::uuid; return;
    end if;
  else
    -- 申請の後に集荷依頼が入っていたら、佐川への連絡が要る申請として出し直してもらう
    if exists (select 1 from public.pickup_requests x where x.shipment_id = s.id
                 and x.state in ('sending', 'accepted', 'unknown', 'needs_review', 'change_pending')) then
      return query select false, 'request_now_live'::text, null::uuid; return;
    end if;
  end if;

  f := c.fields;
  update public.shipment_change_requests set apply_txid = txid_current(),
         old_shipping_number = r.shipping_number,
         old_tracking_numbers = s.tracking_numbers,
         old_tracking_detail = case when c.number_policy = 'changed' then s.tracking_detail end
   where id = c.id;

  v_side := case c.kind when 'hotel_guest' then 'guest' when 'hotel_pickup' then 'pickup' end;
  if v_side = 'guest' then
    v_cancel_task := s.guest_hotel_notified_at is not null;
    update public.shipments set
      to_hotel = f->>'to_hotel', to_hotel_ja = f->>'to_hotel_ja', to_place_id = f->>'to_place_id',
      to_city = coalesce(f->>'to_city', to_city), to_prefecture = f->>'to_prefecture',
      guest_hotel_notified_at = null,
      hotel_contact_info = coalesce(hotel_contact_info, '{}'::jsonb) - 'guest',
      updated_at = now()
    where id = s.id;
  elsif v_side = 'pickup' then
    v_cancel_task := s.pickup_hotel_notified_at is not null;
    update public.shipments set
      from_hotel = f->>'from_hotel', from_hotel_ja = f->>'from_hotel_ja', from_place_id = f->>'from_place_id',
      from_city = coalesce(f->>'from_city', from_city), from_prefecture = f->>'from_prefecture',
      pickup_hotel_notified_at = null,
      hotel_contact_info = coalesce(hotel_contact_info, '{}'::jsonb) - 'pickup',
      updated_at = now()
    where id = s.id;
  end if;
  if v_side is not null then
    insert into public.shipment_hotel_changes(
      shipment_id, booking_id, leg_index, side, old_hotel, new_hotel, old_hotel_ja, new_hotel_ja, old_place_id, new_place_id,
      over_deadline, reason, old_slip_task, old_hotel_cancel_task, changed_by, agency
    ) values (
      s.id, s.booking_id, s.leg_index, v_side,
      case v_side when 'guest' then s.to_hotel else s.from_hotel end,
      case v_side when 'guest' then f->>'to_hotel' else f->>'from_hotel' end,
      case v_side when 'guest' then s.to_hotel_ja else s.from_hotel_ja end,
      case v_side when 'guest' then f->>'to_hotel_ja' else f->>'from_hotel_ja' end,
      case v_side when 'guest' then s.to_place_id else s.from_place_id end,
      case v_side when 'guest' then f->>'to_place_id' else f->>'from_place_id' end,
      false,
      case when c.needs_sagawa then '集荷依頼の受付後の変更 (佐川の回答: ' || coalesce(c.answer_note, '') || ')' else coalesce(c.reason, '') end,
      false, coalesce(v_cancel_task, false), 'operator:' || p_actor, s.agency)
    returning id into v_hc;
  end if;

  if c.kind in ('dates', 'count', 'rearrange') then
    update public.shipments set
      shipment_date    = case when f ? 'shipment_date'    then (f->>'shipment_date')::date    else shipment_date end,
      expected_arrival = case when f ? 'expected_arrival' then (f->>'expected_arrival')::date else expected_arrival end,
      delivery_time    = case when f ? 'delivery_time'    then f->>'delivery_time'            else delivery_time end,
      suitcase_count   = case when f ? 'suitcase_count'   then (f->>'suitcase_count')::int    else suitcase_count end,
      updated_at = now()
    where id = s.id;
  end if;

  if c.kind = 'representative' then
    update public.shipments set
      representative = f->>'representative',
      recipient = coalesce(f->>'recipient', recipient),
      updated_at = now()
    where id = s.id;
  end if;

  if c.kind = 'cancel' then
    -- 佐川の取消確認を反映: 先に集荷依頼の記録を取消にし (有効な依頼が無くなる)、
    -- B2C の予約なら予約・通知・請求の取消を b2c 側の関数で行う (区間の取消もそこで行う)。
    if c.needs_sagawa then
      update public.pickup_requests p set state = 'cancelled', resolved_by = p_actor, resolved_at = now(), updated_at = now(),
             note = concat_ws(E'\n', p.note, p_actor || ': 佐川の取消確認を記録 (区間を取消)')
       where p.id = r.id;
    end if;
    perform public.shipment_cancel_hook(s.id, c.id, p_actor);
    update public.shipments set status = 'cancelled', cancelled_at = now(),
           cancelled_by = 'operator:' || p_actor,
           cancel_source = case when c.needs_sagawa then 'sagawa_confirmed' else 'change_request' end,
           updated_at = now()
     where id = s.id;
  end if;

  if c.number_policy = 'changed' then
    update public.shipments set tracking_numbers = jsonb_build_array(c.new_shipping_number), tracking_detail = null,
           tracking_limit_reached = false, updated_at = now()
     where id = s.id;
  end if;

  if c.needs_sagawa then
    if c.kind = 'cancel' then
      null;  -- 依頼記録の取消は上 (区間の取消の前) で済ませた
    elsif c.kind = 'rearrange' then
      -- 佐川の回答で個別再手配。今の依頼記録だけ取消にし、運営が手動 (Excel・電話) で新しく依頼して記録する
      -- (区間は未依頼に戻る)。
      update public.pickup_requests p set state = 'cancelled', resolved_by = p_actor, resolved_at = now(), updated_at = now(),
             note = concat_ws(E'\n', p.note, p_actor || ': 佐川の回答で個別再手配 (今の依頼は取消・手動で新しく依頼)')
       where p.id = r.id;
      update public.shipments set pickup_requested_at = null where id = s.id;
    else
      update public.pickup_requests p set
        state = 'accepted',
        shipping_number = case when c.number_policy = 'changed' then c.new_shipping_number else p.shipping_number end,
        request_snapshot = (select public.pickup_snapshot_json(y) from public.shipments y where y.id = s.id),
        resolved_by = p_actor, resolved_at = now(), updated_at = now(),
        note = concat_ws(E'\n', p.note, p_actor || ': 変更申請 (' || c.kind || ') を反映'
               || case when c.number_policy = 'changed' then ' (問合番号 ' || coalesce(r.shipping_number, '-') || ' → ' || c.new_shipping_number || ')' else ' (問合番号は維持)' end)
      where p.id = r.id;
    end if;
  end if;

  update public.shipment_change_requests set stage = 'applied', applied_by = p_actor, applied_at = now(), hotel_change_id = v_hc
   where id = c.id;
  return query select true, 'applied'::text, v_hc;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. 実行権限: サーバ (service_role) だけ。匿名・代理店のロールからは呼べない。
revoke all on function public.create_shipment_change(uuid, text, jsonb, text, text, text, text) from public, anon, authenticated;
revoke all on function public.step_shipment_change(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.apply_shipment_change(uuid, text) from public, anon, authenticated;
revoke all on function public.pickup_number_in_use(text, uuid) from public, anon, authenticated;
revoke all on function public.shipments_pickup_lock() from public, anon, authenticated;
revoke all on function public.shipment_change_requests_guard() from public, anon, authenticated;
grant execute on function public.create_shipment_change(uuid, text, jsonb, text, text, text, text) to service_role;
grant execute on function public.step_shipment_change(uuid, text, text, text, text, text) to service_role;
grant execute on function public.apply_shipment_change(uuid, text) to service_role;
grant execute on function public.pickup_number_in_use(text, uuid) to service_role;
