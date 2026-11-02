#!/usr/bin/env bash
# 受付の上限の同時実行の試験（ローカルの Supabase だけ）。2つの接続が同じ集荷日の最後の 1枠を同時に取りに行き、片方だけが成功することを確かめる。
# 前提: run-local.sh を先に実行（表とダミーの入口・ホテルがある状態）。
set -euo pipefail
CONTAINER="${B2C_LOCAL_DB_CONTAINER:-supabase_db_supa-local}"
PSQL=(docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -t -v ON_ERROR_STOP=1)
"${PSQL[@]}" -c "delete from b2c_orders where pickup_date = '2027-02-01'; insert into b2c_ops_days(date, max_new_bookings, max_pieces) values ('2027-02-01', 1, 19) on conflict (date) do update set max_new_bookings = 1, closed = false;"
order_sql() {
  cat <<SQL
begin;
insert into b2c_orders(id, entry_link_id, referrer_code, guest_name, guest_email, guest_whatsapp, origin_place_id, dest_place_id,
  origin_snapshot, dest_snapshot, pickup_date, delivery_date, pieces, route_class, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen,
  price_rule_version, status, confirmation_mode, card_status, consent_version, consented_at, access_token_hash)
values ('$1', '00000000-0000-0000-0000-0000000000e1', 'HNK001', 'Dummy', 'd@example.invalid', '+31612345678', 'place_A', 'place_B',
  '{}', '{}', '2027-02-01', '2027-02-02', 1, 'standard', 4980, 4980, 498, 5478, 'v1', 'card_pending', 'instant', 'registered', 'v1', now(), 'tok_$1');
select pg_sleep($2);
commit;
SQL
}
( order_sql 00000000-0000-0000-0000-0000000000a1 3 | "${PSQL[@]}" >/dev/null 2>&1 && echo "A: committed" || echo "A: rejected" ) &
sleep 1
( order_sql 00000000-0000-0000-0000-0000000000a2 0 | "${PSQL[@]}" >/dev/null 2>&1 && echo "B: committed" || echo "B: rejected" ) &
wait
N=$("${PSQL[@]}" -c "select count(*) from b2c_orders where pickup_date = '2027-02-01' and status = 'card_pending'" | tr -d ' ')
echo "orders on 2027-02-01: $N"
[[ "$N" == "1" ]] && echo "CONCURRENCY CHECK PASSED" || { echo "CONCURRENCY CHECK FAILED"; exit 1; }
