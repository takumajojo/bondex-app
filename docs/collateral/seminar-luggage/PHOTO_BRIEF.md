# 写真ブリーフ（BondEx 講演スライド）

このデッキは「1スライド＝1枚の写真＋1つのメッセージ」で設計しています。写真は下記のファイル名で `photos/` に置き、`./build.sh` を実行すると PDF / PPTX に自動で反映されます。
全スロットが埋まり、解像度チェック（トリミング後に拡大が不要）を通った時だけ `out/BondEx_Seminar_Final.pdf / .pptx` が出力されます。足りない間は `BondEx_Seminar_Draft.*` になります。

## 共通の条件

- **解像度**：全面写真は 1920×1080px 以上（推奨 3840×2160px）。スライド2の左右写真は各 956×640px 以上。
- **写真内に文字を入れない**：看板・駅名・社名・ブランドロゴが読める写真は避ける（特に 小田急・PARCO などの実在社名やロゴ）。
- **トーン**：ドキュメンタリー／エディトリアル調。自然光、彩度は控えめ。8枚で色温度を揃える。
- **人物**：自然な表情を最優先。肖像が判別できる人物は、モデルリリース（肖像使用許諾）付きの素材のみ。
- **ライセンス**：講演・商用利用が可能なもの。出典とライセンスを `photos/CREDITS.md` に記録する。
- **文字の載る余白**：各スロットの「文字の位置」に、空・床・暗い店内など情報量の少ない面を残す。

## 調達方法（優先順）

1. **有料ストック**：PIXTA（日本のロケ・訪日客モデルが豊富）、Adobe Stock、Getty Images / iStock。駅・京都・ホテルロビーは見つかりやすい。
2. **撮影**：スライド4（ホテルでの預け入れ）・5（購入を迷う）・7（購入品の配送手配）は具体的な場面なので、ストックで合うものが無ければ提携ホテル・商業施設での撮影が最も確実で、本物らしさも出る。
3. **無料ストック**：Unsplash / Pexels（商用可・帰属表示任意）。駅の雑踏・京都の風景は候補が多い。人物の写った素材はモデルリリースの有無を各ページで確認。
4. **AI画像生成（外部ツール）**：下記の英語プロンプトを使用。手指・顔・スーツケースの車輪・看板の偽文字など、不自然な部分が無いか等倍で確認し、少しでも違和感があれば不採用にする。

※ このリポジトリの制作環境では、外部の写真サイト・画像生成サービスへの接続がネットワーク設定で遮断されており、写真の取得・生成はできませんでした。

## スロット一覧

| # | ファイル | 場面 | 文字の位置 |
|---|---|---|---|
| 01 | `s01.jpg` | 大型ターミナル駅を行き交う、スーツケースの流れ | 画面下40%は暗め・情報量少なめ（文字を載せる） |
| 02 | `s02a.jpg` / `s02b.jpg` | 左：身軽に歩く旅行者／右：別ルートで運ばれるスーツケース | 各写真は 956×640 にトリミングされる（横長）。被写体は中央寄せ |
| 03 | `s03.jpg` | 駅のホーム、スーツケースと電車に乗り込む後ろ姿 | 画面上35%は空・天井など情報量少なめ（文字を載せる） |
| 04 | （不要） | 写真ではなく図で表現（作成済み） | - |
| 05 | `s05.jpg` | 商業施設で、商品を手に迷う訪日旅行者 | 人物は画面右寄り。左半分は暗めの店内（文字を載せる） |
| 06 | `s06.jpg`（任意） | （任意）ショッピングバッグ／高級商業施設 | 全面に文字が載るため、コントラストの低い写真 |
| 07 | `s07.jpg` | 購入した商品をその場で配送手配し、手ぶらで店を出る | 画面下40%はカウンター天板など情報量少なめ（文字を載せる） |
| 08 | `s08.jpg` | 京都の風景を、身軽に歩く旅行者（ラストシーン） | 画面下40%は道・影など情報量少なめ（文字を載せる） |

### 01｜OVER TOURISM? OR “OVER LUGGAGE”?

- **場面**：東京駅・新宿駅・京都駅クラスのコンコース。多数の訪日旅行者が大型スーツケースを引いて移動している。やや高い位置からの俯瞰〜目線の高さ。人の顔は判別できない程度のブレ・距離感でよい。
- **文字の位置**：画面下40%は暗め・情報量少なめ（文字を載せる）
- **トリミングの中心**：`50% 45%`（slides.json の `focal` で調整可）
- **検索語（日本語）**：駅 コンコース 外国人観光客 スーツケース 混雑 / 京都駅 スーツケース 観光客
- **検索語（英語）**：Tokyo station crowd tourists suitcases / Kyoto station travelers rolling luggage concourse
- **AI生成プロンプト**：

  ```
  Documentary photograph, wide shot of a busy Japanese railway station concourse at daytime, dozens of international tourists pulling large hard-shell suitcases, natural motion blur on people, high vantage point, soft overcast light from skylights, muted colors, 35mm lens, shot on Sony A7IV, no readable signage, no text, no logos
  ```

### 02｜人と荷物は、 一緒に移動する必要があるのか？

