#!/usr/bin/env bash
# 試験環境（Supabase の bondex-staging = oeucjrmuigtfnwowvzwr）に、本番と同じ表の定義と、本番移行チェックリストの順番の SQL を流す。
# **本番（dscxftwfspgihkszfakk）には絶対に流さない**: 次の 3重の確認で止める。
#   1. 接続文字列に試験環境の ID（oeucjrmuigtfnwowvzwr）があり、本番の ID が無いこと
#   2. 接続した DB に試験環境の印（staging_guard.marker の ref）があること（初回だけ、空の DB に印を作る）
#   3. 流す SQL の 1つ 1つの先頭で、同じ印を DB の中で確かめる（印が無ければそのトランザクションごと失敗）
# 接続文字列は .env.staging.local の STAGING_DB_URL（Git に入らない）。画面にも記録にも出さない。
# psql はローカルの Supabase の DB のコンテナの中のもの（PostgreSQL 17）を使う。
# 使い方: bash scripts/staging/apply.sh [base|migrate|seed|verify|all]
set -euo pipefail
cd "$(dirname "$0")/../.."
STAGING_REF=oeucjrmuigtfnwowvzwr
PROD_REF=dscxftwfspgihkszfakk
C=${PSQL_CONTAINER:-supabase_db_supa-local}
if [ -n "${REHEARSAL_LOCAL_DB:-}" ]; then
  # 予行演習: ローカルの DB のコンテナの中の別のデータベースだけ（外には接続しない）
  case "$REHEARSAL_LOCAL_DB" in bondex_stg_*) ;; *) echo "STOP: 予行演習のデータベース名は bondex_stg_*"; exit 1;; esac
  STAGING_DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/$REHEARSAL_LOCAL_DB"
else
  [ -f .env.staging.local ] || { echo "STOP: .env.staging.local がありません"; exit 1; }
  STAGING_DB_URL=$(grep -E '^STAGING_DB_URL=' .env.staging.local | head -1 | cut -d= -f2-)
  [ -n "$STAGING_DB_URL" ] || { echo "STOP: STAGING_DB_URL が空です"; exit 1; }
  case "$STAGING_DB_URL" in *"$PROD_REF"*) echo "STOP: 接続文字列に本番の ID があります"; exit 1;; esac
  case "$STAGING_DB_URL" in *"$STAGING_REF"*) ;; *) echo "STOP: 接続文字列に試験環境の ID がありません"; exit 1;; esac
fi

q()  { docker exec -i -e PGURL="$STAGING_DB_URL" "$C" sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -qtA "$@"' psql "$@"; }
GUARD="do \$g\$ begin if not exists (select 1 from staging_guard.marker where ref = '$STAGING_REF') then raise exception 'STOP: 試験環境の印がありません（本番かもしれない）'; end if; end \$g\$;"
# 印を確かめてから、ファイルを 1つのトランザクションで流す（印の確認も同じトランザクションの中）
run() { local label=$1; shift; echo "== $label"; { echo "$GUARD"; for f in "$@"; do cat "$f"; echo; done; } | q -1 >/dev/null; }

marker() {
  local has
  has=$(q -c "select count(*) from information_schema.tables where table_schema='staging_guard' and table_name='marker'")
  if [ "$has" = "0" ]; then
    local n; n=$(q -c "select count(*) from information_schema.tables where table_schema='public'")
    [ "$n" = "0" ] || { echo "STOP: 印が無いのに public に表が $n あります（想定外。止めます）"; exit 1; }
    q -c "create schema staging_guard; create table staging_guard.marker (ref text primary key, created_at timestamptz default now()); insert into staging_guard.marker(ref) values ('$STAGING_REF'); revoke all on schema staging_guard from public, anon, authenticated;" >/dev/null
    echo "== 試験環境の印を作成"
  fi
  [ "$(q -c "select ref from staging_guard.marker")" = "$STAGING_REF" ] || { echo "STOP: 印が一致しません"; exit 1; }
  echo "== 接続先: 試験環境（印 $STAGING_REF を確認）"
}

base() {
  if [ "$(q -c "select count(*) from information_schema.tables where table_schema='public' and table_name='shipments'")" != "0" ]; then echo "== 土台は作成済み（飛ばす）"; return; fi
  run "土台: 本番の表の定義（データなし）" scripts/staging/000_prod_schema_20261105.sql
}

PREFIX=sql/ops/migration_lock_prefix.sql
migrate() {
  echo "== 手順1 事前確認（読み取りだけ）"; { echo "$GUARD"; cat sql/067_precheck.sql; } | q > /dev/null
  run "2-1 067" sql/067_pickup_requests.sql
  run "2-2 069" sql/069_facilities.sql
  run "2-3 068" sql/068_change_requests_pickup_lock.sql
  run "2-4 061（前置き）" "$PREFIX" sql/061_b2c_mvp.sql
  run "2-4 062（前置き）" "$PREFIX" sql/062_b2c_stage4.sql
  run "2-4 073（前置き）" "$PREFIX" sql/073_b2c_outbox_hardening.sql
  run "2-5 071" sql/071_b2c_cutoff_1830.sql
  run "2-5b 074（前置き）" "$PREFIX" sql/074_b2c_stage5_payments.sql
  run "2-6 075" sql/075_pickup_watch_alerts.sql
  run "2-6 076" sql/076_agency_change_atomic.sql
  run "2-6b 077" sql/077_operator_email_code_attempts.sql
  run "2-6c 078" sql/078_pickup_customer_numbering.sql
  run "2-6d 079" sql/079_b2c_legal_versions.sql
  echo "== （本番ではここでアプリを入れ替える）"
  run "4-1 072" sql/072_enable_pickup_lock.sql
  run "手順5 070" sql/070_change_deadline_1830.sql
}

seed() {
  run "佐川の配達日数（公開の情報・059）" sql/059_sagawa_lead_times_seed.sql
  # 試験用のダミーのデータだけ（実在の顧客・予約・決済の情報は入れない）
  local tmp; tmp=$(mktemp)
  cat > "$tmp" <<'SQL'
insert into public.b2c_entry_links(referrer_code, referrer_name, referrer_name_en, token_hash)
  values ('HNK001', '阪急交通社（試験）', 'Hankyu Travel (staging)', encode(extensions.digest('dev-hnk-staging-token-0001', 'sha256'), 'hex'))
  on conflict do nothing;
insert into public.b2c_ops_days(date, max_new_bookings, max_pieces)
  select d::date, 20, 60 from generate_series(current_date, current_date + 60, '1 day') d
  on conflict (date) do nothing;
SQL
  run "試験用の入口・受付の上限（ダミー）" "$tmp"; rm -f "$tmp"
  npx tsx scripts/b2c-legal/register-docs.ts > /tmp/staging_register.sql 2>/dev/null
  run "規約の本文（今の版）" /tmp/staging_register.sql
}

verify() {
  echo "== 照合 SQL-D（079）"
  sed -n '/-- SQL-D/,/anon_can_read;/p' ../docs/bizlogi-prod-migration-checklist-20261104.md 2>/dev/null | q -F ' | ' || true
  bash scripts/staging/verify.sh
}

marker
case "${1:-all}" in
  base) base ;;
  migrate) migrate ;;
  seed) seed ;;
  verify) verify ;;
  all) base; migrate; seed; verify ;;
  *) echo "usage: $0 [base|migrate|seed|verify|all]"; exit 1 ;;
esac
echo "== 完了"
