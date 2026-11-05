-- B2C の区間に、ホテルの都道府県と集荷元のチェックアウト日を書く（2026-11-06・谷口さん承認: 作成とローカルの検証まで）。
-- 目的: Biz-Logi の送る前の照合（fix/pickup-safety2-1106: 予約の都道府県と Google の住所の都道府県が一致しなければ送らない）が
--   B2C の区間でも働くようにする。これまで b2c_confirm_order（061・062・071）は区間に from_prefecture・to_prefecture・
--   origin_check_out を書いておらず、照合を入れると B2C の区間がすべて「都道府県が登録されていません」で止まる。
-- 値の出どころ: 予約の控え b2c_orders.origin_snapshot・dest_snapshot（lib/b2c/booking-service.ts が予約の時に保存。
--   都道府県は Google の場所の日本語の住所から parseJpAddressString で取り出したもの。Biz-Logi の照合と同じ取り出し方）。
--   控えに無い・空なら null のまま（推測では埋めない。Biz-Logi の照合が止めて、運営が確かめる）。
-- 変えるもの:
--   1. public.b2c_confirm_order(uuid): 071 の定義に、区間の 3つの列を足すだけ（確定の条件・状態・通知・締切は 071 と同じ）
--   2. 既にある B2C の区間の埋め戻し（谷口さんの条件）: 列が空で、かつ区間のホテル・日程が予約の控えと一致し、ホテルの変更・
--      変更や取消の申請の記録が無く、取消済みでも集荷依頼済みでもない区間だけ。既にある値は上書きしない。
--      それ以外の区間は埋めずに、要確認として件数と区間の ID を notice で知らせる（運営が確かめて手で直す）。
-- 変えないもの: B2B の区間（channel = 'b2c' と b2c_order_id のある行だけ）・予約・決済・通知・集荷依頼の記録。
-- 前提: sql/024（from_prefecture・to_prefecture）、sql/061・062・071（B2C）、sql/067・068（集荷依頼・ロック）。
-- origin_check_out の列: sql/054 で足す列だが、本番・staging には 054 が未適用（2026-11-06 確認: 本番の列の一覧の読み取り・
--   scripts/staging/000_prod_schema_20261105.sql・staging の information_schema）。054 の残り（リマインドの列）は流さないので、
--   この 081 で origin_check_out の 1列だけを足す（add column if not exists。値の無い date の列で、既にある行は書き換えない）。
-- 再実行できる（add column if not exists・create or replace と、空の列だけの更新）。
-- 戻すとき: sql/rollback/rollback_081.sql（b2c_confirm_order を 071 の定義に戻す。埋め戻した値は消さない: 正しい値で、消すと照合が止まるため）。

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

-- ---------------------------------------------------------------------------
-- 0a. 集荷元のチェックアウト日の列（054 が未適用の DB のため。054 を流した DB では何もしない）
-- ---------------------------------------------------------------------------
alter table public.shipments add column if not exists origin_check_out date;
comment on column public.shipments.origin_check_out is '集荷元ホテルのチェックアウト日 (B2C は予約の控えから・sql/081。集荷日がこれより後なら Biz-Logi の送信前に運営の確認)';

-- ---------------------------------------------------------------------------
-- 0. 日付の文字列を安全に日付にする（形・値が正しくなければ null。例外を出さない）
-- ---------------------------------------------------------------------------
create or replace function public.b2c_safe_date(p text) returns date language plpgsql immutable as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then
  return null;
end $$;
revoke all on function public.b2c_safe_date(text) from public;
do $$ begin
  execute 'revoke all on function public.b2c_safe_date(text) from anon, authenticated';
  execute 'grant execute on function public.b2c_safe_date(text) to service_role';
