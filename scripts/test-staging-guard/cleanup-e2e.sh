#!/usr/bin/env bash
# scripts/staging/cleanup-e2e.sh の試験（P0-3）。**ローカルの DB のコンテナの中だけ**（外には接続しない）。
# 土台: 予行演習のデータベース（REHEARSAL_BASE・既定 bondex_stg_audit1107 = staging と同じ定義と印）を複製して使い、最後に消す。
#   bash scripts/test-staging-guard/cleanup-e2e.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
C=${PSQL_CONTAINER:-supabase_db_supa-local}
BASE=${REHEARSAL_BASE:-bondex_stg_audit1107}
T=bondex_stg_clntest
NM=bondex_stg_clnnomark
PASS=0; FAIL=0
ok() { if [ "$2" = "0" ]; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 ${3:-}"; fi; }
db() { docker exec -i "$C" psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -qtA -c "$2"; }
fresh() { db postgres "drop database if exists $1" >/dev/null; db postgres "create database $1 template $BASE" >/dev/null; }
run() { REHEARSAL_LOCAL_DB=${DBN:-$T} bash scripts/staging/cleanup-e2e.sh "$@" 2>&1; }
SINCE=2026-11-07T00:00:00+09:00

seed() { # E2E1107A の予約 2件（1件は配送・請求・返金・集荷の確認・通知・記録・受入つき）、HNK001 の予約 1件（残る）、B2B の配送 1件（残る）
db $T "set session_replication_role = replica;
insert into b2c_entry_links(id, referrer_code, referrer_name, token_hash) values
  ('00000000-0000-0000-0000-0000000000e1', 'E2E1107A', 'E2E', 'h-e2e'), ('00000000-0000-0000-0000-0000000000a1', 'HNK009', '阪急', 'h-hnk');
insert into b2c_facilities(place_id, name, status) values ('bdx-staging-mock-tokyo-0001', 'mock tokyo', 'unknown'), ('bdx-staging-mock-kyoto-0002', 'mock kyoto', 'unknown');
insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('ChIJrealhotel000001', 'real hotel', 'verified', 'x', now());
insert into b2c_orders(id, entry_link_id, referrer_code, guest_name, guest_email, guest_whatsapp, origin_place_id, dest_place_id, origin_snapshot, dest_snapshot, pickup_date, delivery_date, pieces, route_class, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen, price_rule_version, confirmation_mode, confirmation_due_at, access_token_hash, stripe_setup_intent_id) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000e1', 'E2E1107A', 'E2E A', 'a@example.invalid', '+819012345678', 'bdx-staging-mock-tokyo-0001', 'bdx-staging-mock-kyoto-0002', '{}', '{}', '2026-11-20', '2026-11-22', 2, 'standard', 4980, 9960, 996, 10956, 't', 'instant', null, 'ath-e1', 'seti_e2e_1'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000e1', 'E2E1107A', 'E2E B', 'b@example.invalid', '+819012345678', 'bdx-staging-mock-tokyo-0001', 'ChIJrealhotel000001', '{}', '{}', '2026-11-20', '2026-11-22', 1, 'standard', 4980, 4980, 498, 5478, 't', 'awaiting_hotel_verification', now() + interval '1 day', 'ath-e2', null),
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000000a1', 'HNK009', 'Keep', 'k@example.invalid', '+819012345678', 'bdx-staging-mock-tokyo-0001', 'ChIJrealhotel000001', '{}', '{}', '2026-11-20', '2026-11-22', 1, 'standard', 4980, 4980, 498, 5478, 't', 'instant', null, 'ath-a1', null);
insert into shipments(id, booking_id, agency, representative, shipment_date, expected_arrival, from_hotel, to_hotel, recipient, channel, b2c_order_id) values
  ('00000000-0000-0000-0000-0000000005e1', 'B2C-E1', 'BondEx Direct', 'E2E A', '2026-11-20', '2026-11-22', 'a', 'b', 'E2E A', 'b2c', '00000000-0000-0000-0000-00000000e001'),
  ('00000000-0000-0000-0000-0000000005a1', 'B2C-A1', 'BondEx Direct', 'Keep', '2026-11-20', '2026-11-22', 'a', 'b', 'Keep', 'b2c', '00000000-0000-0000-0000-00000000a001');
insert into shipments(id, booking_id, agency, representative, shipment_date, expected_arrival, from_hotel, to_hotel, recipient) values
  ('00000000-0000-0000-0000-0000000005b1', 'B2B-1', 'Some Agency', 'b2b', '2026-11-20', '2026-11-22', 'a', 'b', 'b2b');
insert into b2c_pickup_confirmations(id, order_id, shipment_id, operator_email, credential_id, evidence_type, evidence_ref, booked_pieces, accepted_pieces, reason, prev_shipment_status) values
  ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000005e1', 'ops@example.invalid', 'cred', 'sagawa_driver', 'r', 2, 2, 'r', 'issued');
insert into b2c_payments(id, order_id, kind, charge_key, amount_yen, scheduled_at, created_by, status, succeeded_at, refunded_yen, stripe_payment_intent_id, pickup_confirmation_id) values
  ('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-00000000e001', 'base', 'base:00000000-0000-0000-0000-00000000e001', 10956, now(), 'ops', 'partially_refunded', now(), 1000, 'pi_e2e_1', '00000000-0000-0000-0000-0000000c0001');
insert into b2c_refunds(payment_id, amount_yen, reason, requested_by, refund_key, stripe_refund_id) values ('00000000-0000-0000-0000-0000000f0001', 1000, 'r', 'ops', 'rk1', 're_e2e_1');
insert into b2c_hotel_acceptances(order_id, side) values ('00000000-0000-0000-0000-00000000e002', 'origin');
insert into b2c_outbox(order_id, kind, channel, dedupe_key) values ('00000000-0000-0000-0000-00000000e001', 'booking_confirmed', 'email', 'bc:e1'), ('00000000-0000-0000-0000-00000000a001', 'booking_confirmed', 'email', 'bc:a1');
insert into b2c_order_events(order_id, shipment_id, event, actor_type) values ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000005e1', 'confirmed', 'system'), ('00000000-0000-0000-0000-00000000e002', null, 'facility_hold', 'system'), ('00000000-0000-0000-0000-00000000a001', null, 'confirmed', 'system');
insert into b2c_stripe_events(event_id, type, object_id) values ('evt_e1', 'setup_intent.succeeded', 'seti_e2e_1'), ('evt_e2', 'payment_intent.succeeded', 'pi_e2e_1'), ('evt_keep', 'payment_intent.succeeded', 'pi_other');
" >/dev/null || { echo "SEED FAILED"; exit 1; }
}
cnt() { db $T "select (select count(*) from b2c_orders)||','||(select count(*) from shipments)||','||(select count(*) from b2c_payments)||','||(select count(*) from b2c_refunds)||','||(select count(*) from b2c_order_events)||','||(select count(*) from b2c_outbox)||','||(select count(*) from b2c_stripe_events)||','||(select count(*) from b2c_entry_links)||','||(select count(*) from b2c_facilities)"; }

