# B2C MVP の表の設計案 v1.3（承認待ち）

作成: 2026-11-03。v1.3（同日・最終修正）: 決済方式 A を正式採用（たくまさん 2026-11-03）。オーソリの列・状態は持たない。未確認のホテルの期限を min(翌営業日 17:00, 集荷の 2営業日前 17:00) に統一、運営者の個人の認証、集荷確認から請求までの停止条件、佐川の締切との整合を反映（監査報告書 16.20）。それ以前: Codex の監査（`docs/b2c/reviews/Codex_B2C_Phase1A_review_20261103.md`）の 7点と、たくまさんの直前予約の方針（監査報告書 16.19）を反映。

> **2026-11-05 の注記（この文書の後の決定。本文は書き換えていない）**: (1) 本文の「前日 17:00」（予約・変更・取消の締切）は、**集荷の前日 18:30** に変わった（2026-11-04 決定・2026-11-05 確定。`lib/pickup-cutoff.ts`・`sql/071`）。(2) `consent_version`・`consented_at` は予約の画面の同意（規約）だけを表す。カード登録の時の「集荷の確認の後に請求する」同意は `card_consent_version`・`card_consented_at`、規約の版・言語は `terms_version`・`terms_lang`・`terms_consented_at`、版ごとの本文は `b2c_legal_documents`（`sql/079_b2c_legal_versions.sql`）。

**本番のデータベースには何も適用しない。** 承認後に `sql/061_b2c_mvp.sql` として書き、試験の環境だけで動かす。

用語: この文書では「枠」という言葉を使わない。カードについては「カード登録」「請求」、配送については「集荷依頼」と書く。

## 1. 考え方

- **配送の区間は、B2B と同じ `shipments` に載せる。** ただし作るのは「予約が確定した時」だけ（4章）。確定前の予約は `shipments` に現れない。
- B2C の区間には `shipments.channel = 'b2c'` と `b2c_order_id` を付ける。代理店名は `BondEx Direct`。
- **お金・連絡先・ホテルの確認は B2C 専用の表に置く。** B2B の課金の列（`charged_at` など）は B2C の行では使わない（DB の制約で禁止。2章）。
- Phase 1A は **1予約 1区間**（`b2c_orders` 1行 ↔ `shipments` 1行）。

## 2. 既存の表への追加（`shipments`）

| 列 | 型 | 既定 | 内容 |
|---|---|---|---|
| `channel` | text not null | `'b2b'` | `'b2b'` / `'b2c'`。CHECK で 2値に限る。既存の行はすべて `'b2b'` |
| `b2c_order_id` | uuid null | null | `b2c_orders(id)` への外部キー。UNIQUE（1予約 1区間） |
| `route_class` / `unit_net_yen` / `price_rule_version` | text / int / text | null | 予約の成立時の料金の控え（B2C の行だけ） |

制約: `channel='b2c'` ⇔ `b2c_order_id is not null`。`channel='b2c'` の行は `charged_at`・`stripe_payment_intent_id`・`stripe_checkout_url` が null（B2B の課金の経路に入れない）。
注: 変更の締切（`change_deadline_at`）は 16.15 で B2B・B2C とも前日 17:00 に統一済み。

## 3. 新しい表

### `b2c_entry_links`（入口）

紹介元のコードと、URL に使う秘密の値を分ける。

| 列 | 内容 |
|---|---|
| `id` | uuid |
| `referrer_code` | `HNK001`（紹介元のコード。予約に記録する。URL には出さない） |
| `referrer_name` | 阪急交通社 |
| `token_hash` | URL `/book/<token>` の token（推測できない 22文字以上）のハッシュ。UNIQUE |
| `status` | `active` / `disabled`。API でも毎回確かめる（画面だけで判定しない） |
| `created_at` / `disabled_at` |  |

### `b2c_facilities`（ホテルの施設としての確認）