exception when undefined_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 1. b2c_confirm_order: 区間に都道府県・集荷元のチェックアウト日を書く（それ以外は 071 と同じ）
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
    channel, b2c_order_id, route_class, unit_net_yen, price_rule_version,
    from_prefecture, to_prefecture, origin_check_out
  ) values (
    'B2C-' || o.order_number, 0, 'BondEx Direct', o.guest_name, 1, o.pickup_date, o.delivery_date,
    public.pickup_cutoff_at(o.pickup_date),
    o.origin_snapshot->>'name', o.origin_place_id, (o.origin_snapshot->>'check_in')::date,
    o.dest_snapshot->>'name', o.dest_place_id, (o.dest_snapshot->>'check_in')::date, (o.dest_snapshot->>'check_out')::date,
    o.guest_name, o.pieces, o.subtotal_net_yen, 'issued', 'sagawa', o.language, '11',
    'b2c', o.id, o.route_class, o.unit_net_yen, o.price_rule_version,
    -- 081: 都道府県・集荷元のチェックアウト日を控えから写す（空なら null。推測では埋めない）
    nullif(btrim(o.origin_snapshot->>'prefecture'), ''), nullif(btrim(o.dest_snapshot->>'prefecture'), ''),
    -- 日付として正しくなければ null（ここで型の変換に失敗して、予約の確定そのものを止めないため）
    public.b2c_safe_date(o.origin_snapshot->>'check_out')
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

-- ---------------------------------------------------------------------------
-- 2. 既にある B2C の区間の埋め戻し（2026-11-06 谷口さんの条件: 空欄で、かつ予約の控えと矛盾が無い区間だけ。上書きはしない。
--    変更の履歴・不一致のある区間は埋めずに、要確認として件数と区間の ID を知らせる）
-- ---------------------------------------------------------------------------
-- 控えと矛盾が無い = 次の全部:
--   ホテル: 区間の from_place_id・to_place_id・from_hotel・to_hotel が、控えの origin_place_id・dest_place_id・名前と同じ
--   日程:   区間の集荷日・配達日が、予約の pickup_date・delivery_date と同じ
--   履歴:   ホテルの変更の記録（shipment_hotel_changes）も、変更・取消の申請（shipment_change_requests）も 1件も無い
--   状態:   取消済みでない。佐川へ集荷依頼済み（有効な依頼あり）でない（068 のロックの対象・依頼済みの内容を変えない）
-- 1つのトランザクションで流さなくても動くよう、作り直して最後に消す
drop table if exists pg_temp.b2c_081_targets;
create temporary table b2c_081_targets as
select s.id as shipment_id, o.id as order_id,
       nullif(btrim(o.origin_snapshot->>'prefecture'), '') as from_pref,
       nullif(btrim(o.dest_snapshot->>'prefecture'), '')   as to_pref,
       public.b2c_safe_date(o.origin_snapshot->>'check_out') as origin_out,
       (s.from_place_id is not distinct from o.origin_place_id
        and s.to_place_id is not distinct from o.dest_place_id
        and s.from_hotel is not distinct from (o.origin_snapshot->>'name')
        and s.to_hotel is not distinct from (o.dest_snapshot->>'name')
        and s.shipment_date is not distinct from o.pickup_date
        and s.expected_arrival is not distinct from o.delivery_date
        and not exists (select 1 from public.shipment_hotel_changes h where h.shipment_id = s.id)
        and not exists (select 1 from public.shipment_change_requests c where c.shipment_id = s.id)
        and s.status <> 'cancelled'
        and not exists (select 1 from public.pickup_requests r
                         where r.shipment_id = s.id and r.state in ('sending', 'accepted', 'unknown', 'needs_review', 'change_pending'))
       ) as consistent
  from public.shipments s
  join public.b2c_orders o on o.id = s.b2c_order_id
 where s.channel = 'b2c'
   and (s.from_prefecture is null or s.to_prefecture is null or s.origin_check_out is null);

-- 矛盾が無い区間だけ、空の列だけを書く（上書きしない）
update public.shipments s
   set from_prefecture  = coalesce(s.from_prefecture, t.from_pref),
       to_prefecture    = coalesce(s.to_prefecture, t.to_pref),
       origin_check_out = coalesce(s.origin_check_out, t.origin_out)
  from b2c_081_targets t
 where t.shipment_id = s.id
   and t.consistent
   and (t.from_pref is not null or t.to_pref is not null or t.origin_out is not null);

-- 要確認: 埋めなかった区間（矛盾・履歴・依頼済み・取消）と、控えに値が無くて空のままの区間。件数と区間の ID だけ（個人情報は出さない）
do $$
declare
  n_skip int; ids_skip text; n_empty int; ids_empty text;
begin
  select count(*), string_agg(shipment_id::text, ', ' order by shipment_id) into n_skip, ids_skip
    from b2c_081_targets where not consistent;
  select count(*), string_agg(t.shipment_id::text, ', ' order by t.shipment_id) into n_empty, ids_empty
    from b2c_081_targets t join public.shipments s on s.id = t.shipment_id
   where t.consistent and (s.from_prefecture is null or s.to_prefecture is null);
  if n_skip > 0 then
    raise notice '081 要確認: 予約の控えと矛盾・変更の履歴・集荷依頼済み・取消のため埋めなかった B2C の区間 % 件: %', n_skip, ids_skip;
  end if;
  if n_empty > 0 then
    raise notice '081 要確認: 予約の控えに都道府県が無く、空のままの B2C の区間 % 件: %', n_empty, ids_empty;
  end if;
end $$;

drop table if exists pg_temp.b2c_081_targets;
