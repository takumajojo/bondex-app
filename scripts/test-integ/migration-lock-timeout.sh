#!/usr/bin/env bash
# 移行の SQL の「表の確保」が時間で区切られ、諦めた時に安全であることの試験（2026-11-05・docs/release/sql068_lock_deadline_proposal.md）。
# ローカルの PostgreSQL の試験専用のデータベースだけ（本番・Supabase には接続しない）。
#   実行: bash scripts/test-integ/migration-lock-timeout.sh
# 確かめること（068 を例に。前置きは 067・070・071・072・078・切り戻し・ops と同じ）:
#   1. 長いトランザクションが表を掴んでいる間は、10秒（±1秒）で諦めて失敗する（回数ではなく時間で区切る）
#   2. 失敗した時は何も変わらない（列・トリガーが増えない・データが同じ）＝全部が戻る
#   3. 失敗した後に表のロックが残らない（他の利用者の操作がすぐ通る）
#   4. 待っている 10秒の間も、表を持たない（利用者の操作は止まらない）
#   5. 掴んでいたトランザクションが終われば、流し直しで成功する。もう一度流しても同じ（何度流しても同じ）
#   6. 前置きだけ（sql/ops/migration_lock_prefix.sql）でも同じく 10秒で諦める
set -uo pipefail
R="$(cd "$(dirname "$0")/../.." && pwd)"
C=${PG_TEST_CONTAINER:-supabase_db_supa-local}; DB=${LOCKTEST_DB:-bondex_lock_timeout}
PASS=0; FAIL=0
q() { docker exec -i $C psql -U postgres -d $DB -v ON_ERROR_STOP=1 -qtA "$@"; }
eq() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 (期待: $2 / 実際: $3)"; fi; }
now() { python3 -c 'import time;print(time.time())'; }
since() { python3 -c "import time;print('%.2f'%(time.time()-$1))"; }
inrange() { python3 -c "import sys;v=float('$1');sys.exit(0 if $2<=v<=$3 else 1)" && echo t || echo f; }

docker exec -i $C psql -U postgres -d postgres -qc "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
q -c "grant usage on schema public to anon, authenticated, service_role; grant all on schema public to postgres, service_role;" >/dev/null
for f in scripts/test-b2c/db/000_base_from_prod.sql sql/043_shipment_change_requests.sql sql/033_hotel_change_schema.sql sql/063_fix_hotel_change_tracking_column.sql sql/067_pickup_requests.sql sql/069_facilities.sql; do
  q -1 < "$R/$f" >/dev/null 2>&1 || { echo "土台の適用に失敗: $f"; exit 1; }
done
q -c "insert into shipments (booking_id, leg_index, agency, representative, recipient, shipment_date, expected_arrival, from_hotel, to_hotel, suitcase_count, status)
      select 'LT-'||g, 0, 'AG', 'R'||g, 'R'||g, current_date+g, current_date+g+1, 'H-A', 'H-B', 2, 'requested' from generate_series(1,20) g;
      insert into shipment_change_requests (shipment_id, booking_id, leg_index, requested_by, fields, status)
      select id, booking_id, 0, 'agency', '{\"suitcase_count\":3}', 'pending' from shipments where booking_id in ('LT-1','LT-2');" >/dev/null
digest() { q -c "select md5(string_agg(id::text||booking_id||status||suitcase_count::text||coalesce(representative,''), ',' order by id)) from shipments" ; }
CR_DIGEST() { q -c "select md5(string_agg(id::text||booking_id||status||fields::text, ',' order by id)) from shipment_change_requests"; }
D0=$(digest); CR0=$(CR_DIGEST)
has_trigger() { q -c "select count(*) from pg_trigger where tgname='shipments_pickup_lock'"; }
has_kind() { q -c "select count(*) from information_schema.columns where table_name='shipment_change_requests' and column_name='kind'"; }

echo "1〜4. 長いトランザクション（20秒）が区間の表を掴んでいる間に 068 を流す"
( docker exec -i $C psql -U postgres -d $DB -qtA -c "begin; update shipments set updated_at = now() where booking_id = 'LT-20'; select pg_sleep(20); commit;" >/dev/null 2>&1 ) &
HOLD=$!
for _w in $(seq 1 50); do [ "$(q -c "select count(*) from pg_stat_activity where query like '%pg_sleep(20)%' and wait_event='PgSleep'")" -ge 1 ] && break; sleep 0.2; done
# 待っている間の利用者の操作（別の区間の更新・読み取り）。1秒で掴めなければ失敗とする
OPS_OK=0; OPS_NG=0
( for k in $(seq 1 16); do
    if docker exec -i -e PGOPTIONS='-c lock_timeout=1s' $C psql -U postgres -d $DB -v ON_ERROR_STOP=1 -qtA -c "update shipments set suitcase_count = suitcase_count where booking_id='LT-$((k % 5 + 1))'; select count(*) from shipments;" >/dev/null 2>&1; then echo ok; else echo ng; fi
    sleep 0.5
  done ) > /tmp/lt_ops_$$.txt &