echo "1. 引数（DB に接続する前に止める）"
out=$(run --run HNK001 --since $SINCE); [[ "$out" == *"STOP: --run は E2E"* ]]; ok "E2E で始まらない紹介元は拒否" $? "$out"
out=$(run --run E2E1107A); [[ "$out" == *"STOP: --since"* ]]; ok "開始の時刻なしは拒否" $?
out=$(run --run E2E1107A --since $SINCE --execute); [[ "$out" == *"指紋"* && "$out" == *STOP* ]]; ok "--execute に指紋なしは拒否" $?
out=$(run --run "E2E1107A;drop" --since $SINCE); [[ "$out" == *"STOP"* ]]; ok "記号の混じったコードは拒否" $?

echo "2. 本番の DB では動かない"
tmpenv=$(mktemp); echo "STAGING_DB_URL=postgresql://postgres.dscxftwfspgihkszfakk:x@aws-0.pooler.supabase.com:5432/postgres" > $tmpenv
out=$(CLEANUP_ENV_FILE=$tmpenv bash scripts/staging/cleanup-e2e.sh --run E2E1107A --since $SINCE 2>&1); [[ "$out" == *"本番の ID があります（接続しません）"* ]]; ok "接続文字列に本番の ID → 接続の前に止める" $? "$out"
echo "STAGING_DB_URL=postgresql://postgres.someotherref:x@aws-0.pooler.supabase.com:5432/postgres" > $tmpenv
out=$(CLEANUP_ENV_FILE=$tmpenv bash scripts/staging/cleanup-e2e.sh --run E2E1107A --since $SINCE 2>&1); [[ "$out" == *"試験環境の ID がありません"* ]]; ok "接続文字列に試験環境の ID が無い → 止める" $?
rm -f $tmpenv
fresh $T; seed; before=$(cnt)
LOCAL_SYSID=$(db postgres "select system_identifier from pg_control_system()")
out=$(CLEANUP_TEST_PROD_SYSID=$LOCAL_SYSID run --run E2E1107A --since $SINCE); [[ "$out" == *"本番の DB につながっています"* && "$(cnt)" == "$before" ]]; ok "DB の番号が本番と同じ → 止める・何も消さない" $? "$out"
out=$(CLEANUP_TEST_STAGING_SYSID=1234567890 run --run E2E1107A --since $SINCE); [[ "$out" == *"番号と一致しません"* ]]; ok "DB の番号が試験環境と違う → 止める" $?
fresh $NM; db $NM "drop schema staging_guard cascade" >/dev/null
out=$(DBN=$NM run --run E2E1107A --since $SINCE); [[ "$out" == *"試験環境の印がありません"* ]]; ok "試験環境の印が無い DB（本番の形）→ 止める" $? "$out"
db postgres "drop database if exists $NM" >/dev/null
# 取引の中の確認: 印が途中で消えた場合（事前の確認の後に接続先が変わった想定）は、取引の先頭の確認で止まる
out=$( { echo "begin;"; echo "do \$g\$ begin if not exists (select 1 from information_schema.tables where table_schema='staging_guard_missing') then raise exception 'STOP: 試験環境の印がありません'; end if; end \$g\$;"; echo "delete from b2c_orders;"; echo "commit;"; } | docker exec -i $C psql -U postgres -d $T -v ON_ERROR_STOP=1 -q 2>&1); [[ "$out" == *"STOP"* && "$(cnt)" == "$before" ]]; ok "取引の先頭の確認が失敗すると、後ろの削除は実行されない" $?