| 列 | 内容 |
|---|---|
| `place_id` | PRIMARY KEY |
| `name` / `address` / `postal_code` | 確認した時点の表記 |
| `status` | `verified` / `unknown` / `unsupported` |
| `checked_by` / `checked_at` / `check_note` | 確認した担当者（7章の運営の識別）・時刻・根拠 |
| `last_verified_at` / `verified_until` | 再確認のため。Phase 1A は `verified_until` を null（期限なし） |

**施設の確認（verified）は、その施設に対応の実績・能力があることだけを示す。個々の予約を受けられるかの確認とは別**（`b2c_hotel_acceptances`）。
**旅行者への説明（規約・予約画面・確定メール）**: 確認済みのホテルで即時に確定した予約でも、ホテルの都合で今回の配送を手配できない場合があること、その場合は BondEx から連絡して予約を取り消し、料金は一切かからないこと（16.21）。

### `b2c_orders`（ゲストの予約 1件）

| 列 | 内容 |
|---|---|
| `id` | uuid |
| `order_number` | 数字の予約番号。UNIQUE。シーケンスで採番（Biz-Logi の管理番号に入る） |
| `entry_link_id` / `referrer_code` | 来た入口と紹介元。**作成後は変えない**（トリガーで更新を禁止） |
| `guest_name` / `guest_email` / `guest_whatsapp` | 3つとも必須。WhatsApp は E.164 で保存し、CHECK で形式を確かめる |
| `language` | `ja` / `en`（Phase 1A） |
| `origin_place_id` / `dest_place_id` | 両ホテル。異なること（CHECK） |
| `pickup_date` / `delivery_date` / 両ホテルのチェックイン・アウト・名前・住所・郵便番号 | 予約の成立時の控え |
| `pieces` | 1〜Phase 1A の上限（10。Phase 1A 計画の 5）。CHECK |
| `total_gross_yen` | サーバーで計算した税込の総額。CHECK > 0 |
| `status` | 4章の状態。CHECK |
| `confirmation_mode` | `instant` / `awaiting_hotel_verification`（未確認のホテル）/ `awaiting_hotel_acceptance`（直前予約）。`lib/b2c/hotel-gate.ts` の `planB2cConfirmation` |
| `confirmation_due_at` | この時刻までに確定の条件がそろわなければ自動で取消（instant は null）。未確認のホテル: min(予約の翌営業日 17:00, 集荷の 2営業日前 17:00)。直前予約: 集荷の前日 18:00 |
| `card_status` | `none` / `registering` / `registered` / `failed` |
| `stripe_customer_id` / `stripe_setup_intent_id` / `stripe_payment_method_id` | カード登録の結果。setup_intent は UNIQUE |
| `card_3ds_result` | 本人認証の**結果**（`authenticated` / `attempted` / `not_required` / `unknown`）。認証を要求したかどうかとは分けて記録する |
| `consent_version` / `consented_at` | 規約と「集荷の確認の後に請求する」ことへの同意の版と時刻 |
| `access_token_hash` | My Booking の秘密のリンクのハッシュ。UNIQUE |
| `replaced_by` | 変更で作り直した新しい予約（6章） |
| `cancelled_at` / `cancel_reason` / `cancelled_by` |  |
| `created_at` / `updated_at` |  |

### `b2c_hotel_acceptances`（予約ごとのホテルの受入の確認）

1予約につき `origin`（集荷元: 荷物を預かって佐川に渡せるか）と `dest`（配送先: 受け取れるか）の 2行。UNIQUE(`order_id`, `side`)。

| 列 | 内容 |
|---|---|
| `order_id` / `side` | `origin` / `dest` |
| `status` | `pending` / `accepted` / `refused` / `no_answer` |
| `method` / `contact_note` | 電話・メールなど、応対者の名前 |
| `decided_by` / `decided_at` | 運営の識別（7章） |