OPSPID=$!
T0=$(now)
docker exec -i $C psql -U postgres -d $DB -v ON_ERROR_STOP=1 -1 -qtA < "$R/sql/068_change_requests_pickup_lock.sql" >/dev/null 2>/tmp/lt_068_$$.txt
R068=$?; EL=$(since $T0)
wait $OPSPID
echo "  （068 は ${EL}秒で終了）"
eq "1. 10秒（9.5〜11.0秒）で諦めて失敗する" "1|t" "$([ $R068 -ne 0 ] && echo 1 || echo 0)|$(inrange $EL 9.5 11.0)"
eq "1. 失敗の理由は表を確保できなかったこと（何も変えていない旨）" "1" "$(grep -c '10秒以内に確保できませんでした' /tmp/lt_068_$$.txt)"
eq "2. 失敗の後: 列もトリガーも増えていない" "0|0" "$(has_kind)|$(has_trigger)"
eq "2. 失敗の後: 区間・変更申請のデータが同じ" "$D0|$CR0" "$(digest)|$(CR_DIGEST)"
eq "3. 失敗の後: 移行の側の表のロックが残っていない（掴んでいるのは長いトランザクションだけ）" "0" "$(q -c "select count(*) from pg_locks l join pg_class c on c.oid=l.relation where c.relname in ('shipments','pickup_requests','shipment_change_requests','operator_passkeys') and l.mode='AccessExclusiveLock'")"
eq "3. 失敗の直後でも、利用者の操作（別の区間の更新）が 1秒以内に通る" "ok" "$(docker exec -i -e PGOPTIONS='-c lock_timeout=1s' $C psql -U postgres -d $DB -v ON_ERROR_STOP=1 -qtA -c "update shipments set suitcase_count = suitcase_count where booking_id='LT-3'" >/dev/null 2>&1 && echo ok || echo ng)"
eq "4. 待っている間の利用者の操作は 1件も止まらない" "16|0" "$(grep -c ok /tmp/lt_ops_$$.txt)|$(grep -c ng /tmp/lt_ops_$$.txt)"
wait $HOLD
rm -f /tmp/lt_ops_$$.txt /tmp/lt_068_$$.txt

echo "5. 掴んでいたトランザクションが終わった後に流し直す"
T0=$(now)
docker exec -i $C psql -U postgres -d $DB -v ON_ERROR_STOP=1 -1 -qtA < "$R/sql/068_change_requests_pickup_lock.sql" >/dev/null 2>&1; R2=$?
EL2=$(since $T0)
eq "5. 流し直しは成功（すぐ掴める）" "0|t" "$R2|$(inrange $EL2 0 5)"
eq "5. 列とトリガーができている" "1|1" "$(has_kind)|$(has_trigger)"
eq "5. 区間のデータは移行の前と同じ" "$D0" "$(digest)"
docker exec -i $C psql -U postgres -d $DB -v ON_ERROR_STOP=1 -1 -qtA < "$R/sql/068_change_requests_pickup_lock.sql" >/dev/null 2>&1
eq "5. もう一度流しても成功（何度流しても同じ）・トリガーは 1つ" "0|1" "$?|$(has_trigger)"

echo "6. 前置きだけ（本番の手順で各 SQL の前に付けるもの）"
( docker exec -i $C psql -U postgres -d $DB -qtA -c "begin; lock table shipments in row exclusive mode; select pg_sleep(15); commit;" >/dev/null 2>&1 ) &
HOLD=$!; sleep 1
T0=$(now)
docker exec -i $C psql -U postgres -d $DB -v ON_ERROR_STOP=1 -1 -qtA < "$R/sql/ops/migration_lock_prefix.sql" >/dev/null 2>&1; RP=$?
ELP=$(since $T0)
eq "6. 前置きも 10秒（9.5〜11.0秒）で諦める" "1|t" "$([ $RP -ne 0 ] && echo 1 || echo 0)|$(inrange $ELP 9.5 11.0)"
wait $HOLD
docker exec -i $C psql -U postgres -d $DB -v ON_ERROR_STOP=1 -1 -qtA < "$R/sql/ops/migration_lock_prefix.sql" >/dev/null 2>&1
eq "6. 掴んでいたトランザクションが終われば、前置きはすぐ通る" "0" "$?"

docker exec -i $C psql -U postgres -d postgres -qc "drop database if exists $DB" >/dev/null 2>&1
echo "$PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
