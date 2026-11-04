#!/usr/bin/env bash
# B2C と Biz-Logi の統合の DB 試験 (ローカルの PostgreSQL の試験専用データベースだけ。本番・Supabase には接続しない)。
#   実行: bash scripts/test-integ/db-integration.sh   (Supabase CLI のローカル DB コンテナ supabase_db_supa-local を使う)
# 確かめること:
#   A. 本番移行の順番 (067 → 069 → 068 → 061 → 062 → 073 → 071 → [アプリ] → 072 → 070) と二重適用
#   B. 拡張段階 (ロック無効・記録の停止) で古いアプリの操作が通り、集荷依頼の記録は DB が止める
#   C. 072 の後: ロック・二重依頼の防止・停止スイッチ
#   D. 締切 18:30 (DB の pickup_cutoff_at・b2c_confirm_order の判定と保存値)
#   E. B2C の集荷依頼前の取消 / 依頼後の取消申請 → 佐川の確認 → 確定・却下
#   F. 切り戻し (ロック無効 → 全体の切り戻し → 古いアプリの操作) と再適用
set -uo pipefail
R="$(cd "$(dirname "$0")/../.." && pwd)"
C=supabase_db_supa-local; DB=bondex_integ_test
PASS=0; FAIL=0
q() { docker exec -i $C psql -U postgres -d $DB -v ON_ERROR_STOP=1 -qtA "$@"; }
# 本番 (Supabase の migration) と同じく、1ファイル1トランザクションで流す
apply() { for f in "$@"; do q -1 < "$R/$f" >/dev/null 2>/tmp/integ_err.txt || { echo "  適用失敗: $f"; grep -m3 ERROR /tmp/integ_err.txt; FAIL=$((FAIL+1)); return 1; }; done; }
eq() { # 説明 期待値 実際の値
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 (期待: $2 / 実際: $3)"; fi
}
err_has() { # 説明 SQL 含むべき文字列 (例外になること)
  local out; out=$(q -c "$2" 2>&1); if echo "$out" | grep -q "$3"; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 ($out)"; fi
}
fresh() {
  docker exec -i $C psql -U postgres -d postgres -qc "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
  q -c "grant usage on schema public to anon, authenticated, service_role; grant all on schema public to postgres, service_role;
        alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
        alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
        alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" >/dev/null
  apply scripts/test-b2c/db/000_base_from_prod.sql sql/043_shipment_change_requests.sql sql/033_hotel_change_schema.sql sql/063_fix_hotel_change_tracking_column.sql
}
EXPAND=(sql/067_pickup_requests.sql sql/069_facilities.sql sql/068_change_requests_pickup_lock.sql sql/061_b2c_mvp.sql sql/062_b2c_stage4.sql sql/073_b2c_outbox_hardening.sql sql/071_b2c_cutoff_1830.sql)
lock_state() { q -c "select tgenabled from pg_trigger where tgrelid='public.shipments'::regclass and tgname='shipments_pickup_lock'"; }
leg() { # booking_id 集荷日のオフセット(日) → id
  q -c "insert into shipments (booking_id, leg_index, shipment_date, expected_arrival, from_hotel, to_hotel, status, suitcase_count, agency, representative, recipient)
        values ('$1',0,current_date+$2,current_date+$2+1,'A','B','issued',2,'AG','R','R') returning id" | head -1
}
claim() { q -c "select claimed||':'||reason from claim_pickup_request('$1','manual',null,null,2,(select shipment_date from shipments where id='$1'),'op','op',null)"; }
b2c_order() { # 集荷日のオフセット(日) → order id (カード登録・同意済み・確認済みホテル・instant)
  q -c "insert into b2c_orders (entry_link_id, referrer_code, guest_name, guest_email, guest_whatsapp, origin_place_id, dest_place_id, origin_snapshot, dest_snapshot,
          pickup_date, delivery_date, pieces, route_class, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen, price_rule_version, status, confirmation_mode, card_status, consented_at, access_token_hash)
        select id,'HKU','Guest','g@example.com','+819000000000','P1','P2',
          jsonb_build_object('name','H1','check_in',(current_date)::text),
          jsonb_build_object('name','H2','check_in',(current_date+$1)::text,'check_out',(current_date+$1+5)::text),
          current_date+$1,current_date+$1+1,2,'standard',3000,6000,600,6600,'v1','card_pending','instant','registered',now(),md5(random()::text)
        from b2c_entry_links limit 1 returning id" | head -1
}
b2c_seed() {
  q -c "insert into b2c_entry_links (referrer_code, referrer_name, token_hash) values ('HKU','Hankyu','t-$RANDOM');
        insert into b2c_facilities (place_id,name,status,checked_by,last_verified_at) values ('P1','H1','verified','op',now()),('P2','H2','verified','op',now()) on conflict do nothing;" >/dev/null
}

