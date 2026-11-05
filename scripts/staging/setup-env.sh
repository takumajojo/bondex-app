#!/usr/bin/env bash
# 試験環境（Supabase の bondex-staging = oeucjrmuigtfnwowvzwr）の接続情報を、このコンピュータの中のファイル
# .env.staging.local（Git に入らない・本人だけが読める 600）に保存する。入力は画面に出さない。
#
#   bash scripts/staging/setup-env.sh
#
# 入力するもの（Supabase のダッシュボードの bondex-staging から写す）:
#   1. 接続文字列: 「Connect」→「Session pooler」の文字列。[YOUR-PASSWORD] を保管したパスワードに置き換えたもの
#   2. anon（publishable）キー: 「Project Settings」→「API Keys」
#   3. service_role（secret）キー: 同じ画面
# 守ること:
#   - 入力した値は画面・ログ・履歴に出さない（read -s・set +x・ファイルは 600）
#   - 本番（dscxftwfspgihkszfakk）の値なら保存しない。試験環境の ID が無い接続文字列も保存しない
#   - キーが本当に試験環境のものかは、試験環境の URL に「読み取りだけ」で問い合わせて確かめる（認証の稼働の確認・何も書かない）
set -euo pipefail
set +x
umask 077
cd "$(dirname "$0")/../.."
STAGING_REF=oeucjrmuigtfnwowvzwr
PROD_REF=dscxftwfspgihkszfakk
STAGING_URL="https://$STAGING_REF.supabase.co"
OUT=.env.staging.local
[ -t 0 ] || { echo "端末から実行してください（入力を画面に出さないため）"; exit 1; }

if [ -e "$OUT" ]; then
  read -r -p "$OUT は既にあります。作り直しますか？ [y/N] " yn
  [ "$yn" = "y" ] || { echo "やめました（ファイルは変えていません）"; exit 0; }
fi

ask() { # 名前 説明 → 値（画面に出さない）
  local v
  printf '%s（入力は表示されません）: ' "$2" >&2
  IFS= read -r -s v; printf '\n' >&2
  v="${v//[$'\r\n ']/}"
  [ -n "$v" ] || { echo "空です。やめました" >&2; exit 1; }
  printf '%s' "$v"
}

DB_URL=$(ask DB "1. 接続文字列（Session pooler）")
case "$DB_URL" in *"$PROD_REF"*) echo "本番の ID が含まれています。保存しません"; exit 1;; esac
case "$DB_URL" in postgres://*|postgresql://*) ;; *) echo "接続文字列の形ではありません（postgresql:// で始まる）。保存しません"; exit 1;; esac
case "$DB_URL" in *"postgres.$STAGING_REF:"*"@"*".pooler.supabase.com:5432/"*) ;; *)
  echo "Session pooler の接続文字列ではないか、試験環境の ID（postgres.$STAGING_REF）がありません。保存しません"; exit 1;; esac
case "$DB_URL" in *"[YOUR-PASSWORD]"*) echo "[YOUR-PASSWORD] がそのままです。保存しません"; exit 1;; esac

ANON=$(ask ANON "2. anon（publishable）キー")
SERVICE=$(ask SERVICE "3. service_role（secret）キー")
for k in "$ANON" "$SERVICE"; do
  case "$k" in *"$PROD_REF"*) echo "本番の ID が含まれています。保存しません"; exit 1;; esac
done
[ "$ANON" != "$SERVICE" ] || { echo "2 と 3 が同じです。保存しません"; exit 1; }

# JWT 形式の鍵なら、中の ref（プロジェクトの ID）と role を確かめる（画面には ID と role だけを出す）
jwt_field() { # 鍵 項目
  local p; p=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+'); while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done
  printf '%s' "$p" | base64 -d 2>/dev/null | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"
}
check_key() { # 鍵 期待する role 表示名
  if [ "$(printf '%s' "$1" | tr -cd '.' | wc -c | tr -d ' ')" = "2" ]; then
    local ref role; ref=$(jwt_field "$1" ref); role=$(jwt_field "$1" role)
    [ "$ref" = "$STAGING_REF" ] || { echo "$3: 試験環境の鍵ではありません（ID が違う）。保存しません"; exit 1; }
    [ "$role" = "$2" ] || { echo "$3: 種類が違います（$role）。保存しません"; exit 1; }
    echo "  $3: JWT・ID=$ref・種類=$role"
  else
    case "$1" in sb_publishable_*|sb_secret_*) echo "  $3: 新しい形式の鍵（試験環境への問い合わせで確かめます）";; *) echo "$3: 鍵の形ではありません。保存しません"; exit 1;; esac
  fi
  # 試験環境の認証の稼働の確認（読み取りだけ）。その鍵が試験環境で使えれば 200
  local code; code=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $1" "$STAGING_URL/auth/v1/health")
  [ "$code" = "200" ] || { echo "$3: 試験環境で使えない鍵です（HTTP $code）。保存しません"; exit 1; }
  echo "  $3: 試験環境で使えることを確認（HTTP 200・読み取りだけ）"
}
echo "確認:"
check_key "$ANON" anon "anon キー"
check_key "$SERVICE" service_role "service_role キー"

TMP=$(mktemp "$OUT.XXXXXX")
chmod 600 "$TMP"
{
  echo "# 試験環境（bondex-staging = $STAGING_REF）の接続情報。Git に入らない・本人だけが読める。画面・チャットに貼らない。"
  echo "# 作成: $(date '+%Y-%m-%d %H:%M') scripts/staging/setup-env.sh"
  echo "STAGING_PROJECT_REF=$STAGING_REF"
  echo "STAGING_DB_URL=$DB_URL"
  echo "NEXT_PUBLIC_SUPABASE_URL=$STAGING_URL"
  echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON"
  echo "SUPABASE_SERVICE_ROLE_KEY=$SERVICE"
} > "$TMP"
mv -f "$TMP" "$OUT"
unset DB_URL ANON SERVICE
git check-ignore -q "$OUT" || echo "注意: $OUT が Git の対象外になっていません（.gitignore を確認）"
echo "保存しました: $OUT（権限 $(stat -f %Lp "$OUT")）。値は表示していません。"