echo "3. dry-run（既定）"
out=$(run --run E2E1107A --since $SINCE); rc=$?
[ $rc = 0 ] && [[ "$out" == *"dry-run: 何も消していません"* ]]; ok "dry-run は成功し、消さない" $? "$out"
[ "$(cnt)" = "$before" ]; ok "dry-run の後も件数は同じ（$before）" $?
echo "$out" | grep -qE '^b2c_orders\|2$|b2c_orders +\| +2' ; ok "対象の予約は 2件（E2E の入口だけ）" $? "$out"
echo "$out" | grep -qE 'shipments +\| +1'; ok "対象の配送は 1件（B2B・他の入口の配送は対象外）" $?
echo "$out" | grep -qE 'b2c_stripe_events +\| +2'; ok "Stripe の受付の記録は対象の 2件だけ" $?
echo "$out" | grep -qE 'b2c_facilities（架空のホテル） +\| +1'; ok "架空のホテルは、他の予約が使う東京を残し京都だけ" $?
FP=$(echo "$out" | sed -nE 's/.*指紋（execute の --confirm に渡す）: ([0-9a-f]{32}).*/\1/p' | head -1)
[ -n "$FP" ]; ok "指紋を出す" $?
[[ "$out" != *"E2E A"* && "$out" != *"a@example.invalid"* ]]; ok "出力に旅行者の名前・メールを出さない（ドメインだけ）" $?

echo "4. execute（承認の後）"
out=$(run --run E2E1107A --since $SINCE --execute --confirm 0123456789abcdef0123456789abcdef); [[ "$out" == *"指紋が dry-run と一致しません"* && "$(cnt)" == "$before" ]]; ok "違う指紋 → 止める・何も消さない" $? "$out"
db $T "set session_replication_role = replica; insert into b2c_outbox(order_id, kind, channel, dedupe_key) values ('00000000-0000-0000-0000-00000000e002', 'awaiting_hotel', 'email', 'ah:e2')" >/dev/null
out=$(run --run E2E1107A --since $SINCE --execute --confirm $FP); [[ "$out" == *"一致しません"* ]]; ok "dry-run の後に対象が増えた → 指紋が合わず止める" $?
FP2=$(run --run E2E1107A --since $SINCE | sed -nE 's/.*指紋（execute の --confirm に渡す）: ([0-9a-f]{32}).*/\1/p' | head -1)
out=$(run --run E2E1107A --since $SINCE --execute --confirm $FP2); rc=$?
[ $rc = 0 ] && [[ "$out" == *"削除を確定しました"* ]]; ok "正しい指紋 → 削除" $? "$out"
[ "$(db $T "select string_agg(id::text, ',') from b2c_orders")" = "00000000-0000-0000-0000-00000000a001" ]; ok "残る予約は HNK009 の 1件だけ" $?
[ "$(db $T "select count(*) from shipments where id in ('00000000-0000-0000-0000-0000000005a1','00000000-0000-0000-0000-0000000005b1')")" = "2" ]; ok "他の入口の配送・B2B の配送は残る" $?
[ "$(db $T "select count(*) from b2c_order_events")|$(db $T "select count(*) from b2c_outbox")|$(db $T "select string_agg(event_id, ',') from b2c_stripe_events")" = "1|1|evt_keep" ]; ok "記録・通知・Stripe の受付は対象の外だけ残る" $?
v=$(db $T "select string_agg(referrer_code, ',') from b2c_entry_links"); [ "$v" = "HNK001,HNK009" ]; ok "E2E の入口は消え、阪急の入口（staging の種の HNK001 と試験の HNK009）は残る" $? "$v"
v=$(db $T "select string_agg(place_id, ',' order by place_id collate \"C\") from b2c_facilities"); [ "$v" = "ChIJrealhotel000001,bdx-staging-mock-tokyo-0001" ]; ok "本物のホテルと、他の予約が使う架空のホテルは残る" $? "$v"
[ "$(db $T "select tgenabled from pg_trigger where tgname='b2c_order_events_append_only'")" = "O" ]; ok "操作の記録の追記だけの保護が戻っている" $?
out=$(db $T "delete from b2c_order_events" 2>&1); [[ "$out" == *"append-only"* ]]; ok "保護が効いている（記録を消せない）" $?
out=$(run --run E2E1107A --since $SINCE); [[ "$out" == *"入口がありません"* ]]; ok "2回目は対象が無く止まる（二重に消さない）" $?

