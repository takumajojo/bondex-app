# B2C staging E2E の実行手順と公開判定（2026-11-09 以降に実行）

PoC刷新トラック。作成: 2026-11-08（B2C 担当）。前提のブランチ: `feat/b2c-p0-1107`（統合ブランチへの取り込みは承認の後）。
P0 の中身は `docs/b2c/B2C_STAGING_E2E_P0_20261107.md` を見てください。

## 0. 始める前の条件（全部そろうまで始めない）

| # | 条件 | 担当 | 承認 |
|---|---|---|---|
| 0-1 | `feat/b2c-p0-1107` を統合ブランチ `integ/bizlogi-b2c` に取り込み、push する | Biz-Logi 担当 | 谷口さん |
| 0-2 | Resend で staging 専用の鍵を作る（送信だけ・ドメイン bondex.express） | 谷口さん | 谷口さん |
| 0-3 | Preview（ブランチ `integ/bizlogi-b2c` だけ）に 4つの値を設定し、Preview を作り直す | Biz-Logi 担当 | 谷口さん |
| 0-4 | 定期の処理を Preview で呼ぶ方法を決める（3章） | Biz-Logi 担当 | 谷口さん |
| 0-5 | staging の DB への書き込み（E2E の入口 1行・E2E の予約・後片付け）を許す | — | 谷口さん |

0-3 で設定する値:

- `STAGING_PLACES_MOCK=true`
- `STAGING_RESEND_API_KEY=<0-2 の鍵>`（Sensitive）
- `STAGING_MAIL_SEND=internal`
- `OPERATOR_EMAILS=support@bondex.express`

`MAIL_TEST_CAPTURE=1` は設定済みなので、変えません。

**止める決まり:** 下の「中止条件」に 1つでも当たったら、そこで止めます。B2C 担当に連絡し、先へ進めません。

## 1. 担当

- **運営者:** 運営の画面の操作と、パスキーの登録。support@bondex.express の受信箱を読める人です。
- **旅行者役:** 予約とカードの登録。旅行者のメールには `…@example.invalid` を使います。support@ は使いません。
- **B2C 担当:**
  - staging の DB を読み取りだけで確かめます（Supabase の連携・select だけ）。
  - Stripe のテストのダッシュボードを確かめます。
- **Biz-Logi 担当:** Vercel の設定と、定期の処理の呼び出し（3章）。

## 2. 実行の手順

### 1. Preview の起動の確認

| 項目 | 内容 |
|---|---|
| 実行者 | Biz-Logi 担当 |
| 画面 | Vercel の Deployments。Vercel にログインしたブラウザで Preview の URL を開く |
| 期待結果 | 統合ブランチの最新のコミットが READY。トップのページが開く（起動の守りで止まっていない） |
| DB の確認 | なし |
| Stripe の確認 | なし |
| 中止条件 | ・デプロイが ERROR<br>・開くと 500 になる<br>・ログに `env-guard` の違反が出る |
| 復旧方法 | ログの違反の名前を見て設定を直し、Preview を作り直す（違反の一覧は `lib/env-guard.ts`） |

### 2. staging の DB の接続の確認

| 項目 | 内容 |
|---|---|
| 実行者 | B2C 担当（読み取りだけ） |
| 画面 | Supabase の連携の select |
| 期待結果 | ・DB の番号 = 7702071863184491885<br>・印 = oeucjrmuigtfnwowvzwr<br>・b2c_orders = 0、operator_passkeys = 0（2026-11-08 の時点の値） |
| DB の確認 | `select (select system_identifier::text from pg_control_system()), (select ref from staging_guard.marker), (select count(*) from b2c_orders), (select count(*) from operator_passkeys)` |
| Stripe の確認 | なし |
| 中止条件 | ・番号・印が違う<br>・予約が 0件でない（他の試験の残り） |
| 復旧方法 | 残りの持ち主を確かめる。消すかどうかは谷口さんが決める |

