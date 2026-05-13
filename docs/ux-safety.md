#### 実装

Stripe の `ExpressCheckoutElement` を採用する (Apple Pay / Google Pay / Link を1コンポーネントで提供)。

```tsx
import { ExpressCheckoutElement } from "@stripe/react-stripe-js"

<ExpressCheckoutElement
  onConfirm={handleExpressCheckout}
  options={{
    layout: { maxColumns: 1, maxRows: 0 },
    buttonHeight: 50,
  }}
/>
```

`ExpressCheckoutElement` は表示可能な決済手段のみを自動判定する。サポート外のブラウザ (例: PCのFirefox) では何も表示しない (UI が消える) ので、フォールバックとしてカード入力欄が常に表示される構成を維持する。

### 4.3 ピックアップ・配送先のホテル選択時の入力削減

#### 現状

旅行者が宿泊ホテルを Google Places で検索し、ホテル名を入力 → 候補リストから選択するフロー。

#### 改善仕様

ホテル名検索のプレースホルダーを、ユーザーが「何を入力すべきか」即座に理解できる文言に変更:

| 画面 | 現状 | 改善後 |
|------|------|--------|
| Pickup 検索 | "Enter hotel name..." | "Where are you staying now? (e.g. APA Shinjuku)" |
| Destination 検索 | "Where to?" | "Next hotel or airport (e.g. APA Namba)" |

加えて、Google Places API から `types` を取得し、空港の場合はホテルとは別アイコン (`Plane`) を表示する。

### 4.4 Booking Confirmation アップロードの代替

現状、Booking Confirmation のアップロードが必須。スマホ画面のスクリーンショット撮影 → アップロードという2ステップは離脱要因。

#### 仕様

アップロード以外に **「Skip for now (verify on arrival at front desk)」** ボタンを追加。スキップした場合、`bookingDoc` のステータスを `pending` として保存し、ホテルスタッフ画面で受取時に確認するフローに送る。

ただし、Skipした場合は「ホテルスタッフがフロントで予約確認するため、フロント立ち寄りが必要」と画面に明示する。

---

## 5. 視覚設計の基準 (Visual Design Baseline)

### 5.1 色の使い分け

現状の `muted-foreground` / `muted` の多用を改める。重要度ごとに以下を厳格に使い分ける。

| 用途 | 色クラス | 使用例 |
|------|---------|--------|
| 致命的警告 | text-red-600, bg-red-50 | 危険物リスト、ホテル間違い警告 |
| 注意喚起 | text-amber-600, bg-amber-50 | 梱包不良、サイズ超過 |
| 成功・確認済 | text-green-600 | "Location confirmed", "Payment success" |
| 重要情報 | text-foreground (slate-900) | 配送先、受取人名、決済金額 |
| 通常情報 | text-foreground/80 | 説明文、補足情報 |
| 二次情報 | text-muted-foreground | プレースホルダー、ヒント |
| 無効状態 | text-muted-foreground/50 | disabled な要素 |

### 5.2 フォントサイズ階層

| 用途 | サイズ | 重み | 例 |
|------|--------|------|-----|
| 画面タイトル | text-xl (20px) | font-bold | "Trip Plan" |
| セクションヘッダー | text-base (16px) | font-semibold | "Pickup Point" |
| 重要情報 | text-base (16px) | font-bold | ホテル名、決済金額 |
| 本文 | text-sm (14px) | font-normal | 一般説明 |
| 補足 | text-xs (12px) | font-normal | 注釈、ヒント |
| ラベル | text-[10px] uppercase | font-bold tracking-widest | "STEP 1: PICKUP POINT" |

### 5.3 余白原則

- 画面の左右余白: `p-4` (16px) を基本
- セクション間の縦余白: `space-y-6` (24px)
- カード内のパディング: `p-4` (16px)
- ボタンの高さ: `h-12` (48px) を基本、最重要 CTA は `h-14` (56px)

### 5.4 多言語対応の前提

すべての文言は `<T>` ヘルパー関数経由でレンダリングする。現状のハードコード文字列は段階的に翻訳キーに置き換える (本書のスコープ外、別途i18n仕様で詳細化)。

