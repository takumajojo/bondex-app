# bondex-staging での検証の計画と、公開前のチェックリスト（2026-11-05 更新）

対象: 統合ブランチ `integ/bizlogi-b2c`（このブランチの内容）を、既存の Supabase `bondex-staging`（oeucjrmuigtfnwowvzwr）と Vercel の staging で確かめる。
**今回は staging への SQL の適用・環境の設定は行っていない**（準備だけ）。本番の Supabase・Stripe・Vercel には接続しない。
全体の計画は `docs/release/b2c_go_live_audit_20261105.md`（4章の全工程の試験の一覧・7章の判定の基準）。ここは今回の 3件（個人情報・決済の異常の通知・定期の処理の見張り）と G19 の追加分。

## 1. staging に必要な変更（承認の後にたくまさんの操作か、承認を受けて実施）

| # | 対象 | 内容 | 費用 | 戻し方 |
|---|---|---|---|---|
| S1 | Supabase bondex-staging | `sql/080_cron_heartbeats.sql` を流す（追加だけ。`scripts/staging/apply.sh` の DB 固有番号の確認つき） | なし | `drop table public.cron_heartbeats; drop function public.cron_heartbeat_record(text, boolean, text, timestamptz);` |
| S2 | Vercel の staging の project（未作成・`bondex-staging`） | 作成し、統合ブランチを出す。環境変数は監査の 3章＋下の表 | Vercel の無料の範囲（Hobby）で足りるかは要確認。Pro なら月$20 | project の削除 |
| S3 | Stripe（テストモードだけ） | Webhook の送り先を staging の `/api/b2c/stripe/webhook` に。テストの秘密の鍵を staging だけに | なし | Webhook の削除 |
| S4 | 運営への通知の宛先 | `ALERT_EMAIL` を社内の試験の宛先に。**`MAIL_TEST_CAPTURE=1`** で外に送らず記録だけ（Vercel のログに `[mail-capture]`）。実際に届くかを見る時だけ外す | なし | 環境変数を戻す |
| S5 | 個人パスキー | staging の運営者のパスキーを登録（メールのワンタイムコードで本人確認）。共有パスワードとの比較のため `OPERATOR_PASSWORD` も設定 | なし | `operator_passkeys` の行を消す |
| S6 | 定期の処理の見張り | staging では pg_cron を有効にしない（承認の条件）。見張りは手動で `/api/cron/heartbeat-check` を呼ぶ（GitHub の schedule は main のときだけ動くので staging では動かない） | なし | — |

staging の環境変数（今回の追加分）:

| 変数 | 値 | 意味 |
|---|---|---|
| `BONDEX_ENV` | `staging` | 本番の値で起動したら止める（`lib/env-guard.ts`） |
| `MAIL_TEST_CAPTURE` | `1` | メールを送らずに記録だけ |
| `B2C_SCHEDULER_ENABLED` | `true`（試験の時だけ） | B2C の定期の処理と、その見張り |
| `B2C_CHARGE_LIVE` | `true`（Stripe テストモードの鍵の時だけ） | 請求の実行 |
| `B2C_TICK_STALE_MIN` | `30`（既定） | B2C の定期の処理の「止まった」の基準 |
| `CRON_SECRET` | staging だけの値 | 定期の処理・見張りの呼び出し |

## 2. staging で確かめること

| # | 項目 | 手順 | 合格の条件 |
|---|---|---|---|
| V1 | 個人パスキーでのログイン（Vercel の上） | staging の `/operator/login` でパスキー登録 → メールのコード（記録から読む）→ ログイン | `/operator/b2c` が開ける。共有パスワードでは `/operator/b2c` の操作が 403 |
| V2 | B2C の個人情報の制限 | 試験の予約（ダミーの名前）を 1件作る → 共有パスワード・Bearer・個人パスキーで `/api/shipments`・`/api/operator/report?format=csv`・`/api/operator/today-todo`・`/api/shipments?search=<名前>` を呼ぶ | 共有パスワード・Bearer の応答の本文にダミーの名前が無い・検索で当たらない。個人パスキーでは出る。B2B の代表者名は全員に出る |
| V3 | Stripe テストモードの Webhook | テストのカード（`4242…`・3D セキュア `4000 0027 6000 3184`）で登録 → 集荷の確認 → 30分後の請求 | Webhook の署名の確認が通る・請求が 1回だけ・DB と Stripe が 1対1 |
| V4 | 決済の結果不明の運営への通知 | DB で試験の請求を `unknown` にする（staging だけ）→ `/api/b2c/cron/tick` を呼ぶ | `[mail-capture] … subject=【B2C 請求】要確認` が 1回。もう一度呼んでも出ない。状態を `on_hold` に変えると再び 1回。本文に名前・メール・秘密のリンクが無い。請求の行・Stripe の PaymentIntent が増えない |
| V5 | 定期の処理の実行・停止の検知 | `/api/b2c/cron/tick` を呼ぶ → `cron_heartbeats` に記録。35分呼ばずに `/api/cron/heartbeat-check` を呼ぶ | 記録があり、35分後は 503 と `【監視】定期の処理が止まっている…` が 1回 |
| V6 | 未集荷の通知（G19） | 追跡を止めた状態（`TRACKING_SYNC_PAUSED=true`）で、集荷日を過ぎた試験の区間を作る → `/api/cron/pickup-watch` を呼ぶ | 区間ごとに 1回だけ通知。追跡を止めていても出る |
| V7 | B2B と B2C の分離 | B2B の試験の予約（代理店のログイン）と B2C の予約を並べる | 代理店の画面に B2C は出ない。団体の割引が B2C の料金に効かない。B2B の課金の入口は B2C の区間を課金しない |

## 3. 公開前のチェックリスト（今回の分を追加）

| 区分 | 項目 | 状態 |
|---|---|---|
| 個人情報 | 運営の API の応答から、個人パスキー以外には B2C の名前などを外す | ローカル済み（142件）・staging の V2 待ち |
| 決済 | 結果不明・保留・遅れ・停止を運営に通知 | ローカル済み（37件）・staging の V4 待ち |
| 監視 | 定期の処理の停止・失敗の連続を、別の仕組みから見張る | ローカル済み・staging の V5 待ち・本番は main に入った後に GitHub の schedule が動く |
| 移行 | sql/080 を本番移行のチェックリストの手順に足す（079 の後・アプリより先でよい） | 未（Biz-Logi の移行の担当のチェックリストに追記の承認が要る） |
| 移行 | SQL068 などの表の確保を時間で区切る（`docs/release/sql068_lock_deadline_proposal.md`） | Biz-Logi の担当は同意・**たくまさんの承認待ち** |
| 運用 | 当番・連絡の順番・阪急への連絡の担当 | 未決（`docs/release/b2c_ops_runbook.md` 3章） |
| 法務 | 弁護士 L1〜L11・佐川 S1/S2・プライバシーポリシー | 未 |
| 実機 | iPhone Safari・Android Chrome でのカード登録・3D セキュア・予約の確認ページ | 未 |
