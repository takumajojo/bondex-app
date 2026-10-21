# BondEx 講演スライド「日本旅行から『自分で荷物を運ぶ』という習慣をなくす。」

観光・免税・商業施設関係者向け 15分講演（全8枚・16:9）。PoC刷新トラックではなく、営業・広報資料（collateral）の追加。

## 現在の状態

| 納品物 | ファイル | 状態 |
|---|---|---|
| 登壇用PDF（写真版） | `out/BondEx_Seminar_Final.pdf` | **未完成**：写真7枚（6スライド分）が未配置。いまは `out/BondEx_Seminar_Draft.pdf`（写真枠を明示したドラフト） |
| 編集可能PPTX（写真版） | `out/BondEx_Seminar_Final.pptx` | **未完成**：同上。いまは `out/BondEx_Seminar_Draft.pptx` |
| 写真なし版（すぐ投影できる版） | `out/BondEx_Seminar_TypeOnly.pdf / .pptx` | 完成。黒地に大きな文字だけの版 |
| スピーカーノート | `out/BondEx_Seminar_Speaker_Notes.pdf` | 完成（A4・9ページ。表紙＝時間配分と登壇前の注意） |
| 写真ブリーフ | `PHOTO_BRIEF.md` | 完成（スロット別の構図・検索語・調達方法・AI生成プロンプト） |

写真が未完成の理由：この制作環境はネットワーク設定で写真サイト（Unsplash・Wikimedia 等）と画像生成サービスへの接続が遮断されており、Google Drive にも使える写真がなかったため。低品質な代わりの画像は作っていない。

## 写真を入れて完成させる手順

1. `PHOTO_BRIEF.md` に沿って写真を用意し、`photos/s01.jpg` … `photos/s08.jpg`（スライド2は `s02a.jpg` と `s02b.jpg`、スライド4は図なので不要、スライド6は任意）として置く。出典は `photos/CREDITS.md` に書く。
2. `./build.sh` を実行する。
3. 全写真がそろい、解像度が足りていれば（トリミング後に拡大が不要なら）`out/BondEx_Seminar_Final.pdf / .pptx` が出力される。足りないものがあるとターミナルに一覧が出て、出力は Draft のまま。
4. トリミング位置は `slides.json` の `focal`（例 `"50% 40%"`）で調整する。

PowerPoint 上で直接差し替える場合は、写真を右クリック →「図の変更」。文字はすべてテキストボックスなので、そのまま編集できる。

## 投影するPCに必要なフォント

PPTX を PowerPoint / Keynote で開くPCには、次の2書体（どちらも無料・OFL）をインストールしておく。入っていないと代替フォントで表示され、レイアウトが崩れる。PDFにはフォントが埋め込み済みなので不要。

- Noto Sans JP（Regular / Medium）— Google Fonts
- Inter（SemiBold）— Google Fonts

## デザインの決めごと

- 1枚＝1枚の写真＋1つのメッセージ。箇条書き・アイコン・ページ番号なし。例外としてスライド4だけは、BondExの役割を伝えるために写真ではなく図（人のルートと荷物のルートが分かれて合流する線）を使う。
- 黒 `#0A0A0A` と白が基調（docs/design-tokens.md のブランド色）。オレンジ `#F26A1B` はスライド1の “OVER LUGGAGE”、スライド4の荷物のルート、スライド6の数字だけ。※ design-tokens.md はアクセント色禁止だが、本講演では依頼に従い、この3か所に限定して使用。
- 見出し：Noto Sans JP Medium 92〜108px（約46〜54pt）、英語は Inter SemiBold 150px。左端 128px・上下 116px の余白。
- 行頭の「」は半角ぶん左にぶら下げて、文字の縦ラインをそろえる。
- 写真の上には黒のグラデーション（`scrim`）を敷き、白文字のコントラストを確保する。写真内に文字は焼き込まない。

## 仕組み

- `slides.json`：スライドの文言・レイアウト・写真スロット・写真ブリーフ
- `notes.json`：講演原稿（スピーカーノートPDFと PPTX の発表者ノートの両方に使う）
- `build.mjs`：HTML を Chromium で描画して PDF / PNG を出力。文字の位置を計測して `build/*/manifest.json` に書く
- `build_pptx.py`：manifest を読み、同じ位置に編集可能なテキストボックスと差し替え可能な写真を配置
- `notes.mjs`：スピーカーノート PDF

`build/` は生成物（コミットしない）。
