#!/usr/bin/env bash
# staging の E2E 試験で作ったデータの削除（P0-3・2026-11-07）。中身は scripts/staging/cleanup-e2e.sql。
# **既定は dry-run（何も消さない）**。消すのは、dry-run の結果を谷口さんが確かめて承認した後に、dry-run が出した指紋を付けた時だけ。
#   bash scripts/staging/cleanup-e2e.sh --run E2E1107A --since 2026-11-07T09:00:00+09:00              # dry-run
#   bash scripts/staging/cleanup-e2e.sh --run E2E1107A --since 2026-11-07T09:00:00+09:00 --execute --confirm <指紋>   # 承認の後だけ
# **本番では動かない**（scripts/staging/apply.sh と同じ 4重の確認・どれか 1つでも違えば止める）:
#   1. 接続文字列に試験環境の ID があり、本番の ID が無い（DB に接続する前）
#   2. DB の固有の番号（pg_control_system の system_identifier）が本番と違い、試験環境と一致する
#   3. DB に試験環境の印（staging_guard.marker の ref）がある
#   4. 削除の SQL と同じトランザクションの先頭で 2・3 をもう一度確かめる（間に接続先が変わっても消さない）
# 接続文字列は .env.staging.local の STAGING_DB_URL（画面にも記録にも出さない）。psql はローカルの Supabase の DB のコンテナの中のもの。
# 予行演習: REHEARSAL_LOCAL_DB=bondex_stg_* を付けると、ローカルのコンテナの中のそのデータベースだけに流す（外には接続しない）。
set -euo pipefail
cd "$(dirname "$0")/../.."
STAGING_REF=oeucjrmuigtfnwowvzwr
PROD_REF=dscxftwfspgihkszfakk
STAGING_SYSID=7702071863184491885
PROD_SYSID=7642734024280108049
C=${PSQL_CONTAINER:-supabase_db_supa-local}
ENV_FILE=${CLEANUP_ENV_FILE:-.env.staging.local}

RUN=""; SINCE=""; MODE=dry-run; CONFIRM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --run) RUN=${2:-}; shift 2;;
    --since) SINCE=${2:-}; shift 2;;
    --execute) MODE=execute; shift;;
    --confirm) CONFIRM=${2:-}; shift 2;;
    *) echo "STOP: 知らない引数 $1"; exit 2;;
  esac
done
[[ "$RUN" =~ ^E2E[A-Z0-9]{1,13}$ ]] || { echo "STOP: --run は E2E で始まる紹介元のコード（例: E2E1107A）"; exit 2; }
[[ "$SINCE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?(\+09:00|Z)$ ]] || { echo "STOP: --since は E2E を始めた時刻（例: 2026-11-07T09:00:00+09:00）"; exit 2; }
if [ "$MODE" = execute ] && ! [[ "$CONFIRM" =~ ^[0-9a-f]{32}$ ]]; then echo "STOP: --execute には dry-run の指紋（--confirm）が要ります"; exit 2; fi

if [ -n "${REHEARSAL_LOCAL_DB:-}" ]; then
  case "$REHEARSAL_LOCAL_DB" in bondex_stg_*) ;; *) echo "STOP: 予行演習のデータベース名は bondex_stg_*"; exit 2;; esac
  DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/$REHEARSAL_LOCAL_DB"
  STAGING_SYSID=$(docker exec -i "$C" psql -U postgres -d postgres -tAc "select system_identifier from pg_control_system()")
  # 試験のためだけの差し替え（予行演習の時だけ効く）: 期待する番号・本番の番号
  [ -n "${CLEANUP_TEST_STAGING_SYSID:-}" ] && STAGING_SYSID=$CLEANUP_TEST_STAGING_SYSID
  [ -n "${CLEANUP_TEST_PROD_SYSID:-}" ] && PROD_SYSID=$CLEANUP_TEST_PROD_SYSID
else
  [ -f "$ENV_FILE" ] || { echo "STOP: $ENV_FILE がありません"; exit 1; }
  DB_URL=$(grep -E '^STAGING_DB_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  [ -n "$DB_URL" ] || { echo "STOP: STAGING_DB_URL が空です"; exit 1; }
  case "$DB_URL" in *"$PROD_REF"*) echo "STOP: 接続文字列に本番の ID があります（接続しません）"; exit 1;; esac
  case "$DB_URL" in *"$STAGING_REF"*) ;; *) echo "STOP: 接続文字列に試験環境の ID がありません（接続しません）"; exit 1;; esac
fi

q() { docker exec -i -e PGURL="$DB_URL" "$C" sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -qtA "$@"' psql "$@"; }
sysid=$(q -c "select system_identifier from pg_control_system()")
[ "$sysid" != "$PROD_SYSID" ] || { echo "STOP: 本番の DB につながっています（何もしません）"; exit 1; }
[ "$sysid" = "$STAGING_SYSID" ] || { echo "STOP: 試験環境の DB の番号と一致しません（何もしません）"; exit 1; }
[ "$(q -c "select count(*) from information_schema.tables where table_schema='staging_guard' and table_name='marker'")" = "1" ] || { echo "STOP: 試験環境の印がありません（本番かもしれない・何もしません）"; exit 1; }
[ "$(q -c "select ref from staging_guard.marker")" = "$STAGING_REF" ] || { echo "STOP: 試験環境の印が一致しません（何もしません）"; exit 1; }
echo "== 接続先: 試験環境（DB の番号と印を確認）・モード: $MODE・紹介元: $RUN・開始: $SINCE"

GUARD="do \$g\$ begin if (select system_identifier from pg_control_system())::text <> '$STAGING_SYSID' or (select system_identifier from pg_control_system())::text = '$PROD_SYSID' then raise exception 'STOP: 試験環境の DB ではありません'; end if; if not exists (select 1 from staging_guard.marker where ref = '$STAGING_REF') then raise exception 'STOP: 試験環境の印がありません'; end if; end \$g\$;"
END=rollback
[ "$MODE" = execute ] && END=commit
# 1つのトランザクション: 確認 → 対象の計算と安全の確認 → 件数・指紋 → (execute の時だけ) 削除。dry-run は最後に rollback
set +e  # 失敗の時も、下の「止まりました」を必ず出す（set -e だとここで黙って終わる）
{ echo "begin;"; echo "$GUARD"; cat scripts/staging/cleanup-e2e.sql; echo "$END;"; } |
  docker exec -i -e PGURL="$DB_URL" "$C" sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -q -P pager=off -v run="$1" -v since="$2" -v mode="$3" -v confirm="$4" 2>&1' psql "$RUN" "$SINCE" "$MODE" "${CONFIRM:-none}" |
  sed -E 's#postgres(ql)?://[^ ]*#<接続文字列>#g'
rc=${PIPESTATUS[1]}
set -e
[ "$rc" = 0 ] || { echo "== 止まりました（何も消していません）"; exit 1; }
if [ "$MODE" = execute ]; then echo "== 削除を確定しました"; else echo "== dry-run: 何も消していません（承認の後、同じ引数に --execute --confirm <指紋> を付ける）"; fi
