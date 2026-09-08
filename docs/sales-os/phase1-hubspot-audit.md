# Phase 1 — 既存 HubSpot 調査レポート（読み取りのみ）

調査日: 2026-08-27 / ポータル ID **247107122**（`app-na2.hubspot.com`, データ拠点 na2）
実行内容: GET と search(POST) のみ。**書き込みは一切していない**。
証拠ファイル: `scratchpad/hs-audit/*.json`（生レスポンス）

---

## 0. 結論(先に3行)

1. 既存データは小さく(会社91/担当者111)、**壊すリスクは低い**。ただし **91社のうち実際のBondEx営業対象は27社だけ**で、残り64社はメール連携が自動生成したノイズ。
2. **Deal(取引)はほぼ未使用(2件)**。ご指示どおり「営業ステージはCompanyが持つ」設計と既存データが衝突しない。
3. **設計上の最大の壁は Gmail 側**。受信トレイは 97,568通・未読 50,395通の混在メールボックスで、BondEx営業メールは全体の 0.1% 未満。「Gmailを監視する」は素朴に作ると破綻する（対策は §5）。

---

## 1. ポータル基本情報

| 項目 | 値 |
| --- | --- |
| Portal ID | 247107122 |
| accountType | STANDARD |
| タイムゾーン | US/Eastern（**JST ではない**） |
| 通貨 | USD（**JPY ではない**） |
| UI ドメイン | app-na2.hubspot.com |

> 注意: タイムゾーンが US/Eastern のままだと「今週のMTG」「毎朝9時レポート」の週境界・日境界が
> 日本時間とズレる。ダッシュボード側で JST 固定するか、ポータル設定を Asia/Tokyo に変える判断が必要。
> 通貨 USD も、契約金額を円で入れる運用と噛み合わない。**どちらも既存設定の変更なので Phase 2 で提案し、承認をもらってから触る。**

## 2. レコード件数（現状）

| オブジェクト | 件数 | 内訳・所感 |
| --- | --- | --- |
| Company | 91 | 実営業対象 27 / 自動生成ノイズ 64 |
| Contact | 111 | うち 98 が `EMAIL_INTEGRATION` 由来（後述） |
| Deal | 2 | 実質未使用 |
| Task | 28 | BondEx由来19 / 手動7 / HubSpotサンプル2 |
| Meeting | 2 | **両方 HubSpot のサンプルデータ**。Fathom連携ゼロ |
| Note | 4 | 手動2 / crm-sync由来2 |

### 会社データの内訳（重要）

| 生成元 | 件数 | 実体 |
| --- | --- | --- |
| `INTEGRATION` | 27 | BondEx 営業対象（`bondex_category` が入っている 27社と一致） |
| `CRM_SETTING` | 64 | **メールドメインからの自動会社作成**。営業対象ではない |

- `lifecyclestage`: lead 90 / opportunity 1 → **ステージ管理として機能していない**
- `hubspot_owner_id`: 28社のみ設定（オーナーID 97527572）、63社は未設定
- `bondex_category`: DMC 22 / Travel Agency 5 / 未設定 64

さらに、`name` が空で `domain` だけの会社が実在する（例: `his-world.com`, `group-miki.com`）。
これは自動生成の副作用。**AI が会社を特定するキーは name ではなく domain にすべき**という設計上の示唆。

## 3. 既存カスタムプロパティ（＝勝手に触ってはいけないもの）

| オブジェクト | 全プロパティ | うちカスタム |
| --- | --- | --- |
| Company | 245 | **1** |
| Contact | 407 | **5** |
| Deal | 210 | **4** |
| Task / Meeting / Note | 124 / 123 / 55 | **0** |

**Company（1件）**
- `bondex_category` — select — DMC / Land Operator / Travel Agency / OTA / Hotel / Logistics / Airport / Tourism Board
  → **これは今回の設計でもそのまま使う。再定義しない。**

**Contact（5件）** — いずれも用途不明の「マーケ用サンプル」に見える。**触らない。**
- `bondex`(text) / `contact_role`(checkbox) / `last_purchase_date`(date) / `lead_source`(select) / `purchase_intent_rank`(select)

