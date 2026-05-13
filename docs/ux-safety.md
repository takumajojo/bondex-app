# BondEx UX Safety Specification

> インバウンド旅行者向け荷物配送サービス BondEx における、誤入力・誤配送・規約違反を防ぐためのUX設計基準。本書は実装ガイドラインであり、すべての Traveler フロー画面はこの基準に準拠する。

| 項目 | 値 |
|------|-----|
| バージョン | 1.0 |
| 適用範囲 | Traveler フロー全画面 (Step 0〜7) |
| 想定読者 | プロダクト責任者、フロントエンドエンジニア、外部開発委託先 |
| 前提配送手段 | 陸送のみ (ヤマト宅急便・佐川急便 規約準拠) |
| 想定ユーザー | 訪日インバウンド旅行者 (英語/中国語/日本語/韓国語/タイ語等) |
| 最終更新 | 2026年5月13日 |

---

## 1. 設計原則

本サービスにおけるUXの判断基準は以下の3点に集約される。判断に迷ったときは、この原則に立ち戻る。

### 原則1: 「見ない・読まない・誤入力」を構造で防ぐ

インバウンド旅行者は移動中・空港・観光中にスマートフォンで操作する。集中力は10%以下と仮定する。重要な情報は「読んでもらう」ことを前提にせず、構造的に確認を強制する設計とする。

具体例:
- 危険物確認画面: スクロール完了を物理的に強制した上で、特に重大な3項目は個別チェックを必須化する
- 同名ホテル: 文字列だけでなく地図画像で視覚的に確認させる
- 最終確認: 決済直前で「お届け先」「お名前」「日時」を再度大きく表示

### 原則2: 「入力」は最終手段、「選択」と「自動入力」を優先

入力フォームはコンバージョン率の最大の敵である。インバウンド客にとって日本語入力は更に高負荷。手入力は最終手段として、以下を優先する。

優先順位:
1. ブラウザ/OS の autofill (名前、メール、電話、住所、カード情報)
2. Apple Pay / Google Pay (決済情報を一切入力させない)
3. 選択肢からのタップ
4. それでも必要な場合のみ手入力

### 原則3: 「事故が起きないこと」が最優先、次に「離脱しないこと」

BondEx の事業継続リスクは2つに集約される。

- 配送事故: 危険物の発火、同名ホテル間違い、本人以外への引き渡し → 業者責任 → ヤマト/佐川からの取引停止 → 事業終了
- 離脱: 入力面倒・分かりにくい → 申込完了せず → 売上ゼロ

両者がトレードオフになる場合、事故防止を優先する。ただし、事故防止のために必要以上に厳しくしない。

---

## 2. 危険物確認の設計

### 2.1 適用箇所

`components/traveler/screens/luggage-input-screen.tsx` 内、現在の `showConfirmModal` を以下の仕様に置き換える。Step 3 (荷物入力) で Continue を押下したときに発火する。

### 2.2 モーダル構造

- ヘッダー: 赤背景「Before you continue」
- スクロール領域:
  1. サイズ・重量上限 (現状維持: 200cm / 30kg)
  2. 個別確認3項目 (新規: チェックボックス必須)
  3. その他禁止品 (現状の6項目アイコン、視認性向上)
  4. 規約同意 (現状維持)
- フッター: Back と Continue ボタン。Continue は初期 disabled。

### 2.3 個別確認3項目 (必須チェック)

以下の3項目を個別にチェックボックス必須とする。陸送事業者で発生頻度の高い事故原因。

1. **リチウムイオン電池**: "I have NOT included loose lithium batteries (power banks, e-cigarettes)" / 補足: Built-in batteries in devices are OK
2. **現金・貴重品**: "I have NOT included cash, jewelry, or valuables over ¥30,000" / 補足: Carrier compensation cap is ¥30,000
3. **生鮮食品**: "I have NOT included fresh food, plants, or liquids over 100ml" / 補足: Sealed bottled drinks for personal use are OK

### 2.4 一括チェック

3項目の下に、現状の禁止品6項目アイコン群を表示し、最後に以下の一括チェックを配置:

> "I confirm none of the items listed above are in my luggage"

### 2.5 スクロール完了の検知

Continue ボタンが enabled になる条件は以下の3つすべて:

1. スクロール領域を末尾まで到達した
2. 個別チェック3項目すべてチェック済み
3. 一括チェックがチェック済み

途中でチェックを外した場合、即座に disabled に戻す。

### 2.6 視覚化のルール

すべてのアイコンは `lucide-react` から選定。実写写真は使用しない。多言語対応の容易さ、配信サイズの軽量化、著作権リスクゼロのため。

採用アイコン:
- リチウム電池: BatteryWarning / text-red-600
- 現金・貴重品: Banknote / text-red-600
- 生鮮食品: Apple または Leaf / text-red-600
- 危険・引火物: Flame / text-red-600
- 違法物: ShieldX / text-red-600
- 高額壊れ物: Gem / text-amber-600
- 梱包不良: Package / text-amber-600

