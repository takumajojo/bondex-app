# BondEx 講演スライド「日本旅行から『自分で荷物を運ぶ』という習慣をなくす。」

観光・免税・商業施設関係者向け 15分講演（v2：表紙・自己紹介＋本編8枚＝全10ページ・16:9）。PoC刷新トラックではなく、営業・広報資料（collateral）の追加。

## 現在の状態

| 納品物 | ファイル | 状態 |
|---|---|---|
| 登壇用PDF（v2） | `out/BondEx_Seminar_Final_v2.pdf` | 完成（全10ページ：表紙／自己紹介／本編8枚） |
| 編集可能PPTX（v2） | `out/BondEx_Seminar_Final_v2.pptx` | 完成（文字・図は編集可能、絵は「図の変更」で差し替え可能） |
| 絵なし版（v2） | `out/BondEx_Seminar_TypeOnly_v2.pdf / .pptx` | 完成。黒地に文字だけの予備版 |
| スピーカーノート（v2） | `out/BondEx_Seminar_Speaker_Notes_v2.pdf` | 完成（A4・11ページ。1ページ目＝時間配分（累計）と登壇前の注意） |
| 旧版（v1） | `out/BondEx_Seminar_Final.pdf / .pptx`、`out/BondEx_Seminar_Speaker_Notes.pdf` | 自己紹介なしの版。参照用に残している |
| 写真ブリーフ | `PHOTO_BRIEF.md` | 実写に差し替える場合の構図・検索語・調達方法 |

### スライド構成（v2）

| # | スライド | 時間 |
|---|---|---|
| 1 | 表紙 | — |
| 2 | なぜ、広告会社が物流を始めたのか。（自己紹介・年表） | 50秒 |
| 3 | OVER TOURISM? OR “OVER LUGGAGE”? | 1分 |
| 4 | 人と荷物は、一緒に移動する必要があるのか？ | 1分30秒 |
| 5 | 「配送できる」だけでは、使われない。 | 2分 |
| 6 | 荷物を手放す場所を、旅の中に。（図） | 2分 |
| 7 | 「持ちたくない」が、購買を止めている。 | 2分 |
| 8 | 配送を伝えた結果、約50万円の購入へ。 | 1分30秒 |
| 9 | 「買う」と「持つ」を分離する。 | 2分 |
| 10 | 人は旅する。荷物は物流に任せる。 | 2分 |
| | 合計 | 14分50秒 |

写真ファイル名（`photos/s01.jpg` 〜 `s08.jpg`）は v1 の番号のまま。v2 のスライド番号は「ファイル番号＋2」（例：`s01.jpg` → スライド3）。

### 絵について

スライド3・4・5・7・8・9・10の絵は **ChatGPT で生成した画像**（実写ではない。出典は `photos/CREDITS.md`）。プロンプトは `PROMPTS_ChatGPT.md`。スライド6は図、スライド8は数字の背景に薄く敷いている。スライド2（自己紹介）は写真なし（本人写真がないため、架空の人物写真は使わない）。

- 画像は 1672×941px のため、スライドでは 1.15 倍に拡大している（ビルドは 1.2 倍までを警告扱いにして Final を出力する）
- 以前の試作として `cg/render.py`（Blender による 3DCG）も残している。使っていない

### 表紙

BondEx ロゴ（赤・`assets/bondex-logo-red.png`。スライド10右下も同じ）、講演タイトル「日本旅行から、『自分で荷物を運ぶ』をなくす。」、ブランドのタグライン「TRAVEL LIGHTER. TRAVEL FURTHER.」、登壇者（株式会社JOJO　代表取締役　谷口琢真）、公式サイト `https://bondex.express` の QR コード（`assets/qr-bondex-express.png`、誤り訂正レベル Q。PPTX では QR 画像にリンクも設定）。QR を作り直すときは `python3 -c "import segno; segno.make('https://bondex.express', error='q').save('assets/qr-bondex-express.png', scale=24, border=4, dark='#0A0A0A')"`。

## 実写の写真に差し替える手順

1. `PHOTO_BRIEF.md` に沿って写真を用意し、`photos/s01.jpg` … `photos/s08.jpg` を同じファイル名で上書きする（スライド4は図なので不要、スライド6は任意）。出典は `photos/CREDITS.md` に書く。
2. `./build.sh` を実行する。
3. 全スロットがそろい、解像度が足りていれば（トリミング後に拡大が不要なら）`out/BondEx_Seminar_Final.pdf / .pptx` が出力される。足りないものがあるとターミナルに一覧が出て、出力は `BondEx_Seminar_Draft.*` になる。
4. トリミング位置は `slides.json` の `focal`（例 `"50% 40%"`）で調整する。

PowerPoint 上で直接差し替える場合は、写真を右クリック →「図の変更」。文字はすべてテキストボックスなので、そのまま編集できる。

## 投影するPCに必要なフォント

PPTX を PowerPoint / Keynote で開くPCには、次の2書体（どちらも無料・OFL）をインストールしておく。入っていないと代替フォントで表示され、レイアウトが崩れる。PDFにはフォントが埋め込み済みなので不要。

- Noto Sans JP（Regular / Medium）— Google Fonts
- Inter（SemiBold）— Google Fonts

## デザインの決めごと

- 1枚＝1枚の絵＋1つのメッセージ。箇条書き・アイコン・ページ番号なし。例外としてスライド4だけは、BondExの役割を伝えるために写真ではなく図（人のルートと荷物のルートが分かれて合流する線）を使う。
- 黒 `#0A0A0A` と白が基調（docs/design-tokens.md のブランド色）。オレンジ `#F26A1B` はスライド1の “OVER LUGGAGE”、スライド4の荷物のルート、スライド6の数字だけ。※ design-tokens.md はアクセント色禁止だが、本講演では依頼に従い、この3か所に限定して使用。
- 見出し：Noto Sans JP Medium 92〜108px（約46〜54pt）、英語は Inter SemiBold 150px。左端 128px・上下 116px の余白。
- 行頭の「」は半角ぶん左にぶら下げて、文字の縦ラインをそろえる。
- 写真の上には黒のグラデーション（`scrim`）を敷き、白文字のコントラストを確保する。写真内に文字は焼き込まない。

## 仕組み

- `slides.json`：スライドの文言・レイアウト・写真スロット・写真ブリーフ
- `notes.json`：講演原稿（スピーカーノートPDFと PPTX の発表者ノートの両方に使う）
- `cg/render.py` / `cg/finish.sh`：3DCG の絵を作り、`photos/` に書き出す
- `build.mjs`：HTML を Chromium で描画して PDF / PNG を出力。文字の位置を計測して `build/*/manifest.json` に書く
- `build_pptx.py`：manifest を読み、同じ位置に編集可能なテキストボックスと差し替え可能な写真を配置
- `notes.mjs`：スピーカーノート PDF

`build/` は生成物（コミットしない）。
