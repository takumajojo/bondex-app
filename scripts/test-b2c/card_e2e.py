"""B2C のカード登録の通しの試験（Stage 3）。ローカルの開発サーバー＋ローカルの Supabase＋Stripe のテストモードだけ。

本番には接続しない:
- BASE はローカルだけ。DB は docker のローカルのコンテナの psql だけ。
- Stripe の鍵は sk_test_ だけ（sk_live_ なら止まる）。Stripe の公式のテスト用のカード（pm_card_*）だけを使う。
- メール・WhatsApp・佐川には何も送らない（通知は b2c_outbox に積まれるだけで、送信の処理は無い）。

前提: scripts/test-b2c/db/seed-dev.sh 済み、.env.local（ローカル用）で開発サーバーが BASE で動いている。
実行: set -a; . ./.env.local; set +a; BASE=http://localhost:3211 python3 -I scripts/test-b2c/card_e2e.py
"""
import base64
import concurrent.futures as cf
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
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from card_leak import find_card_leaks  # noqa: E402  カードの番号・CVC の漏えいの検査（構造を見る・2026-11-07）

BASE = os.environ.get("BASE", "http://localhost:3211")
if not (BASE.startswith("http://localhost:") or BASE.startswith("http://127.0.0.1:")):
    sys.exit("refusing: BASE must be local")
SK = os.environ.get("STRIPE_SECRET_KEY", "")
if not SK.startswith("sk_test_"):
    sys.exit("refusing: STRIPE_SECRET_KEY must be a test key (sk_test_)")
WH_B2C = os.environ.get("STRIPE_B2C_WEBHOOK_SECRET", "")
WH_B2B = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
CONTAINER = os.environ.get("B2C_LOCAL_DB_CONTAINER", "supabase_db_supa-local")
TOK = "dev-hnk-local-token-0001"
passed = failed = 0
ip_counter = [0]
API_RESPONSES = []  # 開発サーバーの応答をすべて控え、最後にカードの番号・CVC が無いことを確かめる


def check(label, got, want):
    global passed, failed
    if got == want:
        passed += 1
        print(f"  ok  {label}")
    else:
        failed += 1
        print(f"  NG  {label} (expected {want!r}, got {got!r})")


