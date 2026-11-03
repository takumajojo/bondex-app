-- B2C Phase 1A Stage 4（通知・My Booking・取消・定期の処理）。docs/b2c/B2C_MVP_SCHEMA_v1.md・B2C_PHASE1A_BETA_PLAN.md。
-- 本番には未適用。ローカルの試験環境（scripts/test-b2c/db/seed-dev.sh）だけで適用する。
-- B2B の表で変えるのは無し（shipments への書き込みは b2c の行だけ）。

-- ---------------------------------------------------------------------------
-- 1. 通知の送信待ち（outbox）: 送信中の状態・実際に送った文面の控え・送信先の種類
-- ---------------------------------------------------------------------------
alter table public.b2c_outbox drop constraint if exists b2c_outbox_status_check;
alter table public.b2c_outbox add constraint b2c_outbox_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled', 'expired', 'unknown'));  -- expired / unknown は sql/063（062 を後から再実行しても 063 の行を壊さない）
alter table public.b2c_outbox add column if not exists locked_at           timestamptz;
alter table public.b2c_outbox add column if not exists language            text check (language in ('ja', 'en'));
alter table public.b2c_outbox add column if not exists rendered            jsonb;   -- 実際に送った件名・本文（WhatsApp はテンプレート名と差し込み値）
alter table public.b2c_outbox add column if not exists provider            text;    -- smtp / resend / whatsapp / sandbox
alter table public.b2c_outbox add column if not exists provider_message_id text;
create index if not exists b2c_outbox_order on public.b2c_outbox(order_id);
create index if not exists shipments_b2c_order on public.shipments(b2c_order_id) where b2c_order_id is not null;

-- ---------------------------------------------------------------------------
-- 2. 確定（061 の関数の置き換え）
--    - shipments.guest_language を予約の言語（ja / en）にする（061 は 'en' 固定だった）
--    - ホテルの条件を満たさず awaiting_hotel_confirmation に移った時だけ、確認待ちの通知を積む（確定の通知は送らない）
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3. 取消（1つのトランザクション）: 予約の取消・shipments の行の取消（集荷前だけ）・記録・未送信の通知の取消・取消の通知
--    戻り値: cancelled / already_cancelled / not_found / not_cancellable（集荷済み以降）/ state_changed（p_expect_status と違う）
--    p_expect_status: 指定した時は、その状態の時だけ取り消す（期限切れの片付けが、直前に進んだ予約を取り消さないため）。
--    card_timeout はカードの登録が終わっていれば取り消さない。
--    p_reason: guest / hotel_refused / hotel_unsupported / confirmation_timeout / card_timeout / ops
-- ---------------------------------------------------------------------------
drop function if exists public.b2c_cancel_order(uuid, text, text, text, text, text);
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

revoke execute on function public.b2c_cancel_order(uuid, text, text, text, text, text, text) from public;
do $$ begin
  execute 'revoke execute on function public.b2c_cancel_order(uuid, text, text, text, text, text, text) from anon, authenticated';
exception when undefined_object then null; end $$;
