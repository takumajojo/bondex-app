# B2C Stage 5: 集荷の確認と、集荷の後の請求（設計案・承認待ち）

作成: 2026-11-04。前提: `docs/b2c/B2C_MVP_SCHEMA_v1.md` 5章・5.1章・6章（請求と二重請求の防止の基本方針は承認済み）、`B2C_PHASE1A_BETA_PLAN.md` 1章（方式 A）。
この文書は、たくまさんの Stage 5 の着手の承認（2026-11-04）の条件 1〜9 を、表・状態・処理の手順に落としたもの。
実装と試験はローカルの DB と Stripe のテストモードだけ。本番の DB・Stripe・Vercel には何もしない。

---

## 0. 今回、既存のコードを調べて分かったこと（設計に影響するもの）

| 発見 | 影響 | 対策 |
|---|---|---|
| B2B の Stripe の Webhook（`app/api/stripe/webhook/route.ts`）は同じ Stripe のアカウントの通知をすべて受ける。`payment_intent.payment_failed`・`charge.refunded`・`charge.dispute.created` で区間が見つからないと **500 を返して Stripe に再送させる**（2026-08-31 の監査対応） | B2C の請求が失敗・返金されるたびに、B2B の受け口が 3日間 500 を返し続け、運営に誤ったアラートが出る | B2B の受け口の先頭で `metadata.channel === "b2c"` の通知を 200 で無視する（B2B の動きは変えない。最小の変更）。B2C の PaymentIntent の metadata には `shipment_id` を入れない（B2B が B2C の区間を引かないように） |
| Stripe の冪等キー（API v1）は **最初の結果を 24時間以上保存し、その後は消えうる**。**500 の結果も保存される**（同じキーで再送しても同じ 500 が返る）。パラメータが違うとエラー | 「同じキーで再送すれば安全」は 24時間以内・同じパラメータの時だけ。500 の後の再送では回復しない | 下の 3章: お金が動くのは「DB に保存済みの PaymentIntent の確定（confirm）」だけにし、作成と確定を分ける。照合は旅行者ごとの Customer の PaymentIntent の一覧（検索と違い、反映の遅れが無い）で行う |
| Resend の冪等キー（公式の文書を確認）: ヘッダー `Idempotency-Key`、1〜256文字、**24時間保持**、同じキー・同じ内容は送らずに最初の結果を返す、**同じキー・違う内容は 409 `invalid_idempotent_request`**、**同時の要求は 409 `concurrent_idempotent_requests`（後で再試行してよい）**。SMTP で Resend を使う時は `Resend-Idempotency-Key` | Stage 4 の実装は 409 を一律「届いたか分からない」として再試行していた。違う内容の 409 は「前の要求が処理済み」なので、再試行しても直らない | 409 の種類を分ける: `concurrent_idempotent_requests` → 待って再試行、`invalid_idempotent_request` → 再試行せず unknown（運営が照合）。キーは dedupe_key（60文字前後・256以内）、文面は前の試行と同じものを送る（Stage 4 で実装済み）を維持。当社の SMTP は Google のものなので Resend の SMTP のヘッダーは使えない（SMTP は冪等でない扱いのまま） |
| 旅行者の同意の文（`components/b2c/card-step.tsx`）: 「集荷の時にご予約より多い個数をお預けになった場合は、増えた分を同じ1個あたりの料金で請求」 | 追加の請求の上限は「増えた個数 × 同じ1個あたりの税込の料金」に限られる | 追加の請求の額は運営が入力せず、サーバーが式で決める（6章） |
| B2B の追跡の同期（`app/api/cron/sync-tracking`）は、追跡番号のある B2C の区間の状態も更新しうる | 佐川の追跡と運営の集荷確認の食い違いを判定できる | 2章の「矛盾」の判定に使う |

---

## 1. 状態

### 1.1 集荷の確認（新しい表 `b2c_pickup_confirmations`）

```
（なし）──運営が確認──▶ active ──30分の猶予の中で取消──▶ revoked
                          │
                          └─猶予の後は取消できない（請求が始まる。誤りは返金で直す）
```

| 列 | 内容 |
|---|---|
| `order_id` / `shipment_id` | 対象。1つの区間に active は 1つだけ（部分一意の索引） |
| `operator_email` / `credential_id` | 個人のパスキーの運営者（v2 のセッション） |
| `evidence_type` | `sagawa_tracking`（追跡番号で集荷を確認）/ `sagawa_driver`（ドライバー・営業所に確認）/ `hotel_report`（ホテルが引き渡しを報告）/ `other` |
| `evidence_ref` | 追跡番号・連絡の相手と時刻など（必須） |
| `accepted_pieces` | 佐川が実際に受託した個数（必須。予約の個数と違えば 6章） |
| `reason` | 操作の理由（必須） |
| `confirmed_at` | 操作の日時（DB の時計） |
| `revoked_at` / `revoked_by` / `revoke_reason` | 取消 |