通常の予約（`instant`）でも、通常の連絡の期限（集荷の 2営業日前）までに両方の受入を記録する。B2B の既定（配送先だけに連絡）と違い、**B2C は集荷元にも必ず連絡する**。期限内の連絡で断られた場合も、取消・旅行者への通知・請求なし（6章）。

### `b2c_payments`（請求。方式 A）

| 列 | 内容 |
|---|---|
| `id` | uuid |
| `order_id` | 外部キー |
| `kind` | `base`（予約の基本料金）/ `extra`（集荷の現場で増えた個数など） |
| `charge_key` | **請求そのものの識別**。`base` は `base:<order_id>`、`extra` は運営が作る追加の請求の ID。**UNIQUE**。再試行しても変わらない |
| `amount_yen` | 税込。CHECK > 0 |
| `status` | `scheduled`（集荷の確認の後、30分の猶予の間）/ `ready` / `processing` / `unknown`（Stripe への要求の結果が不明。照合待ち）/ `requires_action`（本人認証などで旅行者の操作待ち）/ `succeeded` / `failed` / `cancelled` / `refunded` / `partially_refunded` |
| `locked_by` / `locked_at` | 処理中の印（条件付きの更新で 1つの処理だけが取る。一定時間で解放） |
| `scheduled_at` | 請求の予定時刻（集荷の確認から 30分後） |
| `stripe_payment_intent_id` | UNIQUE。**1つの請求に PaymentIntent は 1つ**。再試行は同じ PaymentIntent を使う（5章） |
| `attempts` / `last_error_code` / `last_error_message` |  |
| `recovery_link_sent_at` | 回収のリンクを送った時刻 |
| `succeeded_at` |  |

制約: `kind='base'` は 1予約に 1行だけ（部分一意の索引）。

### `b2c_refunds`（返金）

| 列 | 内容 |
|---|---|
| `charge_id` | 外部キー |
| `amount_yen` | CHECK > 0。合計が請求額を超えない（作成時に請求の行を `FOR UPDATE` で固定してサーバーで確かめる） |
| `reason` / `requested_by` | 運営の識別（7章） |
| `refund_key` | UNIQUE。Stripe の重複防止キーにも使う |
| `stripe_refund_id` | UNIQUE |
| `status` | `requested` / `succeeded` / `failed` |

### `b2c_stripe_events`（Webhook の受信の記録）

| 列 | 内容 |
|---|---|
| `event_id` | PRIMARY KEY（同じ通知の再送を 1回だけ処理する） |
| `type` / `object_id` / `received_at` / `processed_at` / `result` |  |

### `b2c_order_events`（記録。追記のみ）

予約・確認・登録・確定・取消・集荷の確認・請求・返金・手作業の上書きを 1行ずつ。手作業の行は、運営の識別（7章）と `reason` を必須（CHECK）。`pickup_confirmed` と `charge_*` は別の行。

### `b2c_ops_days`（日ごとの運営の設定）

| 列 | 内容 |
|---|---|
| `date` | PRIMARY KEY（集荷日） |
| `closed` | true なら B2C の受付を止める（例: 12/31）。B2B は見ない |
| `late_duty_staff` | 直前予約の至急の対応の担当者。null の日は直前予約を受けない |
| `max_new_bookings` / `max_pieces` | その集荷日の受付の上限（Phase 1A 計画の 5） |

## 4. 予約の状態と、確定・配送の手配の時点

`b2c_orders.status`:

```
draft → card_pending → (カード登録の成功) ─┬─ 確定の条件がそろっている → confirmed → completed
                                          └─ そろっていない → awaiting_hotel_confirmation → confirmed / cancelled
cancelled は終点。どの状態からも（集荷依頼の前なら）取消できるが、cancelled から戻らない
```

予約（`b2c_orders.status`）・配送（`shipments.status`）・決済（`b2c_payments.status`）の状態は別々に持つ。

