# 送り状の遅延発行（Deferred Issuance）＋ 通知 設計

最終更新: 2026-06-26

## 背景 / 解決したい課題

ヤマト（Ship&co 経由）の送り状 API は、**出荷予定日が送り状発行日から30日以内**でなければ
受け付けない（エラー `ES003001`「出荷予定日は送り状発行日から30日以内で指定して下さい」）。

一方で BondEx の実運用は **ツアー会社が出発の2〜3ヶ月前に予約する** 構造であり、
旅程アップロード時点でまとめて送り状を発行しようとすると、30日を超える区間が必ず弾かれる。

→ **「予約登録」と「送り状発行」を時間的に分離する**のが本質的な解決策。
旅行者が持つバウチャー（PDF）は日付制約がないため即時発行できる。
送り状だけを、出荷予定日が30日枠に入ったタイミングで自動発行する。

関連: 直接原因となった過去日付テストと、`shipment_date` のバリデーション欠如
（[app/api/shipandco/create/route.ts](../app/api/shipandco/create/route.ts)）。

---

## A. 即時対応（実装済み — ガード＋UX）

本ドキュメントの構造設計（B）に先立ち、最小限のガードを実装済み。

- `app/api/shipandco/create/route.ts`
  - `shipment_date` を JST 基準でバリデーション。
  - **過去日付** → `400 { code: "SHIPMENT_DATE_PAST" }`（Ship&co を呼ばない）。
  - **30日超（`gap > 30`）** → `200 { status: "deferred", issuableFrom }` を返し、
    Ship&co を呼ばない。`issuableFrom = shipmentDate − 30日`。
  - `0 ≤ gap ≤ 30` → 従来どおり発行（`status: "issued"`）。
  - 万一 Ship&co が `ES003001` を返した場合は `code: "SHIPANDCO_DATE_WINDOW"` に正規化。
- `app/operator/page.tsx`
  - `deferred` 区間は「発行予約済み — YYYY-MM-DD から発行可能」と業務向け日本語で表示。
  - エラーコードを日本語メッセージにマッピング（生の API エラーを出さない）。

この `deferred` の構造（区間ごとに「未発行・発行可能日つき」を表現する）を、
そのまま下記 B の自動発行バッチが消費する。

---

## B. 構造的解決（設計）— 登録と発行の分離

### B-1. データモデル

POC は localStorage だが、自動発行には**サーバー側の永続ストア**が必須
（バッチが参照するため）。最小スキーマ:

```
Booking
  id              BDX-YYMMDD-RND
  tourCompany     代理店識別子（通知先の解決に使う）
  contactName / contactPhone / contactEmail   代理店担当者（通知先）
  travelerCount, representativeLabel
  createdAt

Shipment (Booking 1 : N)
  id              BDX-...-L{n}
  bookingId
  shipmentDate    出荷予定日 (YYYY-MM-DD)
  expectedArrival
  fromHotel / toHotel / recipient / suitcaseCount / specialNote
  status          pending | deferred | issued | failed
  issuableFrom    shipmentDate − 30日（deferred のときの発行解禁日）
  issuedAt
  trackingNumbers []
  labelUrl        Ship&co 発行 PDF の URL（または保管先キー）
  lastError       直近の失敗詳細（失敗時）
  retryCount
```

### B-2. ライフサイクル

1. **登録時（旅程アップロード）**
   - バウチャー PDF は即時生成（制約なし）。
   - 各区間の `gap = shipmentDate − today` を計算。
     - `gap ≤ 30` → 即発行（`issued`）。
     - `gap > 30` → `deferred`、`issuableFrom` を保存。
     - `gap < 0` → 登録時バリデーションで弾く（過去日付）。

2. **発行時（自動バッチ）**
   - 日次 Cron（Vercel Cron 推奨）が `status ∈ {deferred, failed}` かつ
     `issuableForToday`（後述の発行ウィンドウ内）の区間を抽出し、Ship&co で発行。
   - 成功 → `issued` に更新 + **通知発火**（後述）。
   - 失敗 → `failed` + `lastError` + `retryCount++`、翌日再試行。

### B-3. 発行タイミング（ウィンドウ）

