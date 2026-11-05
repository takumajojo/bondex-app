-- sql/061_b2c_mvp.sql の検証（ローカルの Supabase / PostgreSQL 17 だけで実行する。ダミーのデータだけを使う）。
-- 失敗すると例外で止まる。最後に "ALL CHECKS PASSED" を出す。
-- 実行: scripts/test-b2c/db/run-local.sh
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- 期待どおり失敗することを確かめる小道具
create or replace function pg_temp.expect_error(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok (rejected): % [%]', p_label, left(sqlerrm, 110);
    return;
  end;
  raise exception 'EXPECTED ERROR BUT SUCCEEDED: %', p_label;
end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'CHECK FAILED: %', p_label; end if;
  raise notice 'ok: %', p_label;
end $$;

-- ===========================================================================
-- 1. B2B の非回帰（既存の書き方の insert/update が今までどおり通る）
-- ===========================================================================
insert into agencies(name, payment_method) values ('Dummy Agency', 'card');
insert into shipments(booking_id, agency, representative, shipment_date, expected_arrival, from_hotel, to_hotel, recipient, amount_yen)
values ('BDX-TEST01', 'Dummy Agency', 'Mr. Dummy', '2026-12-01', '2026-12-02', 'Hotel A', 'Hotel B', 'Mr. Dummy', 4980);
select pg_temp.check((select channel from shipments where booking_id = 'BDX-TEST01') = 'b2b', 'B2B: 列を指定しない従来の insert は channel=b2b になる');
update shipments set charged_at = now(), stripe_payment_intent_id = 'pi_dummy_b2b', status = 'picked_up' where booking_id = 'BDX-TEST01';
select pg_temp.check((select charged_at is not null from shipments where booking_id = 'BDX-TEST01'), 'B2B: 課金の列の更新は今までどおり通る');
update shipments set stripe_checkout_url = 'https://example.invalid/x', is_addition = true where booking_id = 'BDX-TEST01';
insert into operator_passkeys(credential_id, public_key, label) values ('cred_legacy_0000000001', '\x00', 'legacy');
select pg_temp.check((select operator_email is null from operator_passkeys where credential_id = 'cred_legacy_0000000001'), 'B2B: operator_email 無しのパスキーの登録は今までどおり通る');
select pg_temp.expect_error($$insert into agencies(name) values ('BondEx Direct')$$, 'B2B: BondEx Direct という代理店名は作れない');

-- ===========================================================================
-- 2. B2C のダミーの土台
-- ===========================================================================
insert into b2c_entry_links(id, referrer_code, referrer_name, token_hash)
values ('00000000-0000-0000-0000-0000000000e1', 'HNK001', 'Dummy Referrer', 'hash_entry_1');
insert into b2c_facilities(place_id, name, status, checked_by, checked_at, last_verified_at) values
  ('place_A', 'Dummy Hotel A', 'verified', 'ops@example.invalid', now(), now()),
  ('place_B', 'Dummy Hotel B', 'verified', 'ops@example.invalid', now(), now()),
  ('place_U', 'Dummy Hotel U', 'unknown', null, null, null);
select pg_temp.expect_error($$insert into b2c_facilities(place_id, name, status) values ('place_X', 'X', 'verified')$$, '施設: verified は確認者と確認日時が必須');

-- sql/079 の後は、確定の予約にカード登録の同意（card_consent_*）が要るので、列があれば入れる
create or replace function pg_temp.new_order(p_id uuid, p_pickup date, p_pieces int, p_status text, p_dest text default 'place_B') returns void language plpgsql as $f$
declare
  has079 boolean := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'b2c_orders' and column_name = 'card_consent_version');
