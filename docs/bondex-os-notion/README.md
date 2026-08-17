# BondEx OS（Notion）設計・構築ドキュメント

BondExの事業全体を管理する **「事業OS（Operating System）」** をNotionで構築するための、実装正典ドキュメント一式です。

これは営業CRMではありません。市場・顧客・PoC・旅行・物流・経営判断までを1つの構造で蓄積し、
今後 **Claude Code が Web検索・企業追加・営業・レポート生成・分析を自動化しやすい** ことを最優先に設計しています。

---

## 設計思想（1行）

> BondExは物流会社ではない。旅行中の「荷物」というストレスを無くすための事業OSである。
> Notionは単なるCRMではなく、BondEx事業全体のOperating Systemとして設計する。

拡張性・保守性・AI連携を最優先。すべてのデータは将来的に分析できるよう構造化する。

---

## ドキュメント構成

| # | ファイル | 内容 |
|---|---------|------|
| 00 | [00-architecture.md](./00-architecture.md) | 設計思想 / 全体ER図 / 7DBの役割 / 命名規約 |
| 01 | [01-database-schema.md](./01-database-schema.md) | 全7DBの完全プロパティ定義（Notion型・Select選択肢） |
| 02 | [02-relations-rollups-formulas.md](./02-relations-rollups-formulas.md) | リレーション配線 / Rollup / Formula の定義 |
| 03 | [03-templates.md](./03-templates.md) | 各DBのページテンプレート仕様 |
| 04 | [04-dashboard.md](./04-dashboard.md) | ホーム（Dashboard）レイアウト仕様 |
| 05 | [05-ai-automation.md](./05-ai-automation.md) | Claude Code連携・自動化設計 / Notion API マッピング |
| 06 | [06-build-guide.md](./06-build-guide.md) | Notion上での構築手順書（この順で作れば完成） |
| — | [schema/bondex-os.schema.json](./schema/bondex-os.schema.json) | 機械可読スキーマ（AI自動化が参照する正典） |
| — | [csv/](./csv/) | 各DBのインポート用CSVテンプレート（雛形＋サンプル行） |

---

## 7つのDatabase（早見表）

| # | Database | 役割 | Title列 |
|---|----------|------|---------|
| ① | **DMC / ランドオペレーター** | 市場・顧客の中核。営業対象の企業台帳 | 会社名 |
| ② | **Meetings** | 商談・打合せの記録と宿題・Next Action | タイトル |
| ③ | **Travelers（旅行データ）** | 需要予測・配送分析の中心。旅行×荷物の実績 | 旅行ID |
| ④ | **Stakeholders** | 空港・ホテル・物流・自治体などの関係者台帳 | 名称 |
| ⑤ | **Documents** | 提案・契約・PoC資料などの文書ハブ | タイトル |
| ⑥ | **PoC** | 実証実験の計画・実績・結果 | 名称 |
| ⑦ | **Decision Log** | 経営判断の記録（背景・選択肢・採用理由・結果） | タイトル |

すべてのDBはリレーションで相互接続され、Dashboardから横断的に集計されます。

---

## なぜこの設計か（AI連携の前提）

1. **正規化 + リレーション**: 会社・旅行・PoC・文書・判断を別DBに分離し、Relationで接続。
   同じ会社を二重入力せず、Claude Codeが「会社に紐づくMeeting/PoC/旅行」をAPIで一発取得できる。
2. **機械可読スキーマ**: [`schema/bondex-os.schema.json`](./schema/bondex-os.schema.json) にプロパティ名・型・選択肢を定義。
   Claude Codeはこれを読めば、DMC自動追加・レポート生成のAPIペイロードを正確に組める。
3. **分析前提の型付け**: 数値は必ずNumber、日付は必ずDate、区分は必ずSelect/Multi-select。
   自由記述に埋めない。これにより配送件数分析・国別分析・需要予測が集計だけで成立する。
4. **自動化フックの内蔵**: 「次回アクション期日」「要フォロー(Formula)」「Fathom URL」など、
   Claude Codeが定期実行で拾える起点をDBに組み込み済み。

詳細は [05-ai-automation.md](./05-ai-automation.md) を参照。
