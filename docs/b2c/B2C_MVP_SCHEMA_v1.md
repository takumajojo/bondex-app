# B2C MVP の表の設計案 v1.1（承認待ち）

作成: 2026-11-03。v1.1（同日）: ChatGPT の監査（`docs/b2c/reviews/ChatGPT_B2C_Final_Design_v1.4_20261103.txt`）を受けて、ホテルの事前確認・料金とホテルの控え・二重課金の防止の 3層・事件の記録の種類を追加（監査報告書 16.17）。前提の決定は `docs/b2c/B2C_PLATFORM_AUDIT_v1.md` の 16章（16.7〜16.13）。
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

### `b2c_facilities`（ホテルの事前確認。16.17）

Google のホテル（`place_id`）ごとに 1行。

| 列 | 内容 |
|---|---|
| `place_id` | PRIMARY KEY |
| `name` / `address` / `postal_code` | 確認した時点の表記 |
| `status` | `verified`（フロントに人がいて荷物を預かれる）/ `unknown`（未確認）/ `unsupported`（受けない） |
| `checked_by` / `checked_at` / `check_note` | 確認した担当者・時刻・根拠（公式サイト・電話など） |

- 初期値: B2B で実際に集荷・配達したホテル（2026-11-03 時点で 29件）を、運営が目で見て `verified` にする。
- 初めてのホテルは `unknown` で作り、予約は「ホテル確認中」で受ける（下の `b2c_orders.status`）。
- `unknown` を自動で `verified` にしない。

### `b2c_orders`（ゲストの予約 1件。Q03・16.12）

| 列 | 内容 |
|---|---|
| `id` | uuid |
| `order_number` | **数字の予約番号**（Biz-Logi の管理番号に入れる。マスター 28） |
| `entry_code` | 来た入口のコード（`HNK001`）。**作成後は変えない** |
| `guest_name` / `guest_email` / `guest_whatsapp` | 3つとも必須。WhatsApp は国際形式（E.164）で保存 |
| `language` | 公開時は `en` / `ja`。後で `fr` / `es` / `pt` を足す（16.17） |
| `access_token_hash` | 確認ページの秘密のリンクのハッシュ（リンクそのものは保存しない） |
| `status` | `draft`（入力中）→ `awaiting_hotel_confirmation`（枠は確保済み・ホテル確認中）→ `confirmed` → `completed` / `cancelled`。配送の状態は `shipments.status`、お金の状態は `b2c_payments.status` に分けて持つ |
| `hotel_check_due_at` | ホテル確認の期限（予約から 1営業日。ただし集荷の前日 17:00 を超えない）。過ぎても未確認なら取消して枠を外す |
| `consent_version` / `consented_at` | 規約・課金の同意の版と時刻 |
| `stripe_customer_id` | 予約ごとのゲストの顧客（B2B の代理店の顧客と共有しない） |
| `created_at` / `updated_at` |  |

### `b2c_payments`（カードの枠と請求。P-06・P-03・Q01）

区間ごとに 1行以上（追加の個数は別の行）。

| 列 | 内容 |
|---|---|
| `order_id` / `shipment_id` |  |
| `kind` | `hold`（予約時・7日前の与信）/ `extra`（個数の追加・変更で増えた分） |
| `idempotency_key` | UNIQUE。Stripe の重複防止キーと同じ値（`b2c_<shipment>_<kind>_<連番>`）。同じ請求を二度作れない |
| `stripe_payment_intent_id` | UNIQUE |
| `amount_authorized_yen` / `amount_captured_yen` | 確保した額 / 確定した額（税込） |
| `status` | `pending_hold`（31日以上先で、まだ枠を取っていない）→ `held` → `captured` / `released` / `failed` |
| `hold_due_at` | 枠を取る予定の時刻（集荷の 7日前） |
| `hold_expires_at` | 枠の期限（30日。Amex は 7日） |
| `failure_message` / `attempts` |  |

### `b2c_order_events`（記録。追記のみ。Q09）

予約・変更・取消・枠の確保の結果・手作業の集荷確認・返金を 1行ずつ残す。手作業のものは `staff_name` と `reason` を必須にする（データベースの制約で）。

種類: `booking_created` / `hotel_verified` / `hotel_rejected` / `booking_confirmed` / `hold_succeeded` / `hold_failed` / `reminder_sent` / `pickup_confirmed` / `charge_started` / `charge_succeeded` / `charge_failed` / `shipment_delayed` / `changed` / `cancelled` / `refunded` / `manual_override`。`pickup_confirmed` と `charge_*` は別の行（集荷の確認と請求を混同しない）。

### `b2c_order_snapshots` は作らず、`shipments` の B2C の行に控えを持つ

予約が成立した時点の **料金**（区間の種類・単価・個数・税抜・税・税込）と **ホテル**（両方の名前・住所・郵便番号・チェックイン/アウト・宿泊者名）を、B2C の区間の行に保存し、後から料金やホテルの情報が変わっても過去の予約を変えない。料金は `b2c_payments` ではなく区間の行に持つ（`unit_net_yen`・`route_class`・`price_rule_version` の 3列を `shipments` に足す。B2B の行は null）。

### `b2c_closed_dates`（受付を止める日。H07）

| 列 | 内容 |
|---|---|
| `date` | 止める集荷日（例: 12/31）。PRIMARY KEY |
| `reason` / `created_by` |  |

B2B はこの表を見ない。

## 4. 二重課金の防止（3層）

| 層 | 内容 |
|---|---|
| データベース | `b2c_payments.idempotency_key` と `stripe_payment_intent_id` が UNIQUE。B2C の区間は B2B の課金の列（`charged_at` 等）を使わない |
| Stripe | 同じ `idempotency_key` を Stripe の重複防止キーに使う |
| アプリ | B2B の課金の 4か所で `channel='b2c'` を通さない（`lib/channel-guard.ts`）。売上の確定は `held` の行だけを条件付きの更新で `captured` にする |

B2B の回帰試験: 既存の B2B の課金のテストに加え、「B2C の区間が B2B の課金に入らない」を 4か所それぞれで確かめる。

## 5. 安全のための約束

- すべての新しい表は RLS を有効にし、匿名からの許可は付けない（サーバーだけが触る）。
- 予約・確認ページの API は `B2C_ENABLED` が `true` の時だけ動く。実際の請求は `B2C_CHARGE_LIVE` が `true` の時だけ。追跡による自動の集荷確認は `B2C_PICKUP_AUTOMATION_ENABLED` が `true` の時だけ（OFF の間は運営の手作業の確認だけ）。既定はすべて OFF。B2B は止まらない。
- 金額はサーバーで計算し、画面から送られた金額は信用しない。確認ページのリンクには回数の制限をかける。個人情報はログに出さない。
- 月 3,000件を想定し、`b2c_orders(status)`・`b2c_payments(status, hold_due_at)`・`shipments(channel, shipment_date)` に索引を付ける。
- 確認ページのリンクは推測できない値で、メールアドレスや予約番号だけでは開けない。

## 6. 決めていないこと（実装中に出たら確認する）

- 区間をまたぐ予約の取消: 1区間だけの取消を許すか（今の案: 許す。その区間の枠だけ外す）。
- 予約から何日たった `draft` を消すか（今の案: 24時間）。