begin
  execute format($q$
  insert into b2c_orders(id, entry_link_id, referrer_code, guest_name, guest_email, guest_whatsapp, origin_place_id, dest_place_id,
    origin_snapshot, dest_snapshot, pickup_date, delivery_date, pieces, route_class, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen,
    price_rule_version, status, confirmation_mode, card_status, consent_version, consented_at, access_token_hash %s)
  values ($1, '00000000-0000-0000-0000-0000000000e1', 'HNK001', 'Dummy Guest', 'guest@example.invalid', '+31612345678',
    'place_A', $5, '{"name":"Dummy Hotel A","check_in":"2026-11-30"}', '{"name":"Dummy Hotel B","check_in":"2026-12-02","check_out":"2026-12-04"}',
    $2, $2 + 1, $3, 'standard', 4980, 4980 * $3, 498 * $3, 5478 * $3,
    '2026-11-v1', $4, 'instant', case when $4 = 'draft' then 'none' else 'registered' end, 'v1', now(), 'tok_' || $1::text %s)$q$,
    case when has079 then ', card_consent_version, card_consented_at' else '' end,
    case when has079 then ', case when $4 = ''draft'' then null else ''v1-card'' end, case when $4 = ''draft'' then null else now() end' else '' end)
  using p_id, p_pickup, p_pieces, p_status, p_dest;
end $f$;

-- ===========================================================================
-- 3. 予約の制約
-- ===========================================================================
select pg_temp.new_order('00000000-0000-0000-0000-000000000001', '2026-12-01', 2, 'card_pending');
select pg_temp.expect_error($$update b2c_orders set referrer_code = 'XXX999' where id = '00000000-0000-0000-0000-000000000001'$$, '予約: 紹介元のコードは作成後に変えられない');
select pg_temp.expect_error($$select pg_temp.new_order('00000000-0000-0000-0000-0000000000f1', '2026-12-01', 11, 'draft')$$, '予約: 11個は不可（Phase 1A は 10個まで）');
select pg_temp.expect_error($$select pg_temp.new_order('00000000-0000-0000-0000-0000000000f2', '2026-12-01', 1, 'draft', 'place_A')$$, '予約: 集荷元と配送先が同じホテルは不可');
select pg_temp.expect_error($$insert into b2c_orders(entry_link_id, referrer_code, guest_name, guest_email, guest_whatsapp, origin_place_id, dest_place_id, origin_snapshot, dest_snapshot, pickup_date, delivery_date, pieces, route_class, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen, price_rule_version, confirmation_mode, access_token_hash) values ('00000000-0000-0000-0000-0000000000e1','HNK001','G','g@example.invalid','0612345678','place_A','place_B','{}','{}','2026-12-01','2026-12-02',1,'standard',4980,4980,498,5478,'v1','instant','tok_bad_wa')$$, '予約: WhatsApp は国際形式（+ から始まる）でなければ不可');
select pg_temp.expect_error($$insert into b2c_orders(entry_link_id, referrer_code, guest_name, guest_email, guest_whatsapp, origin_place_id, dest_place_id, origin_snapshot, dest_snapshot, pickup_date, delivery_date, pieces, route_class, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen, price_rule_version, confirmation_mode, access_token_hash) values ('00000000-0000-0000-0000-0000000000e1','HNK001','G','g@example.invalid','+31612345678','place_A','place_B','{}','{}','2026-12-01','2026-12-02',1,'standard',4980,4980,498,9999,'v1','instant','tok_bad_total')$$, '予約: 税込の総額が税抜＋税と合わなければ不可');
select pg_temp.expect_error($$update b2c_orders set status = 'confirmed' where id = '00000000-0000-0000-0000-000000000001'$$, '予約: confirmed には confirmed_at が必須（確定の関数以外で確定できない）');

