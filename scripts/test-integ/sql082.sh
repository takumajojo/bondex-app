#!/usr/bin/env bash
# sql/082（B2C の請求の安全: 取消の申請中は請求しない・追跡が先に集荷済みの区間も確認できる ほか）の DB の試験。
# ローカルの DB コンテナの中の、試験専用のデータベースだけ（共有の public・本番・staging・Supabase には接続しない）。
#   実行: bash scripts/test-integ/sql082.sh
# 確かめること:
#   A. 本番移行の順番（067〜081 の後）に足せる・既存のデータ（B2B・B2C の予約・区間・請求・申請・記録）を 1文字も変えない・二重適用
#   B. 082 が変えるのは 5つの関数だけ（ほかの関数・表の定義は同じ）・権限（匿名・ログイン利用者は呼べない）はそのまま
#   C. 本物の PostgreSQL で動き（取消の申請中は取り出さない・却下の後の解除で 1回・配達済みの区間の確認・B2B は対象外）
#   D. 切り戻し（081 の時の定義と完全に同じに戻る）→ 081 の切り戻しも流せる（順番: 082 → 081）→ 再適用
#   E. 同時実行: 区間を掴んでいる利用者がいる時は 10秒で何も変えずに失敗・離した後は成功／2つ同時に流しても壊れない／
#      請求の取り出しと同時に流しても二重に取り出さない
set -uo pipefail
R="$(cd "$(dirname "$0")/../.." && pwd)"
C=supabase_db_supa-local; DB=${SQL082_TEST_DB:-bondex_sql082_test}
PASS=0; FAIL=0
q() { docker exec -i $C psql -U postgres -d $DB -v ON_ERROR_STOP=1 -qtA "$@"; }
apply() { for f in "$@"; do q -1 < "$R/$f" >/dev/null 2>/tmp/sql082_err.txt || { echo "  適用失敗: $f"; grep -m3 ERROR /tmp/sql082_err.txt; return 1; }; done; }
eq() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 (期待: $2 / 実際: $3)"; fi; }
fresh() {
  docker exec -i $C psql -U postgres -d postgres -qc "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
  q -c "grant usage on schema public to anon, authenticated, service_role; grant all on schema public to postgres, service_role;
        alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
        alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
        alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" >/dev/null
  apply scripts/test-b2c/db/000_base_from_prod.sql sql/043_shipment_change_requests.sql sql/033_hotel_change_schema.sql sql/063_fix_hotel_change_tracking_column.sql
}
EXPAND=(sql/067_pickup_requests.sql sql/069_facilities.sql sql/068_change_requests_pickup_lock.sql sql/061_b2c_mvp.sql sql/062_b2c_stage4.sql sql/073_b2c_outbox_hardening.sql sql/071_b2c_cutoff_1830.sql sql/074_b2c_stage5_payments.sql sql/075_pickup_watch_alerts.sql sql/076_agency_change_atomic.sql sql/077_operator_email_code_attempts.sql sql/078_pickup_customer_numbering.sql sql/079_b2c_legal_versions.sql)
b2c_seed() {
  q -c "insert into b2c_entry_links (referrer_code, referrer_name, token_hash) values ('HKU','Hankyu','t-$RANDOM');
        insert into b2c_facilities (place_id,name,status,checked_by,last_verified_at) values ('P1','H1','verified','op',now()),('P2','H2','verified','op',now()) on conflict do nothing;
        insert into b2c_ops_days (date, max_new_bookings, max_pieces) select d::date, 100, 500 from generate_series(current_date, current_date + 30, '1 day') d on conflict (date) do update set max_new_bookings = 100, max_pieces = 500;" >/dev/null
}
EXPAND=(sql/067_pickup_requests.sql sql/069_facilities.sql sql/068_change_requests_pickup_lock.sql sql/061_b2c_mvp.sql sql/062_b2c_stage4.sql sql/073_b2c_outbox_hardening.sql sql/071_b2c_cutoff_1830.sql sql/074_b2c_stage5_payments.sql sql/075_pickup_watch_alerts.sql sql/076_agency_change_atomic.sql sql/077_operator_email_code_attempts.sql sql/078_pickup_customer_numbering.sql sql/079_b2c_legal_versions.sql sql/072_enable_pickup_lock.sql sql/070_change_deadline_1830.sql sql/080_cron_heartbeats.sql sql/081_b2c_leg_prefecture.sql)
b2c_seed() {
  q -c "insert into b2c_entry_links (referrer_code, referrer_name, token_hash) values ('HKU','Hankyu','t-$RANDOM');
        insert into b2c_facilities (place_id,name,status,checked_by,last_verified_at) values ('P1','H1','verified','op',now()),('P2','H2','verified','op',now()) on conflict do nothing;
        insert into b2c_ops_days (date, max_new_bookings, max_pieces) select d::date, 100, 500 from generate_series(current_date - 10, current_date + 30, '1 day') d on conflict (date) do update set max_new_bookings = 100, max_pieces = 500;" >/dev/null
}
b2c_order() {
  q -c "insert into b2c_orders (entry_link_id, referrer_code, guest_name, guest_email, guest_whatsapp, origin_place_id, dest_place_id, origin_snapshot, dest_snapshot,
          pickup_date, delivery_date, pieces, route_class, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen, price_rule_version, status, confirmation_mode, card_status, consented_at, access_token_hash, card_consent_version, card_consented_at)
        select id,'HKU','Guest','g@example.com','+819000000000','P1','P2', '$2'::jsonb, '$3'::jsonb,
          current_date+$1,current_date+$1+1,2,'standard',3000,6000,600,6600,'v1','card_pending','instant','registered',now(),md5(random()::text),'card-v1',now()
        from b2c_entry_links limit 1 returning id" | head -1
}
ORIG_OK='{"name":"H1","prefecture":"東京都","check_in":"2026-12-01","check_out":"2026-12-05"}'
DEST_OK='{"name":"H2","prefecture":"京都府","check_in":"2026-12-05","check_out":"2026-12-08"}'
mk() { local o; o=$(b2c_order "$1" "$ORIG_OK" "$DEST_OK"); q -c "update b2c_orders set stripe_customer_id='cus_test_082', stripe_payment_method_id='pm_test_082', consent_version='terms-v1' where id='$o'; select b2c_confirm_order('$o')" >/dev/null; echo "$o"; }
sid() { q -c "select id from shipments where b2c_order_id='$1'"; }
cp_() { q -c "select b2c_confirm_pickup('$1','ops@example.invalid','cred-1','sagawa_tracking','trk-1',$2,'集荷を確認',$3)->>'result'"; }
FUNCS="'b2c_charge_check','b2c_resolve_charge_hold','b2c_confirm_pickup','b2c_revoke_pickup','b2c_record_piece_correction'"
defs5() { q -c "select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.proname)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ($FUNCS)"; }
defs_other() { q -c "select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.proname, p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.proname not in ($FUNCS)"; }
schema_md5() { q -c "select md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||coalesce(column_default,''), ',' order by table_name, column_name)) from information_schema.columns where table_schema='public'"; }
data_md5() { q -c "select md5(concat_ws('#',
  (select string_agg(to_jsonb(s)::text, '' order by id) from shipments s),
  (select string_agg(to_jsonb(o)::text, '' order by id) from b2c_orders o),
  (select string_agg(to_jsonb(p)::text, '' order by id) from b2c_payments p),
  (select string_agg(to_jsonb(c)::text, '' order by id) from b2c_pickup_confirmations c),
  (select string_agg(to_jsonb(r)::text, '' order by id) from shipment_change_requests r),
  (select string_agg(to_jsonb(e)::text, '' order by id) from b2c_order_events e),
  (select string_agg(to_jsonb(x)::text, '' order by id) from pickup_requests x)))"; }