### 3. 運営のパスキーの登録

| 項目 | 内容 |
|---|---|
| 実行者 | 運営者 |
| 画面 | Preview の `/operator/login`。メールのコードで本人を確かめてから、パスキーを登録する |
| 期待結果 | ・support@bondex.express に認証コードのメールが 1通届く（実際の送信。件名にコードは無い）<br>・パスキーを登録でき、`/operator/b2c` の一覧が 403 にならない |
| DB の確認 | `select count(*) from operator_passkeys where operator_email='support@bondex.express'` = 1 |
| Stripe の確認 | なし |
| 中止条件 | ・コードが届かない（10分）<br>・support@ 以外にメールが届いた<br>・Resend の記録に support@ 以外の宛先がある |
| 復旧方法 | ・Resend の Logs で宛先と失敗の理由を確かめる<br>・`STAGING_MAIL_SEND` を外せば、すべて記録だけに戻る |

### 4. 阪急向けの試験の URL の発行

| 項目 | 内容 |
|---|---|
| 実行者 | B2C 担当が発行する。SQL を流すのは承認の後で、Biz-Logi 担当（staging の確認の印つき） |
| 画面 | 端末。`npx tsx scripts/b2c-entry-link/issue.ts --referrer E2E1109A --name "E2E試験" --expires 2026-11-16 --site <Preview の URL> --target staging` |
| 期待結果 | URL と、ハッシュだけの SQL が出る。SQL を流すと b2c_entry_links が 1行増える |
| DB の確認 | `select referrer_code, status from b2c_entry_links where referrer_code='E2E1109A'` が 1行で active |
| Stripe の確認 | なし |
| 中止条件 | SQL の先頭の確認が「試験環境の DB ではありません」で止まった |
| 復旧方法 | 接続先を確かめる（止まった時は何も入っていない） |

- URL は旅行者役にだけ渡します。チャット・GitHub には貼りません。
- **E2E の開始の時刻**（例: `2026-11-09T10:00:00+09:00`）を記録します。後片付けで使います。

### 5. 架空のホテルで予約

| 項目 | 内容 |
|---|---|
| 実行者 | 旅行者役（スマートフォンで行う） |
| 画面 | 4 の URL。ホテルの検索で「Tokyo」「Kyoto」→ `[TEST ONLY]` のホテルを選ぶ。個数 1、集荷日は選べる中でいちばん早い日 |
| 期待結果 | ・料金は 1個 5,478円（税込・4,980円＋税）<br>・カード登録の画面に進む |
| DB の確認 | ・b2c_orders が 1行で、referrer_code が E2E1109A、unit_net_yen が 4980、status が card_pending<br>・b2c_facilities の 2行が unknown |
| Stripe の確認 | まだ何も無い |
| 中止条件 | ・本物のホテルが出る（模擬が無効）<br>・料金が違う<br>・500 になる |
| 復旧方法 | `STAGING_PLACES_MOCK` を確かめる（Biz-Logi 担当） |

### 6. Stripe のカード登録

| 項目 | 内容 |
|---|---|
| 実行者 | 旅行者役 |
| 画面 | カード登録の画面。テストのカード `4242 4242 4242 4242`。続けて 3D セキュアのカード `4000 0027 6000 3184` で別の予約を作り、認証の画面で 1回は失敗、もう 1回は成功させる |
| 期待結果 | ・登録の後は「ホテルに確認中（まだ確定していません）」<br>・請求はされていない |
| DB の確認 | ・status が awaiting_hotel_confirmation、card_status が registered<br>・b2c_payments が 0件 |
| Stripe の確認 | ・テストの Customer と SetupIntent（succeeded）がある<br>・**PaymentIntent は 0件** |
| 中止条件 | PaymentIntent・Charge が 1件でもできた |
| 復旧方法 | すぐ止める。`B2C_CHARGE_LIVE=false` にして（Biz-Logi 担当）、B2C 担当が原因を調べる |