色の使い分け: 重大警告は red-600、注意喚起は amber-600。グレースケールは使用しない。

---

## 3. 同名ホテル取り違え防止の設計

### 3.1 問題定義

東京・大阪・京都には同名チェーンホテルが多数存在する。例として新宿エリアには「APAホテル新宿」「APAホテル新宿御苑前」「APAホテル新宿歌舞伎町タワー」「APAホテル新宿 西新宿五丁目駅前」が並ぶ。

旅行者が誤って別のアパホテルを選択し、別ホテルに配送される事故が起きると、荷物紛失または受取拒否につながり、BondEx の責任問題に発展する。

### 3.2 検索結果カードの強化

現状はホテル名(太字) + secondary(薄字) のみ。これを以下のように強化する。

- ホテル名 (太字 16px)
- 〒郵便番号 + 都道府県 + 市区町村 + 番地 (本文 14px)
- 最寄駅 + 徒歩分数 (補足 12px)

レイアウト要件:
- ホテル名と住所のフォントサイズ差を小さくする (現状は差が大きすぎて住所が読まれない)
- 郵便番号を住所の冒頭に表示
- 最寄駅情報を Google Places API の vicinity フィールドから取得して表示
- 同一エリアに同名ホテルが2つ以上ある場合、それぞれのカード右上に「2nd location nearby」バッジを表示

### 3.3 選択後の確認カード強化

選択直後、現状の「Location confirmed」緑チェックの下に、Google Maps 静的画像を追加する。

実装上の注意:
- Google Maps Static API を使用 (Embed API より軽量、SEO/JSなし)
- API キーは GOOGLE_MAPS_API_KEY を流用 (.env 既設)
- 画像URLは `https://maps.googleapis.com/maps/api/staticmap?center={lat},{lng}&zoom=16&size=600x300&markers={lat},{lng}&key={API_KEY}`
- 検索結果から lat/lng を取得する必要があるため、`/api/places/route.ts` のレスポンスに geometry.location を含める修正が必要

### 3.4 決済直前の最終確認画面 (新規追加)

新規ファイル `components/traveler/screens/final-review-screen.tsx` を作成。
`traveler-flow.tsx` の Step 順序に挿入し、現在の Payment は1ステップ繰り下げる。

最重要セクション:
- 配送先ホテル名 (大きく)
- 〒郵便番号 + 住所
- Google Maps 静的画像
- 受取人名 + チェックイン日 + 配送時間帯
- "I have verified the destination and recipient" の必須チェックボックス

セカンダリセクション:
- ピックアップ元 (折りたたみ可)
- 荷物個数と料金 (折りたたみ可)

フッター:
- Back ボタン
- "Confirm & Pay" ボタン (チェック後のみ enable)

戻るボタンは Contact Info に戻るのではなく、Destination 編集画面に直接戻すこと。

---

## 4. 入力効率化の設計

### 4.1 autofill属性マッピング

すべてのフォームフィールドに正しい autoComplete 属性を付与する。

- Destination の Booking Name: autoComplete="name"
- Destination の Recipient Name: autoComplete="name"
- Contact Info の Email: autoComplete="email"
- Contact Info の Confirm Email: autoComplete="email"
- Contact Info の Phone: autoComplete="tel" (現状維持)
- Payment のクレカ情報: Stripe Elements が自動設定

数字入力フィールドには inputMode も併せて指定 (Phone: numeric, Verification Code: numeric, Weight: decimal)。

### 4.2 Apple Pay / Google Pay の独立表示

現状: Stripe Payment Element に Apple Pay / Google Pay が自動表示されているが、クレジットカード入力欄と同等の位置に並んでいるため、ユーザーが気付かずカード番号を手入力しがち。

仕様: 決済画面の Order Summary の直下、Payment Element の直上に、Stripe の ExpressCheckoutElement を配置する。Apple Pay / Google Pay / Link を1コンポーネントで提供。

サポート外のブラウザでは何も表示しない(UI が消える)ため、フォールバックとしてカード入力欄が常に表示される構成を維持する。

### 4.3 ホテル検索のプレースホルダー改善

- Pickup 検索: 現状 "Enter hotel name..." → 改善後 "Where are you staying now? (e.g. APA Shinjuku)"
- Destination 検索: 現状 "Where to?" → 改善後 "Next hotel or airport (e.g. APA Namba)"

加えて、Google Places API から types を取得し、空港の場合はホテルとは別アイコン (Plane) を表示する。

### 4.4 Booking Confirmation アップロードの代替

現状はアップロード必須。スマホ画面のスクリーンショット撮影 → アップロードという2ステップは離脱要因。

仕様: "Skip for now (verify on arrival at front desk)" ボタンを追加。スキップした場合、bookingDoc のステータスを pending として保存し、ホテルスタッフ画面で受取時に確認するフローに送る。

ただし Skip した場合は「ホテルスタッフがフロントで予約確認するため、フロント立ち寄りが必要」と画面に明示する。