echo "A. 本番移行の順番と二重適用"
fresh
apply "${EXPAND[@]}" && eq "拡張段階の SQL (067→069→068→061→062→073→071) を適用できる" ok ok
apply "${EXPAND[@]}" && eq "拡張段階の SQL を2回流しても失敗しない" ok ok
eq "068 はロックを無効で作る" D "$(lock_state)"
eq "B2C の確定・取消は 071 の版 (18:30・集荷依頼済みの扱い)" "t|t" "$(q -c "select (prosrc like '%pickup_cutoff_at%') from pg_proc where proname='b2c_confirm_order'")|$(q -c "select (prosrc like '%pickup_requested%') from pg_proc where proname='b2c_cancel_order'")"
eq "067 は集荷依頼の記録を停止で作る" "true|false" "$(q -c "select claims_paused||'|'||lock_enabled from pickup_request_settings")"
q < "$R/scripts/test-b2c/db/verify_061.sql" > /tmp/integ_v061.txt 2>&1; eq "B2C の検証 (verify_061) が通る" 0 "$?"

echo "B. 拡張段階 (古いアプリが動いている間)"
L1=$(leg L1 3); L2=$(leg L2 3)
eq "集荷依頼の記録は DB が止める (運営の注意に頼らない)" "false:claims_paused" "$(claim "$L1")"
q -c "update pickup_request_settings set claims_paused=false" >/dev/null
eq "停止を外してもロックが無効なら止める" "false:pickup_lock_disabled" "$(claim "$L1")"
q -c "update pickup_request_settings set claims_paused=true" >/dev/null
q -c "insert into shipment_change_requests (shipment_id, booking_id, leg_index, requested_by, fields, status) values ('$L1','L1',0,'agency','{\"suitcase_count\":3}','pending')" >/dev/null && eq "古いアプリ: 締切後の申請を積める" ok ok
q -c "update shipment_change_requests set status='approved', decided_by='operator', decided_at=now() where booking_id='L1' and status='pending'" >/dev/null && eq "古いアプリ: 申請を承認できる" ok ok
q -c "update shipments set suitcase_count=3 where id='$L1'" >/dev/null && eq "古いアプリ: 区間を直接更新できる" ok ok
eq "新しいアプリの関数 (create_shipment_change) が使える" t "$(q -c "select ok from create_shipment_change('$L2','count','{\"suitcase_count\":4}','x','agency','AG','agency')")"