echo "4b. 削除の途中の失敗 → 全部を取り消す（ロールバック）"
fresh $T; seed; b=$(cnt)
# 配送の削除（請求・返金・記録の削除の後）で失敗させる: この試験の DB にだけ失敗の trigger を足す
db $T "create function zz_fail() returns trigger language plpgsql as \$f\$ begin raise exception 'injected failure'; end \$f\$; create trigger zz_fail before delete on shipments for each row execute function zz_fail();" >/dev/null
FP3=$(run --run E2E1107A --since $SINCE | sed -nE 's/.*指紋（execute の --confirm に渡す）: ([0-9a-f]{32}).*/\1/p' | head -1)
out=$(run --run E2E1107A --since $SINCE --execute --confirm $FP3); rc=$?
[ $rc != 0 ] && [[ "$out" == *"injected failure"* && "$out" == *"止まりました（何も消していません）"* ]]; ok "途中で失敗 → 失敗として終わる" $? "$out"
[ "$(cnt)" = "$b" ]; ok "先に消したはずの請求・返金・通知・記録も含めて、全部が元のまま（$b）" $? "$(cnt)"
[ "$(db $T "select tgenabled from pg_trigger where tgname='b2c_order_events_append_only'")" = "O" ]; ok "操作の記録の保護も有効のまま" $?
db $T "drop trigger zz_fail on shipments" >/dev/null
out=$(run --run E2E1107A --since $SINCE --execute --confirm $FP3); [[ "$out" == *"削除を確定しました"* ]]; ok "原因を除けば、同じ指紋で削除できる（中途半端な状態が残っていない）" $? "$out"

echo "5. 止める条件（何も消さない）"
fresh $T; seed
db $T "set session_replication_role = replica; update b2c_orders set created_at = '2026-11-01' where id='00000000-0000-0000-0000-00000000e002'" >/dev/null; b=$(cnt)
out=$(run --run E2E1107A --since $SINCE); [[ "$out" == *"開始の時刻より前の予約"* && "$(cnt)" == "$b" ]]; ok "同じ入口に前からの予約（コードの使い回し）→ 止める" $? "$out"
fresh $T; seed; db $T "set session_replication_role = replica; update b2c_payments set status='processing', succeeded_at=null" >/dev/null
out=$(run --run E2E1107A --since $SINCE); [[ "$out" == *"処理中・結果不明の請求"* ]]; ok "処理中の請求 → 止める" $? "$out"
fresh $T; seed; db $T "set session_replication_role = replica; insert into pickup_requests(shipment_id, booking_id, leg_index, channel, state) values ('00000000-0000-0000-0000-0000000005e1', 'B2C-E1', 0, 'manual', 'accepted')" >/dev/null
out=$(run --run E2E1107A --since $SINCE); [[ "$out" == *"集荷依頼 1 件"* ]]; ok "集荷依頼が参照 → 止める" $? "$out"
fresh $T; seed; db $T "create table public.zz_new_table(id serial, order_id uuid); insert into zz_new_table(order_id) values ('00000000-0000-0000-0000-00000000e001')" >/dev/null
out=$(run --run E2E1107A --since $SINCE); [[ "$out" == *"扱っていない表 zz_new_table.order_id"* ]]; ok "扱っていない新しい表が参照 → 止める" $? "$out"
# DB の制約（channel と b2c_order_id の整合）が普段は防ぐ。壊れた行を作るため、この試験の DB でだけ制約を外す
fresh $T; seed; db $T "alter table shipments drop constraint shipments_b2c_order_consistency; set session_replication_role = replica; update shipments set channel='b2b' where id='00000000-0000-0000-0000-0000000005e1'" >/dev/null
out=$(run --run E2E1107A --since $SINCE); [[ "$out" == *"B2B の配送"* ]]; ok "B2B の配送が混ざる → 止める" $? "$out"

[ -n "${KEEP_DB:-}" ] || db postgres "drop database if exists $T" >/dev/null
echo "cleanup-e2e: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