**Deal（4件）** — `budget_range` / `campaign_type` / `contract_duration` / `expected_roi`。**触らない。**

> ⚠️ `bondex_sync_key` は**ポータルに存在しない**。既存の crm-sync (`scripts/crm-sync/sync.ts`) は
> このプロパティがある前提の重複防止層を持つが、無い環境では自動的に無効化されて台帳＋自然キー検索だけで
> 動いている。つまり**重複防止が三段構えのうち一段欠けた状態で運用中**。Phase 4 で追加すべき最優先項目。

## 4. パイプライン

パイプラインは1本のみ: **「Bondex 新規営業」(id=`default`)**

`Appointment Scheduled → Qualified To Buy → Presentation Scheduled → Decision Maker Bought-In → Contract Sent → Closed Won → Closed Lost`

- 中身は HubSpot の初期テンプレートのまま（ラベルだけ日本語化していない）。
- ご指示の営業フロー（開始前→初回メール送信→…→送客開始→継続利用→アップセル→休眠→失注）とは**別物**。
- Deal が2件しかないので、**このパイプラインは実質未使用**。今回の設計で Company 側にステージを持たせても既存運用を壊さない。

## 5. Gmail の実態（最大の設計制約）

| 指標 | 値 |
| --- | --- |
| INBOX メッセージ | 97,568（スレッド 80,979） |
| 未読 | 50,395 |
| SENT | 7,628 |
| `BondEx` ラベル | **6スレッド / 80通のみ** |

直近14日の受信を実際に見ると、内容は
メルマガ / 銀行・決済通知 / 他事業（JOJO Nail・nami・JOJO AI Studio・民泊）/ GitHub 通知 / 自動車の充電通知
が大半で、**BondEx の営業スレッドはその中に埋もれている**。

これが HubSpot 側にそのまま流れ込んでいる証拠が、Contact の 98件が `EMAIL_INTEGRATION` 由来で、
`onamae.com` `udemy` `sbcgaming.com` のような**営業対象ではない相手が Contact 化している**こと。
`hs_sales_email_last_replied` が 83件に入っているのも、大半は営業返信ではない。

→ **「Gmailを監視して返信が来たらステージを進める」を素朴に実装すると、
   ノイズでステージが誤爆する。** Phase 2 の設計はここを最初に解く（対象スレッドの確定ロジック）。

なお調査中に**実際の商談返信が1件見つかった**:
`Yumiko@atouchofjapan.com`（2026-08-27 07:42 UTC / 件名「荷物配送に関するお打ち合わせのお願い」）
「8月31日の週で調整可能、候補日時をいくつか」＝**返信あり → MTG調整中** に進めるべき典型例。
Phase 3 の DRY RUN はこの実データで検証できる。

## 6. Fathom の実態

- MCP 経由で接続確認済み。取得できる録画は現在 **1件**
  （`Impromptu Google Meet Meeting` 2026-08-26 / recording_id 176810867 / 録画者 Takuma Taniguchi）。
- 返ってくるもの: AI要約（日本語・見出し付き）、アクションアイテム（担当者付き・タイムスタンプ付きディープリンク）、文字起こし、参加者。
  → **要約品質は十分**。「現状の課題／料金／トライアル／次アクション」がすでに構造化されている。
- **HubSpot 側の Meeting は2件ともサンプル。Fathom→HubSpot は現状まったく繋がっていない。**

> ⚠️ 実装上の注意: この Fathom は **対話ログイン型の MCP** で、cron / 無人実行では使えない可能性が高い。
> 毎朝9時の自動処理に組み込むなら **Fathom の REST API キー**（または Webhook）を別途取得する必要がある。
> Phase 2 で「MCP は人が対話するとき用 / API は自動処理用」と二層に分けて設計する。

## 7. トークンの権限（＝いま出来ること / 出来ないこと）

非公開アプリのトークンは有効（44文字・`pat-na2-`）。エンドポイント別の実測:

