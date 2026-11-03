"""Stripe のテストモードへの接続の確認（Stage 3）。キーの値は表示しない。

- 秘密キーが sk_test_、公開キーが pk_test_ で始まらなければ、Stripe に接続せずに止める。
- 接続して、Stripe の返す livemode が false（テストモード）であることを確かめる。
- 表示するのは「設定あり・テスト用・接続できた」かどうかだけ。

実行: set -a; . ./.env.local; set +a; python3 -I scripts/test-b2c/stripe_check.py
"""
import json
import os
import sys
import urllib.error
import urllib.request

sk = os.environ.get("STRIPE_SECRET_KEY", "")
pk = os.environ.get("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "")
ok = True
for name, val, want in (("STRIPE_SECRET_KEY", sk, "sk_test_"), ("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", pk, "pk_test_")):
    if not val:
        print(f"NG  {name}: 未設定")
        ok = False
    elif not val.startswith(want):
        print(f"NG  {name}: テスト用ではありません（{want} で始まっていない）。接続しません。")
        ok = False
    else:
        print(f"ok  {name}: テスト用（{want}…）")
if os.environ.get("B2C_STRIPE_ALLOW_LIVE") == "true":
    print("NG  B2C_STRIPE_ALLOW_LIVE=true が入っています。ローカルでは消してください。")
    ok = False
if not ok:
    sys.exit(1)

req = urllib.request.Request("https://api.stripe.com/v1/balance", headers={"Authorization": "Bearer " + sk})
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        body = json.loads(r.read())
except urllib.error.HTTPError as e:
    print(f"NG  Stripe に接続できません（HTTP {e.code}）。キーの写し間違いがないかご確認ください。")
    sys.exit(1)
if body.get("livemode") is not False:
    print("NG  Stripe がテストモードではないと返しました。止めます。")
    sys.exit(1)
print("ok  Stripe のテストモードに接続できました（livemode=false）")