### 7. ホテルの確認

| 項目 | 内容 |
|---|---|
| 実行者 | 運営者 |
| 画面 | `/operator/b2c` の「ホテルの確認待ち」<br>・京都: 「保留」→ 理由を入れて実行<br>・東京・京都: 「確認済みにする」 |
| 期待結果 | ・保留の後も期限は同じ<br>・両方を確認済みにすると予約が確定する<br>・2回目の押下は「既に他の操作で状態が変わっています」 |
| DB の確認 | ・b2c_order_events に facility_hold・facility_verified（operator_email = support@）<br>・status が confirmed<br>・shipments が 1行 |
| Stripe の確認 | PaymentIntent は 0件のまま |
| 中止条件 | ・確定の前に請求ができた<br>・操作の記録が無い |
| 復旧方法 | 予約を開いて状態を確かめる。必要なら運営の取消（Stripe には何もしない） |

**異常系:** 別の予約で、京都を含む未確認のホテルに「受けない」を押します（影響を確かめるチェックが必須）。

- 予約が取り消されること（hotel_unsupported）。
- 取消の通知が記録だけであること。
- PaymentIntent が 0件であること。

### 8. 集荷の確認

| 項目 | 内容 |
|---|---|
| 実行者 | 運営者 |
| 画面 | `/operator/b2c` で受付番号を入れて「予約を開く」→「集荷を確認」。根拠は「other」と「E2E 試験」、受託の個数は 1 |
| 期待結果 | 「30分後に請求」の予定ができる |
| DB の確認 | ・b2c_pickup_confirmations が 1行<br>・b2c_payments が 1行で、base / scheduled / 5478<br>・scheduled_at が確認から 30分後 |
| Stripe の確認 | PaymentIntent は 0件のまま |
| 中止条件 | すぐに請求された |
| 復旧方法 | 30分以内なら「集荷の確認を取消」（請求をやめる） |

集荷の日の前でも、詳細の画面から確かめられます。集荷日の前は「集荷の未確認」の一覧に出ません。

### 9. 30分後のテストの請求

| 項目 | 内容 |
|---|---|
| 実行者 | Biz-Logi 担当（定期の処理を呼ぶ・3章） |
| 画面 | 定期の処理を 29分の時点で 1回、31分の時点で 1回、さらにもう 1回呼ぶ |
| 期待結果 | ・29分では請求しない<br>・31分で 1回だけ請求する<br>・3回目でも増えない |
| DB の確認 | b2c_payments が base / succeeded / 5478（1行） |
| Stripe の確認 | ・PaymentIntent が 1件で、5,478円・succeeded（テスト）<br>・同じ予約の 2件目が無い |
| 中止条件 | ・2件目ができた<br>・status が unknown のまま 10分以上 |
| 復旧方法 | ・2件目は Stripe のテストで返金する<br>・unknown は照合を待つ（新しい請求は作らない設計）。直らなければ B2C 担当が調べる |

### 10. My Booking の確認

| 項目 | 内容 |
|---|---|
| 実行者 | 旅行者役 |
| 画面 | 確認のメール（記録）にある My Booking の URL。URL は B2C 担当が outbox の rendered から渡す |
| 期待結果 | 状態・ホテル・集荷日・請求の済みが英語・日本語で正しい。フロント向けの案内のページが開く |
| DB の確認 | なし |
| Stripe の確認 | なし |
| 中止条件 | 他の予約の中身が見える |
| 復旧方法 | B2C 担当が調べる |

### 11. 通知の確認

| 項目 | 内容 |
|---|---|
| 実行者 | B2C 担当 |
| 画面 | 読み取りの select |
| 期待結果 | ・b2c_outbox の確認待ち・確定・取消が送信済み（provider = sandbox、外へは出ていない）<br>・Resend の Logs は、3 の support@ 宛てだけ |
| DB の確認 | `select kind, channel, status, provider from b2c_outbox order by id` |
| Stripe の確認 | なし |
| 中止条件 | Resend に旅行者の宛先がある |
| 復旧方法 | `STAGING_MAIL_SEND` を外し、B2C 担当が原因を調べる |

