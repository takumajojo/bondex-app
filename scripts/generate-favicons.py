#!/usr/bin/env python3
"""
BondEx ファビコン生成: public/bondex-logo.png (筆記体ワードマーク) から
頭文字「Ƃ」モノグラムを切り出してアイコン一式を生成する。

- 筆記体で文字が連結しているため x=320 (Ƃ と o の間の谷) で切り出し、
  右へ続く上部アーム / 下線ストロークは右端 40px をアルファフェードで処理
- 出力:
    public/icon-light-32x32.png  (透過背景 + 赤)   ライトモード用
    public/icon-dark-32x32.png   (透過背景 + 白)   ダークモード用
    public/apple-icon.png        (白背景 + 赤 180px)
    public/favicon.ico           (16/32/48 マルチサイズ)

実行: pip3 install pillow && python3 scripts/generate-favicons.py
"""

from PIL import Image
import os

ROOT = os.path.join(os.path.dirname(__file__), "..")
PUB = os.path.join(ROOT, "public")

img = Image.open(os.path.join(PUB, "bondex-logo.png")).convert("RGBA")

crop = img.crop((0, 0, 320, 254))
w, h = crop.size
px = crop.load()
FADE = 40
for x in range(w - FADE, w):
    k = (w - x) / FADE
    for y in range(h):
        r, g, b, a = px[x, y]
        px[x, y] = (r, g, b, int(a * k))

bbox = crop.split()[3].getbbox()
crop = crop.crop(bbox)


def make_icon(size, bg, letter_color=None, pad_ratio=0.12):
    canvas = Image.new("RGBA", (size, size), bg)
    g = crop.copy()
    if letter_color:
        solid = Image.new("RGBA", g.size, letter_color)
        solid.putalpha(g.split()[3])
        g = solid
    avail = int(size * (1 - pad_ratio * 2))
    ratio = min(avail / g.width, avail / g.height)
    g = g.resize((max(1, int(g.width * ratio)), max(1, int(g.height * ratio))), Image.LANCZOS)
    canvas.alpha_composite(g, ((size - g.width) // 2, (size - g.height) // 2))
    return canvas


make_icon(32, (0, 0, 0, 0)).save(os.path.join(PUB, "icon-light-32x32.png"))
make_icon(32, (0, 0, 0, 0), letter_color=(255, 255, 255, 255)).save(
    os.path.join(PUB, "icon-dark-32x32.png")
)
make_icon(180, (255, 255, 255, 255)).convert("RGB").save(os.path.join(PUB, "apple-icon.png"))
# ICO はレガシークライアント / 直接 /favicon.ico を叩くクローラー用
base = make_icon(48, (255, 255, 255, 255)).convert("RGB")
base.save(os.path.join(PUB, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
print("favicons written")
