#!/usr/bin/env python3
"""Vercel の Preview と本番の分離の点検 (読むだけ・2026-11-07)。秘密の値は読まない・出さない。

  実行: python3 -I scripts/ops/vercel-preview-audit.py --since 2026-11-07T15:00:00+09:00 [--vercel <vercel CLI のパス>]
        (--since = Preview の環境変数を staging に替えた時刻。これより前に作られた Preview は、古い本番の鍵を持っている)
  リンク済みのディレクトリ (.vercel/project.json があるところ) で実行する。

確かめること:
  1. 環境変数の名前と設定先 (vercel env ls)。Preview に本番だけの鍵の名前が残っていないか・Preview に要る名前がそろっているか。
     値は見ない (CLI も値を出さない)。値が staging のものかは、新しい Preview の起動 (lib/env-guard.ts) で確かめる
  2. デプロイの一覧 (vercel ls をすべてのページ)。--since より前の Preview で、まだ READY のもの = 削除の対象
  3. 終わりの判定: 1 と 2 の両方が 0件なら「古い Preview は残っていない」
削除・設定の変更はしない (谷口さんの承認の後に、谷口さんが Vercel で行う)。
"""
import argparse
import datetime as dt
import json
import os
import subprocess
import sys

# Preview に置いてはいけない名前 (本番の鍵・外への実際の処理のスイッチ。lib/env-guard.ts の staging の条件と同じ)
FORBIDDEN_IN_PREVIEW = [
    "RESEND_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "GOOGLE_DRIVE_SA_KEY", "SHIPANDCO_API_KEY", "SHIPANDCO_LIVE",
    "STRIPE_CHARGE_LIVE", "AUTO_ISSUE_ENABLED", "BIZLOGI_BASE_URL", "BIZLOGI_CUSTOMER_ID", "BIZLOGI_LOGIN_PASSWORD", "BIZLOGI_LIVE",
    "SLACK_WEBHOOK_URL", "WHATSAPP_CLOUD_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "LINE_CHANNEL_ACCESS_TOKEN", "B2C_STRIPE_ALLOW_LIVE",
    "B2C_WHATSAPP_LIVE", "CRON_SECRET",
    # 秘密ではないが本番の設定の流用 (runbook 1-1)
    "SMTP_PORT", "GOOGLE_DRIVE_ROOT_ID", "ALERT_EMAIL",
]
# Preview に要る名前 (無いと新しい Preview は起動しない・lib/env-guard.ts previewEnvironmentViolations)
REQUIRED_IN_PREVIEW = [
    "BONDEX_ENV", "STAGING_SUPABASE_REF", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
    "STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "APP_BASE_URL", "MAIL_TEST_CAPTURE",
]
# 名前は同じでも、Preview と本番で値を別にするもの (名前だけでは確かめられない・目で確かめる)
MUST_DIFFER = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY",
               "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "OPERATOR_PASSWORD"]


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"失敗: {' '.join(cmd[:3])} …（終了コード {r.returncode}）。ログインとリンク (.vercel/project.json) を確かめてください")
    return r.stdout


def env_targets(vercel):
    """名前 → 設定先の集合。値の列は読まない。"""
    out = run([vercel, "env", "ls"])
    names = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 3 or not parts[0].isupper() and "_" not in parts[0]:
            continue
        name = parts[0]
        if not all(c.isupper() or c.isdigit() or c == "_" for c in name):
            continue
        targets = {t.strip(",") for t in parts[2:] if t.strip(",") in ("Production", "Preview", "Development")}
        if targets:
            names.setdefault(name, set()).update(targets)
    return names


def deployments(vercel):
    deps, nxt = [], None
    for _ in range(50):  # 1ページ 20件 × 50 = 1000件まで
        cmd = [vercel, "ls", "--format", "json"] + (["--next", str(nxt)] if nxt else [])
        d = json.loads(run(cmd))
        deps += d.get("deployments", [])
        nxt = (d.get("pagination") or {}).get("next")
        if not nxt:
            break
    return deps


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", required=True, help="Preview の環境変数を替えた時刻 (ISO 8601・タイムゾーンつき)")
    ap.add_argument("--vercel", default=os.environ.get("VERCEL_CLI", "vercel"))
    a = ap.parse_args()
    since = dt.datetime.fromisoformat(a.since)
    if since.tzinfo is None:
        sys.exit("--since にはタイムゾーンを付けてください (例 +09:00)")
    since_ms = int(since.timestamp() * 1000)

    names = env_targets(a.vercel)
    left = sorted(n for n in FORBIDDEN_IN_PREVIEW if "Preview" in names.get(n, set()))
    missing = sorted(n for n in REQUIRED_IN_PREVIEW if "Preview" not in names.get(n, set()))
    print("1. 環境変数 (名前だけ)")
    print(f"   Preview に残っている本番の鍵・スイッチの名前: {len(left)}件 {' '.join(left)}")
    print(f"   Preview に足りない名前 (無いと新しい Preview は起動しない): {len(missing)}件 {' '.join(missing)}")
    print(f"   値を本番と別にする名前 (目で確かめる): {' '.join(MUST_DIFFER)}")
    print("   (目で確かめる) Vercel の「Automatically expose System Environment Variables」が ON（本番の判定に要る・CLI では読めない）")

    deps = deployments(a.vercel)
    old = [d for d in deps if (d.get("target") or "preview") != "production" and d.get("state") == "READY" and int(d.get("createdAt", 0)) < since_ms]
    print(f"\n2. デプロイ: 全 {len(deps)}件・うち --since より前に作られ、まだ動く Preview: {len(old)}件 (削除の対象)")
    for d in sorted(old, key=lambda x: x.get("createdAt", 0)):
        ref = (d.get("meta") or {}).get("githubCommitRef", "-")
        made = dt.datetime.fromtimestamp(int(d["createdAt"]) / 1000, dt.timezone(dt.timedelta(hours=9))).strftime("%Y-%m-%d %H:%M JST")
        print(f"   {made}  {ref}  {d.get('url', '')}")

    ok = not left and not old
    print("\n3. 判定:", "古い Preview・本番の鍵は残っていない" if ok else "まだ残っている (上の一覧を削除・設定を替えてから、もう一度流す)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