-- ===========================================================================
-- 4. 確定と shipments の作成（1つのトランザクション）
-- ===========================================================================
select pg_temp.check(b2c_confirm_order('00000000-0000-0000-0000-000000000001'), '確定: 条件がそろえば確定する');
select pg_temp.check((select count(*) = 1 from shipments where b2c_order_id = '00000000-0000-0000-0000-000000000001' and channel = 'b2c' and agency = 'BondEx Direct'), '確定: B2C の区間が 1行だけできる');
select pg_temp.check((select count(*) = 2 from b2c_outbox where order_id = '00000000-0000-0000-0000-000000000001'), '確定: 通知はメールと WhatsApp の 2件が積まれる');
select pg_temp.check(not b2c_confirm_order('00000000-0000-0000-0000-000000000001'), '確定: 2回目は何もしない');
select pg_temp.check((select count(*) = 1 from shipments where b2c_order_id = '00000000-0000-0000-0000-000000000001'), '確定: 2回目でも区間は 1行のまま');
select pg_temp.check((select count(*) = 2 from b2c_outbox where order_id = '00000000-0000-0000-0000-000000000001'), '確定: 2回目でも通知は増えない');
select pg_temp.expect_error($$update shipments set charged_at = now() where b2c_order_id = '00000000-0000-0000-0000-000000000001'$$, 'B2C の区間には B2B の課金の列を入れられない');
select pg_temp.expect_error($$update shipments set stripe_checkout_url = 'https://example.invalid' where b2c_order_id = '00000000-0000-0000-0000-000000000001'$$, 'B2C の区間には B2B の決済リンクを入れられない');
select pg_temp.expect_error($$insert into shipments(booking_id, agency, representative, shipment_date, expected_arrival, from_hotel, to_hotel, recipient, channel) values ('B2C-X', 'BondEx Direct', 'x', '2026-12-01', '2026-12-02', 'a', 'b', 'x', 'b2c')$$, 'channel=b2c なのに予約の無い区間は作れない');

-- 原子性: shipments の作成が失敗したら、予約の確定も残らない
select pg_temp.new_order('00000000-0000-0000-0000-000000000002', '2026-12-01', 1, 'card_pending');
insert into shipments(booking_id, agency, representative, shipment_date, expected_arrival, from_hotel, to_hotel, recipient)
values ('B2C-' || (select order_number from b2c_orders where id = '00000000-0000-0000-0000-000000000002'), 'Dummy Agency', 'x', '2026-12-01', '2026-12-02', 'a', 'b', 'x');
select pg_temp.expect_error($$select b2c_confirm_order('00000000-0000-0000-0000-000000000002')$$, '原子性: 区間の作成が失敗すると確定の関数ごと失敗する');
select pg_temp.check((select status = 'card_pending' and confirmed_at is null from b2c_orders where id = '00000000-0000-0000-0000-000000000002'), '原子性: 予約は確定していないまま');
select pg_temp.check((select count(*) = 0 from b2c_outbox where order_id = '00000000-0000-0000-0000-000000000002'), '原子性: 確定の通知も積まれていない');

-- 未確認のホテルなら確定せず「ホテル確認待ち」
select pg_temp.new_order('00000000-0000-0000-0000-000000000003', '2026-12-02', 1, 'card_pending', 'place_U');
update b2c_orders set confirmation_mode = 'awaiting_hotel_verification', confirmation_due_at = now() + interval '1 day' where id = '00000000-0000-0000-0000-000000000003';
select pg_temp.check(not b2c_confirm_order('00000000-0000-0000-0000-000000000003'), '未確認のホテル: 確定しない');
select pg_temp.check((select status = 'awaiting_hotel_confirmation' from b2c_orders where id = '00000000-0000-0000-0000-000000000003'), '未確認のホテル: ホテル確認待ちになる');
-- 取消は終点。取消の後は確定しない
update b2c_orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'test' where id = '00000000-0000-0000-0000-000000000003';
update b2c_facilities set status = 'verified', checked_by = 'ops@example.invalid', checked_at = now(), last_verified_at = now() where place_id = 'place_U';
select pg_temp.check(not b2c_confirm_order('00000000-0000-0000-0000-000000000003'), '取消の後は、ホテルが確認済みになっても確定しない');
select pg_temp.expect_error($$update b2c_orders set status = 'card_pending', cancelled_at = null where id = '00000000-0000-0000-0000-000000000003'$$, '取消は終点（戻せない）');