| 出来る (200) | 出来ない (403) | 不足スコープ |
| --- | --- | --- |
| Company / Contact / Deal / Task / Meeting / Note の読み書き | **Workflow 一覧・作成** | `automation` |
| プロパティ定義の取得 | **Owner(担当者) 一覧** | `crm.objects.owners.read` |
| Deal パイプライン取得 | **カスタムオブジェクト** | `crm.objects.custom.*` |
| アカウント情報 | **Email オブジェクト(送受信メール)の読み取り** | `connected-email-data-access` |
| | Ticket パイプライン | 公開スコープ外 |

**この4つは今回の要件に直撃する:**
1. `automation` が無いと **「既存Workflowを調査してから追加する」という絶対条件が満たせない**。
   → 現状、既存Workflowが何本動いているか**確認不能**。Phase 2 に進む前に付与が必要。
2. `crm.objects.owners.read` が無いと **Task の担当者(Takuma等)を正しく割り当てられない**。
3. `connected-email-data-access` が無いと **HubSpot に記録済みのメール本文を読めない**
   → Gmail API 側から取る設計にするか、スコープを足すかの分岐になる。
4. さらに **ポータルの契約プラン（Free / Starter / Professional）が API からは判定できない**。
   HubSpot の Workflow は Professional 以上の機能。**Free/Starter なら Workflow 設計は成立しない**。

## 8. 既存の資産（再利用すべきもの）

`bondex-poc-main/` に**すでに動いている HubSpot 同期基盤がある**。ゼロから作らない。

| ファイル | 役割 | 今回の位置づけ |
| --- | --- | --- |
| `lib/hubspot.ts` | HubSpot API クライアント。dry-run スイッチ・429/5xxリトライ・監査ログを内蔵 | **そのまま土台にする** |
| `scripts/crm-sync/sync.ts` | 検索優先→更新/作成、重複防止3層 | **AI書き込み層の下敷きにする** |
| `scripts/crm-sync/schema.ts` | 入力JSONの検証 | AI出力の検証に拡張 |
| `scripts/crm-sync/store.ts` | 同期台帳（冪等化） | イベント処理の重複防止に流用 |
| `scripts/crm-sync/cli.ts` | dry-run 既定・`--apply` 明示・サンプルデータ拒否ガード | **DRY RUN 要件をすでに満たす仕組み** |
| `~/.claude/commands/bondex-sync.md` | 人が営業メモを流す入口 | AI自動化と共存させる（手動フォールバック） |

つまり **「⑨実装コード」は新規開発ではなく、この上に AI 判断層とイベント取り込み層を足す**のが正解。

---

## 9. Phase 2 に進む前に決めていただきたいこと（4件）

| # | 論点 | 選択肢 | 私の推奨 |
| --- | --- | --- | --- |
| 1 | HubSpot の契約プランは？ | Free / Starter / Professional 以上 | プランに関わらず **Workflow に依存しない設計**（自前のAIエージェント層で完結）。Workflowは補助に留める |
| 2 | 不足スコープを追加してよいか | `automation` / `crm.objects.owners.read` / `connected-email-data-access` を非公開アプリに追加 | **追加する**。特に `automation` は「既存Workflow調査」という絶対条件の前提 |
| 3 | ポータルのタイムゾーン US/Eastern・通貨 USD を変えるか | 変える / 変えずにアプリ側でJST固定 | まず **変えずにアプリ側でJST固定**（既存データへの影響ゼロ）。将来まとめて変更 |
| 4 | ノイズ64社・ノイズ98担当者をどう扱うか | 削除 / 放置 / 「営業対象フラグ」で選別 | **削除しない**。新プロパティ 1つで選別する（既存データ無傷） |

---

## 10. この調査で「やっていないこと」（明示）

- 書き込み・削除・プロパティ作成・Workflow作成は**一切していない**
- 既存Workflowの調査は **スコープ不足で実行できていない**（未完了項目として残す）
- Ticket / カスタムオブジェクトは同様にスコープ不足で未確認
- HubSpot の契約プランは API から判定不能のため未確認