def sql(q):
    out = subprocess.run(["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "|", "-c", q],
                         capture_output=True, text=True, check=True)
    return out.stdout.strip()


def post(path, body, headers=None, raw=None):
    # 回数の制限（IP ごと）に当たらないよう、試験ではシナリオごとに別の x-real-ip を名乗る（ローカルの試験だけ）
    h = {"Content-Type": "application/json", "x-real-ip": f"10.9.0.{ip_counter[0] % 250 + 1}"}
    h.update(headers or {})
    data = raw if raw is not None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            res = r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        res = e.code, json.loads(e.read() or b"{}")
    API_RESPONSES.append({"path": path, "status": res[0], "body": res[1]})
    return res


def stripe(method, path, params=None):
    data = urllib.parse.urlencode(params or {}, doseq=True).encode() if method == "POST" else None
    url = "https://api.stripe.com/v1" + path + ("?" + urllib.parse.urlencode(params or {}, doseq=True) if method == "GET" and params else "")
    req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": "Bearer " + SK})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def signed(secret, payload):
    ts = str(int(time.time()))
    sig = hmac.new(secret.encode(), f"{ts}.{payload}".encode(), hashlib.sha256).hexdigest()
    return {"Stripe-Signature": f"t={ts},v1={sig}"}


def event(evt_id, typ, si):
    return json.dumps({"id": evt_id, "object": "event", "type": typ, "created": int(time.time()), "api_version": "2026-04-22.dahlia",
                       "livemode": False, "data": {"object": si}})


def place(q):
    return post("/api/b2c/places", {"token": TOK, "query": q, "lang": "en"})[1]["candidates"][0]["placeId"]


def new_order(origin, dest, pickup, delivery, pieces=1, stay=None):
    ip_counter[0] += 1
    stay = stay or {"origin": {"checkIn": D("2026-11-10"), "checkOut": D("2026-11-12")}, "dest": {"checkIn": D("2026-11-12"), "checkOut": D("2026-11-15")}}
    code, r = post("/api/b2c/orders", {"token": TOK, "originPlaceId": origin, "destPlaceId": dest, **stay, "pieces": pieces,
                                        "pickupDate": pickup, "deliveryDate": delivery, "name": "Test Traveler", "email": "t@example.invalid",
                                        "whatsapp": "+31 6 1234 5678", "language": "en", "consent": True})
    assert code == 200, (code, r)
    return {"token": TOK, "orderNumber": r["orderNumber"], "accessToken": r["accessToken"]}


def start(o, **extra):
    return post("/api/b2c/card/start", {**o, "cardConsent": True, **extra})


def status(o):
    return post("/api/b2c/card/status", o)


def row(o):
    cols = "status, card_status, coalesce(stripe_setup_intent_id,''), coalesce(stripe_payment_method_id,''), coalesce(card_3ds_result,''), coalesce(stripe_customer_id,''), (select count(*) from shipments s where s.b2c_order_id = b2c_orders.id), id"
    s, c, si, pm, tds, cus, ships, oid = sql(f"select {cols} from b2c_orders where order_number = {o['orderNumber']}").split("|")
    return {"status": s, "card": c, "si": si, "pm": pm, "tds": tds, "cus": cus, "shipments": int(ships), "id": oid}


def confirm_si(si_id, pm):
    return stripe("POST", f"/setup_intents/{si_id}/confirm", {"payment_method": pm})


# ---------------------------------------------------------------------------
print("準備（ローカルの DB だけ）")
TOKYO, KYOTO, NAHA = place("Keio Plaza Hotel Tokyo"), place("Hotel Granvia Kyoto"), place("Hotel Collective Naha")
for pid, name in ((TOKYO, "Keio Plaza Hotel Tokyo"), (KYOTO, "Hotel Granvia Kyoto")):
    sql(f"insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('{pid}', '{name}', 'verified', 'e2e@example.invalid', now()) "
        f"on conflict (place_id) do update set status='verified', checked_by='e2e@example.invalid', last_verified_at=now()")
sql(f"insert into b2c_facilities(place_id, name, status) values ('{NAHA}', 'Hotel Collective Naha', 'unknown') on conflict (place_id) do update set status='unknown', checked_by=null, last_verified_at=null")
sql("insert into b2c_ops_days(date, max_new_bookings, max_pieces) values ('" + D("2026-11-10") + "', 50, 200), ('" + D("2026-11-11") + "', 50, 200) on conflict (date) do update set max_new_bookings=50, max_pieces=200, closed=false")
T0 = int(time.time()) - 5
customers = []

# ---------------------------------------------------------------------------
print("01 正常: 確認済みのホテルどうし → カード登録 → 予約の確定（請求・オーソリなし）")
o = new_order(TOKYO, KYOTO, D("2026-11-10"), D("2026-11-12"), pieces=2)
check("下書きの時点: draft・カードなし・shipments なし", (row(o)["status"], row(o)["card"], row(o)["shipments"]), ("draft", "none", 0))
code, r = start(o, totalGrossYen=1, amount=1)
check("開始は 200（画面から送った金額は無視）", code, 200)
check("client_secret が返る", r.get("clientSecret", "").startswith("seti_"), True)
rw = row(o)
customers.append(rw["cus"])
check("開始の後: card_pending・registering（枠を確保）", (rw["status"], rw["card"]), ("card_pending", "registering"))
_, si = stripe("GET", f"/setup_intents/{rw['si']}")
check("SetupIntent: usage=off_session・card だけ・metadata.channel=b2c", (si["usage"], si["payment_method_types"], si["metadata"].get("channel"), si["metadata"].get("order_id")), ("off_session", ["card"], "b2c", rw["id"]))
_, cus = stripe("GET", f"/customers/{rw['cus']}")
check("Customer は旅行者ごと（metadata.channel=b2c・代理店の ID なし）", (cus["metadata"].get("channel"), "agency_id" in cus["metadata"], cus["email"]), ("b2c", False, "t@example.invalid"))
code, _ = confirm_si(rw["si"], "pm_card_visa")
check("Stripe でカードの確認（テストの Visa）", code, 200)
code, r = status(o)
check("照合の後: confirmed", (code, r["view"]["status"], r["view"]["cardStatus"]), (200, "confirmed", "registered"))
check("画面に返すカードの表示は Stripe から取り直した末尾 4桁だけ", r["view"].get("card"), {"brand": "visa", "last4": "4242"})
rw = row(o)
check("DB: PaymentMethod の ID・3D セキュアの結果・shipments 1行", (rw["pm"].startswith("pm_"), rw["tds"], rw["shipments"]), (True, "not_required", 1))
check("DB の shipments: channel=b2c・BondEx Direct・課金の列は空", sql(f"select channel, agency, charged_at is null, stripe_payment_intent_id is null, amount_yen from shipments where b2c_order_id = '{rw['id']}'"), "b2c|BondEx Direct|t|t|9960")
code, r = status(o)
check("照合を何度呼んでも同じ（shipments は増えない）", (r["view"]["status"], row(o)["shipments"]), ("confirmed", 1))
O1 = o

# ---------------------------------------------------------------------------
print("02 未確認のホテル: カード登録の後も awaiting_hotel_confirmation（確定しない）")
_, q = post("/api/b2c/quote", {"token": TOK, "originPlaceId": TOKYO, "destPlaceId": NAHA, "origin": {"checkIn": D("2026-11-10"), "checkOut": D("2026-11-12")}, "dest": {"checkIn": D("2026-11-12"), "checkOut": D("2026-11-15")}, "pieces": 1})
op = q["options"][0]
check("見積の段階で「確認待ち」の案内（awaiting_hotel_verification）", op["confirmationMode"], "awaiting_hotel_verification")
o = new_order(TOKYO, NAHA, op["pickupDate"], op["earliestDelivery"])
code, r = start(o)
rw = row(o)
customers.append(rw["cus"])
confirm_si(rw["si"], "pm_card_mastercard")
code, r = status(o)
check("カード登録の成功は確定ではない: awaiting_hotel_confirmation", (r["view"]["status"], r["view"]["cardStatus"]), ("awaiting_hotel_confirmation", "registered"))
check("shipments は作らない（佐川への依頼の対象にならない）", row(o)["shipments"], 0)
check("確認の期限が返る", bool(r["view"]["confirmationDueAt"]), True)
sql(f"update b2c_facilities set status='verified', checked_by='e2e@example.invalid', last_verified_at=now() where place_id='{NAHA}'")
code, r = status(o)
check("運営がホテルを確認済みにした後の照合で confirmed", (r["view"]["status"], row(o)["shipments"]), ("confirmed", 1))
sql(f"update b2c_facilities set status='unknown', checked_by=null, last_verified_at=null where place_id='{NAHA}'")

# ---------------------------------------------------------------------------
print("03 カードの拒否 → 別のカードで入れ直し")
o = new_order(TOKYO, KYOTO, D("2026-11-10"), D("2026-11-13"))
start(o)
rw = row(o)
customers.append(rw["cus"])
code, err = confirm_si(rw["si"], "pm_card_chargeDeclined")
check("Stripe が拒否（402 card_declined）", (code, err.get("error", {}).get("code")), (402, "card_declined"))
code, r = status(o)
check("照合の後: card_status=failed・予約は card_pending のまま（確定しない）", (r["view"]["status"], r["view"]["cardStatus"], r["view"].get("cardError")), ("card_pending", "failed", "generic_decline"))
code, _ = confirm_si(rw["si"], "pm_card_visa")
code, r = status(o)
check("同じ SetupIntent に別のカード → confirmed", (r["view"]["status"], r["view"]["cardStatus"]), ("confirmed", "registered"))

# ---------------------------------------------------------------------------
print("04 3D セキュアの認証が必要なカード（認証の前は確定しない）")
o = new_order(TOKYO, KYOTO, D("2026-11-11"), D("2026-11-13"))
start(o)
rw = row(o)
customers.append(rw["cus"])
code, si = confirm_si(rw["si"], "pm_card_authenticationRequiredOnSetup")
check("Stripe: requires_action（認証待ち）", si.get("status"), "requires_action")
code, r = status(o)
check("照合の後: card_pending・registering のまま", (r["view"]["status"], r["view"]["cardStatus"]), ("card_pending", "registering"))
O4 = o

# ---------------------------------------------------------------------------
print("05 同じ予約のカード登録の開始の重複・競合（同時に 6回）")
o = new_order(TOKYO, KYOTO, D("2026-11-11"), D("2026-11-14"))
with cf.ThreadPoolExecutor(6) as ex:
    res = list(ex.map(lambda _: start(o), range(6)))
secrets = {r.get("clientSecret") for c, r in res if c == 200}
busy = [c for c, r in res if c == 409]
check("全部 200 か、処理中の 409（失敗しない）", all(c in (200, 409) for c, _ in res), True)
check("返った client_secret は 1種類（SetupIntent は 1つ）", len(secrets - {None}), 1)
rw = row(o)
customers.append(rw["cus"])
_, lst = stripe("GET", "/setup_intents", {"customer": rw["cus"], "limit": 10})
check("この予約の Customer の SetupIntent は Stripe でも 1つ", len(lst["data"]), 1)
check("開始の記録（card_started）は 1件", sql(f"select count(*) from b2c_order_events where order_id='{rw['id']}' and event='card_started'"), "1")
code, r = start(o)
check("後からもう一度押しても同じ SetupIntent", r.get("clientSecret", "").split("_secret_")[0], rw["si"])

# ---------------------------------------------------------------------------
print("06 通信の切断（画面が結果を受け取れない）→ Webhook で確定・重複・順序の逆転")
o = new_order(TOKYO, KYOTO, D("2026-11-10"), D("2026-11-14"))
start(o)
rw = row(o)
customers.append(rw["cus"])
confirm_si(rw["si"], "pm_card_visa")  # 画面はここで切断した想定（照合を呼ばない）
check("切断の直後の DB はまだ registering（画面の報告が無い）", row(o)["card"], "registering")
_, si_obj = stripe("GET", f"/setup_intents/{rw['si']}")
body = event("evt_e2e_" + rw["id"][:8] + "_ok", "setup_intent.succeeded", si_obj)
code, r = post("/api/b2c/stripe/webhook", None, signed(WH_B2C, body), raw=body.encode())
check("署名つきの Webhook（succeeded）→ 200", code, 200)
check("Webhook だけで confirmed・shipments 1行", (row(o)["status"], row(o)["shipments"]), ("confirmed", 1))
code, r = post("/api/b2c/stripe/webhook", None, signed(WH_B2C, body), raw=body.encode())
check("同じ通知の再送は重複として何もしない", (code, r.get("duplicate")), (200, True))
stale = dict(si_obj, status="requires_payment_method", last_setup_error={"code": "card_declined"})
body2 = event("evt_e2e_" + rw["id"][:8] + "_late", "setup_intent.setup_failed", stale)
code, r = post("/api/b2c/stripe/webhook", None, signed(WH_B2C, body2), raw=body2.encode())
check("古い失敗の通知が後から届いても（順序の逆転）registered・confirmed のまま", (code, row(o)["card"], row(o)["status"]), (200, "registered", "confirmed"))
check("通知の記録: 2件・処理済み 2件", sql(f"select count(*), count(processed_at) from b2c_stripe_events where object_id='{rw['si']}'"), "2|2")
code, _ = post("/api/b2c/stripe/webhook", None, {"Stripe-Signature": "t=1,v1=deadbeef"}, raw=body.encode())
check("署名が違う通知は 400", code, 400)
code, r = status(o)
check("画面が後から再接続して照合しても同じ（shipments 1行）", (r["view"]["status"], row(o)["shipments"]), ("confirmed", 1))
fake = dict(si_obj, metadata={})
body3 = event("evt_e2e_b2b_like", "setup_intent.succeeded", fake)
code, r = post("/api/b2c/stripe/webhook", None, signed(WH_B2C, body3), raw=body3.encode())
check("B2C の印が無い SetupIntent（B2B の代理店のもの）は無視", (code, r.get("ignored")), (200, "not_b2c"))

# ---------------------------------------------------------------------------
print("07 通信の切断（Webhook も届かない）→ 画面の開き直しの照合で確定")
o = new_order(TOKYO, KYOTO, D("2026-11-11"), D("2026-11-15"), stay={"origin": {"checkIn": D("2026-11-10"), "checkOut": D("2026-11-12")}, "dest": {"checkIn": D("2026-11-12"), "checkOut": D("2026-11-16")}})
start(o)
rw = row(o)
customers.append(rw["cus"])
confirm_si(rw["si"], "pm_card_jcb")
code, r = status(o)
check("開き直しの照合で confirmed（JCB）", (r["view"]["status"], r["view"].get("card", {}).get("brand")), ("confirmed", "jcb"))

# ---------------------------------------------------------------------------
print("08 サーバーでの再検証（開始の時に計算し直す）")
o = new_order(TOKYO, KYOTO, D("2026-11-10"), D("2026-11-12"))
oid = row(o)["id"]
sql(f"alter table b2c_orders disable trigger user; update b2c_orders set unit_net_yen=100, subtotal_net_yen=100, tax_yen=10, total_gross_yen=110 where id='{oid}'; alter table b2c_orders enable trigger user;")
code, r = start(o)
check("保存された料金が今の計算と違えば開始しない（quote_changed）", (code, r.get("error")), (422, "quote_changed"))
check("Stripe の Customer・SetupIntent は作らない", (row(o)["cus"], row(o)["si"], row(o)["status"]), ("", "", "draft"))
o = new_order(TOKYO, KYOTO, D("2026-11-10"), D("2026-11-12"))
code, r = post("/api/b2c/card/start", {**o, "cardConsent": False})
check("カード登録と集荷後の請求への同意が無ければ開始しない", (code, r.get("error")), (422, "card_consent_required"))
code, r = start({**o, "accessToken": "x" * 32})
check("秘密の token が違えば 404（他人の予約は触れない）", code, 404)
sql("insert into b2c_ops_days(date, max_new_bookings, max_pieces) values ('" + D("2026-11-12") + "', 1, 19) on conflict (date) do update set max_new_bookings=1, max_pieces=19, closed=false")
stay12 = {"origin": {"checkIn": D("2026-11-11"), "checkOut": D("2026-11-13")}, "dest": {"checkIn": D("2026-11-13"), "checkOut": D("2026-11-16")}}
a = new_order(TOKYO, KYOTO, D("2026-11-12"), D("2026-11-14"), stay=stay12)
b = new_order(TOKYO, KYOTO, D("2026-11-12"), D("2026-11-15"), stay=stay12)
ca, ra = start(a)
cb, rb = start(b)
customers.append(row(a)["cus"])
check("受付の上限（1件）: 1件目は開始、2件目は「この日程は受けられない」", (ca, cb, rb.get("error")), (200, 422, "date_not_available"))
sql("insert into b2c_ops_days(date, max_new_bookings, max_pieces) values ('" + D("2026-11-13") + "', 1, 19) on conflict (date) do update set max_new_bookings=1, max_pieces=19, closed=false")
stay13 = {"origin": {"checkIn": D("2026-11-12"), "checkOut": D("2026-11-14")}, "dest": {"checkIn": D("2026-11-14"), "checkOut": D("2026-11-17")}}
pair = [new_order(TOKYO, KYOTO, D("2026-11-13"), D("2026-11-15"), stay=stay13), new_order(TOKYO, KYOTO, D("2026-11-13"), D("2026-11-16"), stay=stay13)]
with cf.ThreadPoolExecutor(2) as ex:
    rs = list(ex.map(start, pair))
codes = sorted(c for c, _ in rs)
errs = [r.get("error") for c, r in rs if c != 200]
check("最後の 1枠に 2件が同時: 1件だけ開始、もう 1件は DB の上限で止まる", (codes, errs[0] in ("capacity_full", "date_not_available") if errs else None), ([200, 422], True))
check("2026-11-13 の枠を使っている予約は 1件だけ", sql("select count(*) from b2c_orders where pickup_date='" + D("2026-11-13") + "' and status='card_pending'"), "1")
customers += [row(x)["cus"] for x in pair]

# ---------------------------------------------------------------------------
print("09 カードの入力を始めて放置 → 30分後に枠を返す（Stripe の SetupIntent を先に取り消す）")
oid = row(O4)["id"]
sql(f"alter table b2c_orders disable trigger user; update b2c_orders set updated_at = now() - interval '31 minutes' where id='{oid}'; alter table b2c_orders enable trigger user;")
o = new_order(TOKYO, KYOTO, D("2026-11-11"), D("2026-11-13"))
start(o)  # 開始のついでに期限切れを片付ける
customers.append(row(o)["cus"])
rw = row(O4)
check("放置された予約は cancelled（card_timeout）", (rw["status"], sql(f"select cancel_reason from b2c_orders where id='{oid}'")), ("cancelled", "card_timeout"))
_, si = stripe("GET", f"/setup_intents/{rw['si']}")
check("Stripe の SetupIntent も canceled", si["status"], "canceled")
code, r = status(O4)
check("画面の照合は cancelled を返す（もう一度予約の案内）", r["view"]["status"], "cancelled")

# ---------------------------------------------------------------------------
print("10 予約の時に請求・オーソリを作っていない")
total_pi = 0
for c in [x for x in customers if x]:
    _, lst = stripe("GET", "/payment_intents", {"customer": c, "limit": 10})
    total_pi += len(lst["data"])
check(f"この試験の Customer（{len([x for x in customers if x])}件）の PaymentIntent は 0件", total_pi, 0)
check("DB の b2c_payments は 0行", sql("select count(*) from b2c_payments"), "0")
check("B2C の shipments に課金の記録は無い", sql("select count(*) from shipments where channel='b2c' and (charged_at is not null or stripe_payment_intent_id is not null)"), "0")
# カードの番号・CVC の漏えい（2026-11-07）: 以前は行全体の文字列で '…|cvc' を探し、Stripe の ID（seti_…）に偶然 cvc が
# 含まれると誤って反応した。保存先の行・API の応答・（あれば）開発サーバーのログを、構造を見て調べる（scripts/test-b2c/card_leak.py）
LEAK_TABLES = ["b2c_orders", "b2c_payments", "b2c_order_events", "b2c_outbox", "b2c_stripe_events", "b2c_refunds", "b2c_hotel_acceptances"]
db_leaks = []
for t in LEAK_TABLES:
    rows = sql(f"select coalesce(json_agg(row_to_json(x)), '[]') from {t} x")
    db_leaks += find_card_leaks(json.loads(rows or "[]"), t)
db_leaks += find_card_leaks(json.loads(sql("select coalesce(json_agg(row_to_json(s)), '[]') from shipments s where channel='b2c'") or "[]"), "shipments(b2c)")
check("DB（B2C の表・B2C の区間）にカードの番号・CVC は無い", db_leaks, [])
check("API の応答にカードの番号・CVC は無い", find_card_leaks(API_RESPONSES, "api"), [])
server_log = os.environ.get("B2C_DEV_SERVER_LOG", "")
if server_log and os.path.exists(server_log):
    with open(server_log, encoding="utf-8", errors="replace") as fh:
        check("開発サーバーのログにカードの番号・CVC は無い", find_card_leaks(fh.read().splitlines(), "log"), [])
else:
    print("  --  B2C_DEV_SERVER_LOG が無いのでログの検査は省略")

# ---------------------------------------------------------------------------
print("11 B2B の Webhook は B2C の SetupIntent の通知で何もしない")
if WH_B2B:
    before = sql("select count(*), count(charged_at), count(payment_failed_at) from shipments")
    body4 = event("evt_e2e_to_b2b", "setup_intent.succeeded", si_obj)
    code, r = post("/api/stripe/webhook", None, signed(WH_B2B, body4), raw=body4.encode())
    check("B2B の受信口: 200（対象外として無視）", (code, r.get("received")), (200, True))
    check("shipments は変わらない", sql("select count(*), count(charged_at), count(payment_failed_at) from shipments"), before)
else:
    print("  --  STRIPE_WEBHOOK_SECRET が無いので省略")

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
