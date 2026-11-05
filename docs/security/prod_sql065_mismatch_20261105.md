# 本番に適用済みの SQL 065 とリポジトリの不一致の記録

作成: 2026-11-05。調べたのは読み取りだけ（本番の DB・他のセッションの作業コピーとも変えていない）。

| 項目 | 内容 | 根拠 |
|---|---|---|
| 本番の DB | migration `065_sagawa_bulk_pickups`（20261105013904 = 2026-11-05 10:39 JST）。表 `sagawa_bulk_pickups`・`sagawa_bulk_pickup_members`・`sagawa_bulk_pickup_events`（RLS 有効・ポリシー 0・行 0） | 本番の migration の一覧・表の一覧（読み取り） |
| 誰の作業か | P1-B「佐川大口集荷アラート＋重複集荷検知」（別のセッション）。たくまさんの承認で本番の DB に適用・main にマージ（PR #101 = 9e54f2a）・Vercel の本番にデプロイ。機能のスイッチ `SAGAWA_BULK_ALERT_ENABLED` は未設定（OFF） | `~/JOJO/state/bondex.md` 2026-11-05 の行、`bondex-poc-p1b-wt`（`feat/p1b-sagawa-bulk-alert`） |
| SQL のファイル | `sql/065_sagawa_bulk_pickups.sql` は **main（origin/main）にある**。P1-B の作業コピーのファイルと同じ中身（SHA-1 `6e9e9e87…` で一致） | `git show origin/main:sql/065_sagawa_bulk_pickups.sql` |
| 統合ブランチ `integ/bizlogi-b2c`（c6bb2ae） | **065 が無い**。main の最新の 2つ（#100 P1-A 団体割引・#101 P1-B）を取り込んでいない（統合ブランチは #99 の時点の main から分かれている） | `git log integ/bizlogi-b2c..origin/main` |
| 番号の重なり | `bondex-poc-bizlogi-wt` に別の `sql/065_facilities.sql` がある（古い番号。統合ブランチでは 069 に付け替え済み）。本番の 065 とは別物 | `bondex-poc-bizlogi-wt/sql/065_facilities.sql` |
| 試験環境 | 本番の今の表の定義を写すので、065 の 3表は入る（`scripts/staging/000_prod_schema_20261105.sql`） | — |

## 影響と、することの案（どれも未実施・承認が必要）

1. 統合ブランチを main にマージする前に、main（#100・#101）を統合ブランチに取り込み、全試験をやり直す必要がある。065 は既存の表を変えない追加だけなので、067〜079 との衝突の可能性は低いが、`shipments` に外部キーを持つため、067〜079 の移行のリハーサルにも 065 の表を入れて確かめる（試験環境では入る）。
2. 本番移行チェックリストの手順1（事前確認）に「本番の migration の一覧に 065 がある（P1-B・適用済み）」を足す。
3. 番号の決まり: 065 は P1-B（本番に適用済み）、067〜079 は統合ブランチ、次は 080 以降。066 の使い道はこの調査では確認していない。
