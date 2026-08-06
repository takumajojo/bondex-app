# 05. Claude Code 連携 / 自動化設計

このOSは「Claude CodeがWeb検索・企業追加・営業・レポート生成・分析を自動化しやすい」ことを最優先に設計しています。
本章は将来の自動化の**契約（インターフェース）**です。

## 5.1 前提セットアップ

1. Notion で **Internal Integration** を作成 → `NOTION_TOKEN`（`ntn_...`）を取得。
2. 「Databases」親ページに Integration を **Connect**（配下DBに権限が継承される）。
3. 各DBの `database_id` を控え、[`schema/bondex-os.schema.json`](./schema/bondex-os.schema.json) の `database_id` 欄に記入。
4. Claude Code は本スキーマを読み、プロパティ名・型・選択肢を正として Notion API（`/v1/pages`, `/v1/databases/{id}/query`）を叩く。

> APIはプロパティを **名前 or ID** で参照する。だからプロパティのリネームは禁止（[00-architecture.md](./00-architecture.md) 命名規約）。
> Notion API バージョンは固定（例: `Notion-Version: 2022-06-28`）。破壊的変更に備え schema.json に `notion_api_version` を持たせる。

## 5.2 自動化ユースケースと入出力契約

各フローの「入力 → 使うDB/プロパティ → 出力」を定義。実装はこの契約に従う。

### A. Web検索からDMC自動追加
- **トリガ**: 「北海道に強いランドオペを5社追加して」等。
- **手順**: WebSearchで候補抽出 → 会社名/URL/所在地/得意国/得意地域/団体・FIT等を推定 →
  **既存重複チェック**（DMCを`会社名`でquery）→ 無ければ `pages.create`。
- **書込先**: DMC の 会社名/URL/所在地/得意国/得意地域/北海道案件/団体旅行/FIT/営業ステータス=`リサーチ済`/
  出典URL/情報取得日/優先順位（暫定`B`）。
- **必ず**: `出典URL` と `情報取得日` を埋める（一次情報の追跡性）。推測値は本文に「推定」と明記。

### B. 会社情報更新
- **トリガ**: 「DMC台帳の古い情報を更新して」。
- **手順**: `最終接触日`や`情報取得日`が古い順にquery → 各社サイト/問い合わせURLを再取得 →
  差分があるプロパティのみ`pages.update`、`情報取得日`を更新。上書き前に旧値をページ本文に追記。

### C. 営業メール作成
- **トリガ**: 「○○社への初回アプローチメール下書き」。
- **入力**: DMC（担当者/役職/得意国/北海道案件）＋関連Meetings（過去接触）＋Documents（提案資料）。
- **出力**: メール下書き（Gmail下書き or Documentsに`種別=提案資料`で保存）。送信は人間承認後。

### D. Meeting要約
- **トリガ**: `要約ステータス=未要約` かつ `Fathom URL` ありのMeeting。
- **手順**: Fathom（`get_meeting_transcript`）で文字起こし取得 → 議事録/課題/宿題/Next Action/PoC化可能性を下書き →
  `pages.update` → `要約ステータス=AI要約済`。人が確認後 `確認済` に。

### E. PoCレポート自動生成
- **入力**: PoC（目標値）＋ Travelers Rollup（実績）＋ Meetings（現場課題）。
- **出力**: `種別=PoC資料/分析レポート` の Document を作成し当該PoCへリレーション。
  内容: 実績vs目標、利用率、国別内訳、課題→改善案、次アクション。

### F. 旅行データ分析 / 配送件数分析 / 国別分析 / 需要予測
- **入力**: Travelers 全件（`/databases/{travelers}/query` をページングで全取得）。
- **分析**:
  - 配送件数分析: `配送件数`,`配送商品数`,`配送重量`,`配送金額` の合計・平均・一件単価。
  - 国別分析: `国籍` でグルーピング。
  - 需要予測: `旅行開始日`の月次推移＋`国籍`×`観光地`。季節性（冬=北海道）を考慮。
- **出力**: 分析レポートをDocumentsに保存、要点をDashboardのcalloutへ反映。

### G. ダッシュボード自動更新
- **手順**: 各DBを軽量query（`filter`＋`page_size`）してCount取得 →
  DashboardのKPI calloutブロックを `blocks.update` で書換（例: `DMC数: 42 / PoC候補: 8 / 北海道案件: 15`）。
- **頻度**: 日次 or 週次（cron的トリガ）。

## 5.3 冪等性・安全のルール（自動化の鉄則）

1. **作成前に重複チェック**（Titleや一意キーでquery）。DMCは`会社名`、Travelersは`旅行ID`が実質キー。
2. **Selectの新値を勝手に増やさない**。schema.jsonの許可値に無い区分は`その他`＋本文注記。
3. **上書きは差分のみ**。破壊的更新の前に旧値を本文へ退避。
4. **送信・公開系（メール送信・外部共有）は人間承認必須**。下書きまでを自動化。
5. **出典を残す**。AI由来データは `生成元=Claude Code` / `出典URL` / `情報取得日` を必ず記録。
6. **APIエラーはリトライ（指数バックオフ）**。レート制限（3 req/s目安）を尊重。

## 5.4 API ペイロード例

### DMC 追加（pages.create）
```jsonc
POST https://api.notion.com/v1/pages
{
  "parent": { "database_id": "<dmc.database_id>" },
  "properties": {
    "会社名":       { "title": [{ "text": { "content": "北海道トラベルオペレーターズ" } }] },
    "優先順位":     { "select": { "name": "A" } },
    "所在地":       { "rich_text": [{ "text": { "content": "札幌市中央区" } }] },
    "URL":          { "url": "https://example.co.jp" },
    "得意国":       { "multi_select": [{ "name": "台湾" }, { "name": "香港" }] },
    "得意地域":     { "multi_select": [{ "name": "北海道" }] },
    "北海道案件":   { "checkbox": true },
    "団体旅行":     { "checkbox": true },
    "FIT":          { "checkbox": false },
    "営業ステータス": { "select": { "name": "リサーチ済" } },
    "出典URL":      { "url": "https://source.example/search" },
    "情報取得日":   { "date": { "start": "2026-08-05" } }
  }
}
```

### 需要分析のための全件取得（databases.query, ページング）
```jsonc
POST https://api.notion.com/v1/databases/<travelers.database_id>/query
{ "page_size": 100, "start_cursor": "<次ページがあれば>" ,
  "filter": { "property": "旅行開始日", "date": { "on_or_after": "2026-01-01" } },
  "sorts": [{ "property": "旅行開始日", "direction": "ascending" }] }
```

## 5.5 リポジトリ内の状態ファイル連携

意思決定が確定したら、Decision Log への記録に加え、リポジトリの状態ファイル
（`~/JOJO/state/bondex.md`。本リポCLAUDE.md参照）に「日付・結論・根拠(ファイルパス)」を1行で追記する運用とする。
NotionのDecision Log = 詳細な一次記録、状態ファイル = 開発判断の索引、という役割分担。
