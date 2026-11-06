# ChatGPT 画像生成プロンプト（BondEx 講演スライド）

> ※ この文書のスライド番号は v1（表紙・自己紹介を除いた本編）の番号です。v2 のスライド番号は「＋2」になります（例：Slide 1 → v2 のスライド3）。

## 使い方

1. **1つの ChatGPT の会話の中で**、下のプロンプトを順番に送る（色味と画風がそろう）。2枚目以降は、頭に「前の画像と同じ色調・同じ写真のトーンで。」を付ける。
2. 横長で出力させる（ChatGPT の最大は 1536×1024 程度）。
3. できた画像は `photos/` に、下の表のファイル名で保存する（または、このチャットに貼ってもらえれば配置します）。
4. 人物は**後ろ姿・斜め後ろ**にすると、顔や手の不自然さが出にくい。手指・顔・スーツケースの車輪・看板の偽文字は、等倍で必ず確認する。

| スライド | ファイル名 | 文字が載る位置（空けておく場所） |
|---|---|---|
| 1 | `s01.jpg` | 下 35% |
| 2 | `s02.jpg` | 下 35% |
| 3 | `s03.jpg` | 上 35% |
| 4 | 不要（図） | — |
| 5 | `s05.jpg` | 左半分 |
| 6 | `s06.jpg`（任意） | 全面（背景として薄く敷く） |
| 7 | `s07.jpg` | 下 35%・左側 |
| 8 | `s08.jpg` | 下 35% |

### 注意：解像度

ChatGPT の画像は横 1536px 前後で、スライド（1920×1080）では約1.25倍に拡大されます。大型スクリーンでぼやけが気になる場合は、アップスケーラー（Photoshop のスーパー解像度、Upscayl など）で 2倍にしてから入れてください。ビルドは 1920×1080 未満の画像を「Draft」扱いにして警告します。

---

## 共通の指定（各プロンプトの末尾に付ける）

```
Photorealistic documentary photograph, landscape 16:9 composition, shot on a full-frame camera, natural light, muted cinematic color grade, deep shadows, subtle film grain, realistic proportions, natural hands and faces. Absolutely no text, no letters, no readable signage, no logos, no brand names, no watermarks.
```

---

## Slide 1｜OVER TOURISM? OR “OVER LUGGAGE”?

```
A wide shot of a busy major Japanese railway station concourse, many international tourists pulling large hard-shell suitcases in every direction, the flow of suitcases is the main subject, slight motion blur on people, seen from a slightly elevated angle, people mostly from behind, soft overcast light from skylights. The bottom third of the frame is a dark, uncluttered polished floor with little detail, so large white text can be placed there.
```

## Slide 2｜人と荷物は、一緒に移動する必要があるのか？

```
At the entrance of a refined Japanese hotel in the morning, a delivery driver in a plain dark uniform loads several large suitcases into the cargo area of a small white delivery van, while in the soft-focus background an international traveler walks away down the street carrying only a small shoulder bag. The suitcases and the traveler are clearly going separate ways. The bottom third of the frame is dark pavement with little detail, for text overlay.
```

## Slide 3｜「配送できる」だけでは、使われない。

```
Back view of an international traveler with a large suitcase about to board a limited express train at a Japanese station platform, yellow tactile paving and the white platform edge line visible, the train door open, early evening light, shallow depth of field. The top third of the frame is the dark platform roof with little detail, for text overlay. No readable train names or station signs.
```

## Slide 5｜「持ちたくない」が、購買を止めている。

```
Inside an elegant, softly lit Tokyo department store boutique, an international woman traveler holds a leather handbag she clearly likes, glancing at her wristwatch with a hesitant expression, as if she has dinner plans and does not want to carry it. She stands on the right third of the frame; the left half is a darker, out-of-focus store interior with little detail, for text overlay. Natural, believable expression. No brand logos on bags or walls.
```

## Slide 6（任意・背景）｜約50万円

```
Very dark, low-contrast, soft-focus photograph of elegant paper shopping bags with rope handles on a marble counter in a luxury store at night, heavy bokeh, almost black overall. No logos, no text.
```

## Slide 7｜「買う」と「持つ」を分離する。

```
At a premium Japanese department store counter, a uniformed staff member places a wrapped purchase into a shipping box with a blank white label in the foreground on the right, while in the soft-focus background an international traveler walks out of the store empty-handed, relaxed. Warm light. The left side and the bottom third of the frame are darker with little detail, for text overlay. The shipping label is blank.
```

## Slide 8｜人は旅する。荷物は物流に任せる。

```
Cinematic wide shot in Higashiyama, Kyoto: an international traveler walks freely up a quiet stone-paved slope toward the Yasaka pagoda, carrying only a light bag, seen from behind, small in the frame, golden hour side light, traditional wooden houses, a feeling of freedom like the last scene of a film. The bottom third of the frame is the shaded stone path with little detail, for text overlay. No crowds, no signs.
```
