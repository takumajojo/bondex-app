#!/usr/bin/env bash
# ローカルの Supabase に、B2C の画面の開発用の DB を作り直す（ダミーのデータだけ）。本番には接続しない。
#   表: 本番の土台の写し + sql/061・062 + 佐川の日数の表（sql/058・059。公開の配達日数のデータ）
#   入口: 開発用の token "dev-hnk-local-token-0001"（URL /book/dev-hnk-local-token-0001）
set -euo pipefail
cd "$(dirname "$0")/../../.."
CONTAINER="${B2C_LOCAL_DB_CONTAINER:-supabase_db_supa-local}"
PSQL=(docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -c "drop schema if exists public cascade; create schema public; grant usage on schema public to anon, authenticated, service_role; grant all on schema public to postgres, service_role;"
"${PSQL[@]}" -c "alter default privileges in schema public grant all on tables to anon, authenticated, service_role; alter default privileges in schema public grant all on functions to anon, authenticated, service_role; alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;"
"${PSQL[@]}" < scripts/test-b2c/db/000_base_from_prod.sql
"${PSQL[@]}" -c "create table if not exists public.cron_locks (name text primary key, locked_at timestamptz not null default now());"  # sql/029 と同じ（定期の処理の二重起動の防止）
"${PSQL[@]}" < sql/061_b2c_mvp.sql
"${PSQL[@]}" < sql/062_b2c_stage4.sql
"${PSQL[@]}" < sql/058_sagawa_lead_times.sql
"${PSQL[@]}" < sql/059_sagawa_lead_times_seed.sql
"${PSQL[@]}" -c "insert into b2c_entry_links(referrer_code, referrer_name, referrer_name_en, token_hash) values ('HNK001', '阪急交通社', 'Hankyu Travel', encode(digest('dev-hnk-local-token-0001', 'sha256'), 'hex'));"
"${PSQL[@]}" -c "grant select, insert, update, delete on all tables in schema public to service_role; grant usage, select on all sequences in schema public to service_role; grant execute on function b2c_confirm_order(uuid) to service_role; grant execute on function b2c_cancel_order(uuid, text, text, text, text, text, text) to service_role; notify pgrst, 'reload schema';"
echo "seeded. lead time rows: $("${PSQL[@]}" -tAc 'select count(*) from sagawa_lead_times')"
