# BondEx Sales OS — Phase 2 設計書 (2) HubSpot Property 設計

対象成果物: 3(HubSpot Property設計)
前提: HubSpot **無料プラン** = カスタム項目はアカウント全体で **10 個まで**。**現在 10/10 使用済み**。

---

## 1. 現状の 10 枠（全部の内訳）

| # | オブジェクト | 内部名 | ラベル | 型 | 使用実績 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Company | `bondex_category` | BondEx Category | select | **27社で使用中** | ✅ **残す** |
| 2 | Contact | `bondex` | BondEx | text | 0件 | ❌ 削除候補 |
| 3 | Contact | `contact_role` | 担当者の役割 | checkbox | 0件 | ❌ 削除候補 |
| 4 | Contact | `last_purchase_date` | 最終購入日 | date | 0件 | ❌ 削除候補 |
| 5 | Contact | `lead_source` | リードソース | select | 0件 | ❌ 削除候補 |
| 6 | Contact | `purchase_intent_rank` | 購買意欲のランク | select | 0件 | ❌ 削除候補 |
| 7 | Deal | `budget_range` | 予算範囲 | select | 0件 | ❌ 削除候補 |
| 8 | Deal | `campaign_type` | キャンペーンタイプ | checkbox | 0件 | ❌ 削除候補 |
| 9 | Deal | `contract_duration` | 契約期間 | select | 0件 | ❌ 削除候補 |
| 10 | Deal | `expected_roi` | 想定ROI | number | 0件 | ❌ 削除候補 |

> **使用実績 0 件は Phase 3 の DRY RUN で機械的に再確認します。** 上表は
> 「全 111 Contact / 全 2 Deal を取得して当該項目に値が入っているか」を数えた結果を入れる欄です。
> **1 件でも値が入っていた項目は削除対象から外します。** 承認は「値が 0 件であること」を
> 確認したうえで改めていただきます。

### お願いする判断
**2〜10 の 9 個を削除してよいか。** これは「既存 Property を勝手に変更しない」という絶対条件に
触れるため、谷口さんの明示的な承認なしには実行しません。

- 削除しない場合 → **新規プロパティを 1 個も作れません**。設計は成立しますが、
  営業ステージも温度感も HubSpot 画面には出せず、ダッシュボードだけになります。
- 削除する場合 → 8 枠を新設し、2 枠を将来のために残します。

---

## 2. 新設する Company プロパティ（8 個）

すべて `bondex_` 接頭辞で統一し、既存項目と名前が衝突しないようにします。
専用のプロパティグループ **「BondEx Sales OS」** を新規作成し、その中にまとめます
（既存グループ `companyinformation` を汚しません）。

| # | 内部名 | ラベル | 型 | 誰が書くか | 目的 |
| --- | --- | --- | --- | --- | --- |
| 1 | `bondex_stage` | 営業ステージ | enumeration / select | **AI のみ** | 15段階の営業ステージ |
| 2 | `bondex_temperature` | 営業温度 | enumeration / select | **AI のみ** | Cold/Warm/Hot/Champion/Contract/Lost |
| 3 | `bondex_ai_brief` | AI要約（自動生成・編集不可） | string / textarea | **AI のみ** | 課題・価格・競合・決裁者・時期・リスク・返信速度・AIコメントを1枚に |
| 4 | `bondex_next_action` | 次回アクション | string / text | **AI のみ** | Task と同期した1行サマリ（一覧で見えるように） |
| 5 | `bondex_last_contact_at` | 最終接触日時 | datetime / date | **AI のみ** | 休眠判定と優先順位付けの基準 |
| 6 | `bondex_is_target` | BondEx営業対象 | bool / booleancheckbox | AI + 人 | ノイズ会社との選別。**唯一、人が触ってよい項目** |
| 7 | `bondex_reply_speed` | 返信速度 | enumeration / select | **AI のみ** | fast / normal / slow / cold / 未計測 |
| 8 | `bondex_stage_updated_at` | ステージ更新日時 | datetime / date | **AI のみ** | 「何日ステージが止まっているか」の算出 |

**残枠: 2 個**（将来の WhatsApp 対応・想定外の要件のために空けておきます）