T0="'2026-11-10 03:00:00+00'::timestamptz"

echo "A. 本番移行の順番（067〜081 の後）に足せる・既存のデータを変えない・二重適用"
fresh
apply "${EXPAND[@]}" && eq "067〜081 を本番の順番で適用できる" ok ok
q -c "update pickup_request_settings set claims_paused = false" >/dev/null
b2c_seed
# 既存のデータ: B2B の区間・B2C の確定・集荷の確認済み（予定）・個数違い（保留）・請求済み・取消の申請中・追跡で配達済み
B2B=$(q -c "insert into shipments (booking_id, leg_index, shipment_date, expected_arrival, from_hotel, to_hotel, status, suitcase_count, agency, representative, recipient)
            values ('BDX-082-B2B',0,current_date+3,current_date+4,'A','B','issued',2,'AG','R','R') returning id" | head -1)
q -c "insert into shipments (booking_id, leg_index, shipment_date, expected_arrival, from_hotel, to_hotel, status, suitcase_count, agency, representative, recipient)
      values ('BDX-082-B2B',1,current_date+5,current_date+6,'B','C','picked_up',2,'AG','R','R')" >/dev/null
O_SCHED=$(mk 3); eq "既存: 集荷の確認済み（請求の予定）" confirmed "$(cp_ "$O_SCHED" 2 "$T0")"
O_HOLD=$(mk 3);  eq "既存: 個数違いで保留" confirmed "$(cp_ "$O_HOLD" 3 "$T0")"
O_PAID=$(mk 3);  cp_ "$O_PAID" 2 "$T0" >/dev/null; q -c "update b2c_payments set status='succeeded', succeeded_at=$T0 + interval '31 minutes', stripe_payment_intent_id='pi_test_082_paid' where order_id='$O_PAID'" >/dev/null
O_CREQ=$(mk 3);  q -c "insert into shipment_change_requests (shipment_id, booking_id, leg_index, kind, stage, requested_by, reason) select id, booking_id, leg_index, 'cancel', 'requested', 'operator', 'x' from shipments where b2c_order_id='$O_CREQ'" >/dev/null
O_DELIV=$(mk 3); q -c "update shipments set status='delivered', picked_up_at=$T0 where b2c_order_id='$O_DELIV'" >/dev/null
DEF081=$(defs5); OTHER081=$(defs_other); SCHEMA081=$(schema_md5); DATA081=$(data_md5)
eq "082 の前は、配達済みの区間を確認できない（今の問題の再現）" shipment_not_pickable "$(cp_ "$O_DELIV" 2 "$T0")"
DATA081=$(data_md5)
q -1 < "$R/sql/082_b2c_charge_safety.sql" >/dev/null 2>/tmp/sql082_err.txt && eq "082 を適用できる（ロック有効）" ok ok || { eq "082 を適用できる" ok ng; grep -m3 ERROR /tmp/sql082_err.txt; }
eq "既存のデータは 1文字も変わらない（区間・予約・請求・確認・申請・記録・集荷依頼）" "$DATA081" "$(data_md5)"
DEF082=$(defs5)
[ "$DEF082" != "$DEF081" ] && eq "5つの関数の定義が変わった" ok ok || eq "5つの関数の定義が変わった" changed same
q -1 < "$R/sql/082_b2c_charge_safety.sql" >/dev/null 2>&1 && eq "二重適用できる" ok ok || eq "二重適用できる" ok ng
eq "二重適用の後も定義は同じ" "$DEF082" "$(defs5)"
eq "二重適用の後もデータは同じ" "$DATA081" "$(data_md5)"

echo "B. 変えるのは 5つの関数だけ・権限はそのまま"
eq "ほかの関数の定義は同じ" "$OTHER081" "$(defs_other)"
eq "表・列の定義は同じ" "$SCHEMA081" "$(schema_md5)"
for f in "b2c_charge_check(public.b2c_payments)" "b2c_resolve_charge_hold(uuid, text, text, text, text, timestamptz)" "b2c_confirm_pickup(uuid, text, text, text, text, int, text, timestamptz, interval)" "b2c_revoke_pickup(uuid, text, text, text, timestamptz)" "b2c_record_piece_correction(uuid, int, text, text, text, text, text, timestamptz, interval)"; do
  eq "権限 ${f%%(*}: 匿名・ログイン利用者は呼べない・サーバーは呼べる" "false|false|true" "$(q -c "select has_function_privilege('anon','public.$f','execute')||'|'||has_function_privilege('authenticated','public.$f','execute')||'|'||has_function_privilege('service_role','public.$f','execute')")"
done

echo "C. 本物の PostgreSQL での動き"
O_C1=$(mk 3); cp_ "$O_C1" 2 "$T0" >/dev/null
CR1=$(q -c "insert into shipment_change_requests (shipment_id, booking_id, leg_index, kind, stage, requested_by, reason) select id, booking_id, leg_index, 'cancel', 'requested', 'operator', 'x' from shipments where b2c_order_id='$O_C1' returning id" | head -1)
eq "取消の申請中は取り出さない（on_hold・cancel_pending）" "0|on_hold|cancel_pending" "$(q -c "select count(*) filter (where order_id='$O_C1') from b2c_claim_charges($T0 + interval '31 minutes', 50, 't')")|$(q -c "select status||'|'||hold_reason from b2c_payments where order_id='$O_C1'")"
q -c "update b2c_payments set status='on_hold', hold_reason='x_other' where status='processing'" >/dev/null  # ほかの予定の行は試験の外に置く
PID1=$(q -c "select id from b2c_payments where order_id='$O_C1'")
eq "申請が残ったまま解除 → 次の取り出しで再び止まる" "released|0|on_hold" "$(q -c "select b2c_resolve_charge_hold('$PID1','release','ops@example.invalid','cred-1','確認',$T0 + interval '32 minutes')")|$(q -c "select count(*) filter (where order_id='$O_C1') from b2c_claim_charges($T0 + interval '33 minutes', 50, 't')")|$(q -c "select status from b2c_payments where id='$PID1'")"
q -c "update shipment_change_requests set stage='rejected' where id='$CR1'" >/dev/null
eq "却下の後の解除 → 1回だけ取り出す" "released|1|0" "$(q -c "select b2c_resolve_charge_hold('$PID1','release','ops@example.invalid','cred-1','却下',$T0 + interval '34 minutes')")|$(q -c "select count(*) filter (where order_id='$O_C1') from b2c_claim_charges($T0 + interval '35 minutes', 50, 't')")|$(q -c "select count(*) filter (where order_id='$O_C1') from b2c_claim_charges($T0 + interval '36 minutes', 50, 't')")"
eq "追跡で配達済みの区間も確認できる・区間は delivered のまま" "confirmed|delivered" "$(cp_ "$O_DELIV" 2 "$T0")|$(q -c "select status from shipments where b2c_order_id='$O_DELIV'")"
eq "B2B の区間は集荷の確認の対象外（関数は B2C の予約だけ）・B2B の区間は変わらない" "not_found|issued" "$(q -c "select b2c_confirm_pickup(gen_random_uuid(),'ops@example.invalid','cred-1','sagawa_tracking','t',2,'x',$T0)->>'result'")|$(q -c "select status from shipments where id='$B2B'")"

echo "D. 切り戻し（082 → 081 の順）と再適用"
q -c "update b2c_payments set status='on_hold', hold_reason='cancel_pending' where order_id='$O_SCHED'" >/dev/null   # 082 の理由で止まった行
q -1 < "$R/sql/rollback/rollback_082.sql" >/dev/null 2>/tmp/sql082_err.txt && eq "rollback_082 を流せる" ok ok || { eq "rollback_082 を流せる" ok ng; grep -m3 ERROR /tmp/sql082_err.txt; }
eq "5つの関数が 081 の時と完全に同じ定義に戻る" "$DEF081" "$(defs5)"
eq "ほかの関数も同じ" "$OTHER081" "$(defs_other)"
eq "切り戻しの後、cancel_pending で止まった行は運営が『請求をやめる』で片付けられる（解除はできない）" "not_overridable|cancelled" "$(q -c "select b2c_resolve_charge_hold((select id from b2c_payments where order_id='$O_SCHED'),'release','ops@example.invalid','cred-1','x')")|$(q -c "select b2c_resolve_charge_hold((select id from b2c_payments where order_id='$O_SCHED'),'cancel','ops@example.invalid','cred-1','x')")"
q -1 < "$R/sql/rollback/rollback_081.sql" >/dev/null 2>/tmp/sql082_err.txt && eq "続けて rollback_081 も流せる（順番: 082 → 081）" ok ok || { eq "rollback_081 を流せる" ok ng; grep -m3 ERROR /tmp/sql082_err.txt; }
apply sql/081_b2c_leg_prefecture.sql sql/082_b2c_charge_safety.sql && eq "081 → 082 を再適用できる" ok ok
eq "再適用の後の定義は初回と同じ" "$DEF082" "$(defs5)"

echo "E. 同時実行"
fresh; apply "${EXPAND[@]}" >/dev/null; q -c "update pickup_request_settings set claims_paused = false" >/dev/null; b2c_seed
O_E=$(mk 3); cp_ "$O_E" 2 "$T0" >/dev/null
DEF_E=$(defs5); DATA_E=$(data_md5)
docker exec -i $C psql -U postgres -d $DB -qtA -c "begin; select 1 from shipments limit 1 for update; select pg_sleep(14); commit;" >/dev/null 2>&1 &
HOLDER=$!; sleep 1
t0=$(date +%s); q -1 < "$R/sql/082_b2c_charge_safety.sql" >/dev/null 2>/tmp/sql082_err.txt; rc=$?; t1=$(date +%s)
eq "区間を掴んでいる利用者がいる → 失敗（10秒前後）" "fail|yes" "$([ $rc -ne 0 ] && echo fail || echo ok)|$([ $((t1-t0)) -ge 9 ] && [ $((t1-t0)) -le 13 ] && echo yes || echo no:$((t1-t0)))"
eq "失敗した時は何も変えていない（定義・データ）" "$DEF_E|$DATA_E" "$(defs5)|$(data_md5)"
wait $HOLDER
q -1 < "$R/sql/082_b2c_charge_safety.sql" >/dev/null 2>&1 && eq "離した後は成功" ok ok || eq "離した後は成功" ok ng
apply sql/rollback/rollback_082.sql >/dev/null
( q -1 < "$R/sql/082_b2c_charge_safety.sql" >/dev/null 2>/tmp/sql082_p1.txt; echo $? > /tmp/sql082_rc1 ) &
( q -1 < "$R/sql/082_b2c_charge_safety.sql" >/dev/null 2>/tmp/sql082_p2.txt; echo $? > /tmp/sql082_rc2 ) &
wait
eq "2つ同時に流す → 両方成功（順に）・定義は 1回流した時と同じ" "0|0|$DEF082" "$(cat /tmp/sql082_rc1)|$(cat /tmp/sql082_rc2)|$(defs5)"
apply sql/rollback/rollback_082.sql >/dev/null
# 請求の取り出しの最中（行を掴んだ取引）に流す → 取り出しが終わるのを待ってから変える・取り出しは 1回
docker exec -i $C psql -U postgres -d $DB -qtA -c "begin; select count(*) from b2c_claim_charges($T0 + interval '31 minutes', 50, 'w1'); select pg_sleep(3); commit;" > /tmp/sql082_claim1.txt 2>&1 &
W1=$!; sleep 1
q -1 < "$R/sql/082_b2c_charge_safety.sql" >/dev/null 2>&1; rc=$?
wait $W1
eq "取り出しの最中に流す → 待って成功・取り出しは 1回（processing 1行）・次の取り出しは 0" "0|1|0" "$rc|$(q -c "select count(*) from b2c_payments where order_id='$O_E' and status='processing'")|$(q -c "select count(*) from b2c_claim_charges($T0 + interval '40 minutes', 50, 'w2')")"

docker exec -i $C psql -U postgres -d postgres -qc "drop database if exists $DB" >/dev/null 2>&1
echo
echo "sql082: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
