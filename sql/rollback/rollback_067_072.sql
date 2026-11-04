-- 段階A〜C と B2C 締切 (sql/067〜072) の本番適用の切り戻し (緊急時のみ・承認のうえで実行)。未実行。
-- 前提: 先に sql/rollback/pause_pickup_lock.sql (ロック無効・集荷依頼の記録を停止) → アプリを統合前のデプロイへ戻す
--       (Vercel の Instant Rollback)。古いアプリは pickup_requests・変更申請の新しい列・施設台帳を使わない。
-- 戻す順番は適用の逆: 072 (pause_pickup_lock) → 070 → 078 → 076 → 075 → 071 → 068 → 069 → 067。
-- B2C の土台 (sql/061・062) はここでは消さない (B2C は機能フラグで閉じる。061・062 の切り戻しは B2C 側の手順)。
-- データは消す前に *_rollback_backup に写す (後で調べる・やり直すため)。

begin;

-- 移行の表の確保 (2026-11-04 デッドロック対策・切り戻し)。関係する表を「待たずに」まとめて掴む (nowait)。
-- 掴めなければ何も持たずに 0.2秒待って掴み直す (待っている間は表を持たないので、利用者の操作とデッドロックしない)。
-- 掴んだ後は、この SQL が終わるまで (1秒未満) 利用者の操作のほうが待つだけで、失敗しない。
-- 10秒たっても掴めなければ、何も変えずに失敗する (少し待って流し直す)。1つのトランザクションの中で流すこと。
do $migration_lock$
declare
  i int;
  targets text;
begin
  -- 存在する表だけ (例: 067 の前は pickup_requests が無い)
  select string_agg(t, ', ') into targets from unnest(array['public.shipments', 'public.pickup_requests', 'public.shipment_change_requests', 'public.operator_passkeys']) t where to_regclass(t) is not null;
  if targets is null then return; end if;
  for i in 1..50 loop
    begin
      execute format('lock table %s in access exclusive mode nowait', targets);
      return;
    exception when lock_not_available then
      perform pg_sleep(0.2);
    end;
  end loop;
  raise exception 'migration: 表 (%) を10秒以内に確保できませんでした。何も変えていません。少し待って流し直してください', targets;
end $migration_lock$;

-- ── 072: ロック無効・記録の停止 (pause_pickup_lock.sql を先に流していれば何も変わらない)
alter table public.shipments disable trigger shipments_pickup_lock;

-- ── 070: 変更受付締切を元の値に戻す
update public.shipments s set change_deadline_at = b.change_deadline_at
  from public.change_deadline_backup_070 b where b.shipment_id = s.id;

-- ── 078: 顧客側採番 (番号範囲・台帳は写してから消す。採番を記録した列も消す)
do $$ begin
  if to_regclass('public.pickup_number_ledger') is not null then
    execute 'create table if not exists public.pickup_number_ledger_rollback_backup as select * from public.pickup_number_ledger';
    execute 'create table if not exists public.pickup_number_ranges_rollback_backup as select * from public.pickup_number_ranges';
  end if;
end $$;
drop trigger if exists pickup_requests_numbering_ins on public.pickup_requests;
drop trigger if exists pickup_requests_numbering_upd on public.pickup_requests;
drop trigger if exists pickup_requests_numbering_guard on public.pickup_requests;
drop function if exists public.pickup_requests_numbering();
drop function if exists public.pickup_set_assigned_number(uuid, text);
drop function if exists public.pickup_leg_number(uuid, text);
drop function if exists public.pickup_retire_number(text, text);
drop function if exists public.sagawa_check_digit_ok(text);
drop table if exists public.pickup_number_ledger;
drop table if exists public.pickup_number_ranges;
do $$ begin
  if to_regclass('public.pickup_requests') is not null then
    execute 'alter table public.pickup_requests drop column if exists assigned_number';
  end if;
end $$;

-- ── 076: 代理店の変更の一括反映 (古いアプリは使わない)
drop function if exists public.agency_change_atomic(uuid, jsonb, text, jsonb, jsonb, text, text, text);

