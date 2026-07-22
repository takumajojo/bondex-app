#!/usr/bin/env python3
"""
BondEx ファビコン生成: BondEx レッドの角丸スクエア + 白の太字「B」。

以前は筆記体ワードマークから頭文字を切り出していたが、16-32px で潰れて
汎用ロゴ (v0 風) に見えたため、視認性の高いモノグラムに刷新。

- 出力:
    public/icon-light-32x32.png  (角丸赤 + 白B・透過角)   タブ用
    public/icon-dark-32x32.png   (同上・ダークタブでも視認可)
    public/apple-icon.png        (赤 + 白B 180px)          iOS ホーム画面
    public/favicon.ico           (16/32/48 マルチサイズ)   レガシー / クローラー用

実行: pip3 install pillow && python3 scripts/generate-favicons.py
"""

from PIL import Image, ImageDraw, ImageFont
import os

ROOT = os.path.join(os.path.dirname(__file__), "..")
PUB = os.path.join(ROOT, "public")
FONT = os.path.join(PUB, "fonts", "NotoSansJP-Bold.ttf")

RED = (200, 16, 46, 255)      # #c8102e — BondEx ブランドレッド
WHITE = (255, 255, 255, 255)


def make_icon(size: int) -> Image.Image:
    # 高解像度で描いて縮小 (アンチエイリアス)
    scale = 8
    S = size * scale
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    radius = int(S * 0.22)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=RED)

    # 白の「B」を中央に。フォントサイズはキャンバス比で決める。
    fnt = ImageFont.truetype(FONT, int(S * 0.72))
    l, t, r, b = d.textbbox((0, 0), "B", font=fnt)
    x = (S - (r - l)) / 2 - l
    y = (S - (b - t)) / 2 - t
    d.text((x, y), "B", font=fnt, fill=WHITE)

    return canvas.resize((size, size), Image.LANCZOS)


# タブ用 (赤地の塗りなのでライト/ダークどちらのタブでも視認できる)
icon32 = make_icon(32)
icon32.save(os.path.join(PUB, "icon-light-32x32.png"))
icon32.save(os.path.join(PUB, "icon-dark-32x32.png"))

# Apple touch icon (iOS が角丸マスクするので塗りのまま)
make_icon(180).convert("RGB").save(os.path.join(PUB, "apple-icon.png"))

# ICO はレガシークライアント / 直接 /favicon.ico を叩くクローラー用
make_icon(48).save(os.path.join(PUB, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])

print("generated: icon-light-32x32.png, icon-dark-32x32.png, apple-icon.png, favicon.ico")
