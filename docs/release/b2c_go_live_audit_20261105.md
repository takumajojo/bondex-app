# BondEx B2C 本番公開の前の統合監査・staging の全工程の試験の計画

作成: 2026-11-05。**調査・設計・計画だけ。** main・統合ブランチへのマージ、Vercel の staging へのデプロイ、外部の Webhook の設定、Stripe のテストの決済は、まだ行っていない（承認待ち）。本番の環境は変えていない。
方針: 次は「機能を増やす段階」ではなく「本番で安心して使えることを証明する段階」。成功の確認だけでなく、**失敗した時に安全に止まるか**を重点に確かめる。P1-B2（実際の集荷の個数の差・課金の保留）は B2C の公開の必須の条件と混ぜず、別の工程として扱う。

## 0. 調べた時点の状態

| 対象 | 状態 |
|---|---|
| origin/main | 9e54f2a（#101 P1-B 大口・重複集荷）← 1591451（#100 P1-A 団体 8%）← a23ab1b（#99） |
| 統合ブランチ `integ/bizlogi-b2c` | c6bb2ae。**main とは #99（a23ab1b）で分かれ、#100・#101 を含まない** |
| 検証ブランチ `verify/b1-integ-e2e` | acfba7a（c6bb2ae ＋ staging のスクリプト・監査の文書・誤接続の防止） |
| P1-B のブランチ（別のセッション） | `design/p1b-notify-separation` c55f296（PR #103 通知の分離・ドライラン）。PR #102（cron の予定）は別のブランチ。どちらも main には未マージ |
| staging の DB | 構築済み・検証 35/35（`docs/security/staging_build_report_20261105.md`） |

## 1. 最新の main との統合のリスク（Track A）

### 1.1 試しのマージ（捨てる作業コピーで実施。どのブランチも変えていない）

統合ブランチに origin/main をマージしてみた結果:
- **文字の衝突 2件**: `app/api/agency/booking/route.ts`・`app/api/operator/adjust-count/route.ts`。どちらも **import の行だけ**（両方の import を残せば解ける）。
- 両方が変えた残り 3件（`app/api/shipandco/create/route.ts`・`app/operator/dashboard/page.tsx`・`lib/agency-notify.ts`）は自動でまとまった。
- 解いた後の確認（試しのマージの上で）: 型 エラー 0 ／ lint エラー 0（警告 129 は既存）／ 料金 47/47・金額 14/14・大口集荷 47/47・B2C 34・B1 23・Biz-Logi の通し 88・集荷依頼 110・配送日数 28・追跡 8 — **すべて合格**。

### 1.2 実行の時の意味の衝突（文字の衝突が無くても起きるもの）