-- ── 075: 集荷依頼の監視の通知済みの記録 (写してから消す)
do $$ begin
  if to_regclass('public.pickup_watch_alerts') is not null then
    execute 'create table if not exists public.pickup_watch_alerts_rollback_backup as select * from public.pickup_watch_alerts';
  end if;
end $$;
drop function if exists public.pickup_watch_claim(text[]);
drop table if exists public.pickup_watch_alerts;

-- ── 071: B2C の確定・取消を sql/062_b2c_stage4.sql の版に戻し、取消申請の関数を消す
--         (071 の版は pickup_requests を参照するので、067 を消す前に戻す)
drop function if exists public.b2c_request_cancel(uuid, text, text, text, text);
create or replace function public.b2c_confirm_order(p_order_id uuid) returns boolean language plpgsql as $$
declare
  o         public.b2c_orders%rowtype;
  hotels_ok boolean;
  n         int;
begin
  select * into o from public.b2c_orders where id = p_order_id for update;
  if not found then return false; end if;
  if o.status not in ('card_pending', 'awaiting_hotel_confirmation') or o.cancelled_at is not null then return false; end if;
  if o.card_status <> 'registered' or o.consented_at is null then return false; end if;
  if o.confirmation_due_at is not null and now() > o.confirmation_due_at then return false; end if;

  if o.confirmation_mode = 'awaiting_hotel_acceptance' then
    select count(*) = 2 into hotels_ok from public.b2c_hotel_acceptances
     where order_id = o.id and status = 'accepted';
  else
    select count(*) = 2 into hotels_ok from public.b2c_facilities
     where place_id in (o.origin_place_id, o.dest_place_id) and status = 'verified';
  end if;
  if not hotels_ok then
    update public.b2c_orders set status = 'awaiting_hotel_confirmation' where id = o.id and status = 'card_pending';
    get diagnostics n = row_count;
    if n = 1 then
      insert into public.b2c_order_events(order_id, event, actor_type, before_state, after_state)
      values (o.id, 'awaiting_hotel_confirmation', 'system', jsonb_build_object('status', o.status),
              jsonb_build_object('status', 'awaiting_hotel_confirmation', 'confirmation_due_at', o.confirmation_due_at));
      insert into public.b2c_outbox(order_id, kind, channel, dedupe_key, language) values
        (o.id, 'awaiting_hotel', 'email',    'awaiting_hotel:' || o.id || ':email', o.language),
        (o.id, 'awaiting_hotel', 'whatsapp', 'awaiting_hotel:' || o.id || ':whatsapp', o.language)
      on conflict (dedupe_key) do nothing;
    end if;
    return false;
  end if;

  update public.b2c_orders set status = 'confirmed', confirmed_at = now() where id = o.id;

  insert into public.shipments (
    booking_id, leg_index, agency, representative, traveler_count, shipment_date, expected_arrival,
    change_deadline_at, from_hotel, from_place_id, origin_check_in, to_hotel, to_place_id, from_check_in, to_check_out,
    recipient, suitcase_count, amount_yen, status, carrier, guest_language, pickup_time,
    channel, b2c_order_id, route_class, unit_net_yen, price_rule_version
  ) values (
    'B2C-' || o.order_number, 0, 'BondEx Direct', o.guest_name, 1, o.pickup_date, o.delivery_date,
    ((o.pickup_date - 1)::text || 'T08:00:00Z')::timestamptz,
    o.origin_snapshot->>'name', o.origin_place_id, (o.origin_snapshot->>'check_in')::date,
    o.dest_snapshot->>'name', o.dest_place_id, (o.dest_snapshot->>'check_in')::date, (o.dest_snapshot->>'check_out')::date,
    o.guest_name, o.pieces, o.subtotal_net_yen, 'issued', 'sagawa', o.language, '11',
    'b2c', o.id, o.route_class, o.unit_net_yen, o.price_rule_version
  );

  insert into public.b2c_order_events(order_id, event, actor_type, before_state, after_state)
  values (o.id, 'booking_confirmed', 'system', jsonb_build_object('status', o.status), jsonb_build_object('status', 'confirmed'));

  insert into public.b2c_outbox(order_id, kind, channel, dedupe_key, language) values
    (o.id, 'booking_confirmed', 'email',    'booking_confirmed:' || o.id || ':email', o.language),
    (o.id, 'booking_confirmed', 'whatsapp', 'booking_confirmed:' || o.id || ':whatsapp', o.language)
  on conflict (dedupe_key) do nothing;
  return true;
