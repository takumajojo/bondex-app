#!/usr/bin/env bash
# 本番移行のリハーサル (ローカルの PostgreSQL の試験専用データベースだけ。本番・Supabase には接続しない)。
#   実行: bash scripts/test-integ/migration-rehearsal.sh
# db-integration.sh (順番どおりに1つずつ確かめる) と違い、ここでは「本番と同じ形のデータ」と
# 「移行の最中もアプリが動き続けている」状態で、手順書 (docs/bizlogi-b2c-integration-report-20261104.md 6章) を
# 最初から最後まで流す。確かめること:
#   - 移行中 (拡張 → アプリ切替 → 072 → 070 → 切り戻し → 再適用) に、古い/新しいアプリの操作が1件も失敗しない
#   - 長いトランザクションが区間の表を掴んでいる時、移行の SQL が利用者の操作を巻き込んで止めない (lock_timeout)
#   - 移行の途中 (記録の停止中) に入った予約が、集荷依頼の TODO から漏れない (勝手に「依頼済み」にならない)
#   - 既存データの分類が本番の読み取り結果 (受付済み 21・要確認 0・今後の未依頼 4) と一致する
set -uo pipefail
R="$(cd "$(dirname "$0")/../.." && pwd)"
C=supabase_db_supa-local; DB=${REHEARSAL_DB:-bondex_rehearsal}  # 並行する作業コピーと名前を分けるときは環境変数で変える
WORK=$(mktemp -d); ERR=$WORK/traffic_errors.txt; OPS=$WORK/traffic_ops.txt; : > "$ERR"; : > "$OPS"
PASS=0; FAIL=0
q() { docker exec -i $C psql -U postgres -d $DB -v ON_ERROR_STOP=1 -qtA "$@"; }
eq() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 (期待: $2 / 実際: $3)"; fi; }
step() { # 説明 ファイル... (本番と同じく lock_timeout 5秒・1ファイル1トランザクション)
  local t0 t1; t0=$(date +%s)
  for f in "${@:2}"; do
    echo "$(date +%T.%N | cut -c1-12) start $f" >> $WORK/steps.log
    # 本番の手順と同じく、各 SQL の前に共通の前置き (表を待たずに掴み、掴めなければ持たずに待つ) を付ける
    { cat "$R/sql/ops/migration_lock_prefix.sql"; cat "$R/$f"; } | docker exec -i -e PGOPTIONS='-c lock_timeout=5s' $C psql -U postgres -d $DB -v ON_ERROR_STOP=1 -1 -qtA >/dev/null 2>$WORK/step_err.txt \
      || { FAIL=$((FAIL+1)); echo "  FAIL $1: $f"; head -c 600 $WORK/step_err.txt; echo; return 1; }
  done
  t1=$(date +%s); PASS=$((PASS+1)); echo "  ok   $1 ($((t1-t0))秒)"
}

docker exec -i $C psql -U postgres -d postgres -qc "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
q -c "grant usage on schema public to anon, authenticated, service_role; grant all on schema public to postgres, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" >/dev/null
for f in scripts/test-b2c/db/000_base_from_prod.sql sql/043_shipment_change_requests.sql sql/033_hotel_change_schema.sql sql/063_fix_hotel_change_tracking_column.sql; do
  q < "$R/$f" >/dev/null 2>&1 || { echo "土台の適用に失敗: $f"; exit 1; }
done

