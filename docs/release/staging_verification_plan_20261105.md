# bondex-staging での検証の計画と、公開前のチェックリスト（2026-11-05 更新）

対象: 統合ブランチ `integ/bizlogi-b2c`（このブランチの内容）を、既存の Supabase `bondex-staging`（oeucjrmuigtfnwowvzwr）と Vercel の staging で確かめる。
**今回は staging への SQL の適用・環境の設定は行っていない**（準備だけ）。本番の Supabase・Stripe・Vercel には接続しない。
全体の計画は `docs/release/b2c_go_live_audit_20261105.md`（4章の全工程の試験の一覧・7章の判定の基準）。ここは今回の 3件（個人情報・決済の異常の通知・定期の処理の見張り）と G19 の追加分。

## 1. staging の構築に必要な操作（**どれも実行の前に、対象と内容を報告して承認を得る**）

統合ブランチ `integ/bizlogi-b2c`（3ae02c5 以降）を出す。本番の DB・Stripe・Vercel には触れない。接続先は毎回、DB の固有番号（staging = 7702071863184491885）で確かめる（`scripts/staging/apply.sh`）。

| # | 対象 | 内容 | 誰が | 費用 | 戻し方 |
|---|---|---|---|---|---|
| S1 | Supabase bondex-staging の DB | `bash scripts/staging/apply.sh 080`（sql/080 だけ。表 1つと関数 1つを足す。匿名には権限なし）。067〜079 は流し済み。SQL068 などの直し（表の確保の時間）は流す時の手順の違いだけなので、流し直しは要らない | 済（2026-11-05・DB の番号一致を確認・表と関数あり・anon/authenticated は権限なし・RLS 有効） | なし | `drop table public.cron_heartbeats; drop function public.cron_heartbeat_record(text, boolean, text, timestamptz);` |
| S2 | Vercel（新しい project `bondex-staging`） | GitHub の bondex-app の `integ/bizlogi-b2c` を出す。本番の project とは別。下の環境変数を Preview・Production の両方に（staging の project の中だけ） | たくまさん（Vercel の画面）。Claude は Vercel に入れない | Hobby（無料）は商用不可の規約。Pro は 1人 月$20 | project の削除 |
| S3 | Stripe（テストモードだけ） | Webhook の送り先 `https://<staging の URL>/api/b2c/stripe/webhook`（イベント: payment_intent.*・setup_intent.*・charge.refunded・charge.refund.updated・refund.*・charge.dispute.*。受け取る種類は app/api/b2c/stripe/webhook/route.ts と同じ）。署名の秘密を S2 の `STRIPE_B2C_WEBHOOK_SECRET` に | たくまさん（Stripe の画面・テストモードの切り替えを確認） | なし | Webhook の削除 |
| S4 | 定期の処理 | staging では pg_cron を有効にしない（承認の条件）。試験の時に手で `curl -H "Authorization: Bearer <staging の CRON_SECRET>"` で `/api/b2c/cron/tick`・`/api/cron/pickup-watch`・`/api/cron/heartbeat-check` を呼ぶ。GitHub の schedule は main の時だけ動くので、staging では動かない | Claude（承認の後・staging の URL だけ） | なし | — |
| S5 | 個人パスキー | staging の `/operator/login` で、たくまさんの端末のパスキーを登録（メールのワンタイムコードで本人確認）。共有パスワード（`OPERATOR_PASSWORD`・staging だけの値）での比較も行う | たくまさん（端末の操作） | なし | `operator_passkeys` の行を消す |
| S6 | メールの通知 | `MAIL_TEST_CAPTURE=1`（送らずに Vercel のログに記録）。**staging では外せない**（`lib/env-guard.ts` が 1 以外で起動を止める）。届くことの確認は staging では行わない（必要なら、ガードに社内の宛先だけ許す例外を足すかを別に判断） | Claude（ログの確認） | なし | — |
| S7 | 実機の試験 | iPhone（Safari）・Android（Chrome）で: 入口のリンク → 予約 → カード登録（テストのカード・3D セキュア）→ 予約の確認ページ（秘密のリンク）→ 取消 | たくまさん（端末）・Claude（手順と確認） | なし | — |

staging の環境変数（S2。値は staging だけのもの。本番の値は使わない・`lib/env-guard.ts` が本番の値で起動を止める）:

| 変数 | 値 | 意味 |
|---|---|---|
| `BONDEX_ENV` | `staging` | 誤接続の防止の仕組みを有効に |
| `STAGING_SUPABASE_REF` | `oeucjrmuigtfnwowvzwr` | **必須**（無いと env-guard が起動を止める） |
| `APP_BASE_URL`・`B2C_SITE_URL` | staging の URL | メールのリンク（本番のドメインだと env-guard が止める） |
| `NEXT_PUBLIC_SUPABASE_URL`・`SUPABASE_SERVICE_ROLE_KEY` | bondex-staging のもの（`.env.staging.local` にある・画面に出さない） | DB |
| `STRIPE_SECRET_KEY`・`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe の**テストモード**の鍵（`sk_test_`・`pk_test_`） | 決済 |
| `STRIPE_B2C_WEBHOOK_SECRET` | S3 で作った Webhook の署名の秘密 | Webhook |
| `OPERATOR_PASSWORD`・`OPERATOR_SESSION_SECRET`・`CRON_SECRET` | staging だけの新しい値 | 認証 |
| `MAIL_TEST_CAPTURE` | `1` | メールを送らずに記録だけ |
| `ALERT_EMAIL` | 社内の試験の宛先 | 運営への通知 |
| `B2C_BOOKING_ENABLED`・`B2C_MY_BOOKING_ENABLED` | `true` | 予約・確認ページ |
| `B2C_SCHEDULER_ENABLED`・`B2C_CHARGE_LIVE` | `true`（テストモードの鍵の時だけ） | 定期の処理・請求 |
| `B2C_NOTIFY_LIVE` | 未設定（運営への通知はログだけ）→ 通知を確かめる回だけ `true` | 運営への知らせ |
| `SAGAWA_BULK_ALERT_ENABLED` | `true`（メールのフラグは未設定） | 大口集荷の再集計 |
| Biz-Logi・Ship&co・WhatsApp・LINE・Slack・Google Drive の鍵 | **入れない**（env-guard が起動を止める）。Biz-Logi の模擬はローカルの試験だけ。staging では集荷依頼は「設定が無い」で安全に失敗し、運営の画面に出る | — |

注意: staging では佐川の追跡（Ship&co）も無いので、集荷の確認は運営の画面（`/operator/b2c`・個人パスキー）から手で行う（`b2c_confirm_pickup`）。30分後の請求はその時刻から数える。

## 2. staging で確かめること

| # | 項目 | 手順 | 合格の条件 |
|---|---|---|---|
| V1 | 個人パスキーでのログイン（Vercel の上） | staging の `/operator/login` でパスキー登録 → メールのコード（記録から読む）→ ログイン | `/operator/b2c` が開ける。共有パスワードでは `/operator/b2c` の操作が 403 |
| V2 | B2C の個人情報の制限 | 試験の予約（ダミーの名前）を 1件作る → 共有パスワード・Bearer・個人パスキーで `/api/shipments`・`/api/operator/report?format=csv`・`/api/operator/today-todo`・`/api/shipments?search=<名前>` を呼ぶ | 共有パスワード・Bearer の応答の本文にダミーの名前が無い・検索で当たらない。個人パスキーでは出る。B2B の代表者名は全員に出る |
| V3 | Stripe テストモードの Webhook | テストのカード（`4242…`・3D セキュア `4000 0027 6000 3184`）で登録 → 集荷の確認 → 30分後の請求 | Webhook の署名の確認が通る・請求が 1回だけ・DB と Stripe が 1対1 |
| V4 | 決済の結果不明の運営への通知 | DB で試験の請求を `unknown` にする（staging だけ）→ `/api/b2c/cron/tick` を呼ぶ | ログに `[safe-log]` の `"kind":"ops_alert_sandbox","source":"b2c.charge-watch"` が 1回（件名・本文はログに出ない。中身は運営の画面 /operator/b2c）。もう一度呼んでも出ない。状態を `on_hold` に変えると再び 1回。本文に名前・メール・秘密のリンクが無い。請求の行・Stripe の PaymentIntent が増えない |
| V5 | 定期の処理の実行・停止の検知 | `/api/b2c/cron/tick` を呼ぶ → `cron_heartbeats` に記録。35分呼ばずに `/api/cron/heartbeat-check` を呼ぶ | 記録があり、35分後は 503 と、ログに `"source":"cron.heartbeat-check"` の通知が 1回 |
| V6 | 未集荷の通知（G19） | 追跡を止めた状態（`TRACKING_SYNC_PAUSED=true`）で、集荷日を過ぎた試験の区間を作る → `/api/cron/pickup-watch` を呼ぶ | 区間ごとに 1回だけ通知。追跡を止めていても出る |
| V7 | B2B と B2C の分離 | B2B の試験の予約（代理店のログイン）と B2C の予約を並べる | 代理店の画面に B2C は出ない。団体の割引が B2C の料金に効かない。B2B の課金の入口は B2C の区間を課金しない |

## 3. 公開前のチェックリスト（今回の分を追加）

| 区分 | 項目 | 状態 |
|---|---|---|
| 個人情報 | 運営の API の応答から、個人パスキー以外には B2C の名前・ホテル・宿泊日・問い合わせ番号などを外す（許す項目の方式） | ローカル済み（190件・画面の確認済み）・staging の V2 待ち |
| 決済 | 結果不明・保留・遅れ・停止を運営に通知 | ローカル済み（37件）・staging の V4 待ち |
| 監視 | 定期の処理の停止・失敗の連続を、別の仕組みから見張る（pg_cron と GitHub がお互いを見張る） | ローカル済み（46件）・staging の V5 待ち・本番は main に入った後に GitHub の schedule が動く・GitHub の通知の設定の確認 |
| 移行 | sql/080 を本番移行のチェックリストの手順に足す（079 の後・アプリより先でよい） | 未（Biz-Logi の移行の担当のチェックリストに追記の承認が要る） |
| 移行 | SQL068 などの表の確保を時間で区切る（`docs/release/sql068_lock_deadline_proposal.md`） | 済（2026-11-05・98c7664。Biz-Logi の担当と合意・試験 `migration-lock-timeout.sh`） |
| 運用 | 当番・連絡の順番・阪急への連絡の担当 | 未決（`docs/release/b2c_ops_runbook.md` 3章） |
| 法務 | 弁護士 L1〜L11・佐川 S1/S2・プライバシーポリシー | 未 |
| 実機 | iPhone Safari・Android Chrome でのカード登録・3D セキュア・予約の確認ページ | 未 |