end $$;


create or replace function public.b2c_cancel_order(
  p_order_id uuid, p_reason text, p_actor_type text,
  p_operator_email text default null, p_credential_id text default null, p_note text default null,
  p_expect_status text default null
) returns text language plpgsql as $$
declare
  o   public.b2c_orders%rowtype;
  s   public.shipments%rowtype;
  had_ship boolean := false;
begin
  if p_reason not in ('guest', 'hotel_refused', 'hotel_unsupported', 'confirmation_timeout', 'card_timeout', 'ops') then
    raise exception 'b2c_cancel_order: unknown reason %', p_reason;
  end if;
  select * into o from public.b2c_orders where id = p_order_id for update;
  if not found then return 'not_found'; end if;
  if o.status = 'cancelled' then return 'already_cancelled'; end if;
  if o.status = 'completed' then return 'not_cancellable'; end if;
  if p_expect_status is not null and o.status <> p_expect_status then return 'state_changed'; end if;
  if p_reason = 'card_timeout' and o.card_status = 'registered' then return 'state_changed'; end if;

  select * into s from public.shipments where b2c_order_id = o.id for update;
  if found then
    had_ship := true;
    if s.status not in ('requested', 'pending', 'issued', 'failed') then
      return 'not_cancellable';  -- 集荷済み以降は運営の判断（佐川との調整・請求）
    end if;
    update public.shipments set status = 'cancelled' where id = s.id;
  end if;

  update public.b2c_orders
     set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason,
         cancelled_by = coalesce(p_operator_email, p_actor_type)
   where id = o.id;

  insert into public.b2c_order_events(order_id, shipment_id, event, actor_type, operator_email, credential_id, reason, before_state, after_state)
  values (o.id, case when had_ship then s.id end, 'cancelled', p_actor_type, p_operator_email, p_credential_id,
          coalesce(p_note, p_reason),
          jsonb_build_object('status', o.status, 'shipment_status', case when had_ship then s.status end),
          jsonb_build_object('status', 'cancelled', 'reason', p_reason));

  -- まだ送っていない通知（確定・確認待ち・リマインド）は送らない
  update public.b2c_outbox set status = 'cancelled', last_error = 'order_cancelled'
   where order_id = o.id and status = 'pending' and kind <> 'cancelled';

  insert into public.b2c_outbox(order_id, kind, channel, dedupe_key, language) values
    (o.id, 'cancelled', 'email',    'cancelled:' || o.id || ':email', o.language),
    (o.id, 'cancelled', 'whatsapp', 'cancelled:' || o.id || ':whatsapp', o.language)
  on conflict (dedupe_key) do nothing;
  return 'cancelled';
end $$;


-- ── 068: トリガー・関数を外し、変更申請の表を元の形に戻す
drop trigger if exists shipments_pickup_lock on public.shipments;
drop trigger if exists shipment_change_requests_guard on public.shipment_change_requests;
create table if not exists public.shipment_change_requests_rollback_backup as
  select * from public.shipment_change_requests where kind not in ('fields', 'correction');
-- 段階C の申請 (kind つき) は旧画面で扱えないので、未処理のものは却下扱いにして残す
update public.shipment_change_requests set status = 'rejected', decision_note = coalesce(decision_note, '') || ' [切り戻しで却下扱い]'
 where kind not in ('fields', 'correction') and status = 'pending';