### 12. 取消・返金の異常系

| 項目 | 内容 |
|---|---|
| 実行者 | 運営者 |
| 画面 | 9 の予約の詳細 →「返金」1,000円 → もう一度、残りの全額。さらに、超える額を入れてみる |
| 期待結果 | ・1回目・2回目は成功<br>・超える額は「返金できる額を超えています」<br>・旅行者の取消は、集荷の後はできない |
| DB の確認 | ・b2c_refunds が 2行 succeeded<br>・refunded_yen = 5478<br>・status が refunded |
| Stripe の確認 | ・Refund が 2件、合計 5,478円<br>・3件目が無い |
| 中止条件 | 合計が請求額を超えた |
| 復旧方法 | Stripe のテストで止め、B2C 担当が調べる |

### 13. 試験データの整合性の確認

| 項目 | 内容 |
|---|---|
| 実行者 | B2C 担当（読み取りだけ） |
| 画面 | select |
| 期待結果 | ・E2E の予約の全部が E2E1109A の入口<br>・請求の行の数・額が Stripe と一致する<br>・B2B の shipments に変化が無い |
| DB の確認 | `select o.order_number, o.status, p.status, p.amount_yen, p.refunded_yen from b2c_orders o left join b2c_payments p on p.order_id=o.id order by 1` |
| Stripe の確認 | テストのダッシュボードの PaymentIntent・Refund と、DB の行を 1つずつ照らし合わせる |
| 中止条件 | 一致しない |
| 復旧方法 | 後片付けの前に原因を調べる（消さない） |

### 14. 後片付け

| 項目 | 内容 |
|---|---|
| 実行者 | B2C 担当（dry-run）→ 谷口さんの承認 → Biz-Logi 担当（実行） |
| 画面 | ・dry-run: `bash scripts/staging/cleanup-e2e.sh --run E2E1109A --since <4 の開始の時刻>`<br>・実行: `… --execute --confirm <指紋>` |
| 期待結果 | dry-run の件数が 13 と一致する。実行の後、E2E の行が 0 |
| DB の確認 | `select count(*) from b2c_orders` = 0 |
| Stripe の確認 | テストのデータはそのまま（Stripe 側は消さない） |
| 中止条件 | 台本が STOP を出した（どの条件かが表示される） |
| 復旧方法 | 表示の理由（処理中の請求・集荷依頼など）を解消してから、dry-run からやり直す |

後片付けの最後に、次の 3つを行います。

- `STAGING_MAIL_SEND` を外す。
- Resend の staging の鍵を無効にする。
- 運営のパスキーは残す（次の試験で使う）。

## 3. Stripe のテストの Webhook と Vercel Authentication の扱い

### Vercel Authentication（Preview の保護）

- 外さないでください（谷口さんの方針）。
- 画面の操作は、Vercel にログインしたブラウザで行います。

### Stripe の Webhook

- Preview の URL に Stripe の Webhook は届きません。Vercel Authentication が止めます。`STRIPE_B2C_WEBHOOK_SECRET` も未設定です。
- **今回の E2E では Webhook を使いません。** カード登録の結果は、画面からの照合（`/api/b2c/card/status`）が Stripe から取り直して反映します。請求は Stripe の API の応答で記録し、返金は定期の処理の照合が反映します。
- Webhook の処理（重複・順序の逆転・DB の障害）は、ローカルで試験済みです（`charge_e2e.ts` C07・`card_e2e.py` 06）。
- 本番では Webhook の受け口と秘密の値の登録が要ります（4章 P1）。

### 定期の処理（/api/b2c/cron/tick）を Preview で呼ぶ方法

Bearer の `CRON_SECRET` が要ります。Vercel では Sensitive で、値は画面で見られません。値を知っている Biz-Logi 担当が、次のどちらかで呼びます。

