#!/bin/sh
# BondEx 講演スライド一式をビルドする（写真版 / タイポグラフィ版 / スピーカーノート）
# 前提: Noto Sans JP（Regular/Medium）と Inter（SemiBold）がインストール済み、Chromium(Playwright)・python-pptx・ImageMagick
set -e
cd "$(dirname "$0")"
node build.mjs
python3 build_pptx.py
node build.mjs --type
python3 build_pptx.py --type
node notes.mjs
