# BondEx Design Tokens & Tone Manual

> インバウンド旅行者向け荷物配送サービス BondEx における、UI/UXの判断基準。
> すべての画面・コンポーネント・文言・操作はこの文書に準拠する。
> 本書は ux-safety.md と並行して参照される最上位の設計指針である。

| 項目 | 値 |
|------|------|
| 適用範囲 | Traveler / Hotel Staff / Admin の全画面 |
| 整合性 | docs/ux-safety.md と矛盾する場合は本書を優先 |
| 改訂方針 | ブランド人格の変更時のみ全面改訂、それ以外は追記のみ |

---

## 1. ブランド人格 (Brand Persona)

BondEx は **「黒い制服のホテルコンシェルジュ」** として擬人化される。

すべてのUI判断・文言・操作・配色は、この人物が「実際にやりそうかどうか」で判定する。

### 1.1 コア特性

| 特性 | 意味 |
|------|------|
| **黙って頂く** | 不必要な確認をしない、完璧な記憶で覚えている |
| **さりげない** | 主役は客、自分は背景、注目を集めない |
| **高品質** | 仕事に対するプロ意識、ミスをしない |
| **制服** | 個性より役割、統一感、信頼感 |
| **黒** | 静謐、格式、夜のリッツカールトンのバーマン |

### 1.2 やらないこと (Do Not)

- 大声を出さない (赤い警告バナー禁止、注意は控えめに)
- 強い感情を見せない (絵文字 ⚠️ 🎉 ❌ ✨ 禁止)
- お客様を責めない ("Required" "Error" "Invalid" などの命令的表記禁止)
- おすすめを押し付けない ("Recommended" バッジは控えめに、または使わない)
- 過剰に丁寧でもない (日本語の「お客様」連打は不要)
- フォントウェイトで叫ばない (font-bold (700) は使わない、最大 font-semibold (600))

### 1.3 やること (Do)

- 一度の声かけで完結 (確認は最小限)
- 客が困らないよう先回りする (autofill、賢いデフォルト、Progressive Disclosure)
- 詳細は聞かれたら答える (詳細は隠す、「i」アイコンで展開)
- ミスがあれば自分が責任を取る (エラー時は柔らかい文言、客のせいにしない)
- 約束したことは必ず守る (時間通り、品質通り)

---

## 2. デザイントークン (確定)

### 2.1 配色

```
背景  (background)     : #0A0A0A  /* 深い黒、純黒 #000 は避ける */
カード(card)           : #141414  /* 一段明るい黒、要素を浮かせる */
ボーダー(border)       : #2A2A2A  /* 境界線、控えめに */
文字主  (foreground)   : #FFFFFF  /* 白 */
文字副  (muted)        : #A3A3A3  /* 中グレー、補足情報 */
文字三  (disabled)     : #6B6B6B  /* 薄グレー、disable状態 */
CTA   (primary)        : #FFFFFF  /* 重要操作のボタンは「白×黒文字」で反転 */
CTA文字(primary text)  : #0A0A0A
```

→ **アクセントカラー (青・緑・赤など) は使わない**。
→ 例外: 重大警告 (危険物・規約違反) のみ `#DC2626` (red-600) を最小面積で使用可。

### 2.2 タイポグラフィ

```
英文 : Inter (variable font)
和文 : Noto Sans JP (Interとペアリング)
中文 : Noto Sans SC
韓文 : Noto Sans KR
タイ文: Noto Sans Thai
インドネシア文: Inter (ラテン文字)
スペイン文: Inter
```

ウェイト階層:

| 用途 | クラス | weight | 例 |
|------|-------|--------|----|
| 画面タイトル | text-2xl font-semibold | 600 | "Your luggage" |
| セクションヘッダー | text-base font-medium | 500 | "Pickup Point" |
| 重要情報 | text-base font-medium | 500 | ホテル名、決済金額 |
| 本文 | text-sm font-normal | 400 | 一般説明 |
| 補足 | text-xs font-normal | 400 | 注釈、ヒント |
| ラベル | text-[11px] font-medium tracking-wider uppercase | 500 | "STEP 1" |

→ **font-bold (700) は使わない**。コンシェルジュは囁くように話す。

### 2.3 余白・サイズ

```
画面マージン   : px-6 (24px)        /* スマホでもゆとり */
セクション間   : space-y-10 (40px)  /* 贅沢な間 */
カード内余白   : p-6 (24px)
ボタン高さ    : h-14 (56px)        /* Apple/Uber 同等 */
角丸         : rounded-2xl (16px)  /* Aman/Apple 並みの優雅さ */
最小タップ領域 : 44×44px            /* iOS HIG 準拠 */
```

### 2.4 アニメーション

```
- フェード (transition-opacity 300ms) のみ標準採用
- スライド (transition-transform) は画面遷移時のみ
- 回転・バウンス・スプリングは使わない
- ローディング: Loader2 (lucide-react) のみ
- ボタン押下: active:scale-[0.98] のみ
```

