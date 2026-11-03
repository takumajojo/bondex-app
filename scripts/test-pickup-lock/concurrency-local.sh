#!/usr/bin/env bash
# 段階A の同時実行試験 (本物の PostgreSQL・別々の接続で同時に書く)。本番には接続しない。
# ローカルの Supabase のコンテナ (Docker) の中に、試験専用のデータベース bondex_lock_test を作って使う
# (B2C の試験が使う postgres データベースには触れない)。終わったら消す。
# 使い方: scripts/test-pickup-lock/concurrency-local.sh [回数=100]
set -euo pipefail
cd "$(dirname "$0")/../.."
N="${1:-100}"
CONTAINER="${LOCK_TEST_DB_CONTAINER:-supabase_db_supa-local}"
DB=bondex_lock_test
docker inspect "$CONTAINER" >/dev/null 2>&1 || { echo "local container $CONTAINER not found"; exit 1; }
ADDR=$(docker exec -i "$CONTAINER" psql -U postgres -d postgres -tAc "select coalesce(inet_server_addr()::text, 'local-socket')")
case "$ADDR" in 127.*|172.*|10.*|192.168.*|local-socket|::1) ;; *) echo "refusing: not a local address ($ADDR)"; exit 1;; esac

q()  { docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -qtA "$@"; }
docker exec -i "$CONTAINER" psql -U postgres -d postgres -qc "drop database if exists $DB" -c "create database $DB" >/dev/null
trap 'docker exec -i "$CONTAINER" psql -U postgres -d postgres -qc "drop database if exists '"$DB"'" >/dev/null 2>&1 || true' EXIT

for f in scripts/test-pickup-e2e/schema-base.sql sql/043_shipment_change_requests.sql sql/062_pickup_requests.sql \
         sql/063_fix_hotel_change_tracking_column.sql sql/064_change_requests_pickup_lock.sql sql/065_facilities.sql; do
  q < "$f" >/dev/null
done
echo "schema loaded on $CONTAINER/$DB (server_addr=$ADDR)"

