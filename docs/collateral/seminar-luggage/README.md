# BondEx 講演スライド「日本旅行から『自分で荷物を運ぶ』という習慣をなくす。」

観光・免税・商業施設関係者向け 15分講演（全8枚・16:9）。PoC刷新トラックではなく、営業・広報資料（collateral）の追加。

## 現在の状態

| 納品物 | ファイル | 状態 |
|---|---|---|
| 登壇用PDF | `out/BondEx_Seminar_Final.pdf` | 完成（16:9・8枚） |
| 編集可能PPTX | `out/BondEx_Seminar_Final.pptx` | 完成（文字・図は編集可能、絵は「図の変更」で差し替え可能） |
| 絵なし版 | `out/BondEx_Seminar_TypeOnly.pdf / .pptx` | 完成。黒地に文字だけの予備版 |
| スピーカーノート | `out/BondEx_Seminar_Speaker_Notes.pdf` | 完成（A4・9ページ。表紙＝時間配分と登壇前の注意） |
| 写真ブリーフ | `PHOTO_BRIEF.md` | 実写に差し替える場合の構図・検索語・調達方法 |

### 絵について

スライド1・2・3・5・6・7・8の絵は **ChatGPT で生成した画像**（実写ではない。出典は `photos/CREDITS.md`）。プロンプトは `PROMPTS_ChatGPT.md`。スライド4は図、スライド6は数字の背景に薄く敷いている。

- 画像は 1672×941px のため、スライドでは 1.15 倍に拡大している（ビルドは 1.2 倍までを警告扱いにして Final を出力する）
- 以前の試作として `cg/render.py`（Blender による 3DCG）も残している。使っていない

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