---

## 5. 視覚設計の基準

### 5.1 色の使い分け

- 致命的警告: text-red-600, bg-red-50 (危険物リスト、ホテル間違い警告)
- 注意喚起: text-amber-600, bg-amber-50 (梱包不良、サイズ超過)
- 成功・確認済: text-green-600 ("Location confirmed", "Payment success")
- 重要情報: text-foreground / slate-900 (配送先、受取人名、決済金額)
- 通常情報: text-foreground/80 (説明文、補足情報)
- 二次情報: text-muted-foreground (プレースホルダー、ヒント)
- 無効状態: text-muted-foreground/50 (disabled な要素)

### 5.2 フォントサイズ階層

- 画面タイトル: text-xl 20px / font-bold
- セクションヘッダー: text-base 16px / font-semibold
- 重要情報 (ホテル名・金額): text-base 16px / font-bold
- 本文: text-sm 14px / font-normal
- 補足: text-xs 12px / font-normal
- ラベル: text-[10px] uppercase / font-bold tracking-widest

### 5.3 余白原則

- 画面の左右余白: p-4 (16px) 基本
- セクション間の縦余白: space-y-6 (24px)
- カード内のパディング: p-4 (16px)
- ボタンの高さ: h-12 (48px) 基本、最重要 CTA は h-14 (56px)

### 5.4 多言語対応の前提

すべての文言は将来的に翻訳キーで管理できるように設計する。ドイツ語は英語比 +30%、中国語は -40% 程度の文字数変動があるため、テキスト要素はコンテナ幅を超えても破綻しないようにする (truncate 禁止、wrap 推奨)。

---

## 6. 実装優先順位

### Phase 1: 致命的事故防止 (最優先)

1. 危険物確認モーダルの仕様化 (個別チェック + スクロール完了強制)
2. 同名ホテル取り違え防止の最終確認画面追加
3. autofill属性の全フォーム適用

### Phase 2: 入力効率化 (高優先)

4. Apple Pay / Google Pay の独立表示 (ExpressCheckoutElement)
5. ホテル検索のプレースホルダー改善
6. Booking Confirmation の Skip オプション

### Phase 3: 視覚設計の体系化 (中優先・継続的)

7. 色の使い分けの全画面適用
8. フォントサイズ階層の徹底
9. Google Maps 静的画像の検索結果カードへの追加

---

## 7. 受け入れ基準

### 7.1 危険物確認モーダル

- 表示直後、Continue ボタンは disabled である
- スクロールせずに3項目すべてチェックしても Continue は disabled のまま
- 個別3項目のうち1つでも未チェックなら Continue は disabled
- すべて完了すると Continue が enabled になる
- チェック後に外すと即 disabled に戻る
- Back ボタンは常時 enabled

### 7.2 同名ホテル取り違え防止

- 検索結果カードに郵便番号と最寄駅が表示される
- 選択後、Google Maps 静的画像が表示される
- 決済直前の Final Review 画面で、配送先が画面上1/3以上の領域を占める
- destination verified チェック前は Confirm Pay ボタンが disabled
- Final Review から Destination 編集に直接戻れる

### 7.3 入力効率化

- すべての該当フォームで autofill が動作する (iOS Safari / Android Chrome で実機確認)
- iOS Safari で決済画面に Apple Pay ボタンが表示される
- Android Chrome で決済画面に Google Pay ボタンが表示される
- PC Firefox では Express Checkout セクションが非表示でも、カード入力は機能する
- Booking Confirmation の Skip ボタンが表示・機能する

### 7.4 視覚設計

- 警告色 red が危険物関連にのみ使用されている
- フォントサイズが本書の階層通りに統一されている
- muted-foreground の使用箇所が二次情報のみに限定されている

---

## 8. スコープ外

本書では以下は扱わない。別途仕様書を作成する。

- 認証フロー (NextAuth / Supabase Auth 等の本格実装)
- 多言語化 (i18n 翻訳キーの具体)
- パフォーマンス最適化 (画像最適化、コード分割)
- SEO (該当画面は申込フォームのため重要度低)
- A/B テスト設計
- 分析計測 (Google Analytics / PostHog 等)
- ホテルスタッフ画面・Admin画面のUX (本書は Traveler のみ)

---

## 9. 参考

- ヤマト宅急便 取扱不可品: https://www.kuronekoyamato.co.jp/ytc/customer/send/services/takkyubin/
- 佐川急便 引受拒絶貨物: https://www.sagawa-exp.co.jp/ttk/restricted.html
- Stripe Express Checkout Element: https://docs.stripe.com/elements/express-checkout-element
- HTML autocomplete 属性: https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete
- WCAG 2.1 アクセシビリティ: https://www.w3.org/WAI/standards-guidelines/wcag/

---

本書はBondExの開発判断基準であり、優先順位の高い意思決定の根拠として継続的に参照される。仕様の変更は本書の改訂を伴う。
