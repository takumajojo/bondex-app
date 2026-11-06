"""card_leak.py の試験（DB・Stripe・ネットワークなし）。
実行: python3 -I scripts/test-b2c/card_leak_test.py

1. 誤検知の再現: 3d48f52 の card_e2e で起きた形（Stripe の ID に偶然 "cvc" を含む）を、以前の検査が漏えいと判定し、新しい検査は判定しない
2. 検出の力を落としていない: カードの番号・CVC を、行・入れ子の JSON・JSON の文字列・ログの文・API の応答に入れると必ず見つかる
3. よくある無関係の値（末尾 4桁・問合番号・電話・時刻・UUID・金額・Stripe の ID）では反応しない
"""
import json
import os
import random
import string
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from card_leak import find_card_leaks, is_card_number, legacy_regex_hit  # noqa: E402

passed = failed = 0


def check(label, got, want):
    global passed, failed
    if got == want:
        passed += 1
        print(f"  ok  {label}")
    else:
        failed += 1
        print(f"  NG  {label} (expected {want!r}, got {got!r})")


def leaks(x):
    return find_card_leaks(x)


# 本物の行に近い形（b2c_orders の row_to_json に相当）。カードの情報は Stripe の ID・末尾 4桁だけ
def order_row(**extra):
    row = {
        "id": "3f9c1e2a-4b7d-4e8f-9a01-23456789abcd",
        "order_number": "HNK-20261107-0001",
        "status": "awaiting_hotel_confirmation",
        "stripe_customer_id": "cus_TQx7aB3kLmN9pQ",
        "stripe_setup_intent_id": "seti_1SQb2XLkCvc8RtYzQw3eRtYu",
        "stripe_payment_method_id": "pm_1SQb2YLk7Hj2KlMnOp4QrStU",
        "card_brand": "visa",
        "card_last4": "4242",
        "card_exp_month": 12,
        "card_exp_year": 2034,
        "guest_phone": "+81 90-1234-5678",
        "pieces": 2,
        "amount_yen": 9960,
        "created_at": "2026-11-07T00:36:52.123+00:00",
        "tracking_number": "500020965102",
        "meta": {"checks": {"cvc_check": "pass", "address_line1_check": None}, "number_of_bags": 2},
    }
    row.update(extra)
    return row


print("1 誤検知の再現（以前の検査は反応・新しい検査は反応しない）")
row = order_row()
text = json.dumps(row)
check("以前の検査: seti_…Cvc… ではないが、小文字の cvc を含む ID で反応する（再現のための確認）",
      legacy_regex_hit(json.dumps(order_row(stripe_setup_intent_id="seti_1SQb2XLkcvc8RtYzQw3eRtYu"))), True)
check("新しい検査: 同じ行で漏えいなし", leaks(order_row(stripe_setup_intent_id="seti_1SQb2XLkcvc8RtYzQw3eRtYu")), [])
check("新しい検査: cvc_check: pass（Stripe の検査の結果）は漏えいではない", leaks(row), [])
check("以前の検査: cvc_check のキーでも反応していた", legacy_regex_hit(text), True)

# でたらめな Stripe の ID を大量に作り、"cvc" を含むものでも反応しないこと
rnd = random.Random(20261107)
alphabet = string.ascii_letters + string.digits
fp_legacy = fp_new = 0
for i in range(20000):
    body = "".join(rnd.choice(alphabet) for _ in range(24))
    if i % 50 == 0:
        k = rnd.randrange(0, 21)
        body = body[:k] + "cvc" + body[k + 3:]
    r = order_row(stripe_setup_intent_id="seti_" + body, stripe_payment_method_id="pm_" + body[::-1], meta={})
    if legacy_regex_hit(json.dumps(r).replace("cvc_check", "")):
        fp_legacy += 1
    if leaks(r):
        fp_new += 1
check("でたらめな ID 2万件: 以前の検査は「cvc」を含む ID に反応した（400件以上）", fp_legacy >= 400, True)
check("でたらめな ID 2万件: 新しい検査の誤検知は 0件", fp_new, 0)

print("2 カードの番号・CVC は必ず見つける（負の試験）")
cases = {
    "列にそのままの番号": order_row(note="4242424242424242"),
    "空白区切りの番号": order_row(note="4242 4242 4242 4242"),
    "ハイフン区切りの番号": order_row(note="4242-4242-4242-4242"),
    "3D セキュアの試験のカード（4000 0027 6000 3184）": order_row(note="4000002760003184"),
    "Mastercard の試験のカード": order_row(note="5555555555554444"),
    "Mastercard の 2系": order_row(note="2223003122003222"),
    "American Express（15桁）": order_row(note="378282246310005"),
    "JCB の試験のカード": order_row(note="3566002020360505"),
    "Diners（14桁）": order_row(note="36227206271667"),
    "UnionPay の試験のカード": order_row(note="6200000000000005"),
    "文の中の番号（ログ）": "charge failed for card 4242424242424242 exp 12/34",
    "数値の型の番号": order_row(pan_num=4242424242424242),
    "入れ子の JSON の card.number": order_row(meta={"card": {"number": "4242424242424242", "exp_month": 12}}),
    "JSON の文字列の中の番号（記録の本文）": order_row(payload=json.dumps({"card": {"number": "4000056655665556"}})),
    "キーが cvc で値が 3桁": order_row(meta={"card": {"cvc": "123"}}),
    "キーが CVV（大文字）で値が 4桁": order_row(meta={"CVV": "1234"}),
    "キーが cvc で値が数値": order_row(meta={"cvc": 314}),
    "JSON の文字列の中の cvc": order_row(payload=json.dumps({"payment_method_data": {"card": {"cvc": "999"}}})),
    "ログの文の中の cvc: 123": "debug body cvc: 123 sent",
    "ログの文の中の cvv=1234": "params: cvv=1234&x=1",
    "API の応答の配列の中": {"view": {"cards": [{"brand": "visa", "card_number": "4242424242424242"}]}},
    "キーの名前に番号": {"4242424242424242": True},
}
for label, value in cases.items():
    check(f"見つける: {label}", len(leaks(value)) > 0, True)

print("3 無関係の値には反応しない")
benign = {
    "末尾 4桁だけ": {"card_last4": "4242"},
    "問合番号（12桁）": {"tracking": "500020965102"},
    "電話番号": {"phone": "+81 90-1234-5678", "phone2": "0570011722"},
    "時刻（ミリ秒・13桁）": {"t": 1793980451911, "ts": "1793980451911"},
    "UUID（数字だけの部分を含む）": {"id": "12345678-1234-4567-8901-234567890123", "id2": "a1b2c3d4-4242-4242-4242-424242424242"},
    "金額・個数": {"amount": 9960, "pieces": 2},
    "Luhn を通らない 16桁": {"x": "4242424242424241"},
    "カードの会社の番号の頭に当たらない 16桁": {"x": "9999999999999995"},
    "cvc_check・cvc_status（Stripe の検査の結果）": {"checks": {"cvc_check": "unavailable"}, "cvc_status": "ok"},
    "number が予約番号": {"number": "HNK-20261107-0001", "order_number": 42},
    "文の中の cvc という語だけ": "cvc check passed for seti_1Qcvc",
}
for label, value in benign.items():
    check(f"反応しない: {label}", leaks(value), [])

check("is_card_number: 4242424242424242", is_card_number("4242424242424242"), True)
check("is_card_number: 末尾が違う", is_card_number("4242424242424243"), False)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
