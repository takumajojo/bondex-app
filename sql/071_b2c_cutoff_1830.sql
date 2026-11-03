-- B2C の受付締切を集荷前日 18:30 JST にそろえる・集荷依頼済みの B2C 予約の取消を「取消申請」へ (2026-11-04 谷口さん承認)。未適用。
-- 前提: sql/061・062 (B2C)、sql/067 (pickup_requests・pickup_cutoff_at)、sql/068 (変更申請・shipment_cancel_hook)。
-- 再実行できる (create or replace のみ)。戻すとき: sql/062_b2c_stage4.sql を流し直し、sql/rollback/rollback_067_072.sql の 071 の段。
--
-- 1. b2c_confirm_order: 18:30 以降は確定しない (DB でも判定)。保存する締切 (change_deadline_at) を 18:30 に。
-- 2. b2c_cancel_order: 有効な集荷依頼がある区間の予約は取り消さず 'pickup_requested' を返す
--    (以前は sql/068 のロックの例外で取消全体が失敗していた)。それ以外の動き (通知・記録・カード) は 062 のまま。
-- 3. b2c_request_cancel: 集荷依頼済みの予約の取消申請を登録する (shipment_change_requests の kind='cancel')。
--    この時点では予約・区間・集荷依頼は変えない。佐川が取消を認めなければ申請を却下し、予約はそのまま。
-- 4. shipment_cancel_hook: 佐川の取消確認を反映するとき (apply_shipment_change)、B2C の区間なら
--    b2c_cancel_order で予約の取消・未送信の通知の取消・取消の通知を同じトランザクションで行う。
--    請求は集荷の確認の後にしか作られないので、集荷前の取消で請求・返金は発生しない (062 と同じ)。

-- ---------------------------------------------------------------------------
-- 1. 確定
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
  -- 受付締切 (集荷前日 18:30 JST) 以降は確定しない。アプリ (card-service) も判定するが、DB でも止める。
  if now() >= public.pickup_cutoff_at(o.pickup_date) then return false; end if;

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
    public.pickup_cutoff_at(o.pickup_date),
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
-- 2. 取消 (集荷依頼済みなら取り消さない)
-- ---------------------------------------------------------------------------
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
    -- 佐川へ集荷依頼済み (有効な依頼あり) なら、ここでは取り消さない。b2c_request_cancel で取消申請にし、
    -- 世田谷営業所へ確認 → 佐川の取消確認 → apply_shipment_change が取消を確定する (shipment_cancel_hook 経由)。
    if exists (select 1 from public.pickup_requests r where r.shipment_id = s.id
                and r.state in ('sending', 'accepted', 'unknown', 'needs_review', 'change_pending')) then
      return 'pickup_requested';
    end if;
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


revoke execute on function public.b2c_confirm_order(uuid) from public;
revoke execute on function public.b2c_cancel_order(uuid, text, text, text, text, text, text) from public;
do $$ begin
  execute 'revoke execute on function public.b2c_confirm_order(uuid) from anon, authenticated';
  execute 'revoke execute on function public.b2c_cancel_order(uuid, text, text, text, text, text, text) from anon, authenticated';
exception when undefined_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. 取消申請 (集荷依頼済みの予約)
--    戻り値: cancel_requested / already_requested / no_pickup_request (→ b2c_cancel_order で即時取消)
--            already_cancelled / not_cancellable / not_found / change_in_progress / その他 create_shipment_change の理由
-- ---------------------------------------------------------------------------
create or replace function public.b2c_request_cancel(
  p_order_id uuid, p_actor_type text,
  p_operator_email text default null, p_credential_id text default null, p_note text default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  o public.b2c_orders%rowtype;
  s public.shipments%rowtype;
  v_ok boolean;
  v_id uuid;
  v_reason text;
begin
  if p_actor_type not in ('guest', 'operator') then
    raise exception 'b2c_request_cancel: unknown actor %', p_actor_type;
  end if;
  select * into o from public.b2c_orders where id = p_order_id for update;
  if not found then return 'not_found'; end if;
  if o.status = 'cancelled' then return 'already_cancelled'; end if;
  if o.status <> 'confirmed' then return 'not_cancellable'; end if;

  select * into s from public.shipments where b2c_order_id = o.id for update;
  if not found then return 'not_cancellable'; end if;
  if not exists (select 1 from public.pickup_requests r where r.shipment_id = s.id
                  and r.state in ('sending', 'accepted', 'unknown', 'needs_review', 'change_pending')) then
    return 'no_pickup_request';
  end if;
  if exists (select 1 from public.shipment_change_requests c where c.shipment_id = s.id and c.kind = 'cancel'
              and c.stage in ('requested', 'contacted', 'approved')) then
    return 'already_requested';
  end if;

  select x.ok, x.change_id, x.reason into v_ok, v_id, v_reason
    from public.create_shipment_change(
      s.id, 'cancel', '{}'::jsonb,
      coalesce(nullif(btrim(p_note), ''), case p_actor_type when 'guest' then '旅行者からの取消の希望 (My Booking)' else '運営による取消' end),
      case p_actor_type when 'guest' then 'guest' else 'operator' end,
      case p_actor_type when 'guest' then 'guest:B2C-' || o.order_number else p_operator_email end,
      case p_actor_type when 'guest' then 'guest' else coalesce(p_operator_email, 'operator') end) x;
  if not v_ok then
    return case v_reason when 'open_change_exists' then 'change_in_progress' else v_reason end;
  end if;

  insert into public.b2c_order_events(order_id, shipment_id, event, actor_type, operator_email, credential_id, reason, before_state, after_state)
  values (o.id, s.id, 'cancel_requested', p_actor_type, p_operator_email, p_credential_id,
          coalesce(nullif(btrim(p_note), ''), '集荷依頼済みのため取消申請 (佐川の確認待ち)'),
          jsonb_build_object('status', o.status),
          jsonb_build_object('status', o.status, 'change_request_id', v_id));
  return 'cancel_requested';
end $$;
revoke all on function public.b2c_request_cancel(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.b2c_request_cancel(uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. 佐川の取消確認の反映 (apply_shipment_change から呼ばれる)
-- ---------------------------------------------------------------------------
create or replace function public.shipment_cancel_hook(p_shipment_id uuid, p_change_id uuid, p_actor text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  s public.shipments%rowtype;
  c public.shipment_change_requests%rowtype;
  v text;
begin
  select * into s from public.shipments where id = p_shipment_id;
  if not found or s.b2c_order_id is null then return false; end if;
  select * into c from public.shipment_change_requests where id = p_change_id;
  v := public.b2c_cancel_order(
         s.b2c_order_id,
         case when c.requested_by = 'guest' then 'guest' else 'ops' end,
         'system',
         'operator:' || coalesce(p_actor, ''),
         null,
         '佐川の取消確認を反映 (変更申請 ' || p_change_id || ')');
  if v <> 'cancelled' then
    -- 予約を取り消せない (集荷済み・完了など) なら、区間・集荷依頼の反映も全部取り消す
    raise exception 'b2c_cancel_failed: %', v;
  end if;
  return true;
end $$;
revoke all on function public.shipment_cancel_hook(uuid, uuid, text) from public, anon, authenticated;