- **確定の条件** = カード登録の成功 **かつ** 両ホテルの条件（`instant` は両施設が verified、`awaiting_hotel_verification` は両施設が verified になった、`awaiting_hotel_acceptance` は両方の受入が accepted）**かつ** 取消されていない **かつ** `confirmation_due_at` の前。
- **確定と `shipments` の行の作成は、DB の 1つの関数 `b2c_confirm_order` の中で 1つのトランザクションとして行う**（`sql/061_b2c_mvp.sql`。16.21）。予約の行をロックして条件を確かめ、確定・`shipments` の作成・記録・通知の積み込み（`b2c_outbox`）をまとめて行う。どれかが失敗すれば全部が無かったことになる。**確定の通知は、このトランザクションが成功した後にだけ、`b2c_outbox` から送る**（送信の失敗は再試行。`dedupe_key` で二重に送らない）。
- **取消は終点。** 取消の後に届いたカード登録の成功の通知では、予約を戻さない（上の更新が 0件で終わる）。登録されたカードは Stripe から外す。
- **期限切れ**: `confirmation_due_at` を過ぎても確定していない予約は、定期の処理で `cancelled`（理由 `confirmation_timeout`）にし、旅行者に通知する。請求は発生しない（請求は集荷の確認の後にしか作らない）。
- **集荷依頼**: `confirmed` の予約だけを、集荷の前日 17:00 以降に佐川へ送る（B2B と同じ運用）。直前予約は、受入の確認が取れ次第、前日 18:30 までに個別に連絡する（11章）。
- **Webhook**: 署名を確かめる。`b2c_stripe_events.event_id` で重複を捨てる。順序が逆に届いても、通知の中身では判定せず、Stripe から最新の状態を取り直して判定する。

## 5. 請求と二重請求の防止

- **請求そのものを一意にする。** `b2c_payments.charge_key` が UNIQUE で、`base` は 1予約に 1行。再試行で新しい行・新しいキーを作らない。
- **1つの請求に PaymentIntent は 1つ。** 最初の試行の前に PaymentIntent を作って ID を行に保存し、それから確定（confirm）する。Stripe の重複防止キーは `charge_key` と同じ値。
- **再試行の前に必ず照合する。** 行に PaymentIntent の ID があれば、Stripe から取り直して状態を見る。`succeeded` なら DB を成功に直すだけで、二度目の請求はしない（Stripe で成功し、DB の記録に失敗した場合の復旧）。`requires_payment_method` なら同じ PaymentIntent で再試行、`requires_action` なら旅行者に回収のリンクを送る。
- Stripe の重複防止キーは 24時間以上たつと消えることがあるので、**長期の重複の防止は DB の UNIQUE と上の照合で行う**。
- 請求の開始は条件付きの更新（`ready → processing`）で 1つの処理だけが取る。運営の手作業と定期の処理が同時に動いても 1回になる。
- **結果が不明な要求**（タイムアウト・通信の切断）: 行を `unknown` にし、**新しい論理の請求も、別の重複防止キーの PaymentIntent も作らない**（16.21）。
  - 論理の請求（`b2c_payments` の行と `charge_key`）は、Stripe に要求を出す**前に** DB に確定して保存する。
  - PaymentIntent の ID が保存済み → Stripe から取り直して状態を照合する。
  - ID が保存されていない（作成の要求の後に DB の記録が失敗した）→ **最初の要求から 24時間以内なら、同じ `charge_key` を重複防止キーにして同じ作成の要求を再送する**（Stripe は最初の結果＝同じ PaymentIntent を返す）。返った ID を保存してから照合する。
  - 24時間を過ぎても ID が無い → 自動では何もしない。`metadata.charge_key` の検索で見つからなくても「存在しない」とはみなさない（検索の反映の遅れがありうる）。運営の要対応に出し、Stripe の管理画面で確かめてから手で処理する。