echo "C. 072 (アプリ切替の後) — ロック有効・記録の再開"
apply sql/072_enable_pickup_lock.sql && eq "072 を適用できる" ok ok
apply sql/072_enable_pickup_lock.sql && eq "072 を2回流しても失敗しない" ok ok
eq "ロックが有効" O "$(lock_state)"
apply sql/068_change_requests_pickup_lock.sql && eq "有効化の後に 068 を流し直してもロックは有効のまま" O "$(lock_state)"
N_BEFORE=$(q -c "select count(*) from pickup_requests")
apply sql/067_pickup_requests.sql && eq "有効化の後に 067 を流し直しても停止に戻らない" f "$(q -c "select claims_paused from pickup_request_settings")"
eq "067 を流し直しても、後から作った区間を「要確認」にしない (移行は1回だけ)" "$N_BEFORE" "$(q -c "select count(*) from pickup_requests")"
eq "集荷依頼を記録できる" "true:created" "$(claim "$L1" | sed 's/:.*$/:created/')"
eq "同じ区間に2件目の依頼は作れない (二重依頼の防止)" "false:live_request_exists" "$(claim "$L1")"
err_has "依頼済みの区間は直接更新できない" "update shipments set suitcase_count=9 where id='$L1'" "pickup_request_live"
q -c "update shipments set suitcase_count=9 where booking_id='L2'" >/dev/null && eq "未依頼の区間は直接更新できる" ok ok
q -c "update shipments set tracking_numbers='[\"500000000001\"]' where id='$L1'" >/dev/null && eq "依頼済みの区間に最初の問い合わせ番号は記入できる" '["500000000001"]' "$(q -c "select tracking_numbers from shipments where id='$L1'")"
err_has "入っている番号は直接書き換えられない" "update shipments set tracking_numbers='[\"500000000002\"]' where id='$L1'" "tracking_numbers"
err_has "入っている番号は直接消せない" "update shipments set tracking_numbers='[]' where id='$L1'" "tracking_numbers"
L9=$(leg L9 3); q -c "select claim_pickup_request('$L9','manual',null,null,2,current_date+3,'op','op',null)" >/dev/null 2>&1
q -c "update shipments set tracking_numbers='[\"500000000009\"]' where id='$L9'" >/dev/null
q -c "update pickup_requests set shipping_number='500000000009' where shipment_id='$L9'" >/dev/null
CN=$(q -c "select change_id from create_shipment_change('$L9','number','{}','佐川が番号を振り直し','operator','op','op')")
q -c "select ok from step_shipment_change('$CN','contact','op','x',null,null)" >/dev/null
q -c "select ok from step_shipment_change('$CN','approve','op','佐川: 新番号','changed','500000000010')" >/dev/null
eq "番号の変更は佐川の回答を記録した申請の反映だけで変わる" 't|["500000000010"]|500000000010' "$(q -c "select ok from apply_shipment_change('$CN','op')")|$(q -c "select tracking_numbers from shipments where id='$L9'")|$(q -c "select shipping_number from pickup_requests where shipment_id='$L9' and state='accepted'")"
eq "他の区間で使っている番号には変えられない" number_in_use "$(L10=$(leg L10 3); q -c "select claim_pickup_request('$L10','manual',null,null,2,current_date+3,'op','op',null)" >/dev/null; C10=$(q -c "select change_id from create_shipment_change('$L10','number','{}','x','operator','op','op')"); q -c "select ok from step_shipment_change('$C10','contact','op','x',null,null)" >/dev/null; q -c "select reason from step_shipment_change('$C10','approve','op','x','changed','500000000010')")"
apply sql/ops/pickup_claims_pause.sql; L3=$(leg L3 3)
eq "運営の一時停止で記録が止まる (ロックは有効のまま)" "false:claims_paused|O" "$(claim "$L3")|$(lock_state)"
apply sql/ops/pickup_claims_resume.sql; eq "再開すると記録できる" true "$(claim "$L3" | cut -d: -f1)"

echo "D. 締切 18:30 (DB)"
eq "18:29:59.999 は締切前" f "$(q -c "select timestamptz '2026-11-13 09:29:59.999+00' >= pickup_cutoff_at('2026-11-14')")"
eq "18:30:00 は締切後" t "$(q -c "select timestamptz '2026-11-13 09:30:00+00' >= pickup_cutoff_at('2026-11-14')")"
eq "18:31 は締切後" t "$(q -c "select timestamptz '2026-11-13 09:31:00+00' >= pickup_cutoff_at('2026-11-14')")"
eq "年末をまたいでも前日" "2026-12-31 09:30:00+00" "$(q -c "set timezone='UTC'; select pickup_cutoff_at('2027-01-01')")"
b2c_seed
O_PAST=$(b2c_order 0)   # 集荷が今日 = 締切 (昨日 18:30) を過ぎている
eq "締切を過ぎた予約は DB が確定しない" f "$(q -c "select b2c_confirm_order('$O_PAST')")"
eq "確定しなかった予約は区間を作らない" 0 "$(q -c "select count(*) from shipments where b2c_order_id='$O_PAST'")"
O1=$(b2c_order 3)
eq "締切前の予約は確定する" t "$(q -c "select b2c_confirm_order('$O1')")"
eq "保存する締切は集荷前日 18:30 JST" "18:30" "$(q -c "select to_char(change_deadline_at at time zone 'Asia/Tokyo','HH24:MI') from shipments where b2c_order_id='$O1'")"
apply sql/070_change_deadline_1830.sql && eq "070 (保存済みの締切を 18:30 に) を適用できる" "18:30" "$(q -c "select distinct to_char(change_deadline_at at time zone 'Asia/Tokyo','HH24:MI') from shipments where status<>'cancelled' and shipment_date>=current_date and change_deadline_at is not null")"
apply sql/070_change_deadline_1830.sql && eq "070 を2回流しても失敗しない" ok ok