# 2つの接続を同時に走らせる (コンテナの中で psql を2つ並べて起動)。少しずらすため各接続の先頭で乱数の sleep を入れる。
pair() {
  docker exec -i "$CONTAINER" sh -c "
    psql -U postgres -d $DB -qtA -c \"select pg_sleep(random()*0.01); $1\" >/dev/null 2>&1 &
    psql -U postgres -d $DB -qtA -c \"select pg_sleep(random()*0.01); $2\" >/dev/null 2>&1 &
    wait"
}
newleg() { q -c "insert into shipments (booking_id, leg_index, shipment_date, expected_arrival, from_hotel, from_place_id, to_hotel, to_place_id, suitcase_count)
  values ('$1', 0, current_date + 3, current_date + 4, 'A', 'p-from', 'B', 'p-to', 2) returning id"; }

echo "1. 確保 (Biz-Logi) と代理店の日程・個数の変更を同時に ×$N"
for i in $(seq 1 "$N"); do
  id=$(newleg "C1-$i")
  pair "select claim_pickup_request('$id','bizlogi','test','X',2,current_date+3,'a','o',null)" \
       "update shipments set shipment_date = shipment_date + 1, suitcase_count = suitcase_count + 1 where id='$id'"
done
echo "2. 確保 (手動 Excel の記録) と運営のホテル変更 (本番の apply_hotel_change) を同時に ×$N"
for i in $(seq 1 "$N"); do
  id=$(newleg "C2-$i")
  pair "select claim_pickup_request('$id','manual',null,null,2,current_date+3,'a','o',null)" \
       "select apply_hotel_change('$id','guest','New','新','p-new',null,'大阪府',false,null,false,'operator:t','T',false)"
done
echo "3. 確保と取消を同時に ×$N"
for i in $(seq 1 "$N"); do
  id=$(newleg "C3-$i")
  pair "select claim_pickup_request('$id','bizlogi','test','X',2,current_date+3,'a','own',null)" \
       "update shipments set status='cancelled' where id='$id'"
done
echo "4. 受付の記録 (番号の保存) と取消を同時に ×$N (送信中の依頼がある区間)"
for i in $(seq 1 "$N"); do
  id=$(newleg "C4-$i")
  q -c "select claim_pickup_request('$id','bizlogi','test','X',2,current_date+3,'a','own4',null)" >/dev/null
  rid=$(q -c "select id from pickup_requests where shipment_id='$id'")
  num=$(printf '5%011d' "$i")
  pair "select transition_pickup_request('$rid', array['sending'], 'accepted', 'own4', 'a', '$num', 'P', null, null, null, null)" \
       "update shipments set status='cancelled' where id='$id'"
done
echo "5. 同じ区間への変更申請を2つ同時に ×$N (受付済みの区間)"
for i in $(seq 1 "$N"); do
  id=$(newleg "C5-$i")
  q -c "select claim_pickup_request('$id','manual',null,null,2,current_date+3,'a','o',null)" >/dev/null
  pair "select create_shipment_change('$id','count',jsonb_build_object('suitcase_count',3),'r','operator','operator','a')" \
       "select create_shipment_change('$id','dates',jsonb_build_object('expected_arrival','2030-01-01'),'r','agency','T','b')"
done

echo "== 検証"
q <<'SQL'
select '1. 依頼内容と区間が食い違う (0であること)', count(*) from shipments s join pickup_requests r on r.shipment_id = s.id
 where s.booking_id like 'C1-%' and r.state in ('sending','accepted')
   and (r.request_snapshot->>'shipment_date' <> s.shipment_date::text or (r.request_snapshot->>'suitcase_count')::int <> s.suitcase_count);
select '1. 内訳: 変更が先 / 確保が先で変更は拒否', count(*) filter (where s.suitcase_count = 3), count(*) filter (where s.suitcase_count = 2)
  from shipments s where s.booking_id like 'C1-%';
select '2. 依頼内容と到着ホテルが食い違う (0であること)', count(*) from shipments s join pickup_requests r on r.shipment_id = s.id
 where s.booking_id like 'C2-%' and r.state = 'accepted' and r.request_snapshot->>'to_place_id' is distinct from s.to_place_id;
select '2. 内訳: ホテル変更が先 / 記録が先で変更は拒否', count(*) filter (where s.to_place_id = 'p-new'), count(*) filter (where s.to_place_id = 'p-to')
  from shipments s where s.booking_id like 'C2-%';
select '3. 取消済みなのに有効な依頼がある (0であること)', count(*) from shipments s join pickup_requests r on r.shipment_id = s.id
 where s.booking_id like 'C3-%' and s.status = 'cancelled' and r.state in ('sending','accepted','unknown','needs_review','change_pending');
select '3. 内訳: 取消が先 / 確保が先で取消は拒否', count(*) filter (where s.status = 'cancelled'), count(*) filter (where s.status <> 'cancelled')
  from shipments s where s.booking_id like 'C3-%';
select '4. 取消済みの区間に番号がある (0であること)', count(*) from shipments s
 where s.booking_id like 'C4-%' and s.status = 'cancelled' and jsonb_typeof(s.tracking_numbers) = 'array' and jsonb_array_length(s.tracking_numbers) > 0;
select '4. 取消できた区間 (送信中は止まるので0であること)', count(*) from shipments s where s.booking_id like 'C4-%' and s.status = 'cancelled';
select '5. 進行中の申請が2件以上の区間 (0であること)', count(*) from (
  select c.shipment_id from shipment_change_requests c join shipments s on s.id = c.shipment_id
   where s.booking_id like 'C5-%' and c.stage in ('requested','contacted','approved') group by 1 having count(*) > 1) x;
select '5. 申請が1件の区間', count(distinct c.shipment_id) from shipment_change_requests c join shipments s on s.id = c.shipment_id where s.booking_id like 'C5-%';
SQL