### なぜ「課題」「価格感」「競合」を個別項目にしないのか
個別項目にすると 9 個追加で枠が即座に枯渇し、将来なにも足せなくなります。
また HubSpot 無料プランでは**カスタム項目での絞り込み検索・レポートができない**ため、
個別項目にしても検索性が上がりません。
→ **画面で読むためのものは `bondex_ai_brief` に集約し、絞り込み・集計は自前ダッシュボード（Supabase）で行う**
のが、無料プランでの最適解です。

---

## 3. 各プロパティの詳細定義

### 3-1. `bondex_stage`（営業ステージ）

```
groupName:   bondex_sales_os
label:       営業ステージ
type:        enumeration
fieldType:   select
description: BondEx Sales OS の AI が自動更新します。手動で変更しないでください。
             変更が必要な場合は朝の営業レポートから修正を依頼してください。
```

| value | label | displayOrder |
| --- | --- | --- |
| `not_started` | 00 開始前 | 0 |
| `first_email_sent` | 01 初回メール送信 | 1 |
| `replied` | 02 返信あり | 2 |
| `meeting_scheduling` | 03 MTG調整中 | 3 |
| `meeting_booked` | 04 MTG確定 | 4 |
| `meeting_done` | 05 MTG実施 | 5 |
| `poc_arranging` | 06 PoC調整 | 6 |
| `poc_running` | 07 PoC開始 | 7 |
| `poc_success` | 08 PoC成功 | 8 |
| `contract` | 09 契約 | 9 |
| `shipping_started` | 10 送客開始 | 10 |
| `repeat` | 11 継続利用 | 11 |
| `upsell` | 12 アップセル | 12 |
| `dormant` | 90 休眠 | 13 |
| `lost` | 99 失注 | 14 |

> ラベルに番号を付けるのは、HubSpot の一覧が**アルファベット順に並ぶ**ためです。
> 番号がないと「MTG確定」より「返信あり」が上に来て、営業の順序が読めなくなります。

### 3-2. `bondex_temperature`（営業温度）

| value | label |
| --- | --- |
| `cold` | Cold |
| `warm` | Warm |
| `hot` | Hot |
| `champion` | Champion |
| `contract` | Contract |
| `lost` | Lost |

判定は AI が行いますが、**ステージから導かれる既定値を下回らない**制約を付けます
（例: ステージが `contract` なら温度は必ず `contract` 以上）。矛盾表示を防ぐためです。

### 3-3. `bondex_ai_brief`（AI要約）

```
type:      string
fieldType: textarea
```

**書式を固定します**（AI が毎回この順で全文を書き直す）:
```
※この欄は AI が自動生成します。編集しても次回上書きされます。

担当  安藤様（営業部）
最終  2026-08-27 メール受信
課題  ホテルごとの荷物調整に工数がかかっている
価格  未提示（先方から質問はまだ無い）
競合  なし（現状はホテル経由でヤマト運輸）
決裁  安藤様が窓口。決裁者は未確認
時期  10〜11月の案件でトライアル希望
リスク MIKIチームとの社内調整が未着手
返信  平均 4.2 時間（良好）

AIコメント
大口案件の可能性あり。PoC 提案を推奨。

更新 2026-08-27 09:00 JST / 確信度 0.86 / 根拠イベント ev_01J...
```
末尾の「根拠イベント」により、この要約がどのメール/会議から作られたかを追跡できます。

### 3-4. `bondex_next_action`（次回アクション）
`{期限} {内容}` の1行。例: `10/1 PoC対象旅程の受領待ち`
対応する HubSpot Task と常に同じ内容にします（Task が正、この欄は一覧表示用の写し）。

### 3-5. `bondex_is_target`（BondEx営業対象）
唯一、人が手で変えてよい項目です。AI が誤って営業対象と判定した会社を、
チェックを外すだけで対象から除外できます。**AI はこのチェックを外す方向には変更しません**
（人の判断を AI が覆さないため）。

---

## 4. Contact / Task / Meeting / Note の扱い

**新規プロパティは 1 つも作りません。** 標準項目のみ使います。

| オブジェクト | 使う標準項目 | 用途 |
| --- | --- | --- |
| Contact | `email` `firstname` `lastname` `jobtitle` `phone` | AI は**メールの署名から確実に読めるものだけ**書く。推測禁止 |
| Task | `hs_task_subject` `hs_task_body` `hs_timestamp`(期限) `hs_task_status` `hs_task_priority` `hubspot_owner_id` | 次回アクション |
| Meeting | `hs_meeting_title` `hs_meeting_start_time` `hs_meeting_end_time` `hs_meeting_body` `hs_meeting_external_url` | 商談記録（Fathom URL を external_url に） |
| Note | `hs_note_body` `hs_timestamp` | AI 議事録・メール要約 |