- (a) Vercel にログインしたブラウザの開発者ツールから、同じオリジンに `fetch('/api/b2c/cron/tick', {method:'POST', headers:{Authorization:'Bearer …'}})`。設定の変更は要りません。
- (b) Vercel の「Protection Bypass for Automation」の秘密の値を作り、端末から curl。設定の変更になるので、承認が要ります。

`scripts/ops/vercel-preview-audit.py` は、`CRON_SECRET` を「Preview に置かない名前」に入れています。staging 用の別の値として残すかどうかは、Biz-Logi 担当が決めてください。

## 4. 公開判定（阪急交通社向けの限定 Beta）

P0 は、解決しなければ公開できないものです。P1 は公開の前に解決し、P2 は公開の後に改善します。

| 対象 | P0 | P1 | P2 |
|---|---|---|---|
| 予約 | staging E2E の 5〜6 の合格 | 実機（iPhone Safari・Android Chrome）の確認（B5） | ホテル固定の予約 URL |
| 決済 | staging E2E の 6・9・12 の合格。本番の Stripe の鍵（本番の時だけ） | 本番の Webhook の受け口と秘密の値の登録・受信の確認 | — |
| ホテル確認 | staging E2E の 7 の合格（P0-1 はローカルで合格） | 運営の手順書（だれが・いつ電話するか） | 状態の日本語の表示・優先度 |
| 配送日程 | 本番の佐川の日数の表（既に本番にある） | 直前予約は OFF のまま（`B2C_LATE_BOOKING_ENABLED`） | — |
| My Booking | staging E2E の 10 の合格 | — | — |
| 通知 | 旅行者へのメールの本番の送信（`B2C_NOTIFY_LIVE`・本番だけ）と、送信元のドメインの確認 | 運営への知らせの届き先の確認 | WhatsApp（Beta はメールだけと決定済み） |
| 個人情報 | ローカルで合格（b2c_pii 190・log_pii 58・card_leak 46） | 本番のログの目視（1日分） | — |
| 規約 | **旅行者向けの規約の弁護士の確認（B1・未完了）** | — | — |
| 本番 DB の移行 | sql/061〜083 の本番の適用と確認（手順は Biz-Logi 担当） | 移行の後の照合（行の数・関数の版） | — |
| 本番 Vercel の設定 | B2C の秘密の値（`B2C_ACCESS_TOKEN_SECRET`・`OPERATOR_SESSION_SECRET`・`CRON_SECRET`）・スイッチ・`B2C_SITE_URL` | 本番で `STAGING_*` が無いことの確認 | — |
| 定期処理 | 本番の pg_cron の登録（`sql/ops/b2c_tick_cron.sql`・未登録） | 見張り（cron-heartbeat）が main で動くこと | — |
| 実ホテル検索 | 本番で本物の Google の検索を 1回確かめる（模擬は本番で無効・試験済み） | — | — |
| 阪急との運用合意 | 入口の URL の渡し方・期限・問い合わせ先・取消の決まり・1日の受付の上限の合意 | 停止の連絡の手順 | 紹介料（MVP では無し） |

## 5. 月曜日の実行に要る承認（最小の単位）

1. `feat/b2c-p0-1107` を統合ブランチに取り込み、push する（Biz-Logi 担当）。
2. Resend の staging 専用の鍵を作る（送信だけ・bondex.express）。
3. Preview の 4つの値の設定と、Preview の作り直し（Biz-Logi 担当）。
4. support@bondex.express への実メール（運営の認証コード。数通）。
5. staging の DB への書き込み:
   - 5a: E2E の入口の 1行
   - 5b: E2E の予約の操作（アプリが書く）
6. Stripe のテストモードでの請求・返金（テストのカードだけ。本番の Stripe には接続しない）。
7. 定期の処理の呼び方（3章 (a) か (b)）。
8. 後片付けの実行（dry-run の指紋を見てから）。