echo "E. B2C の取消"
O2=$(b2c_order 3); q -c "select b2c_confirm_order('$O2')" >/dev/null
eq "集荷依頼の前は即時に取り消せる" cancelled "$(q -c "select b2c_cancel_order('$O2','guest','guest')")"
eq "取消で区間も取消・取消の通知を積む" "cancelled|2" "$(q -c "select (select status from shipments where b2c_order_id='$O2')||'|'||(select count(*) from b2c_outbox where order_id='$O2' and kind='cancelled')")"
S1=$(q -c "select id from shipments where b2c_order_id='$O1'")
claim "$S1" >/dev/null
OUT_BEFORE=$(q -c "select count(*) from b2c_outbox where order_id='$O1' and status='pending'")
eq "集荷依頼の後は取り消さず状態を返す (例外にしない)" pickup_requested "$(q -c "select b2c_cancel_order('$O1','guest','guest')")"
eq "その時点で予約・区間・集荷依頼・通知は変わらない" "confirmed|issued|accepted|$OUT_BEFORE" \
  "$(q -c "select (select status from b2c_orders where id='$O1')||'|'||(select status from shipments where id='$S1')||'|'||(select state from pickup_requests where shipment_id='$S1')||'|'||(select count(*) from b2c_outbox where order_id='$O1' and status='pending')")"
eq "旅行者の取消申請を受け付ける" cancel_requested "$(q -c "select b2c_request_cancel('$O1','guest')")"
eq "同じ取消申請は二重に作らない" already_requested "$(q -c "select b2c_request_cancel('$O1','guest')")"
CR=$(q -c "select id from shipment_change_requests where shipment_id='$S1' and kind='cancel' order by created_at desc limit 1")
eq "申請は旅行者から・佐川の確認が要る" "guest|true|requested" "$(q -c "select requested_by||'|'||needs_sagawa||'|'||stage from shipment_change_requests where id='$CR'")"
eq "申請の時点でも予約は確定のまま" "confirmed|issued" "$(q -c "select (select status from b2c_orders where id='$O1')||'|'||(select status from shipments where id='$S1')")"
q -c "select ok from step_shipment_change('$CR','contact','op','世田谷営業所へ電話',null,null)" >/dev/null
eq "佐川が取消を認めない → 却下できる" t "$(q -c "select ok from step_shipment_change('$CR','reject','op','佐川: 集荷済みのため不可',null,null)")"
eq "却下の後も予約・区間・集荷依頼は元のまま" "confirmed|issued|accepted" "$(q -c "select (select status from b2c_orders where id='$O1')||'|'||(select status from shipments where id='$S1')||'|'||(select state from pickup_requests where shipment_id='$S1')")"
eq "運営からも取消申請を出せる" cancel_requested "$(q -c "select b2c_request_cancel('$O1','operator','op@example.com','cred','電話で取消の希望')")"
CR2=$(q -c "select id from shipment_change_requests where shipment_id='$S1' and kind='cancel' and stage='requested'")
q -c "select ok from step_shipment_change('$CR2','contact','op','世田谷営業所へ連絡',null,null)" >/dev/null
eq "反映は佐川の承認の後だけ" "f" "$(q -c "select ok from apply_shipment_change('$CR2','op')")"
q -c "select ok from step_shipment_change('$CR2','approve','op','佐川: 取消を確認','kept',null)" >/dev/null
eq "佐川の取消確認を反映できる" t "$(q -c "select ok from apply_shipment_change('$CR2','op')")"
eq "反映で予約・区間・集荷依頼が同時に取消" "cancelled|cancelled|cancelled" "$(q -c "select (select status from b2c_orders where id='$O1')||'|'||(select status from shipments where id='$S1')||'|'||(select state from pickup_requests where shipment_id='$S1')")"
eq "未送信の通知は取消・取消の通知を積む" "0|2" "$(q -c "select (select count(*) from b2c_outbox where order_id='$O1' and status='pending' and kind<>'cancelled')||'|'||(select count(*) from b2c_outbox where order_id='$O1' and kind='cancelled')")"
eq "取消の記録 (申請と確定) が残る" "1|1" "$(q -c "select (select count(*) from b2c_order_events where order_id='$O1' and event='cancel_requested' and actor_type='guest')||'|'||(select count(*) from b2c_order_events where order_id='$O1' and event='cancelled')")"
eq "請求は作られない (集荷前)" 0 "$(q -c "select count(*) from b2c_payments where order_id='$O1'")"
# 予約が取り消せない状態 (完了) なら、反映全体を取り消す
O3=$(b2c_order 3); q -c "select b2c_confirm_order('$O3')" >/dev/null; S3=$(q -c "select id from shipments where b2c_order_id='$O3'"); claim "$S3" >/dev/null
q -c "select b2c_request_cancel('$O3','guest')" >/dev/null; CR3=$(q -c "select id from shipment_change_requests where shipment_id='$S3' and kind='cancel'")
q -c "select ok from step_shipment_change('$CR3','contact','op','x',null,null); select ok from step_shipment_change('$CR3','approve','op','x','kept',null)" >/dev/null
q -c "alter table b2c_orders disable trigger user; update b2c_orders set status='completed' where id='$O3'; alter table b2c_orders enable trigger user" >/dev/null 2>&1
err_has "B2C の予約を取り消せない時は反映が失敗する" "select ok from apply_shipment_change('$CR3','op')" "b2c_cancel_failed"
eq "失敗した反映では区間・集荷依頼は変わらない" "issued|change_pending" "$(q -c "select (select status from shipments where id='$S3')||'|'||(select state from pickup_requests where shipment_id='$S3')")"
# B2B の取消申請は従来どおり (hook は何もしない)
L4=$(leg L4 3); claim "$L4" >/dev/null
CB=$(q -c "select change_id from create_shipment_change('$L4','cancel','{}','代理店の取消','agency','AG','agency')")
q -c "select ok from step_shipment_change('$CB','contact','op','x',null,null); select ok from step_shipment_change('$CB','approve','op','x','kept',null)" >/dev/null
eq "B2B の取消申請の反映は従来どおり" "t|cancelled|cancelled" "$(q -c "select ok from apply_shipment_change('$CB','op')")|$(q -c "select status from shipments where id='$L4'")|$(q -c "select state from pickup_requests where shipment_id='$L4'")"
eq "匿名ロールは取消申請の関数を呼べない" f "$(q -c "select has_function_privilege('anon','b2c_request_cancel(uuid,text,text,text,text)','execute')")"