→ 「派手な動きで楽しませる」のはコンシェルジュらしくない。

### 2.5 アイコン

```
ライブラリ: lucide-react のみ
サイズ   : w-5 h-5 (20px) を標準、強調時 w-6 h-6 (24px)
線の太さ : strokeWidth=1.5 (デフォルト2は太すぎる)
色     : 文字色に追従 (currentColor)
```

→ 絵文字・カスタムイラスト・スタンプ的アイコンは使わない。

### 2.6 写真

```
- 使うのは1画面に最大1枚、または無し
- 色味は青寄りモノクロ または モノクロ加工
- 旅行者の主観視点 (荷物のクローズアップ、ホテルロビーの俯瞰)
- 顔は写さない (コンシェルジュは客を主役にする)
- 解像度は Retina (2x) 対応
- next/image を使用、aspect-ratio で固定
```

---

## 3. 文言ガイドライン (Tone Manual)

### 3.1 命令形を避ける

| ❌ NG | ✅ OK |
|-------|-------|
| Confirm | Looks good |
| Submit | Continue |
| Required | (赤字で表示しない。必要なら "We need…" と一人称) |
| Enter your email | Your email |
| Choose a date | Pick a date |

### 3.2 ネガティブな単語を避ける

| ❌ NG | ✅ OK |
|-------|-------|
| Error | We need a moment |
| Failed | Let's try again |
| Invalid email | Please check the email |
| Not found | We couldn't find it |
| Wrong | Doesn't match |

### 3.3 大げさな称賛をしない

| ❌ NG | ✅ OK |
|-------|-------|
| Perfect! | Confirmed |
| Great job! | (何も言わない、次に進む) |
| Awesome! | Done |
| Congratulations! | Your booking is confirmed |

### 3.4 ボタン文言の優先順位

```
1. 一語で済むなら一語 ("Continue", "Confirm", "Cancel")
2. 動詞+目的語の最短形 ("Pay ¥3,500", "Add photo")
3. 説明調は避ける ("Click here to continue" 等は禁止)
```

### 3.5 エラー時の声かけ

エラーは「客のせい」にしない。常に**主語をBondEx側**にする。

```
❌ "Your email is invalid"
✅ "Please double-check the email"
✅ "Hmm, that email doesn't look quite right"
✅ "We need a valid email to send confirmation"
```

---

## 4. Progressive Disclosure 原則

### 4.1 基本ルール

すべての「お客様が読まなくてもよい情報」は**初期状態で隠す**。

- 規約、プライバシーポリシー、利用条件
- カードキャリアー情報 (Yamato/Sagawa の選択肢)
- 詳細な料金内訳
- 危険物の完全リスト
- 最寄駅・郵便番号・建物情報 (選択前)

### 4.2 隠す手段の優先順位

1. **「i」アイコン + ツールチップ** : 用語の補足、1〜2行で済む情報
2. **「Details」リンク + ボトムシート** : 規約、長文の補足情報
3. **「Show more」 + インライン展開** : 関連性が高い続き情報
4. **モーダルダイアログ** : 重要な確認 (危険物確認、決済確認)

### 4.3 例外: 強制的に見せる

以下は **必ず本体UIに表示**する。隠してはいけない。

- 配送料金 (Pay now の金額)
- ピックアップ先・配送先のホテル名
- 配送日時
- 受取人名
- 危険物確認のチェックボックス3項目 (スクロール強制)

---

## 5. 既存仕様との関係

### 5.1 ux-safety.md との関係

`docs/ux-safety.md` の「§5 視覚設計の基準」は本書に統合され、
ux-safety.md 側は cross-reference に簡略化された。
ただし、§2「危険物確認の設計」、§3「同名ホテル取り違え防止の設計」は引き続き有効。

### 5.2 Phase 1 実装済みコードの扱い

Phase 1 で実装したコード (危険物モーダル、Final Review screen、Static Map) は、
**機能は維持**しつつ、本書の配色・タイポ・文言ルールに合わせて**ビジュアル再調整**が必要。

ただし、再調整は段階的に行う (Phase 3 のスコープとして別途計画化)。

---

## 6. 参考事例

本書のブランド人格・トークンは以下のサービスを参考にしている。
新しい判断に迷ったときはこれらを基準に「BondExならどうするか」を考える。

- **Tesla** (https://www.tesla.com/) — 黒メイン、Sans-serif、機能ミニマル
- **Apple Store App** — Progressive Disclosure の教科書
- **Aman Resorts** (https://www.aman.com/) — 高級感、余白、Serif混在 (Tesla型なので採用せず参考のみ)
- **Uber** — 単一CTA、機能完結
- **Rivian** (https://rivian.com/) — 黒×Sans-serif の現代版

---

**本書は BondEx UI/UX の最上位判断基準であり、すべての画面実装・文言・操作はこれに準拠する。本書の改訂はブランド人格の変更を伴うため、慎重に行う。**