操作の記録は `b2c_order_events`（追記のみ）にも残す（運営者・時刻・前後の状態・理由）。

### 1.2 請求（既存の表 `b2c_payments`。状態を 2つ追加）

```
              集荷の確認
                  │
                  ▼
            ┌─ scheduled ─(猶予の中で集荷の確認の取消)─▶ cancelled
            │     │ 30分後・条件の再確認
            │     ├─(条件を満たさない: 矛盾・取消・金額の不一致)─▶ on_hold（運営の要対応）─(運営が解除)─▶ scheduled
            │     ▼
            │  processing（1つの処理だけが取る）
            │     ├─ Stripe で成功 ───────────────────────────▶ succeeded ─(返金)─▶ partially_refunded / refunded
            │     ├─ 本人認証が必要 ─────────────▶ requires_action ─┐
            │     ├─ 残高不足・カード停止など ─────▶ failed ────────┤ 旅行者が支払のリンクで支払う／別のカードに変える
            │     │                                               ├──────────▶ succeeded
            │     │                                               └─ 期限まで回収できない ─(運営が判断)─▶ uncollectible
            │     └─ 結果が分からない（通信の切断・時間切れ・DB の記録の失敗）─▶ unknown ─(照合)─▶ 上のどれか
```

追加する状態: `on_hold`（自動の請求を止めて運営の判断を待つ）、`uncollectible`（回収不能。運営が理由を入れて決める）。
既存のトリガー（請求済みから戻さない・PaymentIntent を差し替えない・請求を始めたら金額を変えない）はそのまま使う。

### 1.3 予約の状態との関係

予約（`b2c_orders.status`）は `confirmed` のまま請求する。基本料金が `succeeded` で、配送が `delivered` になったら `completed`。
請求の状態は My Booking に表示する（Stage 4 で枠は実装済み: 請求予定・請求済み・支払が必要・返金）。

---

## 2. 集荷の確認と 30分の猶予（条件 2・3）

1. 運営が運営の画面で集荷を確認する（個人のパスキーだけ）。入力: 根拠の種類・根拠（追跡番号など）・受託の個数・理由。
2. DB の 1つの関数 `b2c_confirm_pickup` が、1つのトランザクションで次を行う:
   予約の行をロック → 予約が `confirmed`・区間が集荷前（`requested`/`pending`/`issued`）を確かめる → 集荷の確認を作る → 区間を `picked_up` にする（`picked_up_at`）→ 基本料金の請求を `scheduled`（`scheduled_at` = 確認の 30分後）で作る（既にあれば作らない。1予約 1行の一意の索引）→ 記録。
3. 猶予の中の取消 `b2c_revoke_pickup`: 請求が `scheduled` の時だけ。請求を `cancelled`、区間を元の状態に戻し、記録。猶予の後（請求が `processing` 以降）は取消できない（誤りは返金で直す）。
4. 30分の後、定期の処理が `scheduled_at` を過ぎた `scheduled` の請求を取る。**取る直前に DB の関数で条件を再確認**し、1つでも満たさなければ `on_hold` にして運営に知らせる:
   - 予約が `confirmed`（取消されていない）
   - active な集荷の確認がある（取り消されていない）
   - 区間が `picked_up`/`in_transit`/`delivered`（`cancelled`/`failed` でない）
   - **佐川の追跡と矛盾しない**: 追跡番号があり、追跡の同期で集荷前のまま・取消・返送になっている → 矛盾。追跡番号の数が受託の個数と違う → 矛盾
   - 金額が予約の控えと一致する（`unit_net_yen × pieces + 税 = total_gross_yen`、請求の額 = `total_gross_yen`）
   - カードが登録済み（PaymentMethod がある）
   - 同じ予約に `processing`・`unknown`・`requires_action` の請求が無い
   - `B2C_CHARGE_LIVE=true`（OFF なら `scheduled` のまま残す）
5. 運営は `on_hold` を確かめ、理由を入れて解除（→ `scheduled`）するか、請求をやめる（→ `cancelled`）。

---

## 3. 請求と二重請求の防止（条件 4）

### 3.1 お金が動くのは 1か所だけ

**お金が動くのは「DB に保存済みの PaymentIntent を確定（confirm）する」時だけ**にする。PaymentIntent の作成は `confirm: false`（作っただけでは請求されない）。

