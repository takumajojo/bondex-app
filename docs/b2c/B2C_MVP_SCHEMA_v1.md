# B2C MVP の表の設計案 v1（承認待ち）

作成: 2026-11-03。前提の決定は `docs/b2c/B2C_PLATFORM_AUDIT_v1.md` の 16章（16.7〜16.13）。
**本番のデータベースには何も適用しない。** 承認後に `sql/060_b2c_mvp.sql` として書き、試験の環境だけで動かす。

## 1. 考え方

- **配送の区間は、B2B と同じ `shipments` に 1区間 1行で載せる。** ホテルへの連絡（H02）、佐川シート、追跡、運営の一覧は B2B のものがそのまま動く。
- B2C の区間には `shipments.channel = 'b2c'` と `b2c_order_id` を付ける。代理店名は `BondEx Direct`（`lib/channel-guard.ts` の判定と同じ）。
- **お金と個人の連絡先は B2C 専用の表に置く。** B2B の課金の列（`charged_at` など）は B2C では使わない。B2C の課金は `b2c_payments` が正本。
- B2B の課金の 4か所（`app/api/shipments/route.ts`、`app/api/cron/sync-tracking/route.ts`、`lib/tracking/reconcile.ts`、`app/api/operator/charge-retry/route.ts`）には、`channel='b2c'` を B2B の課金に入れない振り分けを入れる（13.6）。B2B の行の動きは変わらない。

## 2. 既存の表への追加（`shipments`）

| 列 | 型 | 既定 | 内容 |
|---|---|---|---|
| `channel` | text | `'b2b'` | `'b2b'` / `'b2c'`。既存の行はすべて `'b2b'` になる |
| `b2c_order_id` | uuid null | null | B2C の予約への参照 |

注: B2B の `change_deadline_at` は「発送日の 2営業日前 18:00」で自動計算される（`lib/change-deadline.ts`）。B2C は「前日 17:00」なので、B2C の締切は `b2c_orders` 側の判定（`lib/b2c/bookability.ts`）を正とし、`shipments.change_deadline_at` は B2C の値で上書きして保存する。

## 3. 新しい表

### `b2c_entry_links`（紹介元の入口。Q08）

| 列 | 内容 |
|---|---|
| `code` | `HNK001` など。UNIQUE。URL は `/book/HNK001` |
| `referrer_name` | 阪急交通社 |
| `status` | `active` / `disabled`（運営が止める） |
| `created_at` |  |

### `b2c_orders`（ゲストの予約 1件。Q03・16.12）

| 列 | 内容 |
|---|---|
| `id` | uuid |
| `order_number` | **数字の予約番号**（Biz-Logi の管理番号に入れる。マスター 28） |
| `entry_code` | 来た入口のコード（`HNK001`）。**作成後は変えない** |
| `guest_name` / `guest_email` / `guest_whatsapp` | 3つとも必須 |
| `language` | `en` / `nl` / `es` / `pt` |
| `access_token_hash` | 確認ページの秘密のリンクのハッシュ（リンクそのものは保存しない） |
| `status` | `draft`（入力中）→ `booked`（全区間の枠を確保）→ `in_progress` → `completed` / `cancelled` |
| `consent_version` / `consented_at` | 規約・課金の同意の版と時刻 |
| `stripe_customer_id` | 予約ごとのゲストの顧客（B2B の代理店の顧客と共有しない） |
| `created_at` / `updated_at` |  |

### `b2c_payments`（カードの枠と請求。P-06・P-03・Q01）

区間ごとに 1行以上（追加の個数は別の行）。

| 列 | 内容 |
|---|---|
| `order_id` / `shipment_id` |  |
| `kind` | `hold`（予約時・7日前の与信）/ `extra`（個数の追加・変更で増えた分） |
| `stripe_payment_intent_id` | UNIQUE |
| `amount_authorized_yen` / `amount_captured_yen` | 確保した額 / 確定した額（税込） |
| `status` | `pending_hold`（31日以上先で、まだ枠を取っていない）→ `held` → `captured` / `released` / `failed` |
| `hold_due_at` | 枠を取る予定の時刻（集荷の 7日前） |
| `hold_expires_at` | 枠の期限（30日。Amex は 7日） |
| `failure_message` / `attempts` |  |

### `b2c_order_events`（記録。追記のみ。Q09）

予約・変更・取消・枠の確保の結果・手作業の集荷確認・返金を 1行ずつ残す。手作業のものは `staff_name` と `reason` を必須にする（データベースの制約で）。

### `b2c_closed_dates`（受付を止める日。H07）

| 列 | 内容 |
|---|---|
| `date` | 止める集荷日（例: 12/31）。PRIMARY KEY |
| `reason` / `created_by` |  |

B2B はこの表を見ない。

## 4. 安全のための約束

- すべての新しい表は RLS を有効にし、匿名からの許可は付けない（サーバーだけが触る）。
- 予約・確認ページの API は `B2C_ENABLED` が `true` の時だけ動く。実際の請求は `B2C_CHARGE_LIVE` が `true` の時だけ。既定はどちらも OFF。
- 確認ページのリンクは推測できない値で、メールアドレスや予約番号だけでは開けない。

## 5. 決めていないこと（実装中に出たら確認する）

- 区間をまたぐ予約の取消: 1区間だけの取消を許すか（今の案: 許す。その区間の枠だけ外す）。
- 予約から何日たった `draft` を消すか（今の案: 24時間）。