- ヤマト制約: `shipmentDate − 発行日 ≤ 30日`。
- 推奨発行日: **出荷予定日の約21日前**（30日枠に9日の余裕。
  ラベルが from ホテルへ物理的に届くリードタイムも確保）。
- 発行可能判定: `today ≥ shipmentDate − 21日` かつ `today ≤ shipmentDate`（＝ 30日枠内）。
  21日前を逃しても 30日枠の内側であれば毎日リトライで救済される。

### B-4. Cron 基盤

- Vercel Cron（`vercel.json` の `crons`）で `/api/cron/issue-shipments` を日次起動。
- Cron エンドポイントは `CRON_SECRET` ヘッダで保護。
- 冪等性: `status` 遷移と `issuedAt` で二重発行を防止。
  バッチ内も区間単位 try/catch で1区間の失敗が他を巻き込まない。

---

## C. 通知設計

### C-0. 基本方針

自動発行と同時に、代理店が「**いつ・何が・どう発行されたか**」を業務動線で
受け取れるようにする。代理店に「システムを見に行く」作業を強いない。
**通知が能動的に届く**形にする。

### C-1. チャネル設計（2層）

#### 代理店向け（主・必須）

- **メール通知** — 送り状発行時に代理店担当者メールへ自動送信。
  - 送り状 PDF を**添付**。
  - 件名: `BondEx 送り状発行通知 [予約ID]`（識別容易・検索容易）。
  - 本文: 配送元 / 配送先 / 出荷予定日 / 追跡番号 を記載。
  - 複数区間が同日に発行された場合は、予約ID単位で1通にまとめる（添付複数）案を推奨
    （受信箱の氾濫を防ぐ）。区間単位の即時性が必要なら区間ごとも選択可。

- **Google ドライブ自動格納（次段階）** — 代理店ごとに専用フォルダを用意し、
  発行と同時に PDF を格納。
  - フォルダ構成例: `BondEx/{代理店名}/{予約ID}/{区間ID}.pdf`。
  - 代理店は普段の業務動線（Drive）で一括管理できる。
  - メール添付と二重化することで「メールを消した／見落とした」を救済。

#### BondEx 運営向け（監視・別チャネル）

- **Slack 通知** — 運営チームが運用状況を把握するため。代理店には届かない。
  - **日次サマリー**: 発行件数 / 失敗件数 / deferred 件数。
  - **リアルタイム異常通知**: Ship&co API エラー、Cron バッチ失敗、
    通知（メール送信）失敗、リトライ枯渇 など。

### C-2. 実装順序の推奨

1. **メール通知のみ**（最も汎用・運用が確実に回る）。まずここで運用を確立。
2. **Google ドライブ自動格納**を追加（代理店オンボーディング時の OAuth 設計が必要）。
3. **Slack 運営監視**を追加（運営側の体制が固まってから）。

### C-3. 設計論点

#### (1) メール送信サービスの選定基準

| 観点 | Resend | SendGrid | AWS SES |
|---|---|---|---|
| 導入の速さ | ◎ API/DX がモダン、数分で送信可 | ○ | △ IAM/設定が重い |
| 添付（PDF） | ○ 対応 | ○ 対応 | ○ 対応 |
| 到達率・評判 | ○（新興だが良好） | ◎ 実績豊富 | ◎（要 warm-up） |
| 価格（低〜中量） | ◎ 無料枠あり | ○ | ◎ 最安（従量） |
| 独自ドメイン認証 | ◎ SPF/DKIM 簡単 | ○ | ○（自前設定） |
| テンプレート管理 | ○（React Email と親和） | ◎ GUI あり | △ なし |
| ベンダーロックイン | 低 | 中 | 中（AWS 前提） |

- **選定基準**:
  (a) 独自ドメイン送信（`@bondex...`）で SPF/DKIM/DMARC を通せること（到達率・なりすまし対策）、
  (b) PDF 添付が API で素直に扱えること、
  (c) 送信ログ / Webhook（バウンス・配信失敗）が取れること、
  (d) 想定送信量に対する価格、
  (e) 既存スタック（Next.js / Vercel）との親和性。
