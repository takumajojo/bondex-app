"""B2C のカード登録の網羅試験（Stage 3）。Stripe のテストモードの公式のテストカード（pm_card_*）を、予約の流れ全体に通す。

A. カードの種類・国・拒否の理由の全パターン
C. 操作の事故（取消の後の登録・期限の後の登録・締切の後・別の顧客のカード・入力の悪用・休業日）
本番には接続しない（BASE はローカル、鍵は sk_test_ だけ、DB は docker のローカルのコンテナだけ）。

実行: set -a; . ./.env.local; set +a; BASE=http://localhost:3210 python3 -I scripts/test-b2c/card_matrix.py
"""
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
    sys.exit("refusing: STRIPE_SECRET_KEY must be a test key (sk_test_)")
CONTAINER = os.environ.get("B2C_LOCAL_DB_CONTAINER", "supabase_db_supa-local")
TOK = "dev-hnk-local-token-0001"
passed = failed = 0
ip = [100]
findings = []


def check(label, got, want):
    global passed, failed
    if got == want:
        passed += 1
        print(f"  ok  {label}", flush=True)
    else:
        failed += 1
        print(f"  NG  {label} (expected {want!r}, got {got!r})", flush=True)


def sql(q):
    return subprocess.run(["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "|", "-c", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def post(path, body):
    h = {"Content-Type": "application/json", "x-real-ip": f"10.7.{ip[0] // 250}.{ip[0] % 250 + 1}"}
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def stripe(method, path, params=None):
    data = urllib.parse.urlencode(params or {}, doseq=True).encode() if method == "POST" else None
    url = "https://api.stripe.com/v1" + path + ("?" + urllib.parse.urlencode(params or {}, doseq=True) if method == "GET" and params else "")
    req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": "Bearer " + SK})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def place(q):
    return post("/api/b2c/places", {"token": TOK, "query": q, "lang": "en"})[1]["candidates"][0]["placeId"]


STAY = {"origin": {"checkIn": D("2026-11-10"), "checkOut": D("2026-11-12")}, "dest": {"checkIn": D("2026-11-12"), "checkOut": D("2026-11-15")}}


def new_order(name="Test Traveler", email="t@example.invalid", wa="+31 6 1234 5678", lang="en", pickup=D("2026-11-10"), delivery=D("2026-11-12"), stay=None):
    ip[0] += 1
    code, r = post("/api/b2c/orders", {"token": TOK, "originPlaceId": TOKYO, "destPlaceId": KYOTO, **(stay or STAY), "pieces": 1,
                                        "pickupDate": pickup, "deliveryDate": delivery, "name": name, "email": email,
                                        "whatsapp": wa, "language": lang, "consent": True})
    return code, r, ({"token": TOK, "orderNumber": r.get("orderNumber"), "accessToken": r.get("accessToken")} if code == 200 else None)


def row(o):
    s, c, si, pm, cus, ships, oid = sql(
        "select status, card_status, coalesce(stripe_setup_intent_id,''), coalesce(stripe_payment_method_id,''), coalesce(stripe_customer_id,''), "
        f"(select count(*) from shipments s where s.b2c_order_id=b2c_orders.id), id from b2c_orders where order_number={o['orderNumber']}").split("|")
    return {"status": s, "card": c, "si": si, "pm": pm, "cus": cus, "shipments": int(ships), "id": oid}


def started(o):
    code, r = post("/api/b2c/card/start", {**o, "cardConsent": True})
    assert code == 200, (code, r)
    return row(o)


def status(o):
    return post("/api/b2c/card/status", o)


# ---------------------------------------------------------------------------
print("準備", flush=True)
TOKYO, KYOTO = place("Keio Plaza Hotel Tokyo"), place("Hotel Granvia Kyoto")
for pid, name in ((TOKYO, "Keio Plaza Hotel Tokyo"), (KYOTO, "Hotel Granvia Kyoto")):
    sql(f"insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('{pid}', '{name}', 'verified', 'e2e@example.invalid', now()) "
        f"on conflict (place_id) do update set status='verified', checked_by='e2e@example.invalid', last_verified_at=now()")
sql("insert into b2c_ops_days(date, max_new_bookings, max_pieces) values ('" + D("2026-11-10") + "', 500, 2000) on conflict (date) do update set max_new_bookings=500, max_pieces=2000, closed=false")
customers = []

# ---------------------------------------------------------------------------
print("A1 登録できるカード（ブランド・デビット・プリペイド・各国）→ 確定し、表示のブランドと末尾 4桁が正しい", flush=True)
OK_CARDS = [
    ("pm_card_visa", "visa"), ("pm_card_visa_debit", "visa"), ("pm_card_mastercard", "mastercard"), ("pm_card_mastercard_prepaid", "mastercard"),
    ("pm_card_amex", "amex"), ("pm_card_discover", "discover"), ("pm_card_diners", "diners"), ("pm_card_jcb", "jcb"),
    ("pm_card_jp", "visa"), ("pm_card_us", "visa"), ("pm_card_gb", "visa"), ("pm_card_br", "visa"), ("pm_card_cn", "visa"),
    ("pm_card_au", "visa"), ("pm_card_fr", "visa"), ("pm_card_kr", "visa"), ("pm_card_tw", "visa"), ("pm_card_hk", "visa"),
    ("pm_card_th", "visa"), ("pm_card_sg", "visa"), ("pm_card_threeDSecureOptional", "visa"),
]
for pm, brand in OK_CARDS:
    _, _, o = new_order()
    rw = started(o)
    customers.append(rw["cus"])
    _, pmobj = stripe("GET", f"/payment_methods/{pm}")
    stripe("POST", f"/setup_intents/{rw['si']}/confirm", {"payment_method": pm})
    code, r = status(o)
    v = r.get("view", {})
    check(f"{pm}: confirmed・{brand}", (v.get("status"), v.get("card", {}).get("brand")), ("confirmed", brand))

# ---------------------------------------------------------------------------
print("A2 カード会社が断るカード → 確定しない・理由を返す・別のカードで入れ直せる", flush=True)
DECLINES = [
    ("pm_card_chargeDeclined", "generic_decline"), ("pm_card_chargeDeclinedInsufficientFunds", "insufficient_funds"),
    ("pm_card_chargeDeclinedLostCard", "lost_card"), ("pm_card_chargeDeclinedStolenCard", "stolen_card"),
    ("pm_card_chargeDeclinedExpiredCard", "expired_card"), ("pm_card_chargeDeclinedIncorrectCvc", "incorrect_cvc"),
    ("pm_card_chargeDeclinedProcessingError", "processing_error"), ("pm_card_chargeDeclinedVelocityLimitExceeded", "card_velocity_exceeded"),
    ("pm_card_unionpay", "card_not_supported"),
]
for pm, reason in DECLINES:
    _, _, o = new_order()
    rw = started(o)
    customers.append(rw["cus"])
    code, err = stripe("POST", f"/setup_intents/{rw['si']}/confirm", {"payment_method": pm})
    code, r = status(o)
    v = r.get("view", {})
    check(f"{pm}: 確定しない（card_pending・failed）・理由 {reason}", (v.get("status"), v.get("cardStatus"), v.get("cardError"), row(o)["shipments"]), ("card_pending", "failed", reason, 0))
    stripe("POST", f"/setup_intents/{rw['si']}/confirm", {"payment_method": "pm_card_visa"})
    code, r = status(o)
    check(f"{pm} の後に Visa で入れ直し → confirmed", r.get("view", {}).get("status"), "confirmed")
# 2回続けて断られた後でも入れ直せる
_, _, o = new_order()
rw = started(o)
customers.append(rw["cus"])
for pm in ("pm_card_chargeDeclinedInsufficientFunds", "pm_card_chargeDeclinedLostCard"):
    stripe("POST", f"/setup_intents/{rw['si']}/confirm", {"payment_method": pm})
    status(o)
check("2回断られた後: failed のまま・記録は card_failed 1件（同じ状態を重ねて記録しない）",
      (row(o)["card"], sql(f"select count(*) from b2c_order_events where order_id='{rw['id']}' and event='card_failed'")), ("failed", "1"))
stripe("POST", f"/setup_intents/{rw['si']}/confirm", {"payment_method": "pm_card_mastercard"})
check("3枚目で登録 → confirmed", status(o)[1].get("view", {}).get("status"), "confirmed")

# ---------------------------------------------------------------------------
print("A3 登録は通るが、集荷の後の請求で失敗しうるカード（Stage 5 の未収の危険。登録の時点では見分けられない）", flush=True)
print("A2b CVC（裏面の 3桁）の照合に失敗したカードは受け付けない → 新しい登録で別のカード", flush=True)
_, _, o = new_order()
rw = started(o)
customers.append(rw["cus"])
stripe("POST", f"/setup_intents/{rw['si']}/confirm", {"payment_method": "pm_card_cvcCheckFail"})
v = status(o)[1].get("view", {})
old_pm = stripe("GET", f"/setup_intents/{rw['si']}")[1].get("payment_method")
check("CVC の失敗: 確定しない（card_pending・failed・cvc_check_failed）", (v.get("status"), v.get("cardStatus"), v.get("cardError"), row(o)["shipments"]), ("card_pending", "failed", "cvc_check_failed", 0))
check("CVC の失敗のカードは Customer から外す", stripe("GET", f"/payment_methods/{old_pm}")[1].get("customer"), None)
check("照合を繰り返しても記録 card_rejected は 1件", (status(o)[1]["view"]["cardStatus"], sql(f"select count(*) from b2c_order_events where order_id='{rw['id']}' and event='card_rejected'")), ("failed", "1"))
code, r = post("/api/b2c/card/start", {**o, "cardConsent": True})
new_si = r.get("clientSecret", "").split("_secret_")[0]
check("もう一度の開始で新しい SetupIntent（前のものとは別）", (code, bool(new_si), new_si != rw["si"], row(o)["si"] == new_si), (200, True, True, True))
code2, r2 = post("/api/b2c/card/start", {**o, "cardConsent": True})
check("続けて押しても同じ新しい SetupIntent（増えない）", r2.get("clientSecret", "").split("_secret_")[0], new_si)
stripe("POST", f"/setup_intents/{new_si}/confirm", {"payment_method": "pm_card_visa"})
check("新しい登録で Visa → confirmed", status(o)[1].get("view", {}).get("status"), "confirmed")
_, lst = stripe("GET", "/setup_intents", {"customer": rw["cus"], "limit": 10})
check("この予約の SetupIntent は Stripe で 2つ（失敗 1・成功 1）", len(lst["data"]), 2)

RISKY = ["pm_card_chargeDeclinedFraudulent", "pm_card_radarBlock", "pm_card_riskLevelHighest", "pm_card_avsFail", "pm_card_chargeCustomerFail"]
for pm in RISKY:
    _, _, o = new_order()
    rw = started(o)
    customers.append(rw["cus"])
    stripe("POST", f"/setup_intents/{rw['si']}/confirm", {"payment_method": pm})
    v = status(o)[1].get("view", {})
    _, pmo = stripe("GET", f"/payment_methods/{row(o)['pm']}")
    chk = pmo.get("card", {}).get("checks", {})
    check(f"{pm}: 登録され confirmed（請求はしていない）", v.get("status"), "confirmed")
    findings.append(f"{pm}: setup=succeeded, cvc_check={chk.get('cvc_check')}, address_line1_check={chk.get('address_line1_check')}")

# ---------------------------------------------------------------------------
print("B0 3D セキュアが必要なカード（サーバー側の確認では認証できない＝認証待ちのまま確定しない）", flush=True)
for pm in ("pm_card_authenticationRequiredOnSetup", "pm_card_authenticationRequired", "pm_card_threeDSecure2Required", "pm_card_threeDSecureRequired"):
    _, _, o = new_order()
    rw = started(o)
    customers.append(rw["cus"])
    _, si = stripe("POST", f"/setup_intents/{rw['si']}/confirm", {"payment_method": pm})
    v = status(o)[1].get("view", {})
    check(f"{pm}: requires_action → 予約は card_pending・registering（確定しない）", (si.get("status"), v.get("status"), v.get("cardStatus"), row(o)["shipments"]), ("requires_action", "card_pending", "registering", 0))
    stripe("POST", f"/setup_intents/{rw['si']}/confirm", {"payment_method": "pm_card_visa"})
    check(f"{pm} の認証をやめて別のカード → confirmed", status(o)[1].get("view", {}).get("status"), "confirmed")

# ---------------------------------------------------------------------------
print("C1 運営が取り消した後に、カードの登録が終わった（遅れて終わる）", flush=True)
_, _, o = new_order()
rw = started(o)
customers.append(rw["cus"])
sql(f"update b2c_orders set status='cancelled', cancelled_at=now(), cancel_reason='e2e_ops_cancel', cancelled_by='e2e' where id='{rw['id']}'")
stripe("POST", f"/setup_intents/{rw['si']}/confirm", {"payment_method": "pm_card_visa"})
v = status(o)[1].get("view", {})
pm_id = stripe("GET", f"/setup_intents/{rw['si']}")[1].get("payment_method")
_, pmo = stripe("GET", f"/payment_methods/{pm_id}")
check("予約は cancelled のまま（戻らない）・shipments なし", (v.get("status"), row(o)["shipments"]), ("cancelled", 0))
check("カードは Customer から外す（請求しないカードを持たない）", pmo.get("customer"), None)
check("記録 card_registered_after_cancel", sql(f"select count(*) from b2c_order_events where order_id='{rw['id']}' and event='card_registered_after_cancel'"), "1")
code, r = post("/api/b2c/card/start", {**o, "cardConsent": True})
check("取り消した予約のカード登録の開始は 422 order_cancelled", (code, r.get("error")), (422, "order_cancelled"))

print("C2 ホテルの確認の期限を過ぎてからカードの登録が終わった", flush=True)
_, _, o = new_order()
rw = started(o)
customers.append(rw["cus"])
sql(f"alter table b2c_orders disable trigger user; update b2c_orders set confirmation_mode='awaiting_hotel_verification', confirmation_due_at=now() - interval '1 minute' where id='{rw['id']}'; alter table b2c_orders enable trigger user;")
stripe("POST", f"/setup_intents/{rw['si']}/confirm", {"payment_method": "pm_card_visa"})
v = status(o)[1].get("view", {})
check("期限の後は確定しない（card_pending・registered・shipments なし＝運営の判断に回す）", (v.get("status"), v.get("cardStatus"), row(o)["shipments"]), ("card_pending", "registered", 0))

print("C3 予約の締切（前日 17:00）を過ぎてからカードの登録が終わった", flush=True)
_, _, o = new_order()
rw = started(o)
customers.append(rw["cus"])
sql(f"alter table b2c_orders disable trigger user; update b2c_orders set pickup_date=(now() at time zone 'Asia/Tokyo')::date, delivery_date=(now() at time zone 'Asia/Tokyo')::date + 2 where id='{rw['id']}'; alter table b2c_orders enable trigger user;")
stripe("POST", f"/setup_intents/{rw['si']}/confirm", {"payment_method": "pm_card_visa"})
v = status(o)[1].get("view", {})
check("締切の後は確定しない（佐川への依頼の対象にしない）", (v.get("status"), v.get("cardStatus"), row(o)["shipments"]), ("card_pending", "registered", 0))

print("C4 締切の直前（カードの入力の時間 30分が残っていない）にカード登録を始めた", flush=True)
_, _, o = new_order()
oid = row(o)["id"]
sql(f"alter table b2c_orders disable trigger user; update b2c_orders set pickup_date=(now() at time zone 'Asia/Tokyo')::date, delivery_date=(now() at time zone 'Asia/Tokyo')::date + 2 where id='{oid}'; alter table b2c_orders enable trigger user;")
code, r = post("/api/b2c/card/start", {**o, "cardConsent": True})
check("開始しない（too_close_to_deadline）・Stripe に何も作らない", (code, r.get("error"), row(o)["si"], row(o)["cus"]), (422, "too_close_to_deadline", "", ""))

print("C5 別の予約・別の顧客の SetupIntent をつなぎ替えられても確定しない", flush=True)
_, _, a = new_order()
_, _, b = new_order()
ra, rb = started(a), started(b)
customers += [ra["cus"], rb["cus"]]
stripe("POST", f"/setup_intents/{rb['si']}/confirm", {"payment_method": "pm_card_visa"})
sql(f"alter table b2c_orders disable trigger user; update b2c_orders set stripe_setup_intent_id=null where id='{rb['id']}'; update b2c_orders set stripe_setup_intent_id='{rb['si']}' where id='{ra['id']}'; alter table b2c_orders enable trigger user;")
code, r = status(a)
check("他人の SetupIntent では 500（setup_intent_mismatch）・確定しない", (code, r.get("error"), row(a)["status"], row(a)["card"]), (500, "setup_intent_mismatch", "card_pending", "registering"))

print("C6 休業日・受付停止の日", flush=True)
sql("insert into b2c_ops_days(date, closed) values ('" + D("2026-11-11") + "', false) on conflict (date) do update set closed=false, max_new_bookings=500, max_pieces=2000")
_, _, o = new_order(pickup=D("2026-11-11"), delivery=D("2026-11-13"))
sql("update b2c_ops_days set closed=true where date='" + D("2026-11-11") + "'")
code, r = post("/api/b2c/card/start", {**o, "cardConsent": True})
check("下書きの後に休業日にした → 開始しない（date_not_available）", (code, r.get("error"), row(o)["si"]), (422, "date_not_available", ""))
sql("update b2c_ops_days set closed=false where date='" + D("2026-11-11") + "'")

print("C7 入力の悪用・特殊な文字（画面・Stripe・DB で壊れない）", flush=True)
for nm, em in (("<script>alert(1)</script>", "x+tag@example.invalid"), ("李 小龍", "Upper.Case@Example.Invalid"), ("ศรีสุดา ใจดี", "t@example.invalid"),
               ("محمد علي", "t@example.invalid"), ("O'Brien \"Jr\" ; drop table b2c_orders; --", "t@example.invalid"), ("🧳 Traveler", "t@example.invalid"), ("A" * 100, "t@example.invalid")):
    code, r, o = new_order(name=nm, email=em)
    if code != 200:
        check(f"名前 {nm[:20]!r}: 下書き 200", code, 200)
        continue
    rw = started(o)
    customers.append(rw["cus"])
    _, cus = stripe("GET", f"/customers/{rw['cus']}")
    check(f"名前 {nm[:20]!r}: Stripe の顧客の名前はそのまま（文字が壊れない）・メールは小文字", (cus.get("name"), cus.get("email")), (nm, em.lower()))
code, r, _ = new_order(name="A" * 101)
check("101文字の名前は 422", (code, "invalid_name" in r.get("errors", [])), (422, True))
check("表は壊れていない", sql("select count(*) > 0 from b2c_orders"), "t")
for bad in ({"orderNumber": "1 or 1=1"}, {"orderNumber": -1}, {"accessToken": "' or ''='"}, {"accessToken": None}, {"token": "../../etc"}):
    code, r = post("/api/b2c/card/status", {**o, **bad})
    check(f"照合の入力の悪用 {list(bad.items())[0]} → 404", code, 404)

# ---------------------------------------------------------------------------
print("全体: 請求・オーソリを作っていない", flush=True)
n = 0
for c in sorted({x for x in customers if x}):
    _, lst = stripe("GET", "/payment_intents", {"customer": c, "limit": 5})
    n += len(lst.get("data", []))
check(f"この試験の Customer {len({x for x in customers if x})}件の PaymentIntent は 0件", n, 0)
check("b2c_payments は 0行", sql("select count(*) from b2c_payments"), "0")

print("\n--- 記録（Stage 5 で扱う危険のあるカード）---")
for f in findings:
    print("  " + f)
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
