"""B2C のカード登録の障害の試験（Stage 3・D9/D10）: ローカルの DB の窓口（PostgREST）を止めた時。

- 画面の照合・カード登録の開始は「見つからない」と答えず 503（一時的に使えない）を返す。待つのは 8秒まで。
- Stripe の Webhook は 5xx（Stripe が再送する）。通知を処理済みにしない。
- 復旧の後、同じ通知の再送で確定する。存在しない予約の通知は再送させない（200・記録）。
本番には接続しない（ローカルの docker のコンテナだけを止める・Stripe は sk_test_ だけ）。

実行: set -a; . ./.env.local; set +a; BASE=http://localhost:3210 python3 -I scripts/test-b2c/card_dbdown.py
"""
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "dates"))
from test_dates import D  # noqa: E402  試験の日付を実際の今日から見て有効な週へ（7日の倍数）

BASE = os.environ.get("BASE", "http://localhost:3210")
if not (BASE.startswith("http://localhost:") or BASE.startswith("http://127.0.0.1:")):
    sys.exit("refusing: BASE must be local")
SK = os.environ.get("STRIPE_SECRET_KEY", "")
if not SK.startswith("sk_test_"):
    sys.exit("refusing: sk_test_ only")
WH = os.environ["STRIPE_B2C_WEBHOOK_SECRET"]
REST = "supabase_rest_supa-local"
T = "dev-hnk-local-token-0001"
P = F = 0


def ok(n, c, d=None):
    global P, F
    if c:
        P += 1
        print("  ok ", n, flush=True)
    else:
        F += 1
        print("  NG ", n, d, flush=True)


def post(p, b=None, h=None, raw=None, timeout=60):
    hh = {"Content-Type": "application/json", "x-real-ip": "10.5.2.9"}
    hh.update(h or {})
    r = urllib.request.Request(BASE + p, data=raw if raw is not None else json.dumps(b).encode(), headers=hh, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(r, timeout=timeout) as x:
            return x.status, json.loads(x.read() or b"{}"), time.time() - t0
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}"), time.time() - t0


def st(m, p, params=None):
    d = urllib.parse.urlencode(params or {}).encode() if m == "POST" else None
    r = urllib.request.Request("https://api.stripe.com/v1" + p, data=d, method=m, headers={"Authorization": "Bearer " + SK})
    with urllib.request.urlopen(r, timeout=60) as x:
        return json.loads(x.read())


def sql(q):
    return subprocess.run(["docker", "exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-qtA", "-F", "|", "-c", q],
                          capture_output=True, text=True).stdout.strip()