- **請求済みは DB で再請求できない**: `succeeded` の行から `ready`/`processing` へ戻す更新は CHECK とトリガーで禁止。`base` は 1予約 1行なので、新しい行も作れない。

## 5.1 集荷の確認から請求まで（30分の猶予）

1. 認証済みの運営者（7章）が集荷を確認する。`b2c_order_events` に `pickup_confirmed`（運営者 ID・時刻・対象の区間・理由・前後の状態）を記録。
2. `b2c_payments` の `base` の行を `scheduled`（`scheduled_at` = 30分後）で作る（既にあれば作らない。UNIQUE）。
3. 猶予の間に運営者が集荷の確認を取り消すと、`scheduled → cancelled`（`pickup_confirmation_revoked` を記録）。
4. 猶予の後、定期の処理が `scheduled_at` を過ぎた `scheduled` の行を、**請求の条件を再検証してから** `ready → processing` に進める（条件付きの更新で 1つの処理だけが取る）。
5. 条件を満たせば、5章の手順で PaymentIntent を作って請求する。
6. 結果を記録する（`succeeded` / `requires_action` / `failed` / `unknown`）。
7. 失敗は回収の流れ（回収のリンクをメールと WhatsApp で送る・運営の要対応に出す）へ。

**請求を止める条件**（4 の再検証で 1つでも当てはまれば `processing` にせず、要対応に出す）: 集荷の確認が取り消された／予約が取消されている／集荷の情報に矛盾がある（区間の状態が集荷前・取消、または佐川の追跡と食い違う）／既に請求済み（`succeeded` の行がある）／有効な別の請求が処理中（`processing`・`unknown`・`requires_action` の行がある）／`B2C_CHARGE_LIVE` が OFF（`scheduled` のまま残す）／課金額が確定していない（0 以下・控えと食い違う）。

30分の猶予は二重請求の防止の代わりではない。5章の DB・Stripe・アプリの対策は、猶予と独立に効く。
- **B2B の課金・清算に入れない（実装済み）**: 課金の合図の 4経路（`app/api/shipments/route.ts:301`、`app/api/cron/sync-tracking/route.ts:475`、`lib/tracking/reconcile.ts`、`app/api/operator/charge-retry/route.ts:33`）はすべて `lib/charge.ts` の `chargeShipmentIfDue` を通るので、その入口で B2C の区間を止める（`lib/b2c/b2b-guard.ts`）。5つ目の経路の追加の区間の清算（`app/api/shipments/addition-settle/route.ts`）も同じ判定で止める。試験 `scripts/test-b2c/charge-guard.ts`。加えて 2章の DB の制約で、B2C の行に B2B の課金の列が入らない。

## 6. 取消・変更・返金

| 場面 | 手順（Phase 1A は運営の手作業を含む） | 記録 |
|---|---|---|
| 旅行者の取消（前日 17:00 まで） | My Booking から。`cancelled` にする。集荷依頼の前なので佐川には何もしない。ホテルに連絡済みなら取消を連絡（運営の要対応に出す）。請求は発生しない | `b2c_order_events`、`b2c_hotel_acceptances` に取消の連絡 |
| ホテルが受けられない（通常の連絡で断られた・直前予約で断られた・期限までに回答なし） | 取消し、旅行者にメールと WhatsApp で通知。請求しない | 同上（理由 `hotel_refused` / `confirmation_timeout`） |
| 締切の後の取消 | 運営が受け、世田谷営業所へメール（返信で完了。マスター 174〜178）。集荷されていなければ請求しない | 同上＋佐川の返信の有無 |
| 変更（日付・ホテル・個数） | Phase 1A は運営が対応。**元の予約を取り消し、新しい予約を作る**（料金・同意・ホテルの確認・受入をやり直す）。旅行者には新しい予約の確認ページで同意し直してもらう | 元の予約の `replaced_by` に新しい予約 |
| 集荷の現場で個数が増えた | 運営が `extra` の請求を作る（佐川の受託の個数を根拠に記録）。規約の同意の範囲で請求し、失敗したら回収のリンク | `b2c_payments`（kind=extra） |
| 返金 | 運営が額と理由を入れる。`b2c_refunds` に記録し、Stripe の返金 ID と結果を保存。合計が請求額を超えない | `b2c_refunds`、`b2c_order_events` |