echo "0. 本番と同じ形のデータ (2026-11-04 の本番の読み取り: 全31区間・受付済み21・取消6・今後の未依頼4・変更申請3)"
q -c "
insert into shipments (booking_id, leg_index, agency, representative, recipient, shipment_date, expected_arrival, from_hotel, to_hotel, suitcase_count, status, tracking_numbers, change_deadline_at)
select 'PAST-'||g, 0, 'AG', 'R'||g, 'R'||g, current_date-30+g, current_date-29+g, 'H-A', 'H-B', 2, 'delivered', jsonb_build_array((400000000000+g)::text), null from generate_series(1,21) g;
insert into shipments (booking_id, leg_index, agency, representative, recipient, shipment_date, expected_arrival, from_hotel, to_hotel, suitcase_count, status)
select 'CXL-'||g, 0, 'AG', 'R', 'R', current_date-10+g, current_date-9+g, 'H-A', 'H-B', 1, 'cancelled' from generate_series(1,5) g;
insert into shipments (booking_id, leg_index, agency, representative, recipient, shipment_date, expected_arrival, from_hotel, to_hotel, suitcase_count, status)
values ('CXL-F', 0, 'AG', 'R', 'R', current_date+5, current_date+6, 'H-A', 'H-B', 1, 'cancelled');
insert into shipments (booking_id, leg_index, agency, representative, recipient, shipment_date, expected_arrival, from_hotel, to_hotel, suitcase_count, status, change_deadline_at)
select 'FUT-'||g, 0, 'AG', 'R'||g, 'R'||g, current_date+2+g*3, current_date+3+g*3, 'H-A', 'H-B', 2, 'requested', ((current_date+2+g*3-1)::text||'T09:00:00Z')::timestamptz from generate_series(1,4) g;
insert into shipment_change_requests (shipment_id, booking_id, leg_index, requested_by, fields, status, decided_by, decided_at)
select id, booking_id, 0, 'operator', '{\"suitcase_count\":2}', 'approved', 'operator', now() from shipments where booking_id in ('PAST-1','PAST-2','PAST-3');" >/dev/null
eq "移行前の分類が本番と一致 (受付済み21・要確認0・今後の未依頼4・取消6・申請3)" "21|0|4|6|3" "$(q -c "
with c as (select s.*, case when s.status='cancelled' then 'x' when (jsonb_array_length(s.tracking_numbers)>0) or s.status in ('picked_up','in_transit','delivered') then 'a'
  when s.shipment_date >= current_date and (s.pickup_requested_at is not null or s.status='issued') then 'n' else 'o' end cls from shipments s)
select (select count(*) from c where cls='a')||'|'||(select count(*) from c where cls='n')||'|'||(select count(*) from c where cls='o' and shipment_date>=current_date)||'|'||(select count(*) from c where cls='x')||'|'||(select count(*) from shipment_change_requests)")"

# ── 利用者の操作 (移行の間ずっと動かす)。デッドロックを含め、1件も失敗しないことを合格条件にする。古いアプリ (main) が DB に対して行う書き込みと同じ形。
traffic() { # $1 = 停止の印のファイル
  local i=0
  while [ ! -f "$1" ]; do
    i=$((i+1))
    local sql
    case $((i % 5)) in
      0) sql="insert into shipments (booking_id, leg_index, agency, representative, recipient, shipment_date, expected_arrival, from_hotel, to_hotel, suitcase_count, status, change_deadline_at)
              values ('LIVE-$i', 0, 'AG', 'R', 'R', current_date+1, current_date+2, 'H-A', 'H-B', 2, 'requested', ((current_date)::text||'T09:30:00Z')::timestamptz)";;
      1) sql="update shipments set suitcase_count = 1 + (suitcase_count % 5), updated_at = now() where booking_id = 'FUT-1'";;
      2) sql="insert into shipment_change_requests (shipment_id, booking_id, leg_index, requested_by, fields, status)
              select id, booking_id, 0, 'agency', '{\"suitcase_count\":3}', 'pending' from shipments where booking_id='FUT-2';
              update shipment_change_requests set status='rejected', decided_by='operator', decided_at=now() where booking_id='FUT-2' and status='pending'";;
      3) sql="update shipments set shipment_date = shipment_date, expected_arrival = expected_arrival, updated_at = now() where booking_id = 'FUT-3'";;
      4) sql="select count(*) from shipments s left join shipment_change_requests c on c.shipment_id = s.id where s.shipment_date >= current_date";;
    esac
    if docker exec -i -e PGOPTIONS='-c statement_timeout=15s' $C psql -U postgres -d $DB -v ON_ERROR_STOP=1 -qtA -c "$sql" >/dev/null 2>$WORK/t.txt; then
      echo ok >> "$OPS"
    else
      echo "[$(date +%T.%N | cut -c1-12)] op$((i % 5)): $(tr '\n' ' ' < $WORK/t.txt | cut -c1-300)" >> "$ERR"
    fi
  done
}
STOP=$WORK/stop; traffic "$STOP" & TPID=$!
sleep 2