```
processing を取る（条件付きの更新。1つの処理だけ）
  │
  ├─ 行に PaymentIntent の ID が無い
  │    → 作成（confirm なし・金額は DB の値・metadata に charge_key・order_id・channel=b2c）
  │      冪等キー = charge_key（24時間以内の再送は同じ PaymentIntent が返る）
  │    → ID を DB に保存。保存できなければ確定しない（unknown）
  │
  ├─ Stripe から PaymentIntent を取り直す（確定の前に必ず）
  │    succeeded → DB を成功にするだけ（請求しない）
  │    processing → 待つ（Webhook・次の照合）
  │    requires_action → 支払のリンクへ
  │    requires_payment_method で、このカードで既に失敗済み → 支払のリンクへ（同じカードで自動で何度も試さない）
  │    requires_confirmation / 未試行 → 確定へ
  │
  └─ 確定（off_session）。冪等キー = charge_key + ":c" + 試行の番号（番号は確定の前に DB に保存）
       結果を DB に記録。記録できなければ行は processing のまま → 次の照合で取り直す
```

### 3.2 3つの層

| 層 | 二重請求を防ぐ仕組み |
|---|---|
| DB | `charge_key` の一意、基本料金は 1予約 1行（部分一意の索引）、PaymentIntent の ID は 1請求に 1つで差し替え禁止（トリガー）、請求済みから戻せない（トリガー）、請求の開始は条件付きの更新（`scheduled/ready → processing`）で 1つの処理だけ、返金の合計は請求額まで（関数の中で行をロックして確認） |
| Stripe | 作成の冪等キー = `charge_key`（同じ PaymentIntent が返る）、確定の冪等キー = 試行ごとに固定、成功済みの PaymentIntent は再び確定できない、1つの請求に PaymentIntent は 1つ |
| アプリ | 確定の前に必ず Stripe から取り直す、条件の再確認、定期の処理の二重起動の防止（`cron_locks`）、運営の手動の操作も同じ関数を通る（別の経路で請求しない） |

### 3.3 Stripe で成功し、DB の記録に失敗した場合（必須の条件）

- 確定が成功し記録に失敗 → 行は `processing`（PaymentIntent の ID は保存済み）。次の照合で Stripe から取り直すと `succeeded` → DB を成功にするだけ。**再び確定しない**（Stripe でも成功済みの PaymentIntent は確定できない）。Webhook（`payment_intent.succeeded`）が先に届けば、そちらで記録される。
- 作成が成功し ID の保存に失敗 → 確定はしていない（お金は動いていない）。次の照合で、24時間以内なら同じ冪等キーで作成を再送 → 同じ PaymentIntent が返る → 保存してから確定。24時間を過ぎていれば、旅行者ごとの Customer の PaymentIntent の一覧から `metadata.charge_key` で探し、見つかれば使う。万一 PaymentIntent が 2つあっても、確定するのは DB に保存した 1つだけで、もう 1つは取り消す（確定していないので請求されない）。
- 試験: ローカルの DB で権限を一時的に外して記録を失敗させ、Stripe のテストモードの請求が 1回だけであることを Stripe の側（Customer の PaymentIntent・Charge の一覧）で確かめる。

### 3.4 Webhook

- B2C の受け口（`app/api/b2c/stripe/webhook`・Stage 3 で実装済み）に `payment_intent.succeeded` / `payment_intent.payment_failed` / `payment_intent.requires_action` / `payment_intent.canceled` / `charge.refunded` / `refund.updated` / `charge.dispute.created` を足す。
- 同じ通知は `b2c_stripe_events` で 1回だけ。**通知の中身では判定せず、Stripe から PaymentIntent を取り直して判定**（順序の逆転に強い。古い「失敗」の通知が「成功」の後に届いても、成功のまま）。
- `metadata.channel` が `b2c` でない・`charge_key` が DB に無い → 何もしない（200）。

---

## 4. 決済の失敗と回収（条件 5）

| 場面 | Stripe の結果 | 扱い | 旅行者へ |
|---|---|---|---|
| 残高不足 | `card_declined` / `insufficient_funds` | `failed` | 支払のリンク（別のカード・後で再試行） |
| カード停止・紛失・期限切れ | `card_declined`（`lost_card`・`stolen_card`・`expired_card` 等） | `failed` | 支払のリンク（別のカード） |
| 3D セキュアの追加認証 | `authentication_required` → `requires_action` | `requires_action` | 支払のリンク（本人認証） |
| Stripe の通信障害 | 接続の失敗・5xx | 再送しても結果が同じ場合があるため `unknown` → 照合 | なし（照合で決まるまで） |
| 結果不明 | 時間切れ・切断・記録の失敗 | `unknown` → 照合（3.3） | なし |
| カード変更 | 支払のリンクで別のカードを入れる | 同じ PaymentIntent で確定（新しい請求は作らない）。成功したカードを以後の請求（追加の個数）用に保存（`setup_future_usage`） | 受領の案内 |
| 回収不能 | 支払のリンクを送っても期限までに払われない | 運営が理由を入れて `uncollectible`（自動にはしない） | なし（運営が個別に連絡） |