drop function if exists public.apply_shipment_change(uuid, text);
drop function if exists public.step_shipment_change(uuid, text, text, text, text, text);
drop function if exists public.create_shipment_change(uuid, text, jsonb, text, text, text, text);
drop function if exists public.shipments_pickup_lock();
drop function if exists public.shipment_change_requests_guard();
drop function if exists public.pickup_locked_changes(public.shipments, public.shipments);
drop function if exists public.change_kind_allowed_keys(text);
drop function if exists public.shipment_cancel_hook(uuid, uuid, text);
drop function if exists public.pickup_number_in_use(text, uuid);
drop index if exists public.shipment_change_requests_one_open_per_leg;
-- 申請者 guest (B2C の旅行者) は旧来の制約に無いので、運営の申請として残す (元の値は backup に残る)
update public.shipment_change_requests set requested_by = 'operator' where requested_by = 'guest';
alter table public.shipment_change_requests drop constraint if exists shipment_change_requests_requested_by_check;
alter table public.shipment_change_requests add constraint shipment_change_requests_requested_by_check
  check (requested_by in ('agency', 'operator'));
drop index if exists public.shipment_change_requests_pickup_idx;
alter table public.shipment_change_requests
  drop constraint if exists shipment_change_requests_kind_check,
  drop constraint if exists shipment_change_requests_stage_check,
  drop constraint if exists shipment_change_requests_policy_check,
  drop column if exists kind, drop column if exists stage, drop column if exists pickup_request_id,
  drop column if exists needs_sagawa, drop column if exists requested_actor,
  drop column if exists contact_note, drop column if exists contacted_by, drop column if exists contacted_at,
  drop column if exists answer_note, drop column if exists answered_by, drop column if exists answered_at,
  drop column if exists number_policy, drop column if exists new_shipping_number, drop column if exists old_shipping_number,
  drop column if exists old_tracking_numbers, drop column if exists old_tracking_detail, drop column if exists large_lot,
  drop column if exists hotel_change_id, drop column if exists apply_txid, drop column if exists applied_by,
  drop column if exists applied_at, drop column if exists updated_at;

-- ── 069: 施設台帳 (どこからも使っていない。中身は写してから消す)
create table if not exists public.facilities_rollback_backup as select * from public.facilities;
create table if not exists public.facility_checks_rollback_backup as select * from public.facility_checks;
drop table if exists public.facility_checks cascade;
drop table if exists public.facility_place_ids cascade;
drop table if exists public.facility_source_records cascade;
drop table if exists public.survey_regions cascade;
drop table if exists public.facilities cascade;
drop table if exists public.facility_settings cascade;
drop function if exists public.facility_register_place(text);
drop function if exists public.facility_link_place(uuid, text, text);
drop function if exists public.facility_register_residence(text, text, text);
drop function if exists public.facility_set_status(uuid, text, text, text, text, text, jsonb, text, text, text);
drop function if exists public.facility_gate(text, text);
drop function if exists public.facility_gate_residence(text, text);
drop function if exists public.b2c_facility_status(text);
drop function if exists public.facilities_status_guard();
drop function if exists public.facility_checks_guard();
drop function if exists public.facility_checks_immutable();

-- ── 067: 集荷依頼の記録 (古いアプリは使わない。区間の依頼済み印・番号はそのまま残る)
create table if not exists public.pickup_requests_rollback_backup as select * from public.pickup_requests;
drop function if exists public.claim_pickup_request(uuid, text, text, text, int, date, text, text, text);
drop function if exists public.transition_pickup_request(uuid, text[], text, text, text, text, text, jsonb, text, text, jsonb);
drop function if exists public.pickup_snapshot_json(public.shipments);
drop table if exists public.pickup_requests;
drop table if exists public.pickup_request_settings;
drop function if exists public.pickup_cutoff_at(date);

commit;

-- 確認 (結果を記録する)
select 'triggers' k, count(*) from pg_trigger where tgname in ('shipments_pickup_lock', 'shipment_change_requests_guard')
union all select 'pickup_requests table', count(*) from information_schema.tables where table_name = 'pickup_requests'
union all select 'scr new columns', count(*) from information_schema.columns where table_name = 'shipment_change_requests' and column_name in ('kind', 'stage')
union all select 'b2c_request_cancel', count(*) from pg_proc where proname = 'b2c_request_cancel'
union all select 'agency_change_atomic / pickup_watch_claim', count(*) from pg_proc where proname in ('agency_change_atomic', 'pickup_watch_claim');
