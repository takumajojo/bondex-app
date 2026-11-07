-- staging の E2E 試験で作ったデータの削除（P0-3・2026-11-07）。**単独で流さない**: scripts/staging/cleanup-e2e.sh だけが、
-- DB の番号と試験環境の印を確かめる文を先頭に付けて、1つのトランザクションで流す。
-- psql の変数: run（E2E の入口の紹介元のコード）・since（E2E を始めた時刻）・mode（dry-run | execute）・confirm（dry-run の指紋）
--
-- 対象 = 紹介元のコードが :run の入口（scripts/b2c-entry-link/issue.ts で E2E 用に発行）から、:since 以降に作られた予約と、その
--   予約にひもづく行（配送・集荷の確認・請求・返金・ホテルの受入・通知・操作の記録・Stripe の Webhook の受付の記録）。
--   予約が無くなった入口と、:since 以降に作られ、どの予約からも使われていない架空のホテル（bdx-staging-mock-*）も消す。
-- 対象にしない: 他の入口の予約・:since より前の行・本物のホテル（place_id が架空でない）・運営のパスキー・営業日の枠（b2c_ops_days）。
-- 止める（何も消さない）: 入口が無い／同じ入口に :since より前の予約がある（コードの使い回し）／B2B の配送が混ざる／
--   集荷依頼・集荷番号の台帳・事故の記録が対象の配送を参照している／請求が処理中・結果不明／対象の外の行が対象を参照している。
-- dry-run（既定）は件数と指紋を出して取り消す（rollback）。execute は指紋が dry-run と一致した時だけ消す（間に増減があれば止まる）。

select set_config('cleanup.run', :'run', true),
       set_config('cleanup.since', :'since', true),
       set_config('cleanup.mode', :'mode', true),
       set_config('cleanup.confirm', :'confirm', true) \gset cfg_

create temp table t_links on commit drop as
  select id from public.b2c_entry_links where referrer_code = current_setting('cleanup.run');
create temp table t_orders on commit drop as
  select o.id, o.stripe_setup_intent_id, o.origin_place_id, o.dest_place_id from public.b2c_orders o
   where o.entry_link_id in (select id from t_links) and o.created_at >= current_setting('cleanup.since')::timestamptz;
create temp table t_ships on commit drop as
  select id, channel from public.shipments where b2c_order_id in (select id from t_orders);
create temp table t_pays on commit drop as
  select id, status, stripe_payment_intent_id from public.b2c_payments where order_id in (select id from t_orders);
create temp table t_refunds on commit drop as
  select id, stripe_refund_id from public.b2c_refunds where payment_id in (select id from t_pays);
create temp table t_pconf on commit drop as
  select id from public.b2c_pickup_confirmations where order_id in (select id from t_orders);
create temp table t_stripe on commit drop as
  select event_id from public.b2c_stripe_events
   where object_id in (select stripe_setup_intent_id from t_orders where stripe_setup_intent_id is not null
                       union select stripe_payment_intent_id from t_pays where stripe_payment_intent_id is not null
                       union select stripe_refund_id from t_refunds where stripe_refund_id is not null);

do $chk$
declare
  r record;
  n bigint;
  handled text[] := array['b2c_hotel_acceptances', 'b2c_order_events', 'b2c_outbox', 'b2c_payments', 'b2c_pickup_confirmations', 'b2c_refunds',
                          'shipments', 'b2c_orders', 'sagawa_bulk_pickup_members', 'shipment_change_requests', 'shipment_hotel_changes'];
begin
  if current_setting('cleanup.run') !~ '^E2E[A-Z0-9]{1,13}$' then raise exception 'STOP: 紹介元のコードは E2E で始まるものだけ'; end if;
  if not exists (select 1 from t_links) then raise exception 'STOP: 紹介元 % の入口がありません', current_setting('cleanup.run'); end if;
  select count(*) into n from public.b2c_orders where entry_link_id in (select id from t_links) and created_at < current_setting('cleanup.since')::timestamptz;
  if n > 0 then raise exception 'STOP: この入口に開始の時刻より前の予約が % 件あります（コードの使い回しの疑い・何も消しません）', n; end if;
  if exists (select 1 from t_ships where channel is distinct from 'b2c') then raise exception 'STOP: B2B の配送が対象に混ざっています'; end if;
  select count(*) into n from public.pickup_requests where shipment_id in (select id from t_ships);
  if n > 0 then raise exception 'STOP: 集荷依頼 % 件が対象の配送を参照しています（佐川・Biz-Logi の記録。手で確かめる）', n; end if;
  select count(*) into n from public.pickup_number_ledger where shipment_id in (select id from t_ships);
  if n > 0 then raise exception 'STOP: 集荷番号の台帳 % 件が対象の配送を参照しています', n; end if;
  select count(*) into n from public.claim_cases where shipment_id in (select id from t_ships);
  if n > 0 then raise exception 'STOP: 事故の記録 % 件が対象の配送を参照しています', n; end if;
  select count(*) into n from t_pays where status in ('processing', 'unknown');
  if n > 0 then raise exception 'STOP: 処理中・結果不明の請求が % 件あります（照合が終わってから）', n; end if;
  select count(*) into n from public.b2c_orders where replaced_by in (select id from t_orders) and id not in (select id from t_orders);
  if n > 0 then raise exception 'STOP: 対象の外の予約 % 件が対象を参照しています（replaced_by）', n; end if;
  -- 対象の ID を持つ列（名前で探す）が、上の扱う表の外にあれば止める（新しい表が増えても見落とさない）
  for r in
    select c.table_name, c.column_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name in ('order_id', 'b2c_order_id', 'shipment_id', 'payment_id', 'pickup_confirmation_id')
       and not (c.table_name = any(handled))
  loop
    execute format('select count(*) from public.%I where %I::text in (select id::text from %s)', r.table_name, r.column_name,
      case r.column_name when 'shipment_id' then 't_ships' when 'payment_id' then 't_pays' when 'pickup_confirmation_id' then 't_pconf' else 't_orders' end) into n;
    if n > 0 then raise exception 'STOP: 扱っていない表 %.% の % 行が対象を参照しています', r.table_name, r.column_name, n; end if;
  end loop;