## 7. B2B との分離と運営の権限

**既存のコードで確認したこと（2026-11-03・このブランチ）**:

| 経路 | 現状 | B2C への影響と対策 |
|---|---|---|
| 代理店の API（`app/api/agency/**`） | 代理店名で絞っている（`app/api/agency/shipment/[id]/route.ts:53`、`app/api/agency/label/route.ts:46`、`app/api/agency/shipment/[id]/hotel-change/route.ts:84`。予約の作成は自社名に固定 `app/api/agency/booking/route.ts:332`） | `BondEx Direct` という名前の代理店を作れないようにする（`agencies.name` に CHECK）。これで代理店から B2C の行は見えない・変えられない |
| 運営の API（`app/api/operator/**`、`app/api/shipments`） | `middleware.ts` で `/api/*` は既定で運営の認証が必須（公開ルートは許可リスト） | 運営は B2C も見える（意図どおり）。CSV（`app/api/operator/report/route.ts`）には `channel` の列を足す |
| **公開の追跡**（`app/api/track/[bookingId]/route.ts`） | **認証なし**で予約番号（`BDX-XXXXXX`）から区間・ホテル・日付・姓を返す | B2C の行は返さない（`channel='b2c'` を除外）。B2C の旅行者は My Booking の秘密のリンクで見る。B2B の動きは変えない |
| **WhatsApp の自動応答**（`lib/whatsapp-tracking.ts`） | 予約番号・追跡番号で区間を引いて返す | 同じく B2C の行を除外 |
| B2B の課金の 4経路＋追加の清算 | すべて `chargeShipmentIfDue` か `addition-settle` を通る | 両方の入口で B2C を止める（実装済み・5章）＋2章の DB の制約 |

試験: 上の各経路について「B2C の行が見えない・変えられない」を自動の試験にする（Phase 1A 計画の A12）。

**運営者の個人の認証（Phase 1A で必須）**: 今の運営のセッション（`lib/operator-session.ts` の `issueOperatorSession`）は「v1.有効期限」だけを署名しており、**誰が操作したかを持たない**。共有パスワード（`OPERATOR_PASSWORD`）でも入れる。
一方、パスキーの登録（`app/api/operator/passkey/register-verify/route.ts`）は、許可された運営者のメールアドレス（`lib/operator-webauthn.ts` の `operatorEmailAllowed`）へのワンタイムコードで本人を確かめてから行っている。これを再利用する。

- `operator_passkeys` に `operator_email` の列を足し、登録の時に確かめたメールアドレスを保存する（既存の登録は email が空なので、B2C の操作の前に登録し直す）。
- パスキーでログインした時のセッションを `v2.<有効期限>.<credential_id>` にする。B2B の画面は v1 も v2 も今までどおり受ける（B2B の動きは変えない）。
- **B2C の手作業**（集荷の確認と取り消し・返金・ホテルの施設の確認と予約ごとの受入・追加の請求・予約の取消の代行）は、v2 のセッションで、`operator_email` が登録済みのパスキーの時だけ実行できる。共有パスワード・サーバー間の Bearer・v1 のセッションでは拒否する。
- 記録（`b2c_order_events`）に残すもの: 認証済みの運営者 ID（`operator_email`）・`credential_id`・操作の日時・対象（予約・区間）・操作の内容・理由・操作の前後の状態。追記のみ。

**Supabase の注意**: サーバーの特権キーは RLS を通らない。新しい表に RLS を付けても、守りの本体は API の権限の確認（上の表の対策）。

## 8. 安全スイッチ

