"""B2C の試験の日付を実際の今日から見て有効な日に動かす（2026-11-06 監査・決まりは scripts/test-b2c/dates/test-dates.ts）。
B2C_TEST_DATE_SHIFT_DAYS が無ければ test-dates.ts に計算させる（祝日の一覧を 1か所に保つため）。"""
import datetime, os, subprocess

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def _shift():
    v = os.environ.get("B2C_TEST_DATE_SHIFT_DAYS")
    env = dict(os.environ)
    out = subprocess.run(["npx", "tsx", "scripts/test-b2c/dates/test-dates.ts"], cwd=_ROOT, env=env, capture_output=True, text=True, check=True).stdout.strip().splitlines()[-1]
    if v not in (None, "") and int(v) != int(out):
        raise SystemExit("B2C_TEST_DATE_SHIFT_DAYS が test-dates.ts の判定と合いません")
    return int(out)


SHIFT_DAYS = _shift()


def D(ymd):
    return (datetime.date.fromisoformat(ymd) + datetime.timedelta(days=SHIFT_DAYS)).isoformat()


def T(iso):
    t = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")) + datetime.timedelta(days=SHIFT_DAYS)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")