end $chk$;

create temp table t_facs on commit drop as
  select f.place_id from public.b2c_facilities f
   where f.place_id like 'bdx-staging-mock-%' and f.created_at >= current_setting('cleanup.since')::timestamptz
     and f.place_id in (select origin_place_id from t_orders union select dest_place_id from t_orders)
     and not exists (select 1 from public.b2c_orders o where (o.origin_place_id = f.place_id or o.dest_place_id = f.place_id) and o.id not in (select id from t_orders));

create temp table t_plan on commit drop as
  select 1 as ord, 'b2c_refunds' as tbl, (select count(*) from t_refunds) as n
  union all select 2, 'b2c_payments', (select count(*) from t_pays)
  union all select 3, 'b2c_pickup_confirmations', (select count(*) from t_pconf)
  union all select 4, 'b2c_hotel_acceptances', (select count(*) from public.b2c_hotel_acceptances where order_id in (select id from t_orders))
  union all select 5, 'b2c_outbox', (select count(*) from public.b2c_outbox where order_id in (select id from t_orders))
  union all select 6, 'b2c_order_events', (select count(*) from public.b2c_order_events where order_id in (select id from t_orders) or shipment_id in (select id from t_ships))
  union all select 7, 'sagawa_bulk_pickup_members（配送と一緒に消える）', (select count(*) from public.sagawa_bulk_pickup_members where shipment_id in (select id from t_ships))
  union all select 8, 'shipment_change_requests（配送と一緒に消える）', (select count(*) from public.shipment_change_requests where shipment_id in (select id from t_ships))
  union all select 9, 'shipment_hotel_changes（配送と一緒に消える）', (select count(*) from public.shipment_hotel_changes where shipment_id in (select id from t_ships))
  union all select 10, 'shipments', (select count(*) from t_ships)
  union all select 11, 'b2c_stripe_events', (select count(*) from t_stripe)
  union all select 12, 'b2c_orders', (select count(*) from t_orders)
  union all select 13, 'b2c_entry_links', (select count(*) from t_links)
  union all select 14, 'b2c_facilities（架空のホテル）', (select count(*) from t_facs);

\echo '== 削除の対象（件数）'
select tbl as "表", n as "件数" from t_plan order by ord;
\echo '== 対象の外（消さない）: 残るホテル = 本物・前からある・他の予約が使う架空のホテル'
select (select count(*) from public.b2c_orders) - (select count(*) from t_orders) as "残る予約",
       (select count(*) from public.b2c_facilities where place_id in (select origin_place_id from t_orders union select dest_place_id from t_orders) and place_id not in (select place_id from t_facs)) as "残るホテル",
       (select string_agg(distinct split_part(guest_email, '@', 2), ', ') from public.b2c_orders where id in (select id from t_orders)) as "対象の予約のメールのドメイン";

-- 指紋: 対象の予約の ID と各表の件数（dry-run と execute の間に増減があれば一致しない）
select md5(coalesce((select string_agg(id::text, ',' order by id) from t_orders), '') || '|' ||
           (select string_agg(tbl || '=' || n, ',' order by ord) from t_plan)) as fp \gset
\echo '== 指紋（execute の --confirm に渡す）:' :fp

select set_config('cleanup.fp', :'fp', true) \gset cfg2_

do $del$
begin
  if current_setting('cleanup.mode') <> 'execute' then return; end if;
  if current_setting('cleanup.confirm') <> current_setting('cleanup.fp') then
    raise exception 'STOP: 指紋が dry-run と一致しません（対象が変わった。dry-run からやり直す）';
  end if;
  delete from public.b2c_refunds where id in (select id from t_refunds);
  delete from public.b2c_payments where id in (select id from t_pays);
  delete from public.b2c_pickup_confirmations where id in (select id from t_pconf);
  delete from public.b2c_hotel_acceptances where order_id in (select id from t_orders);
  delete from public.b2c_outbox where order_id in (select id from t_orders);
  -- 操作の記録は追記だけの表（削除を止める trigger）。このトランザクションの中だけ外し、消した後に戻す
  alter table public.b2c_order_events disable trigger b2c_order_events_append_only;
  delete from public.b2c_order_events where order_id in (select id from t_orders) or shipment_id in (select id from t_ships);
  alter table public.b2c_order_events enable trigger b2c_order_events_append_only;
  delete from public.shipments where id in (select id from t_ships);
  delete from public.b2c_stripe_events where event_id in (select event_id from t_stripe);
  delete from public.b2c_orders where id in (select id from t_orders);
  delete from public.b2c_entry_links where id in (select id from t_links)
     and not exists (select 1 from public.b2c_orders o where o.entry_link_id = b2c_entry_links.id);
  delete from public.b2c_facilities where place_id in (select place_id from t_facs);
  -- 後の確認: 対象が残っていない・追記だけの trigger が戻っている
  if exists (select 1 from public.b2c_orders where id in (select id from t_orders)) or exists (select 1 from public.shipments where id in (select id from t_ships)) then
    raise exception 'STOP: 削除の後に対象が残っています（取り消します）';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'b2c_order_events_append_only' and tgenabled = 'O') then
    raise exception 'STOP: 操作の記録の保護が戻っていません（取り消します）';
  end if;
  raise notice '削除しました（指紋 %）', current_setting('cleanup.fp');
end $del$;