### 重複防止（カスタム項目を使わない方法）
Note / Task / Meeting の本文末尾に、機械が読む1行を埋め込みます:
```
bondex-event-id: 01J8XZQ4K7M2N9P0R1S2T3U4V5
```
作成前に `hs_note_body CONTAINS_TOKEN <id>` で検索し、あればスキップします。
**これによりカスタム項目を 1 つも消費せずに冪等性を確保します**（無料プラン 10 枠制約への対策）。

> 参考: 既存 `scripts/crm-sync/sync.ts` は `bondex_sync_key` というカスタム項目を前提にした
> 重複防止層を持ちますが、無料プランでは枠がもったいないため**採用しません**。
> 代わりに Supabase の台帳（`sales_change_set.external_ref`）＋ 上記の本文埋め込みで二重化します。
> 既存 crm-sync は今までどおり「その項目が無ければ自動的に無効化」されるだけで、壊れません。

---

## 5. Task の担当者割り当てについて

ご要望の Task 例（`担当: Takuma`）を実現するには **Owner ID** が必要ですが、
Phase 1 時点では `crm.objects.owners.read` スコープが無く取得できませんでした。
承認いただいたスコープ追加後に取得します。

Phase 1 の実データでは Company 28 社に `hubspot_owner_id = 97527572` が設定されており、
これが谷口さんの Owner ID である可能性が高いですが、**確認が取れるまで決め打ちしません**。
スコープ追加後に `/crm/v3/owners` で名前とメールを突き合わせて確定します。

---

## 6. 変更手順（Phase 4 / 5 で実行。今は実行しない）

```
1. [DRY RUN] 削除候補 9 個の使用実績を全レコード走査で再確認 → 0件を証明
2. [承認]    9個削除の可否を谷口さんに確認
3. [実行]    プロパティグループ「BondEx Sales OS」を作成
4. [実行]    Contact 5個・Deal 4個を削除          ← 差分レポート出力
5. [実行]    Company に 8 個作成                   ← 差分レポート出力
6. [検証]    /crm/v3/properties/companies を再取得し、8個の存在と型を証明
7. [初期化]  既存 27 社に bondex_is_target=true、残り 64 社に false を一括設定（DRY RUN 経由）
8. [初期化]  27社の現在ステージを既存データから推定 → 提案として提示 → 承認後に反映
```

**7 と 8 は「既存データの書き換え」です。** 差分レポート（91 行）を提示し、
1 社ずつ確認できる形にしてから承認をいただきます。

---

## 7. ノイズ 64 社の削除について（谷口さんの回答「削除で良い」を受けて）

削除は承りましたが、**削除だけでは再発します**。根本原因は HubSpot の設定です。

| 発見 | 原因 | 対策 |
| --- | --- | --- |
| 会社 64 社が `CRM_SETTING` 由来で自動生成 | HubSpot の「担当者のメールドメインから会社を自動作成」設定が ON | この設定を **OFF** にする（設定 → オブジェクト → 会社） |
| 担当者 98 名が `EMAIL_INTEGRATION` 由来 | Gmail 連携が**すべての**やり取り相手を Contact 化している | 連携設定で「特定のメールのみ記録」に変更、または除外ドメインを登録 |

**この 2 つを先に止めてから削除しないと、翌日にはまた増えます。**
これらは HubSpot の画面操作（API では変更不可）なので、Phase 5 で手順書をお渡しし、
谷口さんご自身に操作いただく形になります。

また、担当者 98 名についてはご回答をいただいていません。以下を推奨します:

| 対象 | 推奨 | 理由 |
| --- | --- | --- |
| 会社 64 社（`bondex_category` 空・INTEGRATION 由来でない） | **削除** | ご承認済み。営業対象と明確に無関係 |
| 担当者 98 名 | **削除ではなく保留** | メールアドレスは資産。将来営業対象になる可能性がある相手（旅行業ドメイン）が混ざっている。まず `bondex_is_target` で選別し、90日後に見直す |

> HubSpot の削除は 90 日間ごみ箱に残り復元可能ですが、**関連する Note / Task も一緒に消えます**。
> 削除前に全 64 社の一覧（社名・ドメイン・作成日・関連レコード数）を CSV で出力し、
> 承認をいただいてから実行します。