- **POC の推奨**: **Resend**（Next.js/Vercel と親和、React Email でテンプレ管理、立ち上げが速い）。
  量が増え GUI テンプレ運用や高度な到達率管理が必要になれば SendGrid、
  コスト最優先かつ AWS 集約なら SES に寄せる、という段階移行を想定。
- 抽象化: 送信処理は `lib/notify/email.ts` の単一インターフェース（`sendIssuanceEmail`）に閉じ込め、
  プロバイダ差し替えを可能にしておく。

#### (2) 通知失敗時のリトライとフォールバック

- **送信リクエスト失敗**（API エラー / タイムアウト）: 指数バックオフで最大 N 回（例: 3回）リトライ。
- **非同期の配信失敗**（バウンス・スパム判定）: プロバイダの Webhook を受け、
  `notificationStatus = bounced` を記録。
- **フォールバック階層**:
  1. メール再送（別 From / 別経路）。
  2. Drive 格納が有効なら「Drive に格納済み」を担保（メール不達でも PDF は届いている状態）。
  3. それでも不達なら **Slack で運営にアラート** → 運営が代理店へ手動連絡。
- **可視化**: 各 Shipment に `notificationStatus`（sent / failed / bounced / manual）を持たせ、
  運営ダッシュボード／Slack 日次サマリーで未達を検知できるようにする。
- 通知失敗は**発行の成否とは独立**に扱う（送り状自体は発行済みなので、再通知で回復可能）。

#### (3) 代理店ごとの通知設定

- 代理店（`tourCompany`）単位で通知プロファイルを持つ:
  - **複数担当者**: 宛先リスト（To 複数）。
  - **CC / BCC**: 例 — 代理店の共有メールを CC、BondEx 運営を BCC（記録用）。
  - **PDF 添付の要否**: 添付派／本文リンク派（Drive リンク）を選べるように。
    セキュリティポリシー上、添付不可の代理店向けに「リンクのみ」モードを用意。
  - **言語**: 通知本文の JA / EN（operator の i18n と整合）。
  - **集約単位**: 区間ごと即時 / 予約ID単位でまとめ。
- 既定値（オンボーディング時に確定）: To = `contactEmail`、添付あり、言語 = 予約の locale。

#### (4) GDPR / 個人情報の観点

旅行者情報（氏名・宿泊先・日程）を含む PDF をメール添付・Drive 格納する以上、配慮が必須。

- **データ最小化**: 送り状/通知に載せる個人情報は配送に必要な範囲に限定
  （代表者氏名・ホテル・日付・追跡番号）。不要な旅行者個人情報は載せない。
- **目的拘束 & 委託**: 通知先は「予約した代理店」に限定。
  メール/Drive/Slack の各プロバイダは**処理委託先（processor）**であり、
  DPA（データ処理契約）を締結し、保存リージョン（EU/日本）を確認する。
- **保持期間**: PDF とメールログの保持期間を定義し、期限後は自動削除。
  Drive 格納分も保持ポリシーを適用。
- **送信の安全性**: 独自ドメイン認証（SPF/DKIM/DMARC）でなりすまし防止。
  添付不可ポリシーの代理店には**期限付き署名リンク**（Drive 限定共有）で代替。
- **アクセス制御**: Drive フォルダは代理店ごとに権限分離（他代理店の旅行者情報が見えない）。
  Slack の運営通知には旅行者の詳細な個人情報を載せない（件数・予約ID・エラー種別まで）。
- **越境移転**: 旅行者が EU 在住なら、米国系プロバイダ利用時の移転根拠（SCC 等）を確認。
- **削除要求対応**: 旅行者/代理店からの削除要求に応じてメールログ・Drive 実体を消せる導線を用意。

---

## 関連ファイル

- [app/api/shipandco/create/route.ts](../app/api/shipandco/create/route.ts) — 発行ガード（A 実装済み）
- [app/operator/page.tsx](../app/operator/page.tsx) — deferred 表示 / エラーマッピング（A 実装済み）
- [app/api/itinerary/parse/route.ts](../app/api/itinerary/parse/route.ts) — `shipmentDate` 抽出元
- （将来）`app/api/cron/issue-shipments/route.ts` — 自動発行バッチ（B）
- （将来）`lib/notify/email.ts` — 通知の単一インターフェース（C）