def sig(body):
    ts = str(int(time.time()))
    return {"Stripe-Signature": f"t={ts},v1=" + hmac.new(WH.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()}


def wait_rest():
    for _ in range(60):
        if post("/api/b2c/entry", {"token": T})[0] == 200:
            return
        time.sleep(1)


pl = lambda q: post("/api/b2c/places", {"token": T, "query": q, "lang": "en"})[1]["candidates"][0]["placeId"]
tk, ky = pl("Keio Plaza Hotel Tokyo"), pl("Hotel Granvia Kyoto")
# この試験で使うホテル（確認済み）と受付の枠を自分で用意する（他の試験の順番に左右されない。ローカルの DB だけ）
for pid, name in ((tk, "Keio Plaza Hotel Tokyo"), (ky, "Hotel Granvia Kyoto")):
    sql(f"insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('{pid}', '{name}', 'verified', 'e2e@example.invalid', now()) "
        f"on conflict (place_id) do update set status='verified', checked_by='e2e@example.invalid', last_verified_at=now()")
sql("insert into b2c_ops_days(date, max_new_bookings, max_pieces) values ('" + D("2026-11-10") + "', 500, 2000) on conflict (date) do update set max_new_bookings=500, max_pieces=2000, closed=false")
c, r, _ = post("/api/b2c/orders", {"token": T, "originPlaceId": tk, "destPlaceId": ky, "origin": {"checkIn": D("2026-11-10"), "checkOut": D("2026-11-12")},
                                   "dest": {"checkIn": D("2026-11-12"), "checkOut": D("2026-11-15")}, "pieces": 1, "pickupDate": D("2026-11-10"), "deliveryDate": D("2026-11-12"),
                                   "name": "DB Down", "email": "db@example.invalid", "whatsapp": "+81 90 1111 2222", "language": "en", "consent": True})
o = {"token": T, "orderNumber": r["orderNumber"], "accessToken": r["accessToken"]}
c, r, _ = post("/api/b2c/card/start", {**o, "cardConsent": True})
si_id = r["clientSecret"].split("_secret_")[0]
st("POST", f"/setup_intents/{si_id}/confirm", {"payment_method": "pm_card_visa"})
si = st("GET", f"/setup_intents/{si_id}")
body = json.dumps({"id": "evt_dbdown_" + si_id[-10:], "object": "event", "type": "setup_intent.succeeded", "created": int(time.time()), "livemode": False, "data": {"object": si}})

print("D9 DB の窓口を止める（カードは Stripe で登録済み・画面と Webhook がまだ反映していない）", flush=True)
subprocess.run(["docker", "stop", REST], capture_output=True, check=True)
try:
    c1, r1, t1 = post("/api/b2c/card/status", o, timeout=120)
    ok(f"画面の照合: 503 temporarily_unavailable（「見つからない」と答えない）・{t1:.0f}秒", (c1, r1.get("error")) == (503, "temporarily_unavailable") and t1 < 20, (c1, r1, t1))
    c2, r2, t2 = post("/api/b2c/card/start", {**o, "cardConsent": True}, timeout=120)
    ok(f"カード登録の開始: 503・{t2:.0f}秒", c2 == 503 and t2 < 20, (c2, r2, t2))
    c3, r3, t3 = post("/api/b2c/stripe/webhook", None, sig(body), raw=body.encode(), timeout=120)
    ok(f"Webhook: 5xx（Stripe が再送する）・{t3:.0f}秒", c3 >= 500 and t3 < 20, (c3, r3, t3))
finally:
    subprocess.run(["docker", "start", REST], capture_output=True, check=True)
    wait_rest()

print("D9 復旧の後", flush=True)
ok("DB は registering のまま・通知は未処理（壊れた状態を残していない）",
   (sql(f"select status, card_status from b2c_orders where order_number={o['orderNumber']}"), sql(f"select count(processed_at) from b2c_stripe_events where event_id like 'evt_dbdown_{si_id[-10:]}'")) == ("card_pending|registering", "0"))
c4, r4, _ = post("/api/b2c/stripe/webhook", None, sig(body), raw=body.encode())
ok("Stripe の再送（同じ通知）→ 200・confirmed・shipments 1行",
   (c4, sql(f"select status from b2c_orders where order_number={o['orderNumber']}"), sql(f"select count(*) from shipments s join b2c_orders b on b.id=s.b2c_order_id where b.order_number={o['orderNumber']}")) == (200, "confirmed", "1"), (c4, r4))
c5, r5, _ = post("/api/b2c/card/status", o)
ok("画面の照合も confirmed", r5.get("view", {}).get("status") == "confirmed", r5)

print("D10 存在しない予約の通知 → 再送させない（200・記録）", flush=True)
fake = dict(si, metadata={"channel": "b2c", "order_id": "00000000-0000-0000-0000-000000000000"})
b2 = json.dumps({"id": "evt_noorder_" + si_id[-10:], "object": "event", "type": "setup_intent.succeeded", "created": int(time.time()), "livemode": False, "data": {"object": fake}})
c6, r6, _ = post("/api/b2c/stripe/webhook", None, sig(b2), raw=b2.encode())
ok("200 ignored order_not_found・記録は処理済み", (c6, r6.get("ignored"), sql(f"select result from b2c_stripe_events where event_id='evt_noorder_{si_id[-10:]}'")) == (200, "order_not_found", "ignored:order_not_found"), (c6, r6))
print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
