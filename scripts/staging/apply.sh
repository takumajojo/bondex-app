#!/usr/bin/env bash
# 試験環境（Supabase の bondex-staging = oeucjrmuigtfnwowvzwr）に、本番と同じ表の定義と、本番移行チェックリストの順番の SQL を流す。
# **本番（dscxftwfspgihkszfakk）には絶対に流さない**: 次の 3重の確認で止める。
#   1. 接続文字列に試験環境の ID（oeucjrmuigtfnwowvzwr）があり、本番の ID が無いこと
#   2. 接続した DB に試験環境の印（staging_guard.marker の ref）があること（初回だけ、空の DB に印を作る）
#   3. 流す SQL の 1つ 1つの先頭で、同じ印を DB の中で確かめる（印が無ければそのトランザクションごと失敗）
# 接続文字列は .env.staging.local の STAGING_DB_URL（Git に入らない）。画面にも記録にも出さない。
# psql はローカルの Supabase の DB のコンテナの中のもの（PostgreSQL 17）を使う。
# 使い方: bash scripts/staging/apply.sh [base|migrate|080|081-083|check081-083|rollback083-081|seed|verify|all]
#   080 = 2026-11-05 の追加分だけ・081-083 = 2026-11-06 の追加分だけ（staging には 2026-11-06 18:27 に適用済み）・check081-083 = 読むだけの確認
# 注意: staging には統合に無い agency_first_offer（agencies の first_offer_* 3列・2026-11-05 に連携から適用）がある。初回オファーを統合する時は
#   SQL の番号を 084 以降に振り直す（統合の 081 と重なるため）。sql/052・sql/ops/*_cron.sql は本番の URL が入っているので staging に流さない
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
# DB の固有の番号（pg_control_system の system_identifier）。2026-11-05 に Supabase の連携で読み取って確認:
#   試験環境 = 7702071863184491885 / 本番 = 7642734024280108049
STAGING_SYSID=7702071863184491885
PROD_SYSID=7642734024280108049
[ -n "${REHEARSAL_LOCAL_DB:-}" ] && STAGING_SYSID=$(docker exec -i "$C" psql -U postgres -d postgres -tAc "select system_identifier from pg_control_system()")
GUARD="do \$g\$ begin if (select system_identifier from pg_control_system())::text <> '$STAGING_SYSID' then raise exception 'STOP: 試験環境の DB ではありません（DB の番号が違う）'; end if; if not exists (select 1 from staging_guard.marker where ref = '$STAGING_REF') then raise exception 'STOP: 試験環境の印がありません（本番かもしれない）'; end if; end \$g\$;"
# 印を確かめてから、ファイルを 1つのトランザクションで流す（印の確認も同じトランザクションの中）
run() { local label=$1; shift; echo "== $label"; { echo "$GUARD"; for f in "$@"; do cat "$f"; echo; done; } | q -1 >/dev/null; }

marker() {
  local sysid has
  sysid=$(q -c "select system_identifier from pg_control_system()")
  [ "$sysid" != "$PROD_SYSID" ] || { echo "STOP: 本番の DB につながっています"; exit 1; }
  [ "$sysid" = "$STAGING_SYSID" ] || { echo "STOP: 試験環境の DB の番号と一致しません"; exit 1; }
  echo "== DB の番号を確認（試験環境と一致・本番と不一致）"
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
  run "2-6e 080" sql/080_cron_heartbeats.sql
  # 081・082 は自分で表の確保（migration_lock）をするので前置きは付けない。083 は関数の置き換えだけ
  run "2-6f 081" sql/081_b2c_leg_prefecture.sql
  run "2-6g 082" sql/082_b2c_charge_safety.sql
  run "2-6h 083" sql/083_claim_pickup_guards.sql
  check0813
  echo "== （本番ではここでアプリを入れ替える。081〜083 が無ければ入れ替えない: チェックリスト 3-00）"
  run "4-1 072" sql/072_enable_pickup_lock.sql
  run "手順5 070" sql/070_change_deadline_1830.sql
}

# 2026-11-05 の追加分だけ（067〜079 を流し済みの staging に、定期の処理の記録の表を足す。追加だけ・何度流しても同じ）
m080() {
  run "2-6e 080" sql/080_cron_heartbeats.sql
  echo "== 確認: 表と関数・匿名に権限が無いこと"
  q -F ' | ' -c "select to_regclass('public.cron_heartbeats') is not null as table_ok,
    has_function_privilege('anon', 'public.cron_heartbeat_record(text, boolean, text, timestamptz)', 'execute') as anon_can_exec,
    has_table_privilege('anon', 'public.cron_heartbeats', 'select') as anon_can_read"
}

# 081〜083 の適用の確認（読むだけ）。どれか 1つでも違えば止める
check0813() {
  local got want="1|t|t|t|t|f|f|t"
  got=$(q -c "select concat_ws('|',
    (select count(*) from information_schema.columns where table_schema='public' and table_name='shipments' and column_name='origin_check_out'),
    (select prosrc like '%from_prefecture%' from pg_proc where proname='b2c_confirm_order'),
    (select prosrc like '%cancel_pending%' and prosrc like '%no_card_consent%' from pg_proc where proname='b2c_charge_check'),
    (select prosrc like '%open_change_exists%' from pg_proc where proname='claim_pickup_request'),
    (select prosrc like '%pickup_marked%' from pg_proc where proname='claim_pickup_request'),
    has_function_privilege('anon', 'public.claim_pickup_request(uuid,text,text,text,int,date,text,text,text)', 'execute'),
    has_function_privilege('authenticated', 'public.claim_pickup_request(uuid,text,text,text,int,date,text,text,text)', 'execute'),
    has_function_privilege('service_role', 'public.claim_pickup_request(uuid,text,text,text,int,date,text,text,text)', 'execute'))")
  echo "== 確認 081〜083: $got（期待 $want = 列・確定・請求の確認・確保の 2条件・匿名/ログイン利用者は不可・service_role は可）"
  [ "$got" = "$want" ] || { echo "STOP: 081〜083 の状態が想定と違います"; exit 1; }
}

# 2026-11-06 の追加分だけ（080 まで流し済みの staging に。1本ずつ・番号の順。何度流しても同じ）
m0813() {
  run "2-6f 081" sql/081_b2c_leg_prefecture.sql
  run "2-6g 082" sql/082_b2c_charge_safety.sql
  run "2-6h 083" sql/083_claim_pickup_guards.sql
  check0813
}
# 081〜083 を逆の順で戻す（関数を前の版に戻す。081 の列と埋めた値は残す）。谷口さんの承認の後だけ
rb0813() {
  run "083 を戻す" sql/rollback/rollback_083.sql
  run "082 を戻す" sql/rollback/rollback_082.sql
  run "081 を戻す" sql/rollback/rollback_081.sql
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
  080) m080 ;;
  081-083) m0813 ;;
  check081-083) check0813 ;;
  rollback083-081) rb0813 ;;
  seed) seed ;;
  verify) verify ;;
  all) base; migrate; seed; verify ;;
  *) echo "usage: $0 [base|migrate|080|081-083|check081-083|rollback083-081|seed|verify|all]"; exit 1 ;;
esac
echo "== 完了"