| # | 対象 | 調べた結果 | 判定 |
|---|---|---|---|
| A-1 | #100 団体 8% と B2C の料金 | B2C は `lib/b2c/pricing.ts` で、main が変えた `lib/pricing.ts` を使わない | B2C に影響なし |
| A-2 | #100 と統合ブランチの個数の変更の経路 | 統合ブランチが足した呼び出し（`lib/pickup-request/apply-effects.ts`・変更申請の承認）も `amountForNewCount` を使い、区間の行を全部（`select("*")`）渡すので、割引の判定の材料（`booking_type`・`created_at`）が届く。B2C の区間は手前で止める（`isB2cShipmentRow`） | 意味の衝突なし。**割引を ON にする時は、変更申請の経路でも割引が付くことを試験に足す** |
| A-3 | `adjust-count` | main = `lineSubtotalYen`（割引の単一入口）、統合ブランチ = ロックの時に 409。解いた形は両方が働く | 解ける |
| A-4 | `shipandco/create` | main の `lineSubtotalYen` と、統合ブランチの「B2C の区間は Ship&co で発行しない（409）」が両方入る | 問題なし |
| A-5 | `agency-notify` | main = 区間ごとの概算（割引）、統合ブランチ = 締切の文を 18:30 に。自動でまとまり、両方の変更が入る | 問題なし（文面の試験を足す） |
| A-6 | #101 大口集荷と B2C の区間 | 集計は `shipments` を読むだけで**書かない**（集荷依頼のロック 068/072 と衝突しない）。経路で絞らないので **B2C の区間も同じホテル・同じ日の個数に数える**（佐川の集荷は同じなので正しい）。B2C の代理店名 `BondEx Direct` も 1社と数える | 正しいが、**B2C の予約の確定・取消では集計し直さない**（すぐ集計し直すのは B2B の予約の経路だけ）。大口の検知を ON にする時は cron（PR #102）の間隔の分だけ遅れる → B2C の確定・取消の後にも集計し直すかを決める |
| A-7 | #101 の表（sql/065）と 067〜079 | 本番に 065 は適用済み。staging で 065 の表がある状態で 067〜079 が全部成功・065 の表は main の SQL と 71項目で一致 | 衝突なし。番号は 065＝P1-B、067〜079＝統合ブランチ、次は 080 以降 |
| A-8 | cron | GitHub Actions の 9本はすべて本番の URL（`https://bondex.express`）と本番の秘密を使う（staging には届かない）。Vercel の cron の設定ファイルは無い。定時の処理の二重起動の鍵の名前はすべて別（`sagawa-bulk-alert`・`pickup-watch`・`b2c-tick`・`sync-tracking` ほか） | 衝突なし。PR #102 が足す予定と、統合ブランチの pg_cron（`pickup-watch`・`b2c-tick`）を本番で重ねて登録しないよう、登録の一覧を 1か所にまとめる |
| A-9 | 環境変数・機能のスイッチ | main: `GROUP_DISCOUNT_ENABLED`・`GROUP_DISCOUNT_ENABLED_AT`・`SAGAWA_BULK_ALERT_ENABLED`（いずれも既定 OFF）。統合ブランチ: `B2C_*`・`BIZLOGI_*`・`B2C_LEGAL_PAGES_ENABLED`。名前の重なりは無い。**共有は `CRON_SECRET` と運営への通知（`ALERT_EMAIL`・support@）** | 大口集荷の通知（PR #103）と B2C・集荷依頼の監視の通知が同じ宛先に届く。件名で見分けられること・量を確認 |
| A-10 | 共有の部品 | `lib/pricing.ts`・`lib/amount-recalc.ts`・`lib/agency-notify.ts`・`lib/voucher-pdf.tsx`・`app/api/shipandco/create`・運営の画面。B2C は B2B の課金の入口で止まる（`lib/charge.ts` の `isB2cShipmentRow`） | 試験で確認済み |

### 1.3 統合の計画（案・未実施）

1. P1-B のセッションと順番を決める（PR #103 → #102 → main。その後に統合ブランチへ main を取り込む、の順が衝突が少ない）。
2. 統合ブランチに origin/main を取り込む（import の 2件を解く）→ 全試験（下の 4章の自動の分）→ 統合ブランチの持ち主のセッションと確認。
3. staging の DB は本番の写しの上で作っているので作り直しは不要（065 を含む）。
4. main へのマージは、5章の公開の判定を満たした後に別の承認。

## 2. staging の接続の構成（Track B）

```
旅行者・運営（実機・PC） ──https──▶ Vercel「bondex-staging」project（staging 専用の URL・Deployment Protection）
                                         │  BONDEX_ENV=staging（誤接続の防止が働く）
                                         ├──▶ Supabase bondex-staging（oeucjrmuigtfnwowvzwr）だけ
                                         ├──▶ Stripe テストモード（sk_test_ / pk_test_）
                                         ├──✕ メール（MAIL_TEST_CAPTURE=1: 送らず記録だけ）
                                         ├──✕ WhatsApp・LINE・Slack・Ship&co・Biz-Logi・Google Drive（設定しない）
                                         └──▶ Google の場所の照会（読み取り・試験の回数だけ）
Stripe テストモード ──Webhook（staging 専用の受け口・署名の秘密も staging 専用）──▶ /api/b2c/stripe/webhook?x-vercel-protection-bypass=…
```

