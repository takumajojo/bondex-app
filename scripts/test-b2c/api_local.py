"""B2C の API の試験（ローカルの開発サーバー＋ローカルの Supabase だけ）。本番には接続しない。

前提: scripts/test-b2c/db/seed-dev.sh 済み、開発サーバー（.env.local はローカル用）が BASE で動いている。
実行: BASE=http://localhost:3211 python3 -I scripts/test-b2c/api_local.py
予約の API は 1分 10回まで（lib/rate-limit.ts の strict）。続けて実行する時は 1分あける。
"""
import json
import os
import sys
import urllib.error
import urllib.request
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "dates"))
from test_dates import D  # noqa: E402  試験の日付を実際の今日から見て有効な週へ（7日の倍数）

BASE = os.environ.get("BASE", "http://localhost:3211")
if not (BASE.startswith("http://localhost:") or BASE.startswith("http://127.0.0.1:")):
    sys.exit("refusing: BASE must be local")
TOK = "dev-hnk-local-token-0001"
passed = failed = 0


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def check(label, got, want):
    global passed, failed
    if got == want:
        passed += 1
        print(f"  ok  {label}")
    else:
        failed += 1
        print(f"  NG  {label} (expected {want!r}, got {got!r})")


def place(q):
    return post("/api/b2c/places", {"token": TOK, "query": q, "lang": "en"})[1]["candidates"][0]["placeId"]


TOKYO, KYOTO, NAHA = place("Keio Plaza Hotel Tokyo"), place("Hotel Granvia Kyoto"), place("Hotel Collective Naha")
STAY = {"origin": {"checkIn": D("2026-11-10"), "checkOut": D("2026-11-12")}, "dest": {"checkIn": D("2026-11-12"), "checkOut": D("2026-11-15")}}
GUEST = {"name": "Test Traveler", "email": "t@example.invalid", "whatsapp": "+31 6 1234 5678", "language": "en", "consent": True}

print("入口")
check("無効な token は 404", post("/api/b2c/entry", {"token": "not-a-valid-token-0000"})[0], 404)
check("有効な token は 200", post("/api/b2c/entry", {"token": TOK})[0], 200)
check("token なしのホテル検索は 404（有料の API を使わせない）", post("/api/b2c/places", {"query": "Keio"})[0], 404)

print("見積（サーバーで計算）")
_, q = post("/api/b2c/quote", {"token": TOK, "originPlaceId": TOKYO, "destPlaceId": KYOTO, **STAY, "pieces": 2})
check("東京→京都 2個 = 税込 10,956円", q["price"]["totalGrossYen"], 10956)
check("最短のお届け日は配送先のチェックイン日より前にならない", q["options"][0]["earliestDelivery"], D("2026-11-12"))
check("お届け日はチェックアウトの前日まで", q["options"][0]["deliveryDates"][-1], D("2026-11-14"))
_, q = post("/api/b2c/quote", {"token": TOK, "originPlaceId": TOKYO, "destPlaceId": NAHA, **STAY, "pieces": 1})
check("東京→那覇 = 沖縄の料金 13,000円（税抜）", q["price"]["unitNetYen"], 13000)
check("東京→那覇 1個 = 税込 14,300円", q["price"]["totalGrossYen"], 14300)
_, q = post("/api/b2c/quote", {"token": TOK, "originPlaceId": TOKYO, "destPlaceId": TOKYO, **STAY, "pieces": 1})
check("同じホテルどうしは不可", q["errors"], ["same_hotel"])
_, q = post("/api/b2c/quote", {"token": TOK, "originPlaceId": TOKYO, "destPlaceId": KYOTO, **STAY, "pieces": 11})
check("11個は不可", q["errors"], ["invalid_pieces"])
_, q = post("/api/b2c/quote", {"token": TOK, "originPlaceId": TOKYO, "destPlaceId": KYOTO, "origin": STAY["origin"], "dest": {"checkIn": D("2026-11-20"), "checkOut": D("2026-11-19")}, "pieces": 1})
check("宿泊日の前後が逆なら不可", q["errors"], ["invalid_stay"])
_, q = post("/api/b2c/quote", {"token": TOK, "originPlaceId": TOKYO, "destPlaceId": KYOTO, "origin": STAY["origin"], "dest": {"checkIn": D("2026-11-30"), "checkOut": D("2026-12-02")}, "pieces": 1})
check("配送先の滞在が先でも、配送先のチェックイン日より前のお届け日は出さない", all(d >= D("2026-11-30") for o in q["options"] for d in o["deliveryDates"]), True)

print("予約の下書き（画面の値を信用しない）")
body = {"token": TOK, "originPlaceId": TOKYO, "destPlaceId": KYOTO, **STAY, "pieces": 1, "pickupDate": D("2026-11-10"), "deliveryDate": D("2026-11-12"), **GUEST}
code, r = post("/api/b2c/orders", {**body, "totalGrossYen": 1, "unitNetYen": 1})
check("金額を送っても無視され、サーバーの計算で保存（200）", code, 200)
check("保存された税込の総額は 5,478円", r.get("totalGrossYen"), 5478)
code, r = post("/api/b2c/orders", {**body, "pickupDate": D("2026-11-09")})
check("選べない集荷日（滞在の外）は 422", (code, "date_not_available" in r.get("errors", [])), (422, True))
code, r = post("/api/b2c/orders", {**body, "deliveryDate": D("2026-11-15")})
check("配送先のチェックアウト当日のお届けは 422", (code, "date_not_available" in r.get("errors", [])), (422, True))
code, r = post("/api/b2c/orders", {**body, "consent": False, "whatsapp": "0612345678"})
check("同意なし・WhatsApp の形式違いは 422", (code, sorted(r.get("errors", []))), (422, ["consent_required", "invalid_whatsapp"]))
check("無効な token の予約は 404", post("/api/b2c/orders", {**body, "token": "not-a-valid-token-0000"})[0], 404)

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
