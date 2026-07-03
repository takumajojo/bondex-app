#!/usr/bin/env python3
"""
NotoSansJP に U+2009 (THIN SPACE) を「幅 0 の空グリフ」として追加するパッチ。

目的:
  react-pdf (@react-pdf/textkit) は単語内の改行点で必ず "-" を挿入するため、
  日本語が「お-預かり」のように壊れる。空白 (glue node) での改行には
  ハイフンが付かないので、lib/voucher-pdf.tsx の jb() が日本語文字間に
  U+2009 を挿入して「幅ゼロ・ハイフンなしの改行点」を作る。
  この仕組みには U+2009 のグリフがフォントに存在する必要がある
  (無いと豆腐になる) が、NotoSansJP には元々含まれていない。

セットで必要なもの:
  - patches/@react-pdf+textkit+6.3.0.patch
    (textkit の改行判定に U+2009 を空白として認識させる 1 行パッチ。
     patch-package + postinstall で自動適用される)
  - lib/voucher-pdf.tsx の jb() / Font.registerHyphenationCallback

実行方法 (フォントファイルを差し替えた場合は必ず再実行):
  pip3 install fonttools
  python3 scripts/patch-fonts-thinspace.py
"""

from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph
import os

FONT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "fonts")
FONTS = [
    "NotoSansJP-Regular.ttf",
    "NotoSansJP-Medium.ttf",
    "NotoSansJP-Bold.ttf",
    # 中国語 (簡体字) — バウチャーのゲスト言語切り替え用
    "NotoSansSC-Regular.ttf",
    "NotoSansSC-Bold.ttf",
]

for name in FONTS:
    p = os.path.join(FONT_DIR, name)
    font = TTFont(p)
    gname = "uni2009"
    order = font.getGlyphOrder()
    if gname in order:
        print(name, "already patched")
        continue
    font.setGlyphOrder(order + [gname])
    g = Glyph()
    g.numberOfContours = 0
    g.data = b""  # 空グリフ (アウトラインなし)
    font["glyf"].glyphs[gname] = g
    font["hmtx"].metrics[gname] = (0, 0)  # advance 0 = 幅ゼロ
    if "vmtx" in font:
        font["vmtx"].metrics[gname] = font["vmtx"].metrics.get("space", (0, 0))
    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap[0x2009] = gname
    font["maxp"].numGlyphs = len(font.getGlyphOrder())
    font.save(p)
    print(name, "patched")

# 検証
for name in FONTS:
    p = os.path.join(FONT_DIR, name)
    font = TTFont(p)
    cmap = font.getBestCmap()
    ok = 0x2009 in cmap and font["hmtx"].metrics[cmap[0x2009]][0] == 0
    print(name, "U+2009 zero-width:", "OK" if ok else "MISSING")