echo "1. 事前確認と手順2 (DB を広げる: 067 → 069 → 068 → 061 → 062 → 073 → 071) — 利用者の操作を流したまま"
step "067 集荷依頼の記録" sql/067_pickup_requests.sql
step "069 施設台帳" sql/069_facilities.sql
# 長いトランザクション (例: 運営の一括更新や管理画面の操作) が区間の表を掴んでいる間に 068 を流す
( docker exec -i $C psql -U postgres -d $DB -qtA -c "begin; update shipments set updated_at = now() where booking_id = 'FUT-4'; select pg_sleep(12); commit;" >/dev/null 2>&1 ) &
HOLD=$!; sleep 1
T0=$(date +%s)
docker exec -i -e PGOPTIONS='-c lock_timeout=5s' $C psql -U postgres -d $DB -v ON_ERROR_STOP=1 -1 -qtA < "$R/sql/068_change_requests_pickup_lock.sql" >/dev/null 2>$WORK/s068.txt
R068=$?; T1=$(date +%s)
eq "長いトランザクション (12秒) の最中の 068 は、10秒で諦めて何も変えずに失敗する" "1|0" "$([ $R068 -ne 0 ] && echo 1 || echo 0)|$(q -c "select count(*) from pg_trigger where tgname='shipments_pickup_lock'")"
eq "移行が表を待っている間は表を持たない (待ちは10秒まで・利用者の操作は止まらない)" "t" "$([ $((T1-T0)) -le 12 ] && echo t || echo f)"
wait $HOLD
step "068 をやり直す (ロックは無効で作る)" sql/068_change_requests_pickup_lock.sql
step "061・062・073・071・075・076 (B2C は機能フラグ OFF のまま)" sql/061_b2c_mvp.sql sql/062_b2c_stage4.sql sql/073_b2c_outbox_hardening.sql sql/071_b2c_cutoff_1830.sql sql/074_b2c_stage5_payments.sql sql/075_pickup_watch_alerts.sql sql/076_agency_change_atomic.sql
eq "拡張後: ロック無効・記録の停止中・B2C の関数は 071 の版" "D|t|t|t" "$(q -c "select tgenabled from pg_trigger where tgname='shipments_pickup_lock'")|$(q -c "select claims_paused from pickup_request_settings")|$(q -c "select prosrc like '%pickup_cutoff_at%' from pg_proc where proname='b2c_confirm_order'")|$(q -c "select prosrc like '%pickup_requested%' from pg_proc where proname='b2c_cancel_order'")"
eq "既存データの分類 (受付済み21・要確認0・今後の未依頼は記録なし)" "21|0|0" "$(q -c "select count(*) from pickup_requests where state='accepted'")|$(q -c "select count(*) from pickup_requests where state='needs_review'")|$(q -c "select count(*) from pickup_requests r join shipments s on s.id=r.shipment_id where s.booking_id like 'FUT-%'")"
eq "既存の変更申請3件は運営の訂正 (correction・applied) として残る" "3" "$(q -c "select count(*) from shipment_change_requests where kind='correction' and stage='applied'")"

echo "2. 手順3 (アプリ切替) の後 — 新しいアプリの操作"
L=$(q -c "select id from shipments where booking_id='FUT-4'")
eq "集荷依頼の記録はまだ止まっている (運営の注意に頼らない)" "false:claims_paused" "$(q -c "select claimed||':'||reason from claim_pickup_request('$L','manual',null,null,2,(select shipment_date from shipments where id='$L'),'op','op',null)")"
eq "新しいアプリの変更申請が登録できる" "t" "$(q -c "select ok from create_shipment_change('$L','count','{\"suitcase_count\":3}','rehearsal','agency','AG','agency')")"
q -c "insert into shipments (booking_id, leg_index, agency, representative, recipient, shipment_date, expected_arrival, from_hotel, to_hotel, suitcase_count, status, change_deadline_at)
      values ('MID-1', 0, 'AG', 'R', 'R', current_date+2, current_date+3, 'H-A', 'H-B', 2, 'requested', pickup_cutoff_at(current_date+2))" >/dev/null