| スイッチ | OFF の時 |
|---|---|
| `B2C_BOOKING_ENABLED` | 新しい予約の受付（入口・予約・カード登録）を止める。既存の予約の閲覧・取消・確定の処理は動く |
| `B2C_MY_BOOKING_ENABLED` | 既存の予約の確認ページを止める（緊急時だけ。通常は ON） |
| `B2C_CHARGE_LIVE` | 請求を実行しない。`scheduled`/`ready` の請求はそのまま残し、ON に戻した時に 5章の照合を経て 1回ずつ処理する |
| `B2C_PICKUP_AUTOMATION_ENABLED` | 追跡による自動の集荷確認をしない（Phase 1A は OFF。運営の手作業だけ） |

既定はすべて OFF（`B2C_MY_BOOKING_ENABLED` は公開時に ON）。どれも B2B を止めない。今の `lib/b2c/flags.ts`（`B2C_ENABLED`・`B2C_CHARGE_LIVE`）は、実装時にこの 4つに分ける。

## 9. その他の安全

- 金額はサーバーで計算し、画面から送られた金額は使わない。
- 入口・予約・My Booking の API には回数の制限（`lib/rate-limit.ts`）。
- **受付の上限は DB で保証する**（`b2c_orders_capacity` のトリガー）。上限は**集荷日ごと**。受付の枠を使う状態（`card_pending` 以降）に入る時に、その集荷日の `b2c_ops_days` の行をロックして件数と個数を数える。同時に最後の 1枠を取りに来ても片方は失敗する。画面の表示は案内にすぎない。
- **未収による自動の停止は新規の受付だけ**を止める（`B2C_BOOKING_ENABLED` 相当）。既存の予約の集荷・通知・請求・回収は続ける。
- 個人情報（名前・メール・電話）はログに出さない。
- 新しい表はすべて RLS を有効にし、匿名からの許可は付けない。
- 索引: `b2c_orders(status, confirmation_due_at)`、`b2c_payments(status, scheduled_at)`、`shipments(channel, shipment_date)`。

## 10. 締切の一覧（16.20）

| 締切 | 時刻 | 根拠 |
|---|---|---|
| 旅行者の予約の締切 | 集荷の前日 17:00 | D03 |
| ホテルへの通常の連絡の期限 | 集荷の 2営業日前 17:00 | `lib/hotel-notification.ts` |
| 未確認のホテルの施設の確認 | min(予約の翌営業日 17:00, 集荷の 2営業日前 17:00)。2時間未満の日は選べない | `lib/b2c/hotel-gate.ts` |
| 直前予約の受入の確認 | 集荷の前日 18:00。**佐川が新規の集荷の依頼を前日 18:30 まで受けると確認できるまで、直前予約は受けない**（`B2C_LATE_BOOKING_ENABLED` 既定 OFF） | 同上・16.21 |
| 佐川への集荷の連絡（Phase 1A・運営の手作業） | 集荷の前日 18:30 まで（世田谷営業所への連絡。緊急の変更は 18:30 まで、カスタマーサービスは 9:00〜19:00） | `docs/sagawa/BondEx_Sagawa_BizLogi_Master_FULL_20261103.txt` 181・182 |
| （参考）Biz-Logi の API での集荷依頼の締め | 集荷の前日 20:00（土日祝も同じ） | 同 78・79。Phase 1A は使わない |
| 予約の変更の締切 | 集荷の前日 17:00（個数は 14日前・30個以上は 7日前から変更不可） | 16.15・16.16 |
| 取消の締切（旅行者が自分で） | 集荷の前日 17:00。その後は運営が世田谷営業所へ連絡（返信で完了） | 16.15・マスター 174〜178 |

## 11. 決めていないこと（実装中に確認する）

- 荷物の重さの上限と、受け付けない品物の一覧（佐川の規則に合わせる。佐川の資料で確認する）。
- `draft` を消すまでの時間（案: 24時間）。
