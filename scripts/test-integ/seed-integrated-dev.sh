#!/usr/bin/env bash
# 統合版（B2C ＋ Biz-Logi）の開発用の DB を、ローカルの Supabase の public に作り直す（ダミーのデータだけ）。本番には接続しない。
# 順番は本番の移行の手順（docs/bizlogi-b2c-integration-report の 6章）に合わせる:
#   土台 → B2C（061・062・073・074。scripts/test-b2c/db/seed-dev.sh）→ 043・033・063・065（本番に適用済み・P1-B）→ 067 → 069 → 068 → 071 → 072 → 070 → 075 → 076 → 077 → 078
# 071 は 062 の締切（17:00）の関数を 18:30 の版に置き換えるので、062 より後に流す（062 だけを後から流し直さない）。
set -euo pipefail
cd "$(dirname "$0")/../.."
CONTAINER="${B2C_LOCAL_DB_CONTAINER:-supabase_db_supa-local}"
PSQL=(docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
bash scripts/test-b2c/db/seed-dev.sh
# 本番にある関数（本番の定義の写し: scripts/staging/000_prod_schema_20261105.sql）。sql/065 のトリガーが使う
"${PSQL[@]}" -c "create or replace function public.set_updated_at() returns trigger language plpgsql set search_path to 'public' as \$f\$ begin new.updated_at = now(); return new; end; \$f\$;"
for f in sql/043_shipment_change_requests.sql sql/033_hotel_change_schema.sql sql/063_fix_hotel_change_tracking_column.sql sql/065_sagawa_bulk_pickups.sql \
         sql/067_pickup_requests.sql sql/069_facilities.sql sql/068_change_requests_pickup_lock.sql sql/071_b2c_cutoff_1830.sql \
         sql/072_enable_pickup_lock.sql sql/070_change_deadline_1830.sql sql/075_pickup_watch_alerts.sql sql/076_agency_change_atomic.sql sql/077_operator_email_code_attempts.sql sql/078_pickup_customer_numbering.sql sql/079_b2c_legal_versions.sql; do
  [[ -f "$f" ]] || { echo "missing $f"; exit 1; }
  "${PSQL[@]}" < "$f" > /dev/null
done
"${PSQL[@]}" -c "grant select, insert, update, delete on all tables in schema public to service_role; grant usage, select on all sequences in schema public to service_role; grant execute on all functions in schema public to service_role; notify pgrst, 'reload schema';"
# B2C の関数が 071 の版（18:30）であること
"${PSQL[@]}" -tAc "select case when pg_get_functiondef('public.b2c_confirm_order(uuid)'::regprocedure) like '%pickup_cutoff_at%' then 'b2c_confirm_order: 071 (18:30)' else 'NG: b2c_confirm_order is not 071' end"
echo "integrated seed done"
