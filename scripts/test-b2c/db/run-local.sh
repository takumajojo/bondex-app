#!/usr/bin/env bash
# sql/061_b2c_mvp.sql をローカルの Supabase（Docker の中の PostgreSQL 17）だけに適用して検証する。
# 本番には接続しない: 接続先はローカルのコンテナ（supabase_db_*）に固定し、psql もコンテナの中で動かす。
# 前提: colima start && (cd <ローカルの supabase プロジェクト> && supabase start)
# 使い方: scripts/test-b2c/db/run-local.sh [--reset]
set -euo pipefail
cd "$(dirname "$0")/../../.."
CONTAINER="${B2C_LOCAL_DB_CONTAINER:-supabase_db_supa-local}"
PSQL=(docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -t)

# 接続先の確認: ローカルのコンテナで、本番のホスト名を持たないこと
docker inspect "$CONTAINER" >/dev/null 2>&1 || { echo "local container $CONTAINER not found"; exit 1; }
HOST=$("${PSQL[@]}" -tAc "select coalesce(inet_server_addr()::text, 'local-socket')")
echo "target: container=$CONTAINER server_addr=$HOST"
case "$HOST" in 127.*|172.*|10.*|192.168.*|local-socket|::1) ;; *) echo "refusing: not a local address"; exit 1;; esac

if [[ "${1:-}" == "--reset" ]]; then
  "${PSQL[@]}" -c "drop schema if exists public cascade; create schema public; grant usage on schema public to anon, authenticated, service_role; grant all on schema public to postgres, service_role;"
  "${PSQL[@]}" -c "alter default privileges in schema public grant all on tables to anon, authenticated, service_role; alter default privileges in schema public grant all on functions to anon, authenticated, service_role; alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;"
fi

echo "== base (copy of production table definitions, no data)"
"${PSQL[@]}" < scripts/test-b2c/db/000_base_from_prod.sql
echo "== sql/061_b2c_mvp.sql"
"${PSQL[@]}" < sql/061_b2c_mvp.sql
echo "== sql/061 again (must be re-runnable)"
"${PSQL[@]}" < sql/061_b2c_mvp.sql
echo "== sql/062_b2c_stage4.sql (2回・再実行できること)"
"${PSQL[@]}" < sql/062_b2c_stage4.sql
"${PSQL[@]}" < sql/062_b2c_stage4.sql
echo "== sql/073_b2c_outbox_hardening.sql (2回・再実行できること)"
"${PSQL[@]}" < sql/073_b2c_outbox_hardening.sql
"${PSQL[@]}" < sql/073_b2c_outbox_hardening.sql
echo "== 062 → 073 をもう一度（073 の状態 expired / unknown の行があっても 062 を再実行できること）"
"${PSQL[@]}" < sql/062_b2c_stage4.sql
"${PSQL[@]}" < sql/073_b2c_outbox_hardening.sql
echo "== verify"
"${PSQL[@]}" < scripts/test-b2c/db/verify_061.sql