英語以外の言語で文字数が大きく増減する箇所:
- ドイツ語: 英語比 +30%
- 中国語: 英語比 -40%

すべてのテキスト要素はコンテナの幅を超えても破綻しないようにする (truncate 禁止、wrap 推奨)。

---

## 6. 実装優先順位

本仕様の実装は以下の3フェーズで進める。

### Phase 1: 致命的事故防止 (最優先・2〜4時間)

1. 危険物確認モーダルの仕様化 (個別チェック + スクロール完了強制)
2. 同名ホテル取り違え防止の最終確認画面追加
3. autofill属性の全フォーム適用

### Phase 2: 入力効率化 (高優先・1〜2時間)

4. Apple Pay / Google Pay の独立表示 (ExpressCheckoutElement)
5. ホテル検索のプレースホルダー改善
6. Booking Confirmation の Skip オプション

### Phase 3: 視覚設計の体系化 (中優先・継続的)

7. 色の使い分けの全画面適用
8. フォントサイズ階層の徹底
9. Google Maps 静的画像の検索結果カードへの追加

---

## 7. 受け入れ基準 (Acceptance Criteria)

実装完了の判定基準を以下に列挙する。各項目は QA テストで確認する。

### 7.1 危険物確認モーダル

- [ ] 表示直後、Continue ボタンは disabled である
- [ ] スクロールせずに3項目すべてチェックしても Continue は disabled のまま (スクロール強制が動作)
- [ ] 個別3項目のうち1つでも未チェックなら Continue は disabled
- [ ] すべて完了すると Continue が enabled になる
- [ ] チェック後に外すと即 disabled に戻る
- [ ] Back ボタンは常時 enabled

### 7.2 同名ホテル取り違え防止

- [ ] 検索結果カードに郵便番号と最寄駅が表示される
- [ ] 選択後、Google Maps 静的画像が表示される
- [ ] 決済直前の Final Review 画面で、配送先が画面上1/3以上の領域を占める
- [ ] "destination verified" チェック前は Confirm & Pay ボタンが disabled
- [ ] Final Review から Destination 編集に直接戻れる

### 7.3 入力効率化

- [ ] すべての該当フォームで autofill が動作する (iOS Safari / Android Chrome で実機確認)
- [ ] iOS Safari で決済画面に Apple Pay ボタンが表示される
- [ ] Android Chrome で決済画面に Google Pay ボタンが表示される
- [ ] PC Firefox では Express Checkout セクションが非表示でも、カード入力は機能する
- [ ] Booking Confirmation の Skip ボタンが表示・機能する

### 7.4 視覚設計

- [ ] 警告色 (red) が危険物関連にのみ使用されている
- [ ] フォントサイズが本書の階層通りに統一されている
- [ ] muted-foreground の使用箇所が二次情報のみに限定されている

---

## 8. スコープ外 (Out of Scope)

本書では以下は扱わない。別途仕様書を作成する。

- 認証フロー (NextAuth / Supabase Auth 等の本格実装)
- 多言語化 (i18n 翻訳キーの具体)
- パフォーマンス最適化 (画像最適化、コード分割)
- SEO (該当画面は申込フォームのため重要度低)
- A/B テスト設計
- 分析計測 (Google Analytics / PostHog 等)
- ホテルスタッフ画面・Admin画面のUX (本書はTravelerのみ)

---

## 9. 参考

- ヤマト宅急便 取扱不可品: https://www.kuronekoyamato.co.jp/ytc/customer/send/services/takkyubin/
- 佐川急便 引受拒絶貨物: https://www.sagawa-exp.co.jp/ttk/restricted.html
- Stripe Express Checkout Element: https://docs.stripe.com/elements/express-checkout-element
- HTML autocomplete 属性: https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete
- WCAG 2.1 アクセシビリティ: https://www.w3.org/WAI/standards-guidelines/wcag/

---

**本書はBondExの開発判断基準であり、優先順位の高い意思決定の根拠として継続的に参照される。仕様の変更は本書の改訂を伴う。**