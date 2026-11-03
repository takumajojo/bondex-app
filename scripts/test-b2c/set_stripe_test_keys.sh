#!/usr/bin/env bash
# Stripe のテストモードのキーを .env.local に書き込む（ローカルの試験だけ）。
# 入力は画面に表示しない（read -s）。sk_test_ / pk_test_ 以外は書き込まずに止める。
#   実行: bash scripts/test-b2c/set_stripe_test_keys.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE=".env.local"
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE がありません"; exit 1; }

printf "シークレットキー（sk_test_…）を貼り付けて Enter（画面には出ません）: "
read -rs SK; echo
printf "公開キー（pk_test_…）を貼り付けて Enter（画面には出ません）: "
read -rs PK; echo
SK="$(printf '%s' "$SK" | tr -d '[:space:]\"'"'")"
PK="$(printf '%s' "$PK" | tr -d '[:space:]\"'"'")"
case "$SK" in sk_test_*) ;; *) echo "止めました: シークレットキーが sk_test_ で始まっていません（本番のキーは使いません）"; exit 1 ;; esac
case "$PK" in pk_test_*) ;; *) echo "止めました: 公開キーが pk_test_ で始まっていません（本番のキーは使いません）"; exit 1 ;; esac

SK="$SK" PK="$PK" python3 -I - "$ENV_FILE" <<'EOF'
import os, sys
p = sys.argv[1]
lines = open(p, encoding="utf-8").read().splitlines()
vals = {"STRIPE_SECRET_KEY": os.environ["SK"], "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY": os.environ["PK"]}
seen = set()
out = []
for l in lines:
    k = l.split("=", 1)[0].strip()
    if k in vals:
        out.append(f"{k}={vals[k]}")
        seen.add(k)
    else:
        out.append(l)
for k, v in vals.items():
    if k not in seen:
        out.append(f"{k}={v}")
open(p, "w", encoding="utf-8").write("\n".join(out) + "\n")
EOF
echo "書き込みました（テスト用のキー 2つ）。キーの値は表示していません。"