-- ===========================================================================
-- 5. 請求（二重請求の防止の DB の層）
-- ===========================================================================
insert into b2c_payments(order_id, kind, charge_key, amount_yen, scheduled_at, created_by)
values ('00000000-0000-0000-0000-000000000001', 'base', 'base:00000000-0000-0000-0000-000000000001', 10956, now() + interval '30 minutes', 'ops@example.invalid');
select pg_temp.expect_error($$insert into b2c_payments(order_id, kind, charge_key, amount_yen, scheduled_at, created_by) values ('00000000-0000-0000-0000-000000000001', 'base', 'base:00000000-0000-0000-0000-000000000001', 10956, now(), 'x')$$, '請求: 同じ論理の請求（charge_key）は 2行にならない');
select pg_temp.expect_error($$insert into b2c_payments(order_id, kind, charge_key, amount_yen, scheduled_at, created_by) values ('00000000-0000-0000-0000-000000000001', 'base', 'base-other', 10956, now(), 'x')$$, '請求: base の charge_key は base:<予約の ID> に限る');
select pg_temp.expect_error($$insert into b2c_payments(order_id, kind, charge_key, amount_yen, scheduled_at, created_by) values ('00000000-0000-0000-0000-000000000001', 'extra', 'extra:1', 0, now(), 'x')$$, '請求: 0円の請求は作れない');
update b2c_payments set status = 'ready' where charge_key = 'base:00000000-0000-0000-0000-000000000001';
update b2c_payments set status = 'processing', stripe_payment_intent_id = 'pi_dummy_1', attempts = 1 where charge_key = 'base:00000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($$update b2c_payments set stripe_payment_intent_id = 'pi_dummy_2' where charge_key = 'base:00000000-0000-0000-0000-000000000001'$$, '請求: 一度付けた PaymentIntent は差し替えられない');
select pg_temp.expect_error($$update b2c_payments set amount_yen = 1 where charge_key = 'base:00000000-0000-0000-0000-000000000001'$$, '請求: 処理を始めた後は金額を変えられない');
update b2c_payments set status = 'succeeded', succeeded_at = now() where charge_key = 'base:00000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($$update b2c_payments set status = 'ready' where charge_key = 'base:00000000-0000-0000-0000-000000000001'$$, '請求: 請求済みを請求前に戻せない（再請求できない）');
select pg_temp.expect_error($$insert into b2c_payments(order_id, kind, charge_key, amount_yen, scheduled_at, created_by, stripe_payment_intent_id) values ('00000000-0000-0000-0000-000000000001', 'extra', 'extra:dup-pi', 5478, now(), 'x', 'pi_dummy_1')$$, '請求: 同じ PaymentIntent を 2つの請求に使えない');
-- 条件付きの更新で 1つの処理だけが取る（2回目は 0行）
insert into b2c_payments(order_id, kind, charge_key, amount_yen, scheduled_at, created_by, status)
values ('00000000-0000-0000-0000-000000000001', 'extra', 'extra:claim-test', 5478, now(), 'ops@example.invalid', 'ready');
with a as (update b2c_payments set status = 'processing', locked_by = 'worker-1', locked_at = now() where charge_key = 'extra:claim-test' and status = 'ready' returning 1) select pg_temp.check((select count(*) = 1 from a), '請求: 1回目の取得は成功');
with a as (update b2c_payments set status = 'processing', locked_by = 'worker-2', locked_at = now() where charge_key = 'extra:claim-test' and status = 'ready' returning 1) select pg_temp.check((select count(*) = 0 from a), '請求: 2回目の取得は 0行（同時に 2つの処理が請求しない）');

-- 返金・Webhook の重複
insert into b2c_refunds(payment_id, amount_yen, reason, requested_by, refund_key) select id, 1000, 'test', 'ops@example.invalid', 'refund:1' from b2c_payments where charge_key = 'base:00000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($$insert into b2c_refunds(payment_id, amount_yen, reason, requested_by, refund_key) select id, 1000, 'test', 'x', 'refund:1' from b2c_payments where charge_key = 'base:00000000-0000-0000-0000-000000000001'$$, '返金: 同じ返金のキーは 2行にならない');
insert into b2c_stripe_events(event_id, type) values ('evt_dummy_1', 'setup_intent.succeeded');
select pg_temp.expect_error($$insert into b2c_stripe_events(event_id, type) values ('evt_dummy_1', 'setup_intent.succeeded')$$, 'Webhook: 同じ通知は 2回記録されない');