- **支払のリンク**: `https://…/my/<秘密の token>/pay`（Stage 4 の My Booking と同じ秘密のリンク。検索に載せない）。開いた時にサーバーで請求の状態を確かめ、支払が必要な時だけ Stripe の画面（PaymentElement）を出す。金額はサーバーの値。日本語・英語。
- **案内の送信**: Stage 4 の送信待ち（`b2c_outbox`）で、メールと WhatsApp。新しい種類 `payment_action_required`（支払が必要）、`payment_received`（支払の受領）、`refund_issued`（返金）。再送の案内は 1日目・3日目・7日目（同じ請求に同じ案内は dedupe で 1回）。
- **運営の要対応**: `failed`・`requires_action`・`unknown`・`on_hold`・`uncollectible`・7日以上の未収を一覧に出す。
- **未収の上限（計画 5章・2026-11-04 Stage 6 で訂正）**: 未回収の請求（`failed`・`requires_action`・`uncollectible`）が 2件、または合計 3万円（税込）になったら、新しい予約の受付を自動で止める（既存の予約の集荷・請求・回収は続ける。`B2C_UNPAID_MAX_COUNT`・`B2C_UNPAID_MAX_YEN`）。

---

## 5. 照合（結果が分からない請求・返金）

定期の処理が `unknown` と、10分以上 `processing` の行を照合する。

1. PaymentIntent の ID がある → Stripe から取り直して状態を反映。
2. ID が無い → 3.3 のとおり（24時間以内は同じキーで作成を再送、以後は Customer の一覧で探す）。
3. 照合でも決まらない（Stripe の障害が続く）→ `unknown` のまま、運営に知らせる。**新しい PaymentIntent・新しい冪等キーでの請求はしない。**

---

## 6. 追加の個数と返金（条件 6）

- **個数の違い**: 集荷の確認の `accepted_pieces` が予約の個数と違えば、基本料金の請求は通常どおり予約の個数で行い、差は運営の要対応に出す（自動で請求額を変えない）。
- **増えた時（追加の請求）**: 運営が「追加の請求を作る」を押す。額はサーバーが決める: `(受託の個数 − 予約の個数) × 予約の時の 1個あたりの税込の料金`（旅行者の同意の文のとおり）。運営は額を入力できない。予約の上限（10個）を超える個数は作れない。`kind='extra'`、`charge_key = extra:<order_id>:<集荷の確認の ID>`（同じ確認から 2つ作れない）。30分の猶予の後に、基本料金と同じ手順で請求。
- **減った時**: 自動では返金しない。運営が返金（下）で差額を返す（同意の文に減った時の記載が無いため、運営の判断にする。**要確認 Q1**）。
- **返金**: 個人のパスキーの運営者だけ。DB の関数 `b2c_request_refund` が請求の行をロックし、`返金の合計（requested・succeeded）+ 今回 ≤ 請求額` を確かめてから `b2c_refunds` に `requested` で作る（過剰な返金の防止）。`refund_key = refund:<payment_id>:<連番>`、Stripe の冪等キーも同じ。結果が分からない時は PaymentIntent の返金の一覧（`metadata.refund_key`）で照合し、新しい返金を作らない（二重の返金の防止）。全額で `refunded`、一部で `partially_refunded`。旅行者に返金の案内。

---

## 7. 運営の画面（条件 2・5・7）

`/operator/b2c`（既存の運営のログインの中。操作は個人のパスキーの v2 のセッションだけ。見るだけなら v1 も可）

- **要対応**（上から緊急度の順）: 結果不明の請求・止めた請求（矛盾）・支払が必要（未収・経過日数）・集荷の未確認（集荷日を過ぎて確認が無い）・個数の違い・通知の要確認（Stage 4 の unknown・failed・expired）・確認待ちの予約（期限）
- **予約の詳細**: 予約・配送・請求・返金・通知・記録（操作の履歴）
- **操作**: 集荷の確認・取消（猶予の残り時間を表示）、止めた請求の解除・中止、追加の請求、返金、回収不能、通知の照合（届いていた・再送・送らない）
- どの操作も理由が必須。押した後に確認の画面を出す（返金・回収不能は金額と対象を再表示）。

