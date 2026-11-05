# Vercel staging の作り方（2026-11-06・画面の操作の案内）

対象: GitHub `takumajojo/bondex-app` のブランチ `integ/bizlogi-b2c`（9221c0a 以降）を、**本番とは別の新しい Vercel project** `bondex-staging` に出す。
本番の project（bondex.express）の設定・環境変数には触れない。課金・プランの変更は、たくまさんが料金の画面を確かめてから行う。

## 0. 前提として知っておくこと

- 本番の project は、push されたブランチごとに自動でプレビューを作る（今回の push でも作られる。今までの PR と同じ動き。本番の公開・設定は変わらない）。
- **main には試験環境の安全装置（`lib/env-guard.ts`）が無い**。staging の project で main を出さないよう、手順 3 の前に環境変数を入れない。
- このリポジトリには `vercel.json` が無いので、Vercel の定時実行（Cron）は登録されない。staging で定期の処理が勝手に動くことはない。
- staging では、検索エンジンに載せない（robots.txt で全体を対象外・`X-Robots-Tag: noindex`）・本番の GA を読み込まない（9221c0a。`BONDEX_ENV=staging` の時だけ）。

## 1. project を作る（たくまさん）

1. Vercel の画面 → Add New → Project → `takumajojo/bondex-app` を Import
2. Project Name: `bondex-staging`（本番の project と取り違えない名前）
3. Framework: Next.js（自動）。Build Command・Output は既定のまま
4. **Environment Variables はここでは入れない**（最初の自動の build は main になるため。値が無ければ、どこにもつながらずに失敗するだけで害はない）
5. Deploy を押す（失敗・未接続で構わない）

## 2. 出すブランチを統合ブランチにする（たくまさん）

1. bondex-staging → Settings → Git → Production Branch を `integ/bizlogi-b2c` に変えて保存
2. 同じ画面の Ignored Build Step を「Custom」にして、次を入れる（統合ブランチ以外は build しない）:
   `[ "$VERCEL_GIT_COMMIT_REF" = "integ/bizlogi-b2c" ] && exit 1 || exit 0`
3. Settings → Integrations で、Supabase の連携を**つながない**（自動で本番の鍵が入るのを防ぐ）
4. Domains は追加しない（`bondex-staging.vercel.app` だけ。bondex.express の下に作らない）
5. Deployment Protection は既定（Standard Protection）のまま。本番扱いの URL（`bondex-staging.vercel.app`）は Stripe の Webhook と実機の試験のために公開になる

## 3. 環境変数を入れる（たくまさん・Production の範囲だけ）

秘密の値は画面・チャット・Git に出さない。新しい乱数はお手元の Mac で `openssl rand -hex 32` を値ごとに 1回ずつ作る。
**本番の project からコピーしない**（本番の値が混ざると、安全装置が起動を止める）。

| 変数 | 値 | どこから |
|---|---|---|
| `BONDEX_ENV` | `staging` | 固定 |
| `STAGING_SUPABASE_REF` | `oeucjrmuigtfnwowvzwr` | 固定 |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://oeucjrmuigtfnwowvzwr.supabase.co` | 固定 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`・`SUPABASE_SERVICE_ROLE_KEY` | bondex-staging の鍵 | Supabase の bondex-staging → Project Settings → API Keys |
| `STRIPE_SECRET_KEY`・`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `sk_test_…`・`pk_test_…` | Stripe の画面を**テストモード**にして → 開発者 → API キー |
| `STRIPE_B2C_WEBHOOK_SECRET` | 後で入れる（S3・Webhook の登録は別に承認） | — |
| `OPERATOR_PASSWORD` | staging だけの新しい値（12文字以上） | お手元で作る |
| `OPERATOR_SESSION_SECRET`・`CRON_SECRET`・`B2C_ACCESS_TOKEN_SECRET` | それぞれ `openssl rand -hex 32` | お手元で作る |
| `OPERATOR_EMAILS` | 運営のメールアドレス（カンマ区切り） | 個人パスキーの登録に使う |
| `APP_BASE_URL`・`B2C_SITE_URL` | `https://bondex-staging.vercel.app` | 固定 |
| `MAIL_TEST_CAPTURE` | `1` | 固定（staging はメールを送らない・決定事項 A） |
| `ALERT_EMAIL` | 社内の宛先 | 記録だけ（送らない） |
| `B2C_BOOKING_ENABLED`・`B2C_MY_BOOKING_ENABLED` | `true` | 固定 |
| `B2C_SCHEDULER_ENABLED`・`B2C_CHARGE_LIVE` | `true` | 固定（テストモードの鍵の時だけ） |
| `SAGAWA_BULK_ALERT_ENABLED` | `true` | 固定 |

**既定の OFF のままにするもの**: `B2C_LEGAL_PAGES_ENABLED`（規約のページは弁護士の確認まで「ローカルのレビューだけ」の決まり。staging の URL は公開になるため）・`B2C_LATE_BOOKING_ENABLED`（佐川の確認待ち）・`B2C_PICKUP_AUTOMATION_ENABLED`（Biz-Logi は staging に無い）。

**入れないもの**（入れると安全装置が起動を止める・外へ送る）: `BIZLOGI_*`・`SHIPANDCO_*`・`WHATSAPP_*`・`LINE_*`・`SLACK_WEBHOOK_URL`・`GOOGLE_DRIVE_*`・`RESEND_API_KEY`・`SMTP_*`・`B2C_STRIPE_ALLOW_LIVE`・`AUTO_ISSUE_ENABLED`・`STRIPE_WEBHOOK_SECRET`（B2B 用）。

## 4. 統合ブランチを出す（たくまさん）

Deployments → 最新の `integ/bizlogi-b2c` を Redeploy（または Claude が空のコミットを push して build を起こす）。
build の後、URL を Claude に伝える。Claude は Vercel に入れないので、外から curl で確かめる（手順 5）。

## 5. 出した後の確認（Claude・読むだけ）

| 確認 | 合格 |
|---|---|
| `curl -sI https://bondex-staging.vercel.app/` | 200・`X-Robots-Tag: noindex, nofollow` |
| `/robots.txt` | `Disallow: /` |
| トップの HTML | `G-M2LR1SYV92`（本番の GA）が無い |
| `/api/cron/heartbeat-check`（鍵なし） | 401（CRON_SECRET が入っている） |
| 起動 | 500 で止まっていない（安全装置の条件を満たしている。止まった時は Vercel のログに `[env-guard]` と理由） |

## 6. 未解決: 個人パスキーの登録（承認が必要）

個人パスキーの登録には、運営のメールアドレスに届く 6桁のコードが要る（`app/api/operator/passkey/register-*`）。
staging はメールを送らない（A）。記録のログには本文を出さず、DB にはコードの hash しか残らないので、**staging では個人パスキーを登録できない**。
パスワードで登録したパスキーは「個人」ではないので、B2C の個人情報の表示も、集荷の確認（請求の起点）もできない。
→ 予約から集荷の後の請求までの通しの試験（STEP 7）と V1・V2 の個人パスキーの側は、このままでは行えない。

選べる方法:
1. メールの安全装置に「`OPERATOR_EMAILS` の社内の宛先だけは実際に送る」例外を足す（コードの変更と試験。Beta 前に必須の「社内の許可された宛先への実送信の試験」をここで兼ねる）
2. staging の DB で、パスワードで登録したパスキーの行に運営のメールアドレスを入れる（DB の変更・事前の承認が要る。メールのコードの流れは試せない）
3. ログにコードを出す（秘密をログに出さない決まりに反するので、勧めない）
