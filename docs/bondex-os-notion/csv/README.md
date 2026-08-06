# CSV インポートテンプレート

各DBの列を素早く作るための雛形＋サンプル行です。対応関係：

| ファイル | Notion DB |
|---------|-----------|
| 01-dmc.csv | ① DMC / ランドオペレーター |
| 02-meetings.csv | ② Meetings |
| 03-travelers.csv | ③ Travelers |
| 04-stakeholders.csv | ④ Stakeholders |
| 05-documents.csv | ⑤ Documents |
| 06-poc.csv | ⑥ PoC |
| 07-decision-log.csv | ⑦ Decision Log |

## 使い方
1. 対応するDBで `⋯ → Merge with CSV`（既存DB）または `Import → CSV`（新規）で取り込む。
2. 取り込み直後は**全列がText型**。[../01-database-schema.md](../01-database-schema.md) に従い型を修正する
   （Select / Date / Number / Checkbox / Email / Phone / URL など）。
3. Relation / Rollup / Formula 列はCSVに含めない（インポート後にNotion上で作成。[../02-relations-rollups-formulas.md](../02-relations-rollups-formulas.md)）。
4. `（サンプル）` 付きの行は動作確認用。不要なら削除する。

## 記法メモ
- Multi-select（得意国・得意地域・観光地・利用航空会社・タグ）は **セミコロン `;` 区切り**。
  Notionインポート後にMulti-select型へ変換すると自動で分割される。
- Checkbox（北海道案件・団体旅行・FIT・添乗員同行・添乗員）は `Yes`/`No`。型変換で☑に。
- 日付は `YYYY-MM-DD`、時刻付きは `YYYY-MM-DD HH:MM`。
- 金額・重量・件数・人数は数値のみ（単位・カンマを入れない）。