- **場面**：左：京都・奈良などの石畳や路地を、小さなショルダーバッグだけで歩く訪日旅行者（後ろ姿〜斜め後ろ）。右：配送トラックの荷台や仕分けラインに整然と並ぶスーツケース。左右とも同じ色温度・同じ明るさに揃える。
- **文字の位置**：各写真は 956×640 にトリミングされる（横長）。被写体は中央寄せ
- **トリミングの中心**：`50% 50%`（slides.json の `focal` で調整可）
- **検索語（日本語）**：観光客 後ろ姿 路地 京都 手ぶら / スーツケース トラック 荷台 配送 物流
- **検索語（英語）**：tourist walking alley Kyoto back view light bag / suitcases loaded delivery truck logistics
- **AI生成プロンプト**：

  ```
  A: Documentary photo, back view of a foreign traveler walking freely through a quiet stone-paved street in Kyoto with only a small shoulder bag, early morning soft light, 50mm. B: Documentary photo, several large hard-shell suitcases neatly loaded in the cargo area of a delivery truck, soft natural light, 50mm. Both: matching warm-neutral color grade, no text, no logos
  ```

### 03｜「配送できる」だけでは、 使われない。

- **場面**：日本の駅ホーム（特急・ロマンスカー的な車両でも可、車両名・社名が読めないこと）。大型スーツケースを持った旅行者が乗車しようとする後ろ姿。「ここまで運んできてしまった」が伝わる距離感。
- **文字の位置**：画面上35%は空・天井など情報量少なめ（文字を載せる）
- **トリミングの中心**：`50% 60%`（slides.json の `focal` で調整可）
- **検索語（日本語）**：駅ホーム スーツケース 後ろ姿 乗車 外国人
- **検索語（英語）**：traveler suitcase boarding train platform Japan back view
- **AI生成プロンプト**：

  ```
  Documentary photograph, back view of an international traveler with a large suitcase about to board a limited express train at a Japanese station platform, platform roof in upper frame, evening light, shallow depth of field, 35mm, no readable signs, no text, no logos
  ```

### 04｜荷物を手放す場所を、 旅の中に。

- **写真は不要**：このスライドは「ホテル → 次のホテル」の間で人のルートと荷物のルートが分かれて合流する図で表現する（PDF・PPTXとも作成済み。図の線・点・文字は PowerPoint 上で編集可能）。

### 05｜「持ちたくない」が、 購買を止めている。

- **場面**：洗練された商業施設のブティック。訪日旅行者が気に入ったバッグ・商品を手に取りつつ、腕時計やスマホを見て迷っている（この後の予定がある）。表情で「欲しいけれど…」が伝わること。ブランドロゴは写さない。
- **文字の位置**：人物は画面右寄り。左半分は暗めの店内（文字を載せる）
- **トリミングの中心**：`65% 50%`（slides.json の `focal` で調整可）
- **検索語（日本語）**：ブティック 外国人 女性 商品 迷う 買い物 高級
- **検索語（英語）**：tourist hesitating holding luxury bag boutique shopping Tokyo
- **AI生成プロンプト**：

  ```
  Editorial photograph in an elegant Tokyo department store boutique, an international traveler holding a leather handbag she likes, glancing at her watch with a hesitant expression, subject on the right third, softly lit darker interior on the left, 50mm, shallow depth of field, no brand logos, no text
  ```

### 06｜配送を伝えた結果、約50万円の購入へ。

- **場面**：背景に22%の濃度で敷く。紙のショッピングバッグや吹き抜けの商業施設など、ボケた写真で可。無くても完成（黒背景）。
- **文字の位置**：全面に文字が載るため、コントラストの低い写真
- **トリミングの中心**：`50% 50%`（slides.json の `focal` で調整可）
- **検索語（日本語）**：ショッピングバッグ 高級 ボケ / 商業施設 吹き抜け 夜
- **検索語（英語）**：shopping bags luxury blurred / department store atrium bokeh
- **AI生成プロンプト**：

  ```
  Soft-focus photograph of elegant paper shopping bags on a marble counter in a luxury store, very dark and low contrast, bokeh, no logos, no text
  ```

### 07｜「買う」と「持つ」を 分離する。

- **場面**：商業施設のカウンターで、スタッフが購入品の箱に配送伝票（文字は読めない）を貼る／梱包する。その奥で、訪日旅行者が手ぶらで店を出ていく。前景＝商品と配送、後景＝身軽な旅行者。
- **文字の位置**：画面下40%はカウンター天板など情報量少なめ（文字を載せる）
- **トリミングの中心**：`50% 50%`（slides.json の `focal` で調整可）
- **検索語（日本語）**：店員 梱包 配送 カウンター 手ぶら 観光客 / 免税 カウンター 配送
- **検索語（英語）**：shop staff packing purchase for delivery counter tourist leaving hands-free
- **AI生成プロンプト**：

  ```
  Editorial photograph at a premium Japanese department store counter, a staff member in uniform sealing a wrapped box with a blank shipping label in the foreground, in the soft-focus background an international tourist walking out of the store carrying nothing, warm light, 35mm, no readable text, no logos
  ```

### 08｜人は旅する。 荷物は物流に任せる。

- **場面**：京都（産寧坂・八坂の塔・嵐山など）を、小さなバッグだけで自由に歩く訪日旅行者。人物は小さめ、風景が主役。早朝または夕方の斜光、映画のラストカットのような余韻。
- **文字の位置**：画面下40%は道・影など情報量少なめ（文字を載せる）
- **トリミングの中心**：`50% 40%`（slides.json の `focal` で調整可）
- **検索語（日本語）**：京都 八坂の塔 観光客 後ろ姿 夕暮れ / 嵐山 旅行者 手ぶら
- **検索語（英語）**：Kyoto Yasaka pagoda traveler back view golden hour / Arashiyama tourist walking light
- **AI生成プロンプト**：

  ```
  Cinematic wide photograph of a traveler walking freely up a stone-paved slope in Higashiyama, Kyoto with the Yasaka pagoda in the distance, golden hour side light, traveler small in frame carrying only a light bag, film-like color grade, 35mm anamorphic feel, no text, no logos
  ```