---

## 8. 安全スイッチと B2B

- `B2C_CHARGE_LIVE`（既定 OFF）: OFF の間は請求を作るだけで確定しない。ローカルの試験だけ ON（テストモードの鍵だけ。本番の鍵は Stage 3 の仕組みで拒否）。
- B2B の変更は 1か所だけ: B2B の Stripe の Webhook で `metadata.channel === "b2c"` を 200 で無視（0章）。B2B の課金の 4経路と追加の清算は Stage 1〜3 の判定で B2C を止め済み。
- B2B の回帰: 金額・配送日数・追跡・課金の入口・運営のセッションに加え、B2B の Webhook の試験（B2B の PaymentIntent は従来どおり処理、B2C は無視）を足す。

---

## 9. 試験（条件 8）

Stripe のテストモード（`pm_card_visa`・`pm_card_chargeDeclinedInsufficientFunds`・`pm_card_chargeDeclined`・`pm_card_authenticationRequired` 等のテストカード）とローカルの DB。結果は Stripe の側（Customer の PaymentIntent・Charge の一覧）でも数える。

| 試験 | 確かめること |
|---|---|
| 集荷の確認の前 | 定期の処理を何度動かしても PaymentIntent 0件 |
| 確認の後 30分以内 | 29分の時点で 0件 |
| 30分の後 | 1回だけ請求（PaymentIntent 1・Charge 1）。続けて動かしても増えない |
| 猶予の中の取消 | 取消の後、何分たっても 0件。猶予の後の取消は拒否 |
| 同時の実行 | 定期の処理 5つ＋運営の手動の再試行を同時に → Charge 1 |
| Stripe 成功・DB 失敗 | 確定の直後に DB の記録を失敗させる → 照合で成功に → Charge 1。作成の直後に失敗させる → 同じ PaymentIntent が返る |
| Webhook | 同じ通知の重複・成功の後に古い失敗の通知・存在しない請求 → 状態が壊れない |
| 通信の障害 | Stripe の接続の失敗 → unknown → 復旧後の照合で 1回 |
| 失敗と回収 | 残高不足・カード停止・本人認証 → 支払のリンク（日本語・英語）→ 別のカード・本人認証で支払 → 成功・同じ PaymentIntent |
| 矛盾 | 追跡が集荷前・追跡番号の数が違う → on_hold・請求 0件 |
| 追加の請求 | 個数が増えた → 額は式どおり・運営は額を変えられない・同じ確認から 2つ作れない |
| 返金 | 一部・全額・合計が請求額を超える要求の拒否・同じ返金の二重の要求 → Stripe の返金 1件 |
| 権限 | 共有パスワード・v1 のセッション・旅行者の鍵では操作できない |
| B2B | 既存の課金の試験一式・B2B の Webhook の動き |

画面の試験（ヘッドレスの Chrome）: 支払のリンクでの本人認証・別のカードでの支払（日本語・英語・スマホ）、運営の画面の主な操作。

---

## 10. 要確認（たくまさんの判断が必要）

- **Q1 個数が減った時**: 同意の文に記載が無い。案: 自動では返金せず、運営が確かめて差額を返金（返金の操作）。
- **Q2 回収不能の判断**: 案: 支払のリンクを 1日目・3日目・7日目に送り、14日を過ぎても未払いなら運営の要対応で「回収不能」を選べるようにする（自動にはしない）。
- **Q3 B2B の Webhook の 1か所の変更**（0章）: B2C の通知を無視する 1行の判定。B2B の通知の扱いは変えない。
- **Q4 WhatsApp のテンプレート**: 支払が必要・受領・返金の 3種（日本語・英語）を Meta に申請する案を作る。承認までは WhatsApp では送らず、メールだけ。

---

## 11. 作業の順番と目安

1. DB（`sql/064_b2c_stage5.sql`）: 集荷の確認の表・請求の状態の追加・集荷の確認と取消・請求の取り方と再確認・返金の関数・未収の数
2. 請求の処理（`lib/b2c/charge-service.ts`）・照合・Webhook・B2B の Webhook の 1行
3. 支払のリンク（`/my/[token]/pay`）・通知の種類の追加
4. 運営の API と画面（`/operator/b2c`）＋Stage 4 の通知の照合の画面
5. 試験（請求の通し・障害・同時・画面）と B2B の回帰
目安: 5〜7日（計画 A09・A11 に相当）。区切りごとに進捗を報告する。
