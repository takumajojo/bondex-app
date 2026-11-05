#!/usr/bin/env bash
# sql/081（B2C の区間に都道府県・集荷元のチェックアウト日）の試験。ローカルの DB コンテナの中の、試験専用のデータベースだけ
# （共有の public・本番・Supabase には接続しない）。
#   実行: bash scripts/test-integ/sql081.sh
# 確かめること:
#   A. 本番移行の順番の最後に足せる・二重適用
#   B. 新しい予約の確定: 区間に都道府県・チェックアウト日が入る・控えに無い/日付が壊れていても確定は止まらない・ほかの列は 071 と同じ
#   C. 既にある区間の埋め戻し: 空の列だけ・運営が直した値は残す・集荷依頼済みの区間の都道府県は変えない・B2B は変えない
#   D. 切り戻し（071 の定義に戻る・埋め戻した値は残る）と再適用
#   E. 同時実行: 区間を掴んでいる利用者がいる時は 10秒で何も変えずに失敗・離した後は成功・同じ予約の同時の確定で区間は 1つ
#   F. 権限: 匿名・ログイン利用者は関数を呼べない
set -uo pipefail
R="$(cd "$(dirname "$0")/../.." && pwd)"
C=${PG_TEST_CONTAINER:-supabase_db_supa-local}; DB=${SQL081_TEST_DB:-bondex_sql081_test}
PASS=0; FAIL=0
q() { docker exec -i $C psql -U postgres -d $DB -v ON_ERROR_STOP=1 -qtA "$@"; }
apply() { for f in "$@"; do q -1 < "$R/$f" >/dev/null 2>/tmp/sql081_err.txt || { echo "  適用失敗: $f"; grep -m3 ERROR /tmp/sql081_err.txt; return 1; }; done; }
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
# 予約（集荷日のオフセット・集荷元の控え・配送先の控え）→ order id
b2c_order() {
  q -c "insert into b2c_orders (entry_link_id, referrer_code, guest_name, guest_email, guest_whatsapp, origin_place_id, dest_place_id, origin_snapshot, dest_snapshot,
          pickup_date, delivery_date, pieces, route_class, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen, price_rule_version, status, confirmation_mode, card_status, consented_at, access_token_hash, card_consent_version, card_consented_at)
        select id,'HKU','Guest','g@example.com','+819000000000','P1','P2', '$2'::jsonb, '$3'::jsonb,
          current_date+$1,current_date+$1+1,2,'standard',3000,6000,600,6600,'v1','card_pending','instant','registered',now(),md5(random()::text),'card-v1',now()
        from b2c_entry_links limit 1 returning id" | head -1
}
ORIG_OK='{"name":"H1","prefecture":"東京都","check_in":"2026-12-01","check_out":"2026-12-05"}'
DEST_OK='{"name":"H2","prefecture":"京都府","check_in":"2026-12-05","check_out":"2026-12-08"}'
leg_of() { q -c "select coalesce(from_prefecture,'∅')||'|'||coalesce(to_prefecture,'∅')||'|'||coalesce(origin_check_out::text,'∅') from shipments where b2c_order_id='$1'"; }
# 071 と比べる列（新しい 3列と、行ごとに違う値を除く）
leg_core() { q -c "select (to_jsonb(s) - array['id','booking_id','b2c_order_id','created_at','updated_at','from_prefecture','to_prefecture','origin_check_out','change_deadline_at'])::text from shipments s where b2c_order_id='$1'"; }