| 項目 | 決め |
|---|---|
| Vercel | **本番とは別の project**（例 `bondex-staging`）。本番の project の Preview の環境変数は使わない（本番の値が入っている可能性を消す） |
| URL | `bondex-staging-*.vercel.app`（独自のドメインは付けない。付けるなら `staging.` の付く名前） |
| 保護 | Deployment Protection を ON。Stripe の Webhook だけ「Protection Bypass for Automation」の秘密を URL に付けて通す |
| DB | `bondex-staging`。接続は Supabase の鍵（アプリ）だけ。アプリの環境変数に DB のパスワードは入れない |
| 運営の入口 | staging の DB の `operator_passkeys` に、staging 用のパスキーを登録（本番とは別）。`OPERATOR_SESSION_SECRET` は staging 専用。共有パスワード（v1）は使わない |
| 代理店の入口 | staging の Supabase Auth に試験用の利用者だけ（本番の利用者は写さない） |
| 定時の処理 | 最初は登録しない。試験で必要な時だけ、試験の担当が手で呼ぶ（`CRON_SECRET` は staging 専用）。登録する時は pg_cron（staging の DB）で、呼ぶ先は staging の URL だけ |
| 誤接続の防止（実装済み・acfba7a） | `BONDEX_ENV=staging` の時、起動（`instrumentation.ts`）・DB のクライアント・B2C の Stripe のクライアントの作成で、本番の Supabase・本番の鍵・本番のドメイン・実際のメールの送信・WhatsApp/LINE/Slack・Ship&co・Biz-Logi・Google Drive・自動の発行の設定を見つけたら止める（起動の時はプロセスを終了）。値は出さず、変数の名前と理由だけを出す。試験 25件合格・本番用のビルドで「本番の Supabase の URL」なら起動しない（終了コード 1）ことを確認。`BONDEX_ENV` が無ければ何もしない（普通に起動して 200） |

## 3. 必要な環境変数（staging）

**値はこの文書にも、チャットにも書かない。** Vercel の staging の project の「Production」（その project の本番 = staging）に入れる。

