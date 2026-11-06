"""カードの番号・CVC が保存先・API の応答・ログに入っていないかを調べる（試験用・2026-11-07）。

以前の検査は、行全体を文字列にして '4242424242424242|"number"|cvc' を探していた。Stripe が作る ID（seti_…）は
英数字のでたらめな並びなので、偶然 "cvc" を含むと漏えいと誤って判定した（3d48f52 の card_e2e で 1回発生）。

ここでは中身の構造を見て判定する:
  1. カードの番号: 区切り（空白・ハイフン）を除いて 13〜19桁の数字の並びで、カードの会社の番号の頭（IIN）に当たり、
     Luhn の検査を通るもの。どの文字列の中にあっても見つける（ID・ログの文の中・JSON の文字列の中も）。
  2. CVC: JSON のキーの名前が cvc・cvv・cvc2・cvv2・card_cvc・security_code（大文字・小文字を問わない）で、
     値が 3〜4桁の数字のもの。キーの名前が card_number・pan・number で、値がカードの番号に当たるものも漏えいとする。
     文字列の中に JSON の文が入っている場合（記録の表の本文など）は、それも読んで同じく調べる。
     ログの文（JSON でない文字列）では「cvc: 123」「cvv=1234」の形を探す。
  3. Stripe の ID・ハッシュ・トークンの中の文字の並び（"cvc" など）は、キーの名前ではないので判定に使わない。
"""
import json
import re

# カードの会社ごとの番号の頭（IIN）と桁数。テストのカード（4242…・4000…・5555…・3782…など）を含む。
_BRANDS = [
    (re.compile(r"^4"), (13, 16, 19)),                                    # Visa
    (re.compile(r"^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))"), (16,)),       # Mastercard
    (re.compile(r"^3[47]"), (15,)),                                       # American Express
    (re.compile(r"^(6011|65|64[4-9]|622)"), (16, 17, 18, 19)),           # Discover・UnionPay の一部
    (re.compile(r"^35(2[89]|[3-8]\d)"), (16, 17, 18, 19)),                # JCB
    (re.compile(r"^3(0[0-5]|[68])"), (14, 16, 17, 18, 19)),               # Diners
    (re.compile(r"^62"), (16, 17, 18, 19)),                               # UnionPay
]
# 数字の並び（区切りの空白・ハイフンを 1文字まで許す）。前後が数字でないこと
_DIGIT_RUN = re.compile(r"(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)")
_CVC_KEYS = {"cvc", "cvv", "cvc2", "cvv2", "card_cvc", "security_code", "securitycode", "cvn"}
_PAN_KEYS = {"card_number", "cardnumber", "pan", "number"}
_CVC_VALUE = re.compile(r"^\d{3,4}$")
# ログの文の中の「cvc: 123」「"cvv":"1234"」「cvc=123」
_CVC_IN_TEXT = re.compile(r"(?i)(?<![a-z0-9_])(cvc2?|cvv2?|card_cvc|security_code)[\"']?\s*[:=]\s*[\"']?\d{3,4}(?!\d)")


def _luhn_ok(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = ord(ch) - 48
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def is_card_number(digits: str) -> bool:
    """区切りを除いた数字の並びが、カードの番号に当たるか（IIN・桁数・Luhn）。"""
    if not digits.isdigit():
        return False
    for prefix, lengths in _BRANDS:
        if len(digits) in lengths and prefix.match(digits):
            return _luhn_ok(digits)
    return False


def card_numbers_in_text(text: str):
    found = []
    for m in _DIGIT_RUN.finditer(text):
        raw = m.group(0)
        if "-" in raw:
            # UUID（8-4-4-4-12 の 16進数）の数字だけの部分を、ハイフン区切りのカードの番号と取り違えない
            before = text[m.start() - 1] if m.start() > 0 else ""
            after = text[m.end()] if m.end() < len(text) else ""
            if re.match(r"[A-Fa-f-]", before) or re.match(r"[A-Fa-f-]", after):
                continue
        digits = re.sub(r"[ -]", "", raw)
        if is_card_number(digits):
            found.append(digits[:4] + "…" + digits[-4:])
    return found


def _maybe_json(s: str):
    t = s.strip()
    if len(t) >= 2 and t[0] in "{[" and t[-1] in "}]":
        try:
            return json.loads(t)
        except ValueError:
            return None
    return None


def find_card_leaks(obj, where: str = "$", _depth: int = 0):
    """obj（JSON にできる値・行・API の応答・ログの文）の中の、カードの番号・CVC の漏えいの一覧を返す。空なら漏えいなし。"""
    leaks = []
    if _depth > 20:
        return leaks
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = str(k)
            path = f"{where}.{key}"
            kl = key.lower()
            if kl in _CVC_KEYS and v is not None and _CVC_VALUE.match(str(v).strip()):
                leaks.append(f"{path}: CVC の値")
            if kl in _PAN_KEYS and v is not None and is_card_number(re.sub(r"[ -]", "", str(v).strip())):
                leaks.append(f"{path}: カードの番号の項目")
            leaks.extend(find_card_leaks(v, path, _depth + 1))
            # キーの名前そのものにカードの番号が入っている場合
            for n in card_numbers_in_text(key):
                leaks.append(f"{where}[キー]: カードの番号 {n}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            leaks.extend(find_card_leaks(v, f"{where}[{i}]", _depth + 1))
    elif isinstance(obj, str):
        for n in card_numbers_in_text(obj):
            leaks.append(f"{where}: カードの番号 {n}")
        inner = _maybe_json(obj)
        if inner is not None:
            # 文字列の中の JSON（記録の本文など）。番号は上で見たので、キーの検査のために中を読む（番号の重複は除く）
            leaks.extend(x for x in find_card_leaks(inner, where + "<json>", _depth + 1) if "カードの番号 " not in x)
        elif _CVC_IN_TEXT.search(obj):
            leaks.append(f"{where}: 文の中の CVC")
    elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
        s = str(int(obj)) if float(obj).is_integer() else ""
        if s and is_card_number(s):
            leaks.append(f"{where}: カードの番号（数値）")
    return leaks


def legacy_regex_hit(text: str) -> bool:
    """以前の検査（誤って反応した版）。比較の試験のためだけに残す。"""
    return re.search(r'4242424242424242|"number"|cvc', text) is not None
