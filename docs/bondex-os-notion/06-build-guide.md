# 06. 構築手順書（この順で作れば完成）

所要: 約60〜90分。上から順に実行すれば、リレーション不整合なく完成します。

## STEP 0. 器を作る
1. 新規ページ `🏠 BondEx OS` を作成（これが最終的なDashboard）。
2. 配下に `🗄 Databases` ページ、`📚 Docs` ページを作成。
3. `📚 Docs` に本フォルダの各Markdown（00〜06）を貼り付けておくと運用時に参照しやすい。

## STEP 1. 空のDBを7つ作る（プロパティはTitleだけ）
`🗄 Databases` 配下に **フルページDB** を7つ作成。名前は表示名で：
`① DMC / ランドオペレーター` `② Meetings` `③ Travelers` `④ Stakeholders` `⑤ Documents` `⑥ PoC` `⑦ Decision Log`

> ここでは各DBのTitle列だけリネーム（会社名 / タイトル / 旅行ID / 名称 / タイトル / 名称 / タイトル）。
> **先に7つとも存在させておく**ことが重要（リレーションは相手DBが無いと張れない）。

## STEP 2. CSVでベースの列と初期データを入れる（任意だが推奨）
[csv/](./csv/) の各ファイルを、対応するDBで `⋯ → Merge with CSV` もしくは新規DBなら
`Import → CSV` で取り込む。→ Text列としてプロパティが一括生成され、サンプル行も入る。
（Notionはインポート時すべてText型。次STEPで型を直す）

## STEP 3. プロパティ型を [01-database-schema.md](./01-database-schema.md) 通りに設定
各DBで、CSV由来のText列を正しい型へ変更：
- Select / Multi-select … 選択肢は01章の語を登録
- Date … 日付列（`日時`,`受取日時`はInclude time ON）
- Number … 人数/件数/重量/金額（金額・重量は表示形式を調整）
- Email / Phone / URL / Checkbox / Files / Person … 該当列
- （Relation / Rollup / Formula はまだ作らない）

## STEP 4. リレーションを張る（[02章 2.1](./02-relations-rollups-formulas.md) の18本）
R1〜R18を上から順に作成。各リレーションは**片側で作れば相手側に自動生成**される。
自動生成された相手側プロパティ名を、02章の名称にリネームして揃える。

> 同一2DB間に複数リレーション（例: DMC↔PoCのR3/R4、Travelers↔StakeholdersのR12/R13）がある。
> 作成時に「Show on 相手DB」を必ずON、名前を明確化して取り違いを防ぐ。

## STEP 5. Rollupを作る（[02章 2.2](./02-relations-rollups-formulas.md)）
DMCに4つ、PoCに3つ。Relationを選び、対象プロパティと計算方法（Count/Latest/Sum）を設定。

## STEP 6. Formulaを作る（[02章 2.3](./02-relations-rollups-formulas.md)）
DMC.要フォロー / Travelers×3 / PoC×2（＋任意でDecision.要見直し）。
`利用率`『達成率(売上)』はNumber formatを **Percent** に。

## STEP 7. テンプレートを設定（[03-templates.md](./03-templates.md)）
各DBの `New ▾ → + New template` で本文とプロパティ初期値を登録。

## STEP 8. Dashboardを組む（[04-dashboard.md](./04-dashboard.md)）
`🏠 BondEx OS` に各DBの **リンクドビュー**（`/linked` → Create linked view of database）を配置し、
フィルタ・グループ・並び替えを04章の通りに設定。KPIはcalloutまたはビューのCountで表現。

## STEP 9. 初期データ投入
- Decision Log に既知の4判断（ホテル営業停止 / ランドオペへのピボット / FlexyBox採用 / 北海道PoC開始）を記録。
- 既存の商談先をDMCへ、進行中PoCをPoCへ登録。

## STEP 10. AI連携を有効化（[05-ai-automation.md](./05-ai-automation.md)）
1. Notion Integrationを作成し `NOTION_TOKEN` を発行。
2. `🗄 Databases` ページに Integration を Connect。
3. 各DBの `database_id`（URLの32桁）を [schema/bondex-os.schema.json](./schema/bondex-os.schema.json) の `database_id` に記入。
4. これでClaude CodeがDMC自動追加・要約・レポート生成・分析を実行可能。

---

## 完成チェックリスト
- [ ] 7DBが `🗄 Databases` 配下に存在
- [ ] 全プロパティ型が01章と一致
- [ ] リレーション18本（両側の名称が02章と一致）
- [ ] Rollup 7本 / Formula 6〜7本が計算されている
- [ ] 各DBにテンプレートが1つ以上
- [ ] Dashboardに営業状況/PoC状況/今週Meeting/Next Action/各KPI/Documents/Decision Logが揃う
- [ ] Decision Logに初期4判断
- [ ] schema.json に database_id 記入済み・Integration接続済み