echo "3. 手順5 (072 ロック有効化と記録の再開) — 利用者の操作を流したまま"
step "072" sql/072_enable_pickup_lock.sql
step "070 (保存済みの締切を 18:30 に)" sql/070_change_deadline_1830.sql
eq "移行の途中に入った予約・移行中の予約は「依頼済み」にならない (TODO の依頼が必要に出る)" "0" "$(q -c "select count(*) from pickup_requests r join shipments s on s.id=r.shipment_id where s.booking_id like 'MID-%' or s.booking_id like 'LIVE-%'")"
eq "有効化の後は集荷依頼を記録できる" "t" "$(q -c "select claimed from claim_pickup_request('$L','manual',null,null,2,(select shipment_date from shipments where id='$L'),'op','op',null)")"
eq "今後の未依頼区間の締切は 18:30 (過去の区間は変えない)" "18:30|0" "$(q -c "select distinct to_char(change_deadline_at at time zone 'Asia/Tokyo','HH24:MI') from shipments where booking_id like 'FUT-%'")|$(q -c "select count(*) from shipments where booking_id like 'PAST-%' and change_deadline_at is not null")"

echo "4. 切り戻し (ロックだけ → 全体) — 利用者の操作を流したまま"
step "ロックだけ戻す (pause_pickup_lock)" sql/rollback/pause_pickup_lock.sql
step "全体の切り戻し (rollback_067_072)" sql/rollback/rollback_067_072.sql
eq "切り戻し後: 区間の締切は元の値、移行で作った記録はバックアップに残る" "18:00|22" "$(q -c "select distinct to_char(change_deadline_at at time zone 'Asia/Tokyo','HH24:MI') from shipments where booking_id like 'FUT-%'")|$(q -c "select count(*) from pickup_requests_rollback_backup")"

echo "5. 再適用 (手順2〜6 をもう一度)"
step "再適用" sql/067_pickup_requests.sql sql/069_facilities.sql sql/068_change_requests_pickup_lock.sql sql/061_b2c_mvp.sql sql/062_b2c_stage4.sql sql/073_b2c_outbox_hardening.sql sql/071_b2c_cutoff_1830.sql sql/074_b2c_stage5_payments.sql sql/075_pickup_watch_alerts.sql sql/076_agency_change_atomic.sql sql/072_enable_pickup_lock.sql sql/070_change_deadline_1830.sql
eq "再適用後: ロック有効・記録の再開・移行の記録は作り直し (受付済み21)" "O|f|21" "$(q -c "select tgenabled from pg_trigger where tgname='shipments_pickup_lock'")|$(q -c "select claims_paused from pickup_request_settings")|$(q -c "select count(*) from pickup_requests where state='accepted' and requested_by='migration-062'")"

touch "$STOP"; wait $TPID
N_OK=$(wc -l < "$OPS" | tr -d ' '); N_ERR=$(grep -vc "deadlock detected" "$ERR" | tr -d ' '); N_DL=$(grep -c "deadlock detected" "$ERR" | tr -d ' ')
# デッドロック: 移行の SQL (1秒未満) と、2つの表を逆の順番で掴む利用者の操作が重なると、PostgreSQL がどちらかを
# 打ち切る。本番の権限では移行の側を打ち切らせる設定 (deadlock_timeout) が使えないため 0 にはできない。
# 打ち切られた操作は何も変えずに失敗する (やり直せる)。ここでは毎秒約25件の操作を流し、回数を記録する。
eq "移行の間ずっと流した利用者の操作 (成功 $N_OK 件) が1件も失敗しない (デッドロック $N_DL 件を含む)" 0 "$((N_ERR + N_DL))"
echo "DEADLOCKS=$N_DL OPS=$N_OK"
[ "$N_ERR" -gt 0 ] && { head -5 "$ERR" | sed 's/^/    /'; sed 's/^/    step /' $WORK/steps.log; }

docker exec -i $C psql -U postgres -d postgres -qc "drop database if exists $DB" >/dev/null 2>&1
rm -rf "$WORK"
echo
echo "$PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