echo "F. 切り戻し"
apply sql/rollback/pause_pickup_lock.sql && eq "ロックを無効・記録を停止 (数秒の切り戻し)" "D|t" "$(lock_state)|$(q -c "select claims_paused from pickup_request_settings")"
q -c "update shipments set suitcase_count=7 where id='$S3'" >/dev/null && eq "ロック無効で古いアプリの直接更新が通る" ok ok
apply sql/rollback/rollback_067_072.sql && eq "全体の切り戻しを流せる" ok ok
eq "切り戻し後: 新しい表・関数・列が無い" "0|0|0|0|0" "$(q -c "select (select count(*) from pg_trigger where tgname='shipments_pickup_lock')||'|'||(select count(*) from information_schema.tables where table_name in ('pickup_requests','pickup_request_settings','facilities'))||'|'||(select count(*) from information_schema.columns where table_name='shipment_change_requests' and column_name='kind')||'|'||(select count(*) from pg_proc where proname in ('b2c_request_cancel','shipment_cancel_hook','pickup_cutoff_at'))||'|'||(select count(*) from shipment_change_requests where requested_by='guest')")"
eq "切り戻し後: B2C の確定・取消は 062 の版で動く" cancelled "$(O5=$(b2c_order 4); q -c "select b2c_confirm_order('$O5')" >/dev/null; q -c "select b2c_cancel_order('$O5','guest','guest')")"
q -c "insert into shipment_change_requests (shipment_id, booking_id, leg_index, requested_by, fields, status) values ('$L2','L2',0,'agency','{\"suitcase_count\":3}','pending')" >/dev/null && eq "切り戻し後: 古いアプリの申請が積める" ok ok
eq "切り戻しのバックアップが残る" "t" "$(q -c "select (select count(*) from pickup_requests_rollback_backup) > 0 and (select count(*) from shipment_change_requests_rollback_backup) > 0")"
apply "${EXPAND[@]}" sql/072_enable_pickup_lock.sql sql/070_change_deadline_1830.sql && eq "切り戻しの後にもう一度適用できる" O "$(lock_state)"

docker exec -i $C psql -U postgres -d postgres -qc "drop database if exists $DB" >/dev/null 2>&1
echo
echo "$PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
