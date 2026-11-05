# 本番移行チェックリストへの SQL 079 の追加（案）

作成: 2026-11-05。対象: `MyClaudecode/docs/bizlogi-prod-migration-checklist-20261104.md`（統合ブランチを持つセッションの文書。**この案はまだ反映していない**。反映はそのセッションと調整し、たくまさんの承認の後）。
根拠: `sql/079_b2c_legal_versions.sql`・`sql/rollback/rollback_079.sql`・試験 `scripts/test-b2c/db/b1_legal_db.sh`（V0〜V3・L・R）・`scripts/test-integ/migration-rehearsal.sh`（079 を含む 24件・利用者の操作 475件の間に失敗 0・デッドロック 0）。

## 1. 依存と順番

| 項目 | 内容 |
|---|---|
| 前提 | 061（`b2c_orders`）・074（`b2c_charge_check` を置き換える） |
| 位置 | **078 の後・アプリのデプロイの前**（手順2 の最後。2-6d） |
| してはいけないこと | **079 の後に 074 だけを流し直さない**（`b2c_charge_check` が 074 の版に戻り、カードの同意の確認が外れる） |
| 他の SQL との競合 | 番号 079 は B1 だけが使用。080 以降は B6（定期の処理）など。079 は `shipments` など B2B の表に触れない（列・制約・トリガーを足さない） |
| 表の確保 | 前置き（`migration_lock_prefix.sql`）は不要。中で `lock_timeout = 5s`。触れるのは `b2c_orders`（B2C は OFF で利用者の書き込みが無い）と新しい表だけ |
| 1つのトランザクション | 必須（`psql -1` / Supabase の migration）。途中で失敗したら何も変わらない（試験 V1） |

## 2. 手順2 の表に足す行（案）

| # | SQL | 適用後の確認 | 失敗したとき |
|---|---|---|---|
| 2-6d | **079**（B2C の規約の版と同意の記録・B1）。**078 の後・アプリのデプロイの前**。前置きは不要。**B2C の機能のスイッチは OFF のまま** | 表 `b2c_legal_documents` があり 0行（本文の登録は公開の承認の後）。`b2c_orders` に `terms_version`・`terms_lang`・`terms_consented_at`・`card_consent_version`・`card_consented_at` がある。制約 `b2c_orders_card_consent_chk` がある。`b2c_charge_check` の本体に `no_card_consent` がある。anon・authenticated は `b2c_legal_documents` を読めない | 何も変わっていない（1つのトランザクション）。中止しても B2B・古いアプリに影響なし |

確認の SQL（読み取りだけ）:

```sql
select to_regclass('public.b2c_legal_documents') is not null as has_table,
       (select count(*) from public.b2c_legal_documents) as docs,
       (select count(*) from information_schema.columns where table_name = 'b2c_orders' and column_name in ('terms_version','terms_lang','terms_consented_at','card_consent_version','card_consented_at')) as new_cols,
       (select count(*) from pg_constraint where conname = 'b2c_orders_card_consent_chk') as chk,
       (select prosrc like '%no_card_consent%' from pg_proc where proname = 'b2c_charge_check') as charge_check_079,
       has_table_privilege('anon', 'public.b2c_legal_documents', 'select') as anon_can_read;
-- 期待: true / 0 / 5 / 1 / true / false
```

## 3. 新旧のアプリと DB の組み合わせ（試験 V0・V2）

| アプリ | DB | 動き | 対策 |
|---|---|---|---|
| 古い | 079 の前 | 今と同じ | — |
| 古い | 079 の後 | B2B は変わらない。B2C の予約の下書きは書ける。**古いアプリでカード登録した B2C の予約は確定できない**（同意の記録が無いので、請求の対象にしない側に倒れる） | B2C のスイッチは OFF のまま流す（本番の B2C は未公開で、B2C の予約は 0件） |
| 新しい | 079 の後 | 予約の同意とカードの同意を分けて記録 | — |
| 新しい | 079 の前 | B2C の予約の下書きが失敗する（列が無い）。中途半端な予約は作らない。B2B は変わらない | 079 を必ずアプリのデプロイより前に流す |

## 4. 切り戻し（6章に足す行・案）

| 段階 | いつ使うか | 方法 | 時間 |
|---|---|---|---|
| 079 だけ戻す | 079 が原因の不具合（B2C の確定・請求が止まる等） | `sql/rollback/rollback_079.sql`（確定の制約を外す）→ 074 の「7. 請求してよいかの再確認」を流し直す（`b2c_charge_check` を 074 の版に）。同意の記録と規約の本文は消さない | 数秒 |

- 規約の本文の表（`b2c_legal_documents`）は、本番で 1行でも入った後は消さない（同意の記録の根拠になる）。
- L3（DB を全部戻す）の時も 079 の表は消さない（`rollback_067_072.sql` は 079 に触れない）。

## 5. 公開の時（この移行の日ではない・別の承認）

1. 規約の確定・版の名前の変更（`lib/b2c/legal-text.ts`）を含むアプリをデプロイ。
2. `npx tsx scripts/b2c-legal/register-docs.ts > register.sql` → 中身を確かめて本番の DB に流す（追記だけ。違う本文を流すと止まる）。
3. `B2C_LEGAL_PAGES_ENABLED=true` → 規約のページ（日英 4つ）が開くこと・本文が登録した版と同じことを確かめる。
