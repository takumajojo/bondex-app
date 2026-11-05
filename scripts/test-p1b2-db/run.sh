#!/usr/bin/env bash
# P1-B2 実PostgreSQL テスト — 隔離した supabase/postgres:17.11 に実 sql/066 を適用し、
# 課金保留の判定 RPC・実個数確認 RPC・課金権取得の競合 (指示 §10) を実機で検証する。
#
#   実行:  bash scripts/test-p1b2-db/run.sh   (要 Docker)
#
# 検証内容:
#   T1 sql/066 クリーン適用
#   T2 evaluate_charge_hold  — leg20/合算20/7個/差異フラグ/residence除外/名称キー/pidマージ
#   T3 confirm_pickup_count  — 実個数記録+履歴追記+held→released / A社30+B社20で確定legのみ解除(按分しない)
#   T4 claim_charge_right    — held は課金権を渡さない / released は渡す / lease owner guard / 既課金
#   T5 競合 (2接続)          — B社追加+hold付与 と A社課金権取得が同時 → A は保留をすり抜けない (= Case A)
#   T6 指示 §9 Case B–J      — 個数入力だけで課金しない/承認額の原子確定/Stripeタイムアウト不明/成功後DB失敗の照合/
#                              Webhook重複の冪等/請求書再実行の二重計上防止/締め後の翌月調整計上/FIT従来動作/団体割引承認額
set -uo pipefail

IMG="public.ecr.aws/supabase/postgres:17.11.0.011"
NAME="bondex-p1b2-$$"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PASS=0; FAIL=0

