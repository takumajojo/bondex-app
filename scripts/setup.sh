#!/usr/bin/env bash
# ============================================================
# BondEx 別 PC セットアップスクリプト
# 使い方:
#   git clone https://github.com/takumajojo/bondex-app.git
#   cd bondex-app
#   bash scripts/setup.sh
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."
echo "▶ BondEx セットアップ開始 (`pwd`)"

# --- 1. Node バージョン確認 (Next.js 16 は Node 20+ 推奨) ---
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
  echo "  Node: $(node -v)"
  if [ "$NODE_MAJOR" -lt 20 ]; then
    echo "  ⚠ Node 20 以上を推奨します (現在 v$NODE_MAJOR)。nodejs.org から更新してください。"
  fi
else
  echo "  ✗ Node が見つかりません。https://nodejs.org から Node 20+ を入れてください。"
  exit 1
fi

# --- 2. 依存インストール (postinstall で patch-package も自動適用) ---
echo "▶ npm install (patch-package の textkit パッチも自動適用されます)"
npm install

# --- 3. 環境変数 ---
if [ -f .env.local ]; then
  echo "▶ .env.local は既にあります (スキップ)"
else
  echo "▶ .env.local がありません。値の取得方法:"
  echo ""
  echo "  【推奨】Vercel から一括取得 (実値をコピペせず安全):"
  echo "     npm i -g vercel && vercel login && vercel link"
  echo "     vercel env pull .env.local"
  echo ""
  echo "  【手動】テンプレートから作って値を埋める:"
  echo "     cp .env.example .env.local"
  echo "     # 値は Vercel の Project Settings → Environment Variables を参照"
  echo ""
fi

# --- 4. フォントパッチの確認 (通常は不要。フォントを差し替えた時だけ再実行) ---
echo "▶ フォントは public/fonts に U+2009 パッチ済みでコミット済み (追加作業不要)"
echo "  もしフォントを差し替えた場合のみ: python3 scripts/patch-fonts-thinspace.py"

echo ""
echo "✅ セットアップ完了。開発サーバー起動:"
echo "     npm run dev      # http://localhost:3000"
echo "   本番ビルド確認:"
echo "     npm run build"
