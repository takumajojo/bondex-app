# P1-B 実PostgreSQL 競合テスト

`scripts/test-sagawa-bulk/run.ts`（純粋ロジックの回帰テスト）では検証できない
**DB レベルの同時実行**を、本番同等イメージ `supabase/postgres:17.11` を隔離起動し、
**独立した 2 接続（2 つの psql バックエンド）の並列実行**で確認する。

```bash
bash scripts/test-sagawa-bulk-db/run_concurrency.sh   # 要 Docker
```

実際の `sql/065_sagawa_bulk_pickups.sql` をそのまま適用し（＝スキーマ自体の適用も再検証）、
PostgreSQL の行ロック・`ON CONFLICT`・条件付き UPDATE の実挙動を確認する。in-memory の模擬ではない。

| シナリオ | 検証内容 | 対応コード |
|---|---|---|
| S1 | 同一集荷単位の同時作成。素の INSERT は unique violation になり、`ON CONFLICT (hotel_key,pickup_date)` upsert は例外なく 1 行に収束する | `applyGroupPlan`（`lib/sagawa-bulk/db.ts`） |
| S2 | 通知 claim の同時取得。条件付き UPDATE で勝者は 1 本だけ（他は 0 行）＝二重送信しない | `claimBulkNotify` |
| S3 | Operator「連絡済み(notified)」× 再集計の競合。再集計はデータ列のみ更新し `status` を書かないため notified を巻き戻さない（status compare-and-set） | `applyGroupPlan` |
| S4 | 予約追加×再集計。2 つの並行 recompute が衝突せず収束し、メンバーは冪等に揃う | `recomputeBulkPickups` |
| S5 | lease 期限切れ後の再取得。期限切れ pending は再 claim 可、新鮮な pending は不可 | `canClaimNotify`/`claimBulkNotify` |

コンテナはテスト終了時に自動削除される（`trap cleanup EXIT`）。本番 Supabase には一切接続しない。