-- ===========================================================================
-- 6. 記録（追記のみ・運営者の識別）
-- ===========================================================================
insert into b2c_order_events(order_id, event, actor_type, operator_email, credential_id, reason)
values ('00000000-0000-0000-0000-000000000001', 'pickup_confirmed', 'operator', 'ops@example.invalid', 'cred_x', 'saw tracking');
select pg_temp.expect_error($$insert into b2c_order_events(order_id, event, actor_type, reason) values ('00000000-0000-0000-0000-000000000001', 'pickup_confirmed', 'operator', 'x')$$, '記録: 運営者の操作は運営者 ID と端末が必須');
select pg_temp.expect_error($$insert into b2c_order_events(order_id, event, actor_type, operator_email, credential_id) values ('00000000-0000-0000-0000-000000000001', 'refund', 'operator', 'a@example.invalid', 'c')$$, '記録: 運営者の操作は理由が必須');
select pg_temp.expect_error($$update b2c_order_events set reason = 'changed'$$, '記録: 書き換えられない');
select pg_temp.expect_error($$delete from b2c_order_events$$, '記録: 消せない');

-- ===========================================================================
-- 7. 受付の上限（同じトランザクションの中での確認。並行の確認は run-local.sh で 2つの接続を使う）
-- ===========================================================================
insert into b2c_ops_days(date, max_new_bookings, max_pieces) values ('2026-12-10', 2, 5);
select pg_temp.new_order('00000000-0000-0000-0000-000000000010', '2026-12-10', 2, 'card_pending');
select pg_temp.new_order('00000000-0000-0000-0000-000000000011', '2026-12-10', 3, 'card_pending');
select pg_temp.expect_error($$select pg_temp.new_order('00000000-0000-0000-0000-000000000012', '2026-12-10', 1, 'card_pending')$$, '上限: その集荷日の件数の上限を超えると受けない');
select pg_temp.new_order('00000000-0000-0000-0000-000000000013', '2026-12-10', 1, 'draft');
select pg_temp.expect_error($$update b2c_orders set status = 'card_pending', card_status = 'registered' where id = '00000000-0000-0000-0000-000000000013'$$, '上限: draft から枠を使う状態に進む時も数える');
insert into b2c_ops_days(date, closed) values ('2026-12-31', true);
select pg_temp.expect_error($$select pg_temp.new_order('00000000-0000-0000-0000-000000000014', '2026-12-31', 1, 'card_pending')$$, '上限: 受付を止めた日（12/31）は受けない');

-- ===========================================================================
-- 8. RLS と権限（anon・authenticated からは何も見えない・書けない・確定の関数も呼べない）
-- ===========================================================================
do $$
declare t text; n int;
begin
  foreach t in array array['b2c_entry_links','b2c_facilities','b2c_orders','b2c_hotel_acceptances','b2c_payments','b2c_refunds','b2c_stripe_events','b2c_order_events','b2c_ops_days','b2c_outbox'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'RLS is not enabled on %', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception 'unexpected policy on %', t;
    end if;
  end loop;
  raise notice 'ok: B2C の表はすべて RLS 有効・許可の規則なし';
end $$;

set role anon;
select pg_temp.check((select count(*) = 0 from b2c_orders), 'anon: 予約は 1件も見えない');
select pg_temp.check((select count(*) = 0 from shipments), 'anon: 配送データは 1件も見えない（既存の RLS）');
reset role;
set role anon;
do $$ begin
  begin
    insert into b2c_ops_days(date) values ('2027-01-01');
    raise exception 'anon could insert';
  exception when insufficient_privilege then raise notice 'ok (rejected): anon は書き込めない';
  end;
  begin
    perform b2c_confirm_order('00000000-0000-0000-0000-000000000002');
    raise exception 'anon could execute b2c_confirm_order';
  exception when insufficient_privilege then raise notice 'ok (rejected): anon は確定の関数を呼べない';
  end;
end $$;
reset role;
set role authenticated;
select pg_temp.check((select count(*) = 0 from b2c_payments), 'authenticated: 請求は 1件も見えない');
do $$ begin
  begin
    perform b2c_confirm_order('00000000-0000-0000-0000-000000000002');
    raise exception 'authenticated could execute b2c_confirm_order';
  exception when insufficient_privilege then raise notice 'ok (rejected): authenticated は確定の関数を呼べない';
  end;
end $$;
reset role;

select 'ALL CHECKS PASSED' as result;
