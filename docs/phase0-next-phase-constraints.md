# 団体配送・チャーター — 次工程への設計制約（Phase 0 整理 / 2026-11-04）

Phase 0 では実装しないが、次工程（団体25個以上8%割引・チャーター見積・大口事前連絡）で守るべき設計上の制約を確定事項として整理する。

## 1. 団体ボリューム割引の判定単位 = 配送区間（leg）ごと
- 判定は **配送区間（leg）ごとの個数**（= `shipments` 1行の `suitcase_count`）で行う。**予約全体（`booking_id`）の合計では判定しない**。
- **往復は合算しない**：往路13個 + 復路13個（2 leg）を 26個として割引対象にしない。各 leg は 13個 < 25個 で対象外。
- 代理店別契約単価（`agencies.unit_price_yen`）がある場合は契約単価を優先し、**8%割引と併用しない**。
- **FIT・チャーターは割引対象外**（チャーターは `discountable:false`）。
- Phase 0 では未有効（`GROUP_DISCOUNT.enabled=false`）。ロジックと単体テストのみ整備済み（`lib/pricing.ts` の `GROUP_DISCOUNT` / `isGroupVolumeDiscountApplicable` / `lineSubtotalYen`、`scripts/test-pricing/run.ts`）。

## 2. 佐川「大口事前連絡」の状態管理（将来・Phase 0 では DB 追加しない）
通常配送でも **20個以上は佐川への事前連絡が必要**。これを扱う際の制約：

- **判定単位 = 同一集荷元ホテル × 同一集荷日の合計個数（集荷単位）**。配送区間単位でも予約単位でもない（1回の集荷で運ぶ物量の話のため）。
- **3つの状態を独立管理する（互いに流用しない）**：
  1. **集荷依頼済み** — 既存 `shipments.pickup_requested_at`。これは「（通常の）集荷を依頼した」フラグ。**大口事前連絡の完了フラグに流用しない**。
  2. **佐川への大口事前連絡済み** — 将来の新カラム（例：`sagawa_bulk_notified_at`）。上記 1 とは別物。
  3. **Biz-Logi 登録済み** — 将来の新カラム（例：`bizlogi_registered_at`）。1・2 とは別物。
- **アラート（Operator TODO「20個以上：佐川へ事前連絡」）は個数（集荷単位）で駆動**し、Biz-Logi 登録状態（3）とは独立。
  - 「2. 大口事前連絡済み」が未完なら TODO を表示し、2 の完了で解消する。
  - 「3. Biz-Logi 登録」では TODO を解消しない（登録と事前連絡は別業務）。
- **Phase 0 では新カラムを追加しない**。次工程で 2・3 を追加する際、1（`pickup_requested_at`）と明確に区別すること。

## 3. 関連
- Phase 1 監査 ③：Biz-Logi は本番 `origin/main` に未実装（コメントのみ）。将来 `feat/bizlogi-client` をマージする際は、Ship&co の `test` 相当の安全弁・`issue-due` の20件上限・冪等（`issue_claimed_at`）の引き継ぎを必ず確認。
- 送り状発行スイッチ：`lib/waybill-issuance.ts`（`AUTO_ISSUE_ENABLED === "true"` でのみ発行・既定OFF）。