echo "A. 本番移行の順番の最後に足せる・二重適用"
fresh
apply "${EXPAND[@]}" sql/072_enable_pickup_lock.sql sql/070_change_deadline_1830.sql sql/080_cron_heartbeats.sql && eq "067〜080 を本番の順番で適用できる" ok ok
eq "本番と同じく、081 の前は origin_check_out の列が無い（054 は未適用）" 0 "$(q -c "select count(*) from information_schema.columns where table_name='shipments' and column_name='origin_check_out'")"
q -c "update pickup_request_settings set claims_paused = false" >/dev/null
b2c_seed
# 081 の前に 071 の版で確定した区間（埋め戻しの対象）を作っておく
O_OLD=$(b2c_order 3 "$ORIG_OK" "$DEST_OK"); q -c "select b2c_confirm_order('$O_OLD')" >/dev/null
O_OPFIX=$(b2c_order 3 "$ORIG_OK" "$DEST_OK"); q -c "select b2c_confirm_order('$O_OPFIX')" >/dev/null
q -c "update shipments set from_prefecture = '神奈川県' where b2c_order_id='$O_OPFIX'" >/dev/null   # 運営が直した値
O_LIVE=$(b2c_order 3 "$ORIG_OK" "$DEST_OK"); q -c "select b2c_confirm_order('$O_LIVE')" >/dev/null
S_LIVE=$(q -c "select id from shipments where b2c_order_id='$O_LIVE'")
CLAIM=$(q -c "select claimed from claim_pickup_request('$S_LIVE','manual',null,null,2,(select shipment_date from shipments where id='$S_LIVE'),'op','op',null)")
eq "集荷依頼済みの区間を用意（有効な依頼）" t "$CLAIM"
# 予約の控えと矛盾・変更の履歴がある区間（埋めずに要確認）
mk() { local o; o=$(b2c_order 3 "$ORIG_OK" "$DEST_OK"); q -c "select b2c_confirm_order('$o')" >/dev/null; echo "$o"; }
O_PLACE=$(mk); q -c "update shipments set to_place_id='P9' where b2c_order_id='$O_PLACE'" >/dev/null          # 配送先のホテルが控えと違う
O_DATE=$(mk);  q -c "update shipments set shipment_date=shipment_date+1 where b2c_order_id='$O_DATE'" >/dev/null # 集荷日が控えと違う
O_HCHG=$(mk);  S_HCHG=$(q -c "select id from shipments where b2c_order_id='$O_HCHG'")
q -c "insert into shipment_hotel_changes (shipment_id, booking_id, leg_index, side, old_hotel, new_hotel, changed_by) select id, booking_id, leg_index, 'guest', 'H2', 'H2', 'op' from shipments where id='$S_HCHG'" >/dev/null
O_CREQ=$(mk); S_CREQ=$(q -c "select id from shipments where b2c_order_id='$O_CREQ'")
q -c "insert into shipment_change_requests (shipment_id, booking_id, leg_index, kind, stage, requested_by, fields) select id, booking_id, leg_index, 'fields', 'withdrawn', 'agency', '{}'::jsonb from shipments where id='$S_CREQ'" >/dev/null
O_CANC=$(mk); q -c "select b2c_cancel_order('$O_CANC','guest','guest')" >/dev/null
O_NOPREF=$(b2c_order 3 '{"name":"H1","check_in":"2026-12-01"}' '{"name":"H2","check_in":"2026-12-05","check_out":"2026-12-08"}'); q -c "select b2c_confirm_order('$O_NOPREF')" >/dev/null
O_REF071=$(b2c_order 4 "$ORIG_OK" "$DEST_OK"); q -c "select b2c_confirm_order('$O_REF071')" >/dev/null
CORE071=$(leg_core "$O_REF071")
B2B=$(q -c "insert into shipments (booking_id, leg_index, shipment_date, expected_arrival, from_hotel, to_hotel, status, suitcase_count, agency, representative, recipient)
            values ('BDX-081-B2B',0,current_date+3,current_date+4,'A','B','issued',2,'AG','R','R') returning id" | head -1)
# 081 は列を 1つ足すので、比べる時はその列を除く（ほかの値が 1つも変わらないこと）
B2B_BEFORE=$(q -c "select md5((to_jsonb(s) - 'origin_check_out')::text) from shipments s where id='$B2B'")
ALL_B2B_BEFORE=$(q -c "select md5(string_agg((to_jsonb(s) - 'origin_check_out')::text, '' order by id)) from shipments s where channel is distinct from 'b2c'")
eq "071 の版の区間には都道府県が無い（今の問題の再現）" "∅|∅" "$(q -c "select coalesce(from_prefecture,'∅')||'|'||coalesce(to_prefecture,'∅') from shipments where b2c_order_id='$O_OLD'")"

q -1 < "$R/sql/081_b2c_leg_prefecture.sql" > /dev/null 2>/tmp/sql081_notice.txt && eq "081 を適用できる（ロック有効・集荷依頼済みの区間があっても）" ok ok
apply sql/081_b2c_leg_prefecture.sql && eq "081 を2回流しても失敗しない" ok ok
eq "081 で origin_check_out の列ができる（date・空を許す）" "date|YES" "$(q -c "select data_type||'|'||is_nullable from information_schema.columns where table_name='shipments' and column_name='origin_check_out'")"

echo "C. 既にある区間の埋め戻し"
eq "空の区間に控えの都道府県・チェックアウト日が入る" "東京都|京都府|2026-12-05" "$(leg_of "$O_OLD")"
eq "運営が直した値は上書きしない（空の to だけ埋まる）" "神奈川県|京都府|2026-12-05" "$(leg_of "$O_OPFIX")"
eq "集荷依頼済みの区間: 埋めない（要確認）" "∅|∅|∅" "$(leg_of "$O_LIVE")"
eq "ホテル（場所の ID）が控えと違う区間: 埋めない" "∅|∅|∅" "$(leg_of "$O_PLACE")"
eq "集荷日が控えと違う区間: 埋めない" "∅|∅|∅" "$(leg_of "$O_DATE")"
eq "ホテルの変更の記録がある区間: 埋めない" "∅|∅|∅" "$(leg_of "$O_HCHG")"
eq "変更・取消の申請の記録がある区間: 埋めない" "∅|∅|∅" "$(leg_of "$O_CREQ")"
eq "取消済みの区間: 埋めない" "∅|∅|∅" "$(leg_of "$O_CANC")"
SKIPPED=$(grep -o '埋めなかった B2C の区間 [0-9]* 件' /tmp/sql081_notice.txt | sed -E 's/.*区間 ([0-9]+) 件/\1/')
eq "要確認の区間を件数で知らせる（依頼済み・ホテル・日程・変更の記録・申請・取消の 6件）" 6 "$SKIPPED"
eq "要確認の知らせに区間の ID が入る" 1 "$(grep -c "$S_HCHG" /tmp/sql081_notice.txt)"
eq "要確認の知らせに名前・ホテル・メールが無い" 0 "$(grep -cE 'Guest|H1|H2|example.com' /tmp/sql081_notice.txt)"
eq "控えに都道府県が無い区間も、要確認として知らせる" 1 "$(grep -c '空のままの B2C の区間' /tmp/sql081_notice.txt)"
eq "控えに都道府県が無い区間: 推測で埋めない（null のまま）" "∅|∅|∅" "$(leg_of "$O_NOPREF")"
eq "B2B の区間は 1つも変わらない（足した列は空）" "$B2B_BEFORE|∅" "$(q -c "select md5((to_jsonb(s) - 'origin_check_out')::text)||'|'||coalesce(origin_check_out::text,'∅') from shipments s where id='$B2B'")"
eq "B2B の区間の全体も変わらない" "$ALL_B2B_BEFORE" "$(q -c "select md5(string_agg((to_jsonb(s) - 'origin_check_out')::text, '' order by id)) from shipments s where channel is distinct from 'b2c'")"
eq "集荷依頼の記録は変わらない（依頼は有効なまま 1件）" 1 "$(q -c "select count(*) from pickup_requests where shipment_id='$S_LIVE' and state in ('sending','accepted','unknown','needs_review','change_pending')")"

echo "B. 新しい予約の確定"
O_NEW=$(b2c_order 4 "$ORIG_OK" "$DEST_OK")
eq "確定できる" t "$(q -c "select b2c_confirm_order('$O_NEW')")"
eq "区間に都道府県・チェックアウト日が入る" "東京都|京都府|2026-12-05" "$(leg_of "$O_NEW")"
eq "ほかの列は 071 で確定した区間と同じ" "$CORE071" "$(leg_core "$O_NEW")"
O_BADDATE=$(b2c_order 4 '{"name":"H1","prefecture":" 東京都 ","check_in":"2026-12-01","check_out":"2026-13-99"}' "$DEST_OK")
eq "チェックアウト日が壊れていても確定は止まらない" t "$(q -c "select b2c_confirm_order('$O_BADDATE')")"
eq "壊れた日付は null・前後の空白は取る" "東京都|京都府|∅" "$(leg_of "$O_BADDATE")"
O_EMPTY=$(b2c_order 4 '{"name":"H1","prefecture":"","check_in":"2026-12-01"}' '{"name":"H2","check_in":"2026-12-05","check_out":"2026-12-08"}')
eq "控えに都道府県が無くても確定する" t "$(q -c "select b2c_confirm_order('$O_EMPTY')")"
eq "空の都道府県は null（Biz-Logi の照合が止めて、運営が確かめる）" "∅|∅|∅" "$(leg_of "$O_EMPTY")"
eq "確定の通知（送信待ち）は 071 と同じく 2件（メール・WhatsApp）" 2 "$(q -c "select count(*) from b2c_outbox where order_id='$O_NEW' and kind='booking_confirmed'")"
eq "同じ予約をもう一度確定しても区間は増えない" "f|1" "$(q -c "select b2c_confirm_order('$O_NEW')")|$(q -c "select count(*) from shipments where b2c_order_id='$O_NEW'")"

echo "E. 同時実行"
# 区間を掴んでいる利用者がいる間に 081 を流す → 10秒で何も変えずに失敗
q -c "update shipments set from_prefecture = null, to_prefecture = null, origin_check_out = null where b2c_order_id='$O_OLD'" >/dev/null
docker exec -i $C psql -U postgres -d $DB -qtA -c "begin; select id from shipments where booking_id='BDX-081-B2B' for update; select pg_sleep(14); commit;" >/dev/null 2>&1 &
HOLD=$!
sleep 1
T0=$(date +%s)
q -1 < "$R/sql/081_b2c_leg_prefecture.sql" >/dev/null 2>/tmp/sql081_lock.txt; RC=$?
T1=$(date +%s)
eq "掴まれている間は失敗する" 1 "$([ $RC -ne 0 ] && echo 1 || echo 0)"
eq "失敗の理由は表を確保できなかったこと" 1 "$(grep -c '10秒以内に確保できませんでした' /tmp/sql081_lock.txt)"
eq "失敗まで 10〜12秒" 1 "$([ $((T1-T0)) -ge 10 ] && [ $((T1-T0)) -le 12 ] && echo 1 || echo 0)"
eq "失敗した時は何も変わらない（埋め戻しも無し）" "∅|∅|∅" "$(leg_of "$O_OLD")"
wait $HOLD
eq "掴んでいた利用者の操作は成功した（待たされただけ）" 0 "$(q -c "select count(*) from pg_locks l join pg_stat_activity a using (pid) where a.datname='$DB' and not l.granted")"
apply sql/081_b2c_leg_prefecture.sql && eq "離した後に流し直すと成功する" ok ok
eq "流し直しで埋め戻しも入る" "東京都|京都府|2026-12-05" "$(leg_of "$O_OLD")"
# 同じ予約の同時の確定（2つのセッション）→ 区間は 1つ
O_RACE=$(b2c_order 5 "$ORIG_OK" "$DEST_OK")
( q -c "select b2c_confirm_order('$O_RACE')" > /tmp/sql081_r1.txt 2>&1 ) & P1=$!
( q -c "select b2c_confirm_order('$O_RACE')" > /tmp/sql081_r2.txt 2>&1 ) & P2=$!
wait $P1 $P2
eq "同時の確定: 片方だけ確定（t と f）" "f t" "$(cat /tmp/sql081_r1.txt /tmp/sql081_r2.txt | sort | tr '\n' ' ' | sed 's/ $//')"
eq "同時の確定: 区間は 1つ・都道府県入り" "1|東京都|京都府|2026-12-05" "$(q -c "select count(*) from shipments where b2c_order_id='$O_RACE'")|$(leg_of "$O_RACE")"

echo "D. 切り戻しと再適用"
apply sql/rollback/rollback_081.sql && eq "切り戻しを適用できる" ok ok
eq "確定の関数は 071 の定義に戻る（都道府県を書かない）" f "$(q -c "select prosrc like '%from_prefecture%' from pg_proc where proname='b2c_confirm_order'")"
O_AFTER_RB=$(b2c_order 6 "$ORIG_OK" "$DEST_OK"); q -c "select b2c_confirm_order('$O_AFTER_RB')" >/dev/null
eq "切り戻しの後の確定は 071 と同じ（都道府県なし）" "∅|∅|∅" "$(leg_of "$O_AFTER_RB")"
eq "切り戻しの後も、埋め戻した値は残る" "東京都|京都府|2026-12-05" "$(leg_of "$O_OLD")"
apply sql/rollback/rollback_081.sql && eq "切り戻しを2回流しても失敗しない" ok ok
apply sql/081_b2c_leg_prefecture.sql && eq "切り戻しの後にもう一度 081 を適用できる" ok ok
eq "再適用で、切り戻しの間に確定した区間も埋まる" "東京都|京都府|2026-12-05" "$(leg_of "$O_AFTER_RB")"

echo "F. 権限"
for r in anon authenticated; do
  eq "$r は確定の関数を呼べない" f "$(q -c "select has_function_privilege('$r','public.b2c_confirm_order(uuid)','execute')")"
  eq "$r は日付の関数を呼べない" f "$(q -c "select has_function_privilege('$r','public.b2c_safe_date(text)','execute')")"
done
eq "service_role は日付の関数を呼べる" t "$(q -c "select has_function_privilege('service_role','public.b2c_safe_date(text)','execute')")"

docker exec -i $C psql -U postgres -d postgres -qc "drop database if exists $DB" >/dev/null 2>&1
echo
echo "$PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
