#!/usr/bin/env bash
# 試験環境（bondex-staging）への接続の確認。**読み取りだけ**（接続の設定で書き込みを禁止して接続する）。何も作らない・変えない。
# 接続情報は .env.staging.local から読み、画面には出さない（接続先の ID・ホストの種類・件数だけを出す）。
#   bash scripts/staging/check-connection.sh
set -uo pipefail
set +x
cd "$(dirname "$0")/../.."
STAGING_REF=oeucjrmuigtfnwowvzwr
PROD_REF=dscxftwfspgihkszfakk
C=${PSQL_CONTAINER:-supabase_db_supa-local}
[ -f .env.staging.local ] || { echo "STOP: .env.staging.local がありません（bash scripts/staging/setup-env.sh で作る）"; exit 1; }
get() { grep -E "^$1=" .env.staging.local | head -1 | cut -d= -f2-; }
DB=$(get STAGING_DB_URL); URL=$(get NEXT_PUBLIC_SUPABASE_URL); ANON=$(get NEXT_PUBLIC_SUPABASE_ANON_KEY); SRV=$(get SUPABASE_SERVICE_ROLE_KEY)
PASS=0; FAIL=0
eq() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 (期待: $2 / 実際: $3)"; fi; }

echo "1. ファイル（値は出さない）"
eq "権限は本人だけ（600）" "600" "$(stat -f %Lp .env.staging.local)"
eq "Git の対象外" "ignored" "$(git check-ignore -q .env.staging.local && echo ignored || echo tracked)"
eq "どの値にも本番の ID が無い" "0" "$(grep -c "$PROD_REF" .env.staging.local)"
eq "接続文字列の利用者が試験環境（postgres.$STAGING_REF）" "yes" "$([[ "$DB" == *"postgres.$STAGING_REF:"* ]] && echo yes || echo no)"
eq "接続先は Session pooler（IPv4・5432）" "yes" "$([[ "$DB" == *".pooler.supabase.com:5432/"* ]] && echo yes || echo no)"
eq "API の URL が試験環境" "https://$STAGING_REF.supabase.co" "$URL"
eq "anon キーは publishable（ブラウザ用）の形" "yes" "$([[ "$ANON" == sb_publishable_* || "$ANON" == eyJ* ]] && echo yes || echo no)"
eq "service_role キーは secret（サーバー用）の形・anon キーと取り違えていない" "yes" "$([[ "$SRV" == sb_secret_* || ( "$SRV" == eyJ* && "$SRV" != "$ANON" ) ]] && echo yes || echo no)"
[ "$FAIL" -eq 0 ] || { echo "STOP: ファイルの確認で不合格。接続しません"; exit 1; }

echo "2. DB への接続（読み取りだけの設定で接続）"
# 読み取りだけ: 接続の後、最初に DB の中で「この接続は読み取りだけ」に切り替えてから問い合わせる。
# （接続の設定の PGOPTIONS は Supabase の接続の中継（Supavisor）が通さないため使わない。2026-11-05 にこれで誤って表を 1つ作り、すぐ消した）
q() { # SQL（1つ）
  { echo "set default_transaction_read_only = on;"; echo "$1"; } |
    docker exec -i -e PGURL="$DB" -e PGCONNECT_TIMEOUT=15 "$C" sh -c 'psql "$PGURL" -qtA -F "|" 2>&1'
}
info=$(q "select current_user, current_setting('default_transaction_read_only'), split_part(current_setting('server_version'),' ',1), (select count(*) from information_schema.tables where table_schema='public'), (select count(*) from information_schema.schemata where schema_name='staging_guard'), (select count(*) from pg_extension where extname in ('pg_cron','pg_net')), (select string_agg(extname, ',' order by extname) from pg_extension)")
if [[ "$info" != *"|"* ]]; then echo "  FAIL 接続できない: $(echo "$info" | sed -E 's#postgres(ql)?://[^ ]*#<接続文字列>#g' | head -c 200)"; exit 1; fi
IFS='|' read -r who ro ver ntab guard ext_out exts <<< "$info"
eq "接続できた（利用者 postgres）" "postgres" "$who"
eq "この接続は読み取りだけ" "on" "$ro"
echo "  情報 PostgreSQL $ver・拡張: $exts"
eq "public の表は 0（空の試験環境。本番は 23 表なので、本番につながっていない）" "0" "$ntab"
eq "試験環境の印はまだ無い（SQL の適用の前）" "0" "$guard"
eq "pg_cron・pg_net は入っていない（外への送信の仕組みが無い）" "0" "$ext_out"
# 書き込みの確認は、もし通っても必ず取り消す（begin … rollback）。読み取りだけなら create の時点で拒否される
w=$(q "begin; create table public._write_probe(x int); rollback;")
eq "書き込みの SQL は拒否される（読み取りだけの接続）" "yes" "$(echo "$w" | grep -q 'read-only transaction' && echo yes || echo no)"

echo "3. API（読み取りだけ）"
eq "anon キーで試験環境の認証の稼働の確認 → 200" "200" "$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $ANON" "$URL/auth/v1/health")"
eq "service_role キーで同じ確認 → 200" "200" "$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $SRV" "$URL/auth/v1/health")"
eq "anon キーは本番の API では使えない（本番の鍵ではない）" "no" "$(c=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $ANON" "https://$PROD_REF.supabase.co/auth/v1/health"); [ "$c" = "200" ] && echo yes || echo no)"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