psql() { docker exec -i "$NAME" psql -U postgres -d postgres "$@"; }
val()  { psql -tA -c "$1" 2>/dev/null | tr -d '[:space:]'; }
ok()   { echo "  PASS: $1"; PASS=$((PASS+1)); }
ng()   { echo "  FAIL: $1"; FAIL=$((FAIL+1)); }
chk()  { if [ "$2" = "$3" ]; then ok "$1 (=$2)"; else ng "$1 (actual=$2 expected=$3)"; fi; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
command -v docker >/dev/null || { echo "docker が必要です"; exit 2; }

echo "=== 起動: $IMG (隔離コンテナ $NAME) ==="
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres "$IMG" >/dev/null || { echo "docker run 失敗"; exit 2; }
echo -n "   DB 起動待ち"; streak=0
for i in $(seq 1 90); do
  if psql -tA -c "select 1" >/dev/null 2>&1; then streak=$((streak+1)); else streak=0; fi
  if [ "$streak" -ge 4 ]; then echo " ready"; break; fi
  echo -n "."; sleep 1
  if [ "$i" = "90" ]; then echo " タイムアウト"; exit 2; fi
done

echo "=== T1: スキーマ適用 (prereq + 実 sql/066) ==="
apply() {
  for a in $(seq 1 40); do
    if psql -v ON_ERROR_STOP=1 < "$1" >/dev/null 2>/tmp/p1b2.err; then return 0; fi
    if grep -qiE "shutting down|starting up|the database system|connection to server" /tmp/p1b2.err; then sleep 2; continue; fi
    echo "   $2 適用エラー: $(cat /tmp/p1b2.err)"; return 1
  done
  echo "   $2 適用リトライ上限"; return 1
}
apply "$HERE/prereq.sql" "prereq" || exit 2
if apply "$REPO/sql/066_p1b2_count_hold.sql" "sql/066"; then
  ok "sql/066 が実 PostgreSQL にクリーン適用 (charge_hold_state 列・RPC 群含む)"
else
  ng "sql/066 適用失敗"; exit 2
fi
if apply "$REPO/sql/067_p1b2_invoice_status.sql" "sql/067"; then
  ok "sql/067 が実 PostgreSQL にクリーン適用 (請求書状態機械・再発行履歴・部分一意)"
else
  ng "sql/067 適用失敗"; exit 2
fi
if apply "$REPO/sql/068_p1b2_agency_approval.sql" "sql/068"; then
  ok "sql/068 が実 PostgreSQL にクリーン適用 (代理店増額承認)"
else
  ng "sql/068 適用失敗"; exit 2
fi
if apply "$REPO/sql/069_p1b2_staged_rollout.sql" "sql/069"; then
  ok "sql/069 が実 PostgreSQL にクリーン適用 (段階導入 disposition)"
else
  ng "sql/069 適用失敗"; exit 2
fi
if apply "$REPO/sql/070_p1b2_price_notifications.sql" "sql/070"; then
  ok "sql/070 が実 PostgreSQL にクリーン適用 (増額通知キュー)"
else
  ng "sql/070 適用失敗"; exit 2
fi
if apply "$REPO/sql/071_p1b2_operator_queue.sql" "sql/071"; then
  ok "sql/071 が実 PostgreSQL にクリーン適用 (Operator確認キュー read)"
else
  ng "sql/071 適用失敗"; exit 2
fi

# 便利: shipment を1行作る。ins <id> <booking> <agency> <pieces> <place_id> [date] [status]
ins() {
  psql -c "insert into public.shipments(id,booking_id,agency,booking_type,suitcase_count,from_place_id,from_hotel,shipment_date,status,amount_yen)
    values ('$1','$2','$3','fit',$4, $(if [ -n "${5:-}" ]; then echo "'$5'"; else echo null; fi), 'H', '${6:-2026-12-01}', '${7:-issued}', $4*4980)
    on conflict (id) do update set suitcase_count=excluded.suitcase_count, from_place_id=excluded.from_place_id;" >/dev/null
}
reset() { psql -c "truncate public.shipments cascade;" >/dev/null; }

echo ""
echo "=== T2: evaluate_charge_hold ==="
reset
ins 10000000-0000-0000-0000-000000000001 BDX-A A 20 PIDBULK
chk "T2 leg20個 → hold=true" "$(val "select hold from evaluate_charge_hold('10000000-0000-0000-0000-000000000001');")" "t"
chk "T2 leg20個 → reason=leg_bulk" "$(val "select reason from evaluate_charge_hold('10000000-0000-0000-0000-000000000001');")" "leg_bulk"

reset
ins 20000000-0000-0000-0000-000000000001 BDX-A A 12 PIDUNIT
ins 20000000-0000-0000-0000-000000000002 BDX-B B 8  PIDUNIT
chk "T2 同一pid 12+8 → 合算20で hold (unit_bulk)" "$(val "select reason from evaluate_charge_hold('20000000-0000-0000-0000-000000000001');")" "unit_bulk"
chk "T2 同一pid 12+8 → unit_total=20" "$(val "select unit_total from evaluate_charge_hold('20000000-0000-0000-0000-000000000001');")" "20"

reset
ins 30000000-0000-0000-0000-000000000001 BDX-A A 3 PIDSMALL
ins 30000000-0000-0000-0000-000000000002 BDX-B B 4 PIDSMALL
chk "T2 3+4=7<20 → hold=false (below_threshold)" "$(val "select hold from evaluate_charge_hold('30000000-0000-0000-0000-000000000001');")" "f"

reset
ins 40000000-0000-0000-0000-000000000001 BDX-A A 5 PIDDISC
psql -c "update public.shipments set count_discrepancy_flag=true where id='40000000-0000-0000-0000-000000000001';" >/dev/null
chk "T2 5個+差異フラグ → hold=true (discrepancy・20未満でも保留)" "$(val "select reason from evaluate_charge_hold('40000000-0000-0000-0000-000000000001');")" "discrepancy"

# residence (民泊/個人宅) は集荷単位に含めない → 12+8 でも合算されない
reset
psql -c "insert into public.shipments(id,booking_id,agency,booking_type,suitcase_count,from_residence,from_hotel,amount_yen)
  values ('50000000-0000-0000-0000-000000000001','BDX-A','A','fit',12,'{\"name\":\"Tanaka\"}','H',12*4980),
         ('50000000-0000-0000-0000-000000000002','BDX-B','B','fit',8,'{\"name\":\"Suzuki\"}','H',8*4980);" >/dev/null
chk "T2 residence 12+8 → 合算しない (no_unit・hold=false)" "$(val "select hold from evaluate_charge_hold('50000000-0000-0000-0000-000000000001');")" "f"

# place_id なし・同名 → name キーで合算 / 別名 → 合算しない
reset
psql -c "insert into public.shipments(id,booking_id,agency,booking_type,suitcase_count,from_hotel_ja,from_prefecture,from_city,from_hotel,amount_yen)
  values ('60000000-0000-0000-0000-000000000001','BDX-A','A','fit',12,'パレスホテル東京','東京都','千代田区','x',12*4980),
         ('60000000-0000-0000-0000-000000000002','BDX-B','B','fit',8, 'パレスホテル東京','東京都','千代田区','x',8*4980);" >/dev/null
chk "T2 place_idなし同名 12+8 → name キーで合算 (unit_bulk)" "$(val "select reason from evaluate_charge_hold('60000000-0000-0000-0000-000000000001');")" "unit_bulk"
reset
psql -c "insert into public.shipments(id,booking_id,agency,booking_type,suitcase_count,from_hotel_ja,from_prefecture,from_city,from_hotel,amount_yen)
  values ('61000000-0000-0000-0000-000000000001','BDX-A','A','fit',12,'パレスホテル東京','東京都','千代田区','x',12*4980),
         ('61000000-0000-0000-0000-000000000002','BDX-B','B','fit',8, 'パレスホテル','東京都','千代田区','x',8*4980);" >/dev/null
chk "T2 place_idなし別名 → 合算しない (誤集計回避・hold=false)" "$(val "select hold from evaluate_charge_hold('61000000-0000-0000-0000-000000000001');")" "f"

echo ""
echo "=== T3: 個数確認/料金確認/保留解除の分離 (v3.0 §3) ==="
# T3a: 実個数を記録しただけでは解除しない (held のまま・count_status=confirmed)。
reset
ins 70000000-0000-0000-0000-000000000001 BDX-A A 20 PIDC
psql -c "update public.shipments set charge_hold_state='held' where id='70000000-0000-0000-0000-000000000001';" >/dev/null
chk "T3a record → count_status=confirmed" "$(val "select count_status from record_pickup_count('70000000-0000-0000-0000-000000000001',20,'operator_manual','佐川:20個','',false,false,'op_taro');")" "confirmed"
chk "T3a 実個数記録だけでは解除しない (held 維持)" "$(val "select charge_hold_state from public.shipments where id='70000000-0000-0000-0000-000000000001';")" "held"
# T3b: 承認前の解除は拒否。
chk "T3b 料金未承認での解除は拒否 (price_not_approved)" "$(val "select reason from release_charge_hold('70000000-0000-0000-0000-000000000001','op_taro');")" "price_not_approved:pending"
# T3c: 料金計算→承認→解除 の順で初めて released。
psql -c "select apply_price_decision('70000000-0000-0000-0000-000000000001',99600,'calculated','op');" >/dev/null
psql -c "select apply_price_decision('70000000-0000-0000-0000-000000000001',99600,'approved','op');" >/dev/null
chk "T3c count=confirmed & price=approved & 問題なし → 解除成功" "$(val "select hold_state from release_charge_hold('70000000-0000-0000-0000-000000000001','op_taro');")" "released"
chk "T3c 追記履歴が複数残る (record+price×2+release)" "$(val "select count(*) from public.shipment_count_confirmations where shipment_id='70000000-0000-0000-0000-000000000001';")" "4"

# T3d: 未集荷/追加集荷が未解決なら、個数一致でも解除しない (v3.0 §2)。
reset
ins 71000000-0000-0000-0000-000000000001 BDX-A A 20 PIDISSUE
psql -c "update public.shipments set charge_hold_state='held' where id='71000000-0000-0000-0000-000000000001';" >/dev/null
psql -c "select record_pickup_count('71000000-0000-0000-0000-000000000001',20,'operator_manual','','',false,true,'op');" >/dev/null  # open_issue=true
psql -c "select apply_price_decision('71000000-0000-0000-0000-000000000001',99600,'calculated','op');
         select apply_price_decision('71000000-0000-0000-0000-000000000001',99600,'approved','op');" >/dev/null
chk "T3d 未集荷問題ありは解除しない (open_pickup_issue)" "$(val "select reason from release_charge_hold('71000000-0000-0000-0000-000000000001','op');")" "open_pickup_issue"

# T3e: disputed は count 未確定扱いで解除しない。
reset
ins 72000000-0000-0000-0000-000000000001 BDX-A A 20 PIDDISP
psql -c "update public.shipments set charge_hold_state='held' where id='72000000-0000-0000-0000-000000000001';" >/dev/null
psql -c "select record_pickup_count('72000000-0000-0000-0000-000000000001',18,'operator_manual','','',true,false,'op');" >/dev/null  # disputed=true
psql -c "select apply_price_decision('72000000-0000-0000-0000-000000000001',89600,'approved','op');" >/dev/null
chk "T3e disputed は解除しない (count_not_confirmed:disputed)" "$(val "select reason from release_charge_hold('72000000-0000-0000-0000-000000000001','op');")" "count_not_confirmed:disputed"

# T3f: A社30 + B社20 同一集荷単位 → A だけ全工程で解除 → B は held 継続 (按分しない)。
reset
ins 80000000-0000-0000-0000-000000000001 BDX-A A 30 PIDMULTI
ins 80000000-0000-0000-0000-000000000002 BDX-B B 20 PIDMULTI
psql -c "update public.shipments set charge_hold_state='held' where from_place_id='PIDMULTI';" >/dev/null
psql -c "select record_pickup_count('80000000-0000-0000-0000-000000000001',30,'operator_manual','佐川合計45・A分は30と確認','',false,false,'op');
         select apply_price_decision('80000000-0000-0000-0000-000000000001',149400,'calculated','op');
         select apply_price_decision('80000000-0000-0000-0000-000000000001',149400,'approved','op');
         select release_charge_hold('80000000-0000-0000-0000-000000000001','op');" >/dev/null
chk "T3f A社=released" "$(val "select charge_hold_state from public.shipments where id='80000000-0000-0000-0000-000000000001';")" "released"
chk "T3f B社=held 継続 (内訳未確定は按分せず保留)" "$(val "select charge_hold_state from public.shipments where id='80000000-0000-0000-0000-000000000002';")" "held"
chk "T3f pickup_unit_summary は2予約を独立表示" "$(val "select count(*) from pickup_unit_summary('80000000-0000-0000-0000-000000000001');")" "2"

# T3g: 自動確定 — 個数一致・料金一致・問題なし・内訳確定 → 1Txで finalized=released。
reset
ins 73000000-0000-0000-0000-000000000001 BDX-A A 20 PIDAUTO1
psql -c "update public.shipments set charge_hold_state='held' where id='73000000-0000-0000-0000-000000000001';" >/dev/null
# recalc=99600(=20×4980=現行amount_yen)・price_matches=true・no_open_issue=true・breakdown_confirmed=true
chk "T3g 一致+問題なし → finalized=true" "$(val "select finalized from auto_finalize_pickup('73000000-0000-0000-0000-000000000001',20,99600,true,true,true,'operator_manual','佐川:一致','op');")" "t"
chk "T3g 自動で released" "$(val "select charge_hold_state from public.shipments where id='73000000-0000-0000-0000-000000000001';")" "released"

# T3h: 不一致 (予約20→実18) → 自動確定せず記録のみ・held 維持・needs_operator。
reset
ins 74000000-0000-0000-0000-000000000001 BDX-A A 20 PIDAUTO2
psql -c "update public.shipments set charge_hold_state='held' where id='74000000-0000-0000-0000-000000000001';" >/dev/null
chk "T3h 不一致は自動確定しない (finalized=false)" "$(val "select finalized from auto_finalize_pickup('74000000-0000-0000-0000-000000000001',18,89640,false,true,true,'operator_manual','佐川:18個','op');")" "f"
chk "T3h 不一致でも実個数は記録 (count=confirmed)" "$(val "select count_status from public.shipments where id='74000000-0000-0000-0000-000000000001';")" "confirmed"
chk "T3h 不一致は held 維持 (Operator 確認へ)" "$(val "select charge_hold_state from public.shipments where id='74000000-0000-0000-0000-000000000001';")" "held"

echo ""
echo "=== T4: claim_charge_right (課金権の原子的取得) ==="
reset
ins 90000000-0000-0000-0000-000000000001 BDX-A A 12 PIDCLAIM
ins 90000000-0000-0000-0000-000000000002 BDX-B B 8  PIDCLAIM
chk "T4 apply_charge_holds_for_unit で2leg held" "$(val "select apply_charge_holds_for_unit('pid:PIDCLAIM','2026-12-01');")" "2"
chk "T4 held leg → 課金権を渡さない (claimed=false)" "$(val "select claimed from claim_charge_right('90000000-0000-0000-0000-000000000001','w1',120);")" "f"
chk "T4 held leg → reason=held:unit_bulk" "$(val "select reason from claim_charge_right('90000000-0000-0000-0000-000000000001','w1',120);")" "held:unit_bulk"

# released は課金権を渡す
reset
ins a0000000-0000-0000-0000-000000000001 BDX-A A 20 PIDREL
psql -c "update public.shipments set charge_hold_state='released' where id='a0000000-0000-0000-0000-000000000001';" >/dev/null
chk "T4 released leg → 課金権を渡す (claimed=true)" "$(val "select claimed from claim_charge_right('a0000000-0000-0000-0000-000000000001','w1',120);")" "t"

# auto (保留対象外) は渡す / lease 内の2回目は owner guard で不可 / 既課金は不可
reset
ins b0000000-0000-0000-0000-000000000001 BDX-A A 5 PIDAUTO
chk "T4 auto(5個・単独) → claimed=true" "$(val "select claimed from claim_charge_right('b0000000-0000-0000-0000-000000000001','w1',120);")" "t"
chk "T4 lease 内の2回目 → claimed_by_other" "$(val "select reason from claim_charge_right('b0000000-0000-0000-0000-000000000001','w2',120);")" "claimed_by_other"
psql -c "update public.shipments set charged_at=now() where id='b0000000-0000-0000-0000-000000000001';" >/dev/null
chk "T4 既課金 → already_charged" "$(val "select reason from claim_charge_right('b0000000-0000-0000-0000-000000000001','w3',120);")" "already_charged"

echo ""
echo "=== T5: 競合 (2接続) — B社追加+hold付与 と A社課金権取得が同時 ==="
# 指示 §10: A社12が集荷予定 → B社8が同一ホテル同日に追加され合計20 (保留対象) → 同時に A社の課金が開始。
# A社が保留をすり抜けて課金されてはいけない。
reset
ins c0000000-0000-0000-0000-000000000001 BDX-A A 12 PIDRACE   # A社12 (まだ auto)
# 接続1: B社8を追加し、集荷単位に hold を付与 (advisory lock を保持したまま sleep)。
( psql -v ON_ERROR_STOP=1 >/tmp/t5_a 2>&1 <<SQL
BEGIN;
INSERT INTO public.shipments(id,booking_id,agency,booking_type,suitcase_count,from_place_id,from_hotel,shipment_date,status,amount_yen)
 VALUES ('c0000000-0000-0000-0000-000000000002','BDX-B','B','fit',8,'PIDRACE','H','2026-12-01','issued',8*4980);
SELECT apply_charge_holds_for_unit('pid:PIDRACE','2026-12-01');
SELECT pg_sleep(2);
COMMIT;
SQL
) &
sleep 1.0
# 接続2: A社の課金権取得を試みる (接続1の確定を待ち、合計20を見て held を返すはず)。
RES=$(val "select claimed||':'||reason from claim_charge_right('c0000000-0000-0000-0000-000000000001','cronA',120);")
wait
chk "T5 A社の課金権取得は held で拒否 (すり抜けない)" "$RES" "false:held:unit_bulk"
chk "T5 A社は未課金のまま" "$(val "select coalesce(charged_at::text,'null') from public.shipments where id='c0000000-0000-0000-0000-000000000001';")" "null"
chk "T5 A社は held" "$(val "select charge_hold_state from public.shipments where id='c0000000-0000-0000-0000-000000000001';")" "held"

echo ""
echo "=== T6: 指示 §9 競合/安全 Case A–J (v3.1) ==="
# Case A は T5 (B社追加と A社課金権取得の競合) で検証済み。ここは B–J。

# Case B: 実個数を入力しただけでは課金権が出ない (held のまま)。
reset
ins d0000000-0000-0000-0000-000000000001 BDX-B B 20 PIDCB
psql -c "update public.shipments set charge_hold_state='held' where id='d0000000-0000-0000-0000-000000000001';
         select record_pickup_count('d0000000-0000-0000-0000-000000000001',20,'operator_manual','','',false,false,'op');" >/dev/null
chk "Case B 実個数記録だけでは課金権を渡さない" "$(val "select claimed||':'||reason from claim_charge_right('d0000000-0000-0000-0000-000000000001','w',120);")" "false:held:leg_bulk"

# Case C: 承認済み金額が保存され解除されるまで課金許可されない。解除で amount_yen が承認額に確定。
reset
ins e0000000-0000-0000-0000-000000000001 BDX-C C 20 PIDCC   # amount_yen = 20*4980 = 99600
psql -c "update public.shipments set charge_hold_state='held' where id='e0000000-0000-0000-0000-000000000001';
         select record_pickup_count('e0000000-0000-0000-0000-000000000001',18,'operator_manual','佐川:18','',false,false,'op');" >/dev/null
chk "Case C 承認前の解除は不可" "$(val "select reason from release_charge_hold('e0000000-0000-0000-0000-000000000001','op');")" "price_not_approved:pending"
psql -c "select apply_price_decision('e0000000-0000-0000-0000-000000000001',89640,'calculated','op');" >/dev/null
chk "Case C 計算済みでも承認前は解除不可" "$(val "select reason from release_charge_hold('e0000000-0000-0000-0000-000000000001','op');")" "price_not_approved:calculated"
psql -c "select apply_price_decision('e0000000-0000-0000-0000-000000000001',89640,'approved','op',4980,'none','p1b2-v3.1',18);" >/dev/null
chk "Case C 承認額を保存 (approved_amount_yen=89640)" "$(val "select approved_amount_yen from public.shipments where id='e0000000-0000-0000-0000-000000000001';")" "89640"
chk "Case C 承認時点では amount_yen 未反映 (99600)" "$(val "select amount_yen from public.shipments where id='e0000000-0000-0000-0000-000000000001';")" "99600"
chk "Case C 解除で amount_yen が承認額に原子確定 (89640)" "$(val "select hold_state from release_charge_hold('e0000000-0000-0000-0000-000000000001','op');")" "released"
chk "Case C amount_yen = 承認額 (89640)" "$(val "select amount_yen from public.shipments where id='e0000000-0000-0000-0000-000000000001';")" "89640"

# Case D: Stripe タイムアウト (結果不明) のまま新しい課金を作らない。
reset
ins f0000000-0000-0000-0000-000000000001 BDX-D D 5 PIDCD   # auto・課金可
psql -c "select claim_charge_right('f0000000-0000-0000-0000-000000000001','w1',120);
         select begin_charge_attempt('f0000000-0000-0000-0000-000000000001','w1','charge_f');
         select settle_charge_attempt('f0000000-0000-0000-0000-000000000001','w1','reconciliation_required',null,'StripeConnectionError','timeout');" >/dev/null
chk "Case D 結果不明は新規課金を拒否 (reconciliation_required)" "$(val "select reason from claim_charge_right('f0000000-0000-0000-0000-000000000001','w2',120);")" "reconciliation_required"
chk "Case D 未課金のまま" "$(val "select coalesce(charged_at::text,'null') from public.shipments where id='f0000000-0000-0000-0000-000000000001';")" "null"

# Case E/F: Stripe 成功・DB 更新失敗 → 照合で確定。Webhook 重複でも二重課金しない。
reset
ins 11110000-0000-0000-0000-000000000001 BDX-E E 5 PIDCE   # 5*4980 = 24900
psql -c "select claim_charge_right('11110000-0000-0000-0000-000000000001','w1',120);
         select begin_charge_attempt('11110000-0000-0000-0000-000000000001','w1','charge_11');" >/dev/null
chk "Case E 照合で初回のみ確定 (charged=true)" "$(val "select charged from reconcile_charge_attempt('11110000-0000-0000-0000-000000000001','succeeded','pi_11',24900);")" "t"
CHG1=$(val "select charged_at from public.shipments where id='11110000-0000-0000-0000-000000000001';")
chk "Case E charged_at がセットされる" "$([ -n "$CHG1" ] && echo set || echo null)" "set"
chk "Case F Webhook 重複は二重課金しない (charged=false)" "$(val "select charged from reconcile_charge_attempt('11110000-0000-0000-0000-000000000001','succeeded','pi_11',24900);")" "f"
chk "Case F charged_at は不変 (1回だけ確定)" "$(val "select charged_at from public.shipments where id='11110000-0000-0000-0000-000000000001';")" "$CHG1"
chk "Case F 既課金は課金権を渡さない" "$(val "select reason from claim_charge_right('11110000-0000-0000-0000-000000000001','w2',120);")" "already_charged"

# Case G: 月次請求の再実行で同一区間が二重計上されない。
reset
ins 22220000-0000-0000-0000-000000000001 BDX-G1 G 3 PIDG1 2026-12-05 issued
ins 22220000-0000-0000-0000-000000000002 BDX-G2 G 4 PIDG2 2026-12-06 issued
chk "Case G 初回計上=2 leg" "$(val "select count(*) from claim_invoice_postings('G','2026-12');")" "2"
chk "Case G 再実行でも増えない (冪等)" "$(val "select count(*) from claim_invoice_postings('G','2026-12');")" "2"
chk "Case G 台帳は2行 (二重計上なし)" "$(val "select count(*) from public.shipment_invoice_postings where agency='G';")" "2"

# Case H: 月次締め後に確定した保留 leg は翌月/調整として計上。保留中は当月に出ない。
reset
ins 33330000-0000-0000-0000-000000000001 BDX-H H 20 PIDH 2026-11-15 issued   # 20個=held・発送は11月
psql -c "update public.shipments set charge_hold_state='held' where id='33330000-0000-0000-0000-000000000001';" >/dev/null
chk "Case H 保留中は当月(11月)請求に計上されない" "$(val "select count(*) from claim_invoice_postings('H','2026-11');")" "0"
psql -c "select record_pickup_count('33330000-0000-0000-0000-000000000001',20,'operator_manual','','',false,false,'op');
         select apply_price_decision('33330000-0000-0000-0000-000000000001',99600,'calculated','op');
         select apply_price_decision('33330000-0000-0000-0000-000000000001',99600,'approved','op',4980,'none','p1b2-v3.1',20);
         select release_charge_hold('33330000-0000-0000-0000-000000000001','op');" >/dev/null
chk "Case H 翌月(12月)で計上される" "$(val "select count(*) from claim_invoice_postings('H','2026-12');")" "1"
chk "Case H 調整計上フラグ (is_adjustment=true)" "$(val "select is_adjustment from claim_invoice_postings('H','2026-12');")" "t"
chk "Case H 生涯1行のみ (複数月に二重計上しない)" "$(val "select count(*) from public.shipment_invoice_postings where shipment_id='33330000-0000-0000-0000-000000000001';")" "1"

# Case I: 19個以下の通常 FIT は従来どおり自動課金・請求 (保留対象外)。
reset
ins 44440000-0000-0000-0000-000000000001 BDX-I I 19 PIDI 2026-12-10 issued
chk "Case I 19個FITは課金権が出る" "$(val "select claimed from claim_charge_right('44440000-0000-0000-0000-000000000001','w',120);")" "t"
chk "Case I 19個FITは月次請求に計上される" "$(val "select count(*) from claim_invoice_postings('I','2026-12');")" "1"

# Case J: 団体割引で再計算された承認額が amount_yen に確定 (遡及の有無は lineSubtotalYen・test-pricing で検証)。
reset
psql -c "insert into public.shipments(id,booking_id,agency,booking_type,suitcase_count,from_place_id,from_hotel,shipment_date,status,amount_yen,charge_hold_state)
  values ('55550000-0000-0000-0000-000000000001','BDX-J','J','group',26,'PIDJ','H','2026-12-01','issued',26*4980,'held');" >/dev/null
psql -c "select record_pickup_count('55550000-0000-0000-0000-000000000001',26,'operator_manual','','',false,false,'op');
         select apply_price_decision('55550000-0000-0000-0000-000000000001',119121,'calculated','op');
         select apply_price_decision('55550000-0000-0000-0000-000000000001',119121,'approved','op',4980,'group8','p1b2-v3.1',26);
         select release_charge_hold('55550000-0000-0000-0000-000000000001','op');" >/dev/null
chk "Case J 団体割引の承認額が amount_yen に確定 (119121)" "$(val "select amount_yen from public.shipments where id='55550000-0000-0000-0000-000000000001';")" "119121"
chk "Case J 割引条件を監査列に保存 (group8)" "$(val "select price_discount_basis from public.shipments where id='55550000-0000-0000-0000-000000000001';")" "group8"

echo ""
echo "=== T7: v3.2 Track A 送信直前の再評価 revalidate_charge_claim (§2) ==="
# T7a: claim 後に同一単位へ別予約が足され大口化 → 送信直前の revalidate が送信を止め held へ戻す。
reset
ins 66000000-0000-0000-0000-000000000001 BDX-A A 12 PID7A
psql -c "select claim_charge_right('66000000-0000-0000-0000-000000000001','w1',120);
         select begin_charge_attempt('66000000-0000-0000-0000-000000000001','w1','charge_66');" >/dev/null
ins 66000000-0000-0000-0000-000000000002 BDX-B B 8 PID7A   # claim 後に追加 → 単位 20
chk "T7a 送信直前 revalidate が大口化を検知し中止" "$(val "select ok||':'||reason from revalidate_charge_claim('66000000-0000-0000-0000-000000000001','w1',120);")" "false:unit_changed_hold:unit_bulk"
chk "T7a A は held へ戻る" "$(val "select charge_hold_state from public.shipments where id='66000000-0000-0000-0000-000000000001';")" "held"
chk "T7a A の試行は解放 (attempt_state=null・再課金は確認後)" "$(val "select coalesce(charge_attempt_state,'null') from public.shipments where id='66000000-0000-0000-0000-000000000001';")" "null"
chk "T7a A は未課金" "$(val "select coalesce(charged_at::text,'null') from public.shipments where id='66000000-0000-0000-0000-000000000001';")" "null"

# T7b: 変化なし → revalidate は ok (送信続行)。
reset
ins 66000000-0000-0000-0000-000000000010 BDX-A A 5 PID7B
psql -c "select claim_charge_right('66000000-0000-0000-0000-000000000010','w1',120);
         select begin_charge_attempt('66000000-0000-0000-0000-000000000010','w1','charge_66b');" >/dev/null
chk "T7b 変化なし → revalidate ok" "$(val "select ok||':'||reason from revalidate_charge_claim('66000000-0000-0000-0000-000000000010','w1',120);")" "true:ok"

# T7c: released は単位再評価をスキップして送信続行。
reset
ins 66000000-0000-0000-0000-000000000020 BDX-A A 20 PID7C
psql -c "update public.shipments set charge_hold_state='released' where id='66000000-0000-0000-0000-000000000020';
         select claim_charge_right('66000000-0000-0000-0000-000000000020','w1',120);
         select begin_charge_attempt('66000000-0000-0000-0000-000000000020','w1','charge_66c');" >/dev/null
chk "T7c released → revalidate ok_released" "$(val "select ok||':'||reason from revalidate_charge_claim('66000000-0000-0000-0000-000000000020','w1',120);")" "true:ok_released"

# T7d: owner 不一致の revalidate は拒否 (別 owner が送信直前チェックを乗っ取れない)。
reset
ins 66000000-0000-0000-0000-000000000030 BDX-A A 5 PID7D
psql -c "select claim_charge_right('66000000-0000-0000-0000-000000000030','w1',120);
         select begin_charge_attempt('66000000-0000-0000-0000-000000000030','w1','charge_66d');" >/dev/null
chk "T7d owner 不一致は拒否" "$(val "select ok||':'||reason from revalidate_charge_claim('66000000-0000-0000-0000-000000000030','w2',120);")" "false:claim_owner_mismatch"

echo ""
echo "=== T8: v3.2 Track B 請求書の状態機械・再発行・二重計上防止 (§5-§9) ==="
delinv() { psql -c "delete from invoice_sends; delete from invoice_versions;" >/dev/null; }

# T8a: 正常系遷移 draft→prepared→approved→sent→paid + 履歴4件。
delinv
chk "T8a prepared" "$(val "select status from invoice_prepare('AgA','2026-12','INV-A',110000,10);")" "prepared"
chk "T8a approved" "$(val "select status from invoice_approve('AgA','2026-12','op');")" "approved"
chk "T8a sent" "$(val "select status from invoice_mark_sent('AgA','2026-12','a@x');")" "sent"
chk "T8a paid" "$(val "select status from invoice_mark_paid('AgA','2026-12');")" "paid"
chk "T8a 実効ステータス=paid" "$(val "select invoice_effective_status('AgA','2026-12');")" "paid"
chk "T8a 履歴4件(prepared/approved/sent/paid)" "$(val "select count(*) from invoice_versions where agency='AgA' and month='2026-12';")" "4"

# T8b: 承認後は金額を黙って書き換えない (already_finalized・金額不変)。
delinv
psql -c "select invoice_prepare('AgB','2026-12','INV-B',100000,10); select invoice_approve('AgB','2026-12','op');" >/dev/null
chk "T8b 承認後の再prepareは拒否" "$(val "select reason from invoice_prepare('AgB','2026-12','INV-B',999999,99);")" "already_finalized"
chk "T8b 金額は不変 (100000)" "$(val "select prepared_total_yen from invoice_sends where agency='AgB' and month='2026-12';")" "100000"
psql -c "select invoice_mark_sent('AgB','2026-12','b@x'); select invoice_mark_paid('AgB','2026-12');" >/dev/null
chk "T8b paid は取消不可" "$(val "select reason from invoice_void('AgB','2026-12','x','op');")" "not_voidable:paid"

# T8c: 送付済みの誤りを void→reissue。送信済みPDFを黙って差し替えず履歴を残す。leg は解放され再計上可能。
delinv; reset
ins 77000000-0000-0000-0000-000000000001 BDX-E AgE 3 PIDE1 2026-12-05 issued
chk "T8c 初回計上=1 leg" "$(val "select count(*) from claim_invoice_postings('AgE','2026-12');")" "1"
psql -c "select invoice_prepare('AgE','2026-12','INV-E',16434,3); select invoice_approve('AgE','2026-12','op'); select invoice_mark_sent('AgE','2026-12','e@x');" >/dev/null
chk "T8c 送信済みを void" "$(val "select status from invoice_void('AgE','2026-12','個数誤り','op');")" "voided"
chk "T8c void で当月の計上は解放 (active=0)" "$(val "select count(*) from shipment_invoice_postings where agency='AgE' and billed_month='2026-12' and voided_at is null;")" "0"
chk "T8c 計上履歴は残る (void含め1行)" "$(val "select count(*) from shipment_invoice_postings where agency='AgE' and billed_month='2026-12';")" "1"
chk "T8c reissue で新バージョン(draft v2)" "$(val "select new_version from invoice_reissue('AgE','2026-12','op');")" "2"
chk "T8c 再発行で leg を再計上=1 (二重計上しない)" "$(val "select count(*) from claim_invoice_postings('AgE','2026-12');")" "1"
chk "T8c active な計上は常に1 leg" "$(val "select count(*) from shipment_invoice_postings where agency='AgE' and billed_month='2026-12' and voided_at is null;")" "1"
chk "T8c 台帳は履歴保持で2行(void 1 + active 1)" "$(val "select count(*) from shipment_invoice_postings where agency='AgE' and billed_month='2026-12';")" "2"
chk "T8c 請求書履歴に voided と reissued" "$(val "select count(*) from invoice_versions where agency='AgE' and month='2026-12' and action in ('voided','reissued');")" "2"

# T8d: 同時送付 (2接続) — advisory lock + CAS で送付確定は1回だけ。
delinv
psql -c "select invoice_prepare('AgD','2026-12','INV-D',50000,5); select invoice_approve('AgD','2026-12','op');" >/dev/null
( val "select ok from invoice_mark_sent('AgD','2026-12','d1@x');" >/tmp/t8d1 ) &
( val "select ok from invoice_mark_sent('AgD','2026-12','d2@x');" >/tmp/t8d2 ) &
wait
t8dn=0; [ "$(cat /tmp/t8d1)" = "t" ] && t8dn=$((t8dn+1)); [ "$(cat /tmp/t8d2)" = "t" ] && t8dn=$((t8dn+1))
chk "T8d 同時送付でも確定は1回だけ" "$t8dn" "1"
chk "T8d 送付記録は1回" "$(val "select case when sent_to_agency_at is null then 0 else 1 end from invoice_sends where agency='AgD' and month='2026-12';")" "1"

# T8e: 下書き (prepared) は再計算で上書きできる (未承認なので金額変更OK)。
delinv
psql -c "select invoice_prepare('AgF','2026-12','INV-F',100000,10);" >/dev/null
chk "T8e 未承認の下書きは再計算で上書き可" "$(val "select status from invoice_prepare('AgF','2026-12','INV-F',120000,12);")" "prepared"
chk "T8e 上書き後の金額 (120000)" "$(val "select prepared_total_yen from invoice_sends where agency='AgF' and month='2026-12';")" "120000"

echo ""
echo "=== T9: v3.3 Operator フロー E2E (confirm-pickup-count の RPC 列を再現・§STEP4) ==="
# T9a: 予約50→実45 (減額)。記録→計算→承認→解除→課金許可。承認前は課金されない。
reset
ins 88000000-0000-0000-0000-000000000001 BDX-50 Ag50 50 PID9A   # amount_yen=249000・大口
psql -c "update public.shipments set charge_hold_state='held' where id='88000000-0000-0000-0000-000000000001';
         select record_pickup_count('88000000-0000-0000-0000-000000000001',45,'operator_manual','佐川:45','',false,false,'op');" >/dev/null
chk "T9a 承認前は課金権が出ない (held)" "$(val "select claimed from claim_charge_right('88000000-0000-0000-0000-000000000001','w',120);")" "f"
psql -c "select apply_price_decision('88000000-0000-0000-0000-000000000001',224100,'calculated','op');" >/dev/null
chk "T9a 計算済みでも承認前は解除不可" "$(val "select reason from release_charge_hold('88000000-0000-0000-0000-000000000001','op');")" "price_not_approved:calculated"
psql -c "select apply_price_decision('88000000-0000-0000-0000-000000000001',224100,'approved','op',4980,'none','p1b2-v3.1',45);
         select release_charge_hold('88000000-0000-0000-0000-000000000001','op');" >/dev/null
chk "T9a 承認・解除で amount_yen 確定 (224100)" "$(val "select amount_yen from public.shipments where id='88000000-0000-0000-0000-000000000001';")" "224100"
chk "T9a 解除後は課金権が出る (ok_released)" "$(val "select reason from claim_charge_right('88000000-0000-0000-0000-000000000001','w',120);")" "ok_released"

# T9b: 予約26→実24 (個数減でも割引消失で増額)。増額は代理店承認が必須・Operator では承認不可。
reset
psql -c "insert into public.agencies(id,name) values ('aaaa0000-0000-0000-0000-0000000000a6','Ag26') on conflict (name) do nothing;" >/dev/null
AG26=$(val "select id from public.agencies where name='Ag26';")
psql -c "insert into public.shipments(id,booking_id,agency,booking_type,suitcase_count,from_place_id,from_hotel,shipment_date,status,amount_yen,charge_hold_state)
  values ('88000000-0000-0000-0000-000000000010','BDX-26','Ag26','group',26,'PID9B','H','2026-12-01','issued',119121,'held');" >/dev/null  # 予約時=割引後 119121
psql -c "select record_pickup_count('88000000-0000-0000-0000-000000000010',24,'operator_manual','佐川:24','',false,false,'op');
         select apply_price_decision('88000000-0000-0000-0000-000000000010',119520,'requires_customer_approval','op');
         select request_price_approval('88000000-0000-0000-0000-000000000010',119121,119520,24,1,null);" >/dev/null  # 24個=割引外れ 119520>119121
chk "T9b 増額は要顧客承認" "$(val "select price_status from public.shipments where id='88000000-0000-0000-0000-000000000010';")" "requires_customer_approval"
chk "T9b Operator では増額を承認できない" "$(val "select reason from apply_price_decision('88000000-0000-0000-0000-000000000010',119520,'approved','op');")" "needs_agency_approval"
chk "T9b 増額承認前は解除不可" "$(val "select reason from release_charge_hold('88000000-0000-0000-0000-000000000010','op');")" "price_not_approved:requires_customer_approval"
chk "T9b 増額承認前は課金権が出ない" "$(val "select claimed from claim_charge_right('88000000-0000-0000-0000-000000000010','w',120);")" "f"
chk "T9b 代理店承認で approved" "$(val "select state from agency_decide_price('88000000-0000-0000-0000-000000000010','$AG26',1,'approved',119520);")" "approved"
psql -c "select release_charge_hold('88000000-0000-0000-0000-000000000010','op');" >/dev/null
chk "T9b 代理店承認後に増額確定 (119520)" "$(val "select amount_yen from public.shipments where id='88000000-0000-0000-0000-000000000010';")" "119520"
chk "T9b 承認後は課金権が出る" "$(val "select reason from claim_charge_right('88000000-0000-0000-0000-000000000010','w',120);")" "ok_released"

echo ""
echo "=== T10: v3.3 既存請求フローと状態機械の整合 (レガシー行の status 導出・§STEP2) ==="
delinv
psql -c "insert into invoice_sends(agency,month,invoice_no,sent_to) values ('LegA','2026-12','INV-L','{}');" >/dev/null
chk "T10 行あり・status null → prepared 導出" "$(val "select invoice_effective_status('LegA','2026-12');")" "prepared"
psql -c "update invoice_sends set approved_at=now() where agency='LegA' and month='2026-12';" >/dev/null
chk "T10 approved_at → approved 導出" "$(val "select invoice_effective_status('LegA','2026-12');")" "approved"
psql -c "update invoice_sends set sent_to_agency_at=now() where agency='LegA' and month='2026-12';" >/dev/null
chk "T10 sent_to_agency_at → sent 導出" "$(val "select invoice_effective_status('LegA','2026-12');")" "sent"
psql -c "update invoice_sends set status='voided', voided_at=now() where agency='LegA' and month='2026-12';" >/dev/null
chk "T10 明示 status 列が導出より優先 (voided)" "$(val "select invoice_effective_status('LegA','2026-12');")" "voided"

echo ""
echo "=== T11: v3.4 Track B 代理店増額承認の認可・安全性 (§14 1-8) ==="
reset
psql -c "insert into public.agencies(id,name) values
  ('a1111111-1111-1111-1111-111111111111','AgX'),('a2222222-2222-2222-2222-222222222222','AgY')
  on conflict (name) do nothing;" >/dev/null
AGX=$(val "select id from public.agencies where name='AgX';")
AGY=$(val "select id from public.agencies where name='AgY';")
mkship() { psql -c "insert into public.shipments(id,booking_id,agency,booking_type,suitcase_count,from_place_id,from_hotel,shipment_date,status,amount_yen,charge_hold_state)
  values ('$1','$2','AgX','group',26,'$3','H','2026-12-01','issued',119121,'held');" >/dev/null; }
mkship 99000000-0000-0000-0000-000000000001 BDX-X1 PIDX1
psql -c "select record_pickup_count('99000000-0000-0000-0000-000000000001',24,'operator_manual','','',false,false,'op');
         select request_price_approval('99000000-0000-0000-0000-000000000001',119121,119520,24,1,null);" >/dev/null
chk "T11-2 他代理店は承認できない (not_owner)" "$(val "select reason from agency_decide_price('99000000-0000-0000-0000-000000000001','$AGY',1,'approved',119520);")" "not_owner"
chk "T11-3 不正な agency_id は承認できない" "$(val "select reason from agency_decide_price('99000000-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333',1,'approved',119520);")" "not_owner"
chk "T11-4 承認金額の改ざんは拒否 (amount_mismatch)" "$(val "select reason from agency_decide_price('99000000-0000-0000-0000-000000000001','$AGX',1,'approved',999999);")" "amount_mismatch"
chk "T11-5 見積バージョン不一致は拒否" "$(val "select reason from agency_decide_price('99000000-0000-0000-0000-000000000001','$AGX',2,'approved',119520);")" "version_mismatch:1"
chk "T11-1 正しい代理店が承認できる" "$(val "select state from agency_decide_price('99000000-0000-0000-0000-000000000001','$AGX',1,'approved',119520);")" "approved"
chk "T11-1 承認で price_status=approved" "$(val "select price_status from public.shipments where id='99000000-0000-0000-0000-000000000001';")" "approved"
chk "T11-6 二重承認は冪等 (already_approved)" "$(val "select reason from agency_decide_price('99000000-0000-0000-0000-000000000001','$AGX',1,'approved',119520);")" "already_approved"
# 期限切れ
mkship 99000000-0000-0000-0000-000000000002 BDX-X2 PIDX2
psql -c "select request_price_approval('99000000-0000-0000-0000-000000000002',119121,119520,24,1, now()-interval '1 hour');" >/dev/null
chk "T11-5b 期限切れは承認できない (expired)" "$(val "select reason from agency_decide_price('99000000-0000-0000-0000-000000000002','$AGX',1,'approved',119520);")" "expired"
# 承認後の条件変更は再承認
psql -c "select request_price_approval('99000000-0000-0000-0000-000000000001',119121,120000,23,2,null);" >/dev/null
chk "T11-7 承認後の条件変更で再び要承認" "$(val "select price_status from public.shipments where id='99000000-0000-0000-0000-000000000001';")" "requires_customer_approval"
chk "T11-7 旧承認は superseded (生きた approved=0)" "$(val "select count(*) from shipment_price_approvals where shipment_id='99000000-0000-0000-0000-000000000001' and state='approved';")" "0"
chk "T11-7 再承認で再び approved" "$(val "select state from agency_decide_price('99000000-0000-0000-0000-000000000001','$AGX',2,'approved',120000);")" "approved"
# 拒否は保留維持
mkship 99000000-0000-0000-0000-000000000003 BDX-X3 PIDX3
psql -c "select record_pickup_count('99000000-0000-0000-0000-000000000003',24,'operator_manual','','',false,false,'op');
         select request_price_approval('99000000-0000-0000-0000-000000000003',119121,119520,24,1,null);
         select agency_decide_price('99000000-0000-0000-0000-000000000003','$AGX',1,'declined',119520);" >/dev/null
chk "T11-8 拒否で price_status は要承認のまま" "$(val "select price_status from public.shipments where id='99000000-0000-0000-0000-000000000003';")" "requires_customer_approval"
chk "T11-8 拒否で解除不可 (保留維持)" "$(val "select reason from release_charge_hold('99000000-0000-0000-0000-000000000003','op');")" "price_not_approved:requires_customer_approval"
# 同時承認 (2接続) → approved は1確定
mkship 99000000-0000-0000-0000-000000000004 BDX-X4 PIDX4
psql -c "select request_price_approval('99000000-0000-0000-0000-000000000004',119121,119520,24,1,null);" >/dev/null
( val "select state from agency_decide_price('99000000-0000-0000-0000-000000000004','$AGX',1,'approved',119520);" >/tmp/t11a1 ) &
( val "select state from agency_decide_price('99000000-0000-0000-0000-000000000004','$AGX',1,'approved',119520);" >/tmp/t11a2 ) &
wait
chk "T11-6b 同時承認でも approved は1件のみ" "$(val "select count(*) from shipment_price_approvals where shipment_id='99000000-0000-0000-0000-000000000004' and state='approved';")" "1"

echo ""
echo "=== T12: v3.4 Track C 代理店単位の段階導入 disposition (§14 26-30) ==="
reset
psql -c "insert into public.agencies(id,name) values
  ('c1111111-1111-1111-1111-111111111111','AgON'),('c2222222-2222-2222-2222-222222222222','AgOFF')
  on conflict (name) do nothing;
  delete from public.charge_hold_agency_optin;
  insert into public.charge_hold_agency_optin(agency_id,enabled_by)
    select id,'test' from public.agencies where name='AgON';" >/dev/null
onoff() { psql -c "insert into public.shipments(id,booking_id,agency,booking_type,suitcase_count,from_place_id,from_hotel,shipment_date,status,amount_yen)
  values ('$1','$2','$3','fit',$4,'$5','H','2026-12-01','issued',$4*4980) on conflict (id) do nothing;" >/dev/null; }
# 27 対象代理店 (単独ユニット) → hold
onoff c7000000-0000-0000-0000-000000000001 BDX-ON AgON 5 PIDON
chk "T12-27 Allowlist対象は hold" "$(val "select charge_hold_unit_disposition('c7000000-0000-0000-0000-000000000001');")" "hold"
chk "T12-27 should_gate=true" "$(val "select charge_hold_should_gate('c7000000-0000-0000-0000-000000000001');")" "t"
# 28 対象外 (単独ユニット) → legacy (従来動作)
onoff c7000000-0000-0000-0000-000000000002 BDX-OFF AgOFF 5 PIDOFF
chk "T12-28 Allowlist対象外は legacy" "$(val "select charge_hold_unit_disposition('c7000000-0000-0000-0000-000000000002');")" "legacy"
chk "T12-28 should_gate=false (従来動作)" "$(val "select charge_hold_should_gate('c7000000-0000-0000-0000-000000000002');")" "f"
# 29 混在ユニット (AgON 12 + AgOFF 8) → 双方 operator_review (scheme C)
onoff c7000000-0000-0000-0000-000000000011 BDX-MON AgON 12 PIDMIX
onoff c7000000-0000-0000-0000-000000000012 BDX-MOFF AgOFF 8 PIDMIX
chk "T12-29 混在=対象側 operator_review" "$(val "select charge_hold_unit_disposition('c7000000-0000-0000-0000-000000000011');")" "operator_review"
chk "T12-29 混在=対象外側も operator_review (自動課金停止)" "$(val "select charge_hold_unit_disposition('c7000000-0000-0000-0000-000000000012');")" "operator_review"
psql -c "select mark_charge_operator_review('c7000000-0000-0000-0000-000000000011');" >/dev/null
chk "T12-29 mark_charge_operator_review で held" "$(val "select charge_hold_state from public.shipments where id='c7000000-0000-0000-0000-000000000011';")" "held"
# 30 対象変更は既存の課金状態を巻き戻さない
onoff c7000000-0000-0000-0000-000000000021 BDX-CH AgON 5 PIDCH
psql -c "update public.shipments set charged_at=now(),charge_attempt_state='succeeded' where id='c7000000-0000-0000-0000-000000000021';
         delete from public.charge_hold_agency_optin o using public.agencies a where a.id=o.agency_id and a.name='AgON';" >/dev/null
chk "T12-30 opt-out後も既課金は巻き戻さない" "$(val "select case when charged_at is null then 'null' else 'charged' end from public.shipments where id='c7000000-0000-0000-0000-000000000021';")" "charged"
chk "T12-30 opt-out後は disposition=legacy" "$(val "select charge_hold_unit_disposition('c7000000-0000-0000-0000-000000000021');")" "legacy"
# held leg は opt-out でも自動解除しない
psql -c "insert into public.charge_hold_agency_optin(agency_id,enabled_by) select id,'test' from public.agencies where name='AgON';" >/dev/null
onoff c7000000-0000-0000-0000-000000000031 BDX-HD AgON 20 PIDHD
psql -c "update public.shipments set charge_hold_state='held' where id='c7000000-0000-0000-0000-000000000031';
         delete from public.charge_hold_agency_optin o using public.agencies a where a.id=o.agency_id and a.name='AgON';" >/dev/null
chk "T12-30 opt-out後も held は自動解除しない" "$(val "select charge_hold_state from public.shipments where id='c7000000-0000-0000-0000-000000000031';")" "held"

echo ""
echo "=== T13: v3.5 Track A 混在集荷単位の安全性 (既存の安全な保留を解除しない) ==="
reset
psql -c "insert into public.agencies(id,name) values
  ('d1111111-1111-1111-1111-111111111111','AgMX'),('d2222222-2222-2222-2222-222222222222','AgMY')
  on conflict (name) do nothing;
  delete from public.charge_hold_agency_optin;
  insert into public.charge_hold_agency_optin(agency_id,enabled_by) select id,'t' from public.agencies where name='AgMX';" >/dev/null
# AgMX(対象) 12 + AgMY(対象外) 8 同一ホテル同日 = 混在
psql -c "insert into public.shipments(id,booking_id,agency,booking_type,suitcase_count,from_place_id,from_hotel,shipment_date,status,amount_yen)
  values ('da000000-0000-0000-0000-000000000001','BDX-MX','AgMX','fit',12,'PIDMX','H','2026-12-01','issued',59760),
         ('da000000-0000-0000-0000-000000000002','BDX-MY','AgMY','fit',8,'PIDMX','H','2026-12-01','issued',39840);" >/dev/null
chk "T13 混在は operator_review (対象側)" "$(val "select charge_hold_unit_disposition('da000000-0000-0000-0000-000000000001');")" "operator_review"
chk "T13 混在は operator_review (対象外側も=自動課金停止)" "$(val "select charge_hold_unit_disposition('da000000-0000-0000-0000-000000000002');")" "operator_review"
# 既に held の案件は混在でも自動解除しない
psql -c "update public.shipments set charge_hold_state='held' where id='da000000-0000-0000-0000-000000000002';
         select mark_charge_operator_review('da000000-0000-0000-0000-000000000002');" >/dev/null
chk "T13 既 held は混在でも自動解除しない" "$(val "select charge_hold_state from public.shipments where id='da000000-0000-0000-0000-000000000002';")" "held"
# 課金済みは mark で巻き戻さない (auto のみ held 化・charged はそのまま)
psql -c "insert into public.shipments(id,booking_id,agency,booking_type,suitcase_count,from_place_id,from_hotel,shipment_date,status,amount_yen,charged_at)
  values ('da000000-0000-0000-0000-000000000003','BDX-MZ','AgMX','fit',5,'PIDMX','H','2026-12-01','issued',24900,now());" >/dev/null
psql -c "select mark_charge_operator_review('da000000-0000-0000-0000-000000000003');" >/dev/null
chk "T13 課金済みは held 化しない (巻き戻さない)" "$(val "select coalesce(charge_hold_state,'?')||':'||case when charged_at is null then 'null' else 'charged' end from public.shipments where id='da000000-0000-0000-0000-000000000003';")" "auto:charged"

echo ""
echo "=== T14: v3.5 Track C 増額通知キューの冪等・再送 ==="
reset
psql -c "insert into public.agencies(id,name) values ('e1111111-1111-1111-1111-111111111111','AgN')
  on conflict (name) do nothing;" >/dev/null
psql -c "insert into public.shipments(id,booking_id,agency,booking_type,suitcase_count,from_place_id,from_hotel,shipment_date,status,amount_yen,charge_hold_state)
  values ('db000000-0000-0000-0000-000000000001','BDX-N1','AgN','group',26,'PIDN1','H','2026-12-01','issued',119121,'held');" >/dev/null
psql -c "select request_price_approval('db000000-0000-0000-0000-000000000001',119121,119520,24,1,null);
         select enqueue_price_notification('db000000-0000-0000-0000-000000000001',null,1,'ja');
         select enqueue_price_notification('db000000-0000-0000-0000-000000000001',null,1,'ja');" >/dev/null
chk "T14 同一(shipment,version)の通知は1件のみ (冪等)" "$(val "select count(*) from agency_price_notifications where shipment_id='db000000-0000-0000-0000-000000000001';")" "1"
NID=$(val "select id from agency_price_notifications where shipment_id='db000000-0000-0000-0000-000000000001';")
psql -c "select mark_price_notification_failed('$NID','smtp timeout');" >/dev/null
chk "T14 送信失敗は failed+attempts=1 (再送対象)" "$(val "select state||':'||attempts from agency_price_notifications where id='$NID';")" "failed:1"
chk "T14 failed は未処理(pending/failed)として再抽出される" "$(val "select count(*) from agency_price_notifications where state in ('pending','failed') and attempts<5;")" "1"
psql -c "select mark_price_notification_sent('$NID');" >/dev/null
chk "T14 送信成功で sent (以後は抽出されない)" "$(val "select state||':'||attempts from agency_price_notifications where id='$NID';")" "sent:2"
# 見積バージョンが変われば新しい通知を1件 (再承認の通知)
psql -c "select enqueue_price_notification('db000000-0000-0000-0000-000000000001',null,2,'ja');" >/dev/null
chk "T14 バージョン更新で新通知が1件追加" "$(val "select count(*) from agency_price_notifications where shipment_id='db000000-0000-0000-0000-000000000001';")" "2"

echo ""
echo "=== T15: v3.5 Track D Operator確認キュー read (operator_count_queue) ==="
reset
# held(確認待ち) と auto(対象外=キューに出ない) を1件ずつ
psql -c "insert into public.shipments(id,booking_id,agency,booking_type,suitcase_count,from_place_id,from_hotel,to_hotel,shipment_date,status,amount_yen,charge_hold_state)
  values ('ec000000-0000-0000-0000-000000000001','BDX-Q1','AgQ','fit',20,'PIDQ','H','K','2026-12-01','issued',99600,'held'),
         ('ec000000-0000-0000-0000-000000000002','BDX-Q2','AgQ','fit',5,'PIDQ2','H','K','2026-12-01','issued',24900,'auto');" >/dev/null
chk "T15 キューは確認待ち(held)のみ=1件" "$(val "select count(*) from operator_count_queue(200);")" "1"
chk "T15 キューの対象は held leg" "$(val "select booking_id from operator_count_queue(200);")" "BDX-Q1"
# requires_customer_approval もキューに出る
psql -c "update public.shipments set charge_hold_state='auto',price_status='requires_customer_approval' where id='ec000000-0000-0000-0000-000000000002';" >/dev/null
chk "T15 増額承認待ちもキューに出る=2件" "$(val "select count(*) from operator_count_queue(200);")" "2"

echo ""
echo "============================================================"
echo "  P1-B2 実PostgreSQL テスト: PASS=$PASS  FAIL=$FAIL"
echo "============================================================"
[ "$FAIL" = "0" ]
