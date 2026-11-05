-- sql/081 を戻す: b2c_confirm_order を 071 の定義に戻す（区間に都道府県・集荷元のチェックアウト日を書かない形）。
-- 埋め戻した値（from_prefecture・to_prefecture・origin_check_out）は消さない（予約の控えと同じ正しい値。消すと Biz-Logi の照合が止まる）。
-- 消す必要がある時は、別に判断して手で行う（集荷依頼済みの区間は sql/068 のロックで変えられない）。
-- 081 で足した origin_check_out の列も消さない（Biz-Logi の送信前の確認が読む。列を消すとアプリが区間を読めなくなる）。b2c_safe_date も残す（害は無い）。

do $migration_lock$
declare
  targets text;
  deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  -- 存在する表だけ (例: 067 の前は pickup_requests が無い)
  select string_agg(t, ', ') into targets from unnest(array['public.shipments', 'public.shipment_change_requests', 'public.operator_passkeys']) t where to_regclass(t) is not null;
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

revoke execute on function public.b2c_confirm_order(uuid) from public;
do $$ begin
  execute 'revoke execute on function public.b2c_confirm_order(uuid) from anon, authenticated';
exception when undefined_object then null; end $$;