| 変数 | staging の値 | 備考 |
|---|---|---|
| `BONDEX_ENV` | `staging` | 誤接続の防止を ON |
| `STAGING_SUPABASE_REF` | `oeucjrmuigtfnwowvzwr` | 防止の照合用 |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://oeucjrmuigtfnwowvzwr.supabase.co` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging の Publishable key | |
| `SUPABASE_SERVICE_ROLE_KEY` | staging の Secret key | |
| `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | テストモードの鍵（`sk_test_` / `pk_test_`） | |
| `STRIPE_B2C_WEBHOOK_SECRET` | staging 用に Stripe テストモードで作った受け口の秘密 | B2B 用の `STRIPE_WEBHOOK_SECRET` も staging 用に別に作る |
| `B2C_SITE_URL` / `APP_BASE_URL` | staging の URL | 本番のドメインは止める |
| `B2C_ACCESS_TOKEN_SECRET`・`OPERATOR_SESSION_SECRET`・`CRON_SECRET` | staging 専用に新しく作る（32文字以上） | 本番と同じ値を使わない |
| `MAIL_TEST_CAPTURE` | `1` | メールは送らず記録だけ（実機で受け取る試験は、宛先を社内に限る仕組みを作ってから別に承認） |
| `B2C_BOOKING_ENABLED`・`B2C_MY_BOOKING_ENABLED`・`B2C_CHARGE_LIVE`・`B2C_SCHEDULER_ENABLED`・`B2C_LEGAL_PAGES_ENABLED` | `true`（試験の段階ごとに） | `B2C_CHARGE_LIVE` はテストモードの鍵の時だけ |
| `B2C_NOTIFY_LIVE` | 未設定（sandbox） | |
| `GOOGLE_MAPS_API_KEY` | 今の鍵（または staging 用に制限を付けた鍵） | |
| `OPERATOR_EMAILS`・`ALERT_EMAIL` | 社内の試験用の宛先 | メールは記録だけなので実際には届かない |
| `GROUP_DISCOUNT_ENABLED`・`SAGAWA_BULK_ALERT_ENABLED` | 未設定（OFF） | B2B の回帰で OFF のままを確認 |
| **設定しない** | `SHIPANDCO_API_KEY`・`SHIPANDCO_LIVE`・`BIZLOGI_*`・`WHATSAPP_*`・`LINE_CHANNEL_ACCESS_TOKEN`・`SLACK_WEBHOOK_URL`・`GOOGLE_DRIVE_SA_KEY`・`AUTO_ISSUE_ENABLED`・`RESEND_API_KEY`・`SMTP_*`・`B2C_STRIPE_ALLOW_LIVE`・`B2C_WHATSAPP_LIVE` | どれかがあると起動しない |

## 4. 全工程の試験の一覧（Track C）

記号: **既**＝手元（ローカル DB・Stripe テストモード）で合格済みの試験がある ／ **新**＝staging（クラウド）で新しく行う ／ **実機**＝iPhone・Android で行う。重点は「失敗した時に安全に止まるか」（★）。

### 4.1 予約

| ID | 内容 | 期待 | 区分 |
|---|---|---|---|
| R-01 | ホテルの選択（検索・確認済み／未確認のホテル） | 未確認のホテルは確認待ち。受けないホテルは選べない | 既・新・実機 |
| R-02 | 集荷日・お届け日・配達日数の制約 | 選べない日は出さない。締切 18:29:59／18:30:00 の境目。カード登録の 30分が間に合わない日は出さない | 既・新 |
| R-03 | 荷物の個数 1〜10 | 範囲の外は拒否 | 既 |
| R-04 | 料金の表示（標準・沖縄・税込） | サーバーの計算と一致 | 既・新・実機 |
| R-05 | 旅行者の情報・規約の同意 | 同意が無ければ拒否。規約の版・言語・日時を記録 | 既・新 |
| R-06 | カード登録（3D セキュア あり／なし） | 予約の時に請求しない（PaymentIntent 0）。カードの同意を記録 | 既・新・実機 |
| R-07 | 予約の確定・My Booking | 確定・B2C の区間 1つ・My Booking の表示（日英） | 既・新・実機 |
| R-08★ | カード登録の失敗（断られる・3D セキュアの失敗・放置） | 確定しない・30分で受付を取消・枠を返す | 既・新・実機 |
| R-09★ | 通信の切断・二重の送信・再読込 | 予約は 1つ・カードの登録から再開 | 既・実機 |
| R-10★ | ホテルの確認の拒否・期限切れ | 無料で取消・通知・請求なし | 既・新 |
| R-11★ | 受付の停止（スイッチ OFF・未収の上限） | 新しい予約は止まり、既存の予約は動く | 既・新 |

### 4.2 決済

| ID | 内容 | 期待 | 区分 |
|---|---|---|---|
| P-01 | 予約の時は請求しない | PaymentIntent 0 | 既・新 |
| P-02 | 集荷の確認 → 30分の待機 → 請求 | 29分で 0・31分で 1回 | 既・新（DB 35/35 で確認済み） |
| P-03 | Stripe テストモードでの請求の成功 → Webhook の成功 | 支払済み・受領の通知 | 既（再現）・**新（本物の Webhook）** |
| P-04★ | Webhook の重複・順番の入れ替わり・古い失敗の通知 | 二重の処理なし・成功のまま | 既（再現）・**新（本物）** |
| P-05★ | 請求の失敗（本人認証が要る・断られる） | 理由を記録・支払のページ・案内 1・3・7日・未収の数え | 既・新 |
| P-06★ | 再試行・照合（作成の通信の障害・確定の応答が切れる） | 二度目の請求を作らない（PaymentIntent 1・Charge 1） | 既 |
| P-07★ | 二重請求の防止（同時に動かす・同じ予約の 2行目） | 1回だけ | 既・新（DB で確認済み） |
| P-08★ | 決済の成功の後に DB に書けない | 10分後の照合で成功を取り込む・二度目の請求なし | 既 |
| P-09 | キャンセル（集荷依頼の前・後） | 前は即時・無料。後は取消申請 → 佐川の確認 | 既・新 |
| P-10★ | 取消の後に届く Stripe の通知 | 予約は取消のまま・区間を作らない | 既・**新（本物）** |
| P-11 | 返金（一部・全額・同時の 2つ） | 合計は請求額以下・1つだけ通る・理由を記録 | 既・新 |
| P-12 | 個数が予約より多い・少ない | 保留 → 運営が根拠を確かめて確定 | 既 |

### 4.3 配送・通知

| ID | 内容 | 期待 | 区分 |
|---|---|---|---|
| D-01 | 集荷依頼の生成（Excel の記録） | B2C の区間も対象 | 既・新 |
| D-02 | 集荷依頼（Biz-Logi）の送信 | 模擬の Biz-Logi で受付・問い合わせ番号（staging では本物に送らない） | 既（模擬） |
| D-03★ | 送信の通信断・結果不明 | 自動で再送しない・Excel に切り替えない・通知 | 既 |
| D-04 | 追跡の状態・配達の完了 | My Booking の表示・再び請求しない | 既・新 |
| D-05 | 前日・当日のメール | 送信待ちに積み、sandbox で送信済み | 既・新（記録だけ） |
| D-06★ | WhatsApp を使わない時 | メールだけ・WhatsApp の送信 0 | 既・新 |
| D-07★ | 預け忘れ（集荷の確認が無い） | 請求しない・未集荷の対象になる | 既・新（DB） |
| D-08★ | 未集荷の通知のメールが届く | 集荷日の 18:00 以降に 1通だけ。**追跡の定時処理の中にある（G19）。Ship&co の鍵が無い staging では動かない**ので、方法の判断が要る | **未** |
| D-09★ | 配送の遅れ | 遅延の通知・返金は個別に判断（理由を記録） | 既（返金）・**未（遅延の通知）** |
| D-10★ | 佐川の API の障害・集荷の確認が取れない | 請求しない・運営が根拠で確定するまで止まる | 既（DB）・新 |
| D-11★ | ホテルが荷物を預かっていない | 預け忘れと同じ扱い（請求なし・運営が再手配か取消） | 新（手順書の訓練） |
| D-12★ | 通知の送信の失敗・再送・重複 | 再試行・重複なし・運営に知らせる | 既 |

### 4.4 B2B の回帰

| ID | 内容 | 期待 | 区分 |
|---|---|---|---|
| B-01 | FIT の予約・発行・追跡・通知 | 変わらない | 既・新 |
| B-02 | 団体の予約 | 変わらない | 既 |
| B-03 | 契約単価 | 変わらない | 既（金額 14） |
| B-04 | 団体 8% の割引が OFF | 割引なし（今と同じ金額） | 既（料金 47）・新 |
| B-05 | 請求書・月次の請求 | 変わらない（staging ではメールは記録だけ） | 既・新 |
| B-06 | Stripe（B2B のカードの課金） | B2C の区間は課金しない・B2B は従来どおり | 既・新 |
| B-07 | 佐川の大口の通知が OFF | 何もしない（画面・集計・通知とも） | 既（大口 47）・新 |
| B-08 | 既存の追跡・通知 | 変わらない | 既（追跡 8） |
| B-09★ | 集荷依頼の後のロック | 直接の変更は止まり、変更申請に回る | 既・新（DB） |

### 4.5 安全（staging そのもの）

| ID | 内容 | 期待 | 区分 |
|---|---|---|---|
| S-01★ | 本番の接続先・鍵がある設定で起動 | 起動しない | 既（25）・**新（Vercel）** |
| S-02★ | 匿名で B2C の表を読む・関数を呼ぶ | 読めない・呼べない | 新（35/35 で確認済み） |
| S-03★ | 外への送信 | メール・WhatsApp・Ship&co・Biz-Logi・佐川への送信 0 | 新 |
| S-04 | 本番の匿名の権限の最小化の案 | 代理店の画面・運営の画面・B2C が動く | **未（staging だけで検証の予定）** |

## 5. 二重課金・誤接続の防止（今ある仕組み）

**二重課金**
- 請求は集荷の確認の後だけ・30分の猶予・取り出しは 1回だけ（`for update skip locked`・状態の変化は条件付き）。
- 同じ予約の基本料金の請求は 1行だけ（DB の一意の索引 `b2c_payments_one_base_per_order`・請求のキーの決まり）。
- Stripe の重複防止のキー（請求のキーと同じ）・結果不明の時は作らずに照合・10分後の照合。
- 請求の前の確認（`b2c_charge_check`: 予約の状態・カード・規約とカードの同意・集荷の確認・佐川の個数・額・別の請求が処理中でないこと）。
- B2B の課金の入口は B2C の区間を課金しない（`lib/charge.ts`・DB のトリガー）。
- 試験: 手元 136件（請求）・staging の DB で 29分／31分・同時・2行目を確認。

**誤接続**
- staging の DB への SQL の適用: 接続文字列の ID・DB の固有の番号（staging `7702071863184491885`／本番 `7642734024280108049`）・staging の印を、SQL の 1つ 1つの先頭で確かめる。
- staging のアプリ: `BONDEX_ENV=staging` の誤接続の防止（2章）。
- 接続情報は開発の Mac の `.env.staging.local`（600・Git の対象外）だけ。値を画面・ログ・Git に出さない。
- 本番の GitHub Actions は本番の URL と秘密だけを使う。

## 6. B2B への影響

- B2C の変更は B2C の表・画面・処理に閉じている。B2B の課金・発行は B2C の区間を止める（409・skip）。
- 統合ブランチの共通の変更（集荷依頼の記録・ロック・変更申請・締切 18:30・代理店の変更の原子化）は B2B の動きを変える（承認済みの設計）。移行のリハーサルで利用者の操作 475件の間に失敗 0。
- main の #100（OFF）・#101（OFF）とまとめても、試験はすべて合格（1.1）。
- 運営への通知の宛先は B2B・B2C・大口集荷で共有。件名で見分けられることを確認する。

## 7. 本番公開の判定の基準（Track D）

**次のすべてを満たすまで公開しない。**

| # | 条件 | 確かめ方 | 今 |
|---|---|---|---|
| 1 | 重大な認証・RLS の問題が無い | staging の検証（RLS・権限・匿名の API）・Supabase の診断でエラー 0・運営の API の認可 | DB は合格。運営の API は middleware に依存（ハンドラーでも認可する案を検討） |
| 2 | 本番への誤接続が無い | 誤接続の防止の試験・Vercel の staging で本番の値を入れて起動しないこと | 手元で合格。Vercel は未 |
| 3 | Stripe テストモードで全工程が成功 | 4.1〜4.3 の「新」を staging で | 未 |
| 4 | 二重課金が起きない | P-02・P-04・P-06・P-07・P-08・P-10（本物の Webhook を含む） | 手元・DB は合格。本物の Webhook は未 |
| 5 | 予約・配送・決済の状態が整合 | 全工程の後の照合（予約・区間・請求・返金・通知の記録が矛盾しない） | 未（staging） |
| 6 | 既存の B2B が正常 | 4.4 | 手元は合格。staging は未 |
| 7 | 通知の失敗を運営が検知できる | D-08・D-12・運営への通知の到達（`?probe=1`） | **未集荷の通知（G19）が未解決** |
| 8 | 本番の移行の手順と切り戻しが明確 | 本番移行チェックリスト（079 を含む）・リハーサル | 済み（手順2-6d・切り戻し） |
| 9 | 機能のスイッチで安全に止められる | B2C の各スイッチを OFF にして既存の予約が動く・新規が止まる | 手元は合格。staging は未 |
| 10 | 公開の後の監視・障害の対応が決まっている | 監視の項目・宛先・当番・障害の時の手順（スイッチ OFF・切り戻し）の文書 | **未（作る）** |
| 11 | 法務・外部の確認 | 弁護士 L1〜L8・L11、佐川 S1、プライバシーポリシーの【要確認】 | 未（B1） |

## 8. 未確定の事項

| 項目 | 誰が |
|---|---|
| main（#100・#101）と P1-B の PR #102・#103 の取り込みの順番 | たくまさん・P1-B のセッション |
| 大口集荷の集計を B2C の確定・取消の後にも行うか（A-6） | たくまさん |
| 未集荷の通知（G19）を追跡の定時処理から分けるか、手順で補うか。staging でどう試すか | たくまさん |
| 実機でメールを受け取る試験をするか（社内の宛先に限る仕組みを作る必要がある） | たくまさん |
| Vercel のプラン（staging の project を作れるか・費用） | たくまさん（管理画面） |
| 運営の API をハンドラーでも認可するか | 設計の判断 |
| `jojo-aio-dashboard` の停止が意図したものか | たくまさん |
| 本番の匿名の権限の最小化を staging で試すか | たくまさん |
| 公開の後の監視・当番 | たくまさん |

## 9. 次の実行の工程（承認をお願いすること）

| 順 | 工程 | 承認 | 目安 |
|---|---|---|---|
| 1 | 誤接続の防止（acfba7a）を統合ブランチに入れる | 要（統合ブランチの持ち主と調整） | 0.5時間 |
| 2 | Vercel に staging の project を作る（本番とは別）・3章の環境変数（値はたくまさんが入れるか、入力の手順を用意）・Deployment Protection | **要（Vercel の操作・費用）** | 0.5日 |
| 3 | staging にデプロイ → 誤接続の防止が働くことを確認（S-01）→ 本番の値が 1つも無いことを確認 | 要 | 0.5時間 |
| 4 | Stripe テストモードに staging 専用の Webhook の受け口を登録 | **要（外部の Webhook の設定）** | 0.5時間 |
| 5 | 4章の「新」の試験（Stripe テストモードの決済を含む）。失敗の時の止まり方（★）を優先 | **要（テストの決済）** | 1.5〜2日 |
| 6 | 実機の試験（iPhone・Android・LINE の中のブラウザ） | たくまさん・社内 | 0.5日 |
| 7 | B2B の回帰（4.4）を staging で | 要 | 0.5日 |
| 8 | 監視・障害の対応の文書（7章の 10） | 不要（文書） | 0.5日 |
| 9 | 公開の判定（7章）→ 本番の移行・main へのマージ・実際の課金 | それぞれ別の承認 | — |

P1-B2（実際の集荷の個数の差・課金の保留）は、この工程と別に管理する。
