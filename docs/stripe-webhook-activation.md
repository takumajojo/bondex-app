# Stripe Webhook 有効化 & 課金安全性修正 運用手順書

対象 PR: [#6 本番課金の安全性修正 (High severity)](https://github.com/takumajojo/bondex-app/pull/6)
ブランチ: `claude/bondex-os-notion-5utpkf`
最終更新: 2026-08-19

このドキュメントは、High severity 修正(H1〜H5)のマージ後にやるべき有効化作業と、
その確認方法をまとめたものです。**別PCで作業を引き継ぐ場合はこのファイルを見れば完結**します。

---

## 0. 全体像

| 修正 | 内容 | マージだけで有効? | 追加作業 |
|------|------|:---:|------|
| H2+H3 | 追跡ステータス誤判定 → 誤課金を防止 | ✅ | なし |
| H4 | 個数変更を禁止(請求額・送り状の食い違い防止) | ✅ | なし |
| H5 | OPERATOR_PASSWORD を Host 由来オリジンへ送らない | ✅ | (任意) `APP_BASE_URL` 設定 |
| **H1** | 返金/係争/決済失敗を検知する Stripe webhook | ❌ | **下記3ステップが必要** |

H2/H3/H4 は**マージすれば自動で有効**。H1 だけは webhook 登録などの外部設定が要ります。
未設定の間、webhook は `{configured:false}` を返すだけで**無害**(既存動作に影響なし)。

---

## 1. H1 Webhook の有効化(マージ後・3ステップ)

### ① DB マイグレーション適用 (`sql/019_shipment_charge_state.sql`)

返金・係争・決済失敗の状態を保存するカラムを `shipments` に追加します。追加のみ・NULL 許容なので既存データに影響しません。

**やり方(推奨: Supabase SQL Editor)**
1. https://supabase.com/dashboard → プロジェクト `takumajojo's Project`(ref: `dscxftwfspgihkszfakk`)
2. 左メニュー **SQL Editor** → New query
3. リポジトリの `sql/019_shipment_charge_state.sql` の中身を貼り付けて **Run**
4. 成功したら次のSQLで6列が増えていることを確認:
   ```sql
   select column_name from information_schema.columns
   where table_name='shipments'
     and column_name in ('refunded_at','refund_amount_yen','disputed_at',
                         'dispute_status','payment_failed_at','payment_failure_message');
   ```
   → 6行返ればOK。

> 補足: この作業だけは自動化ツール(MCP)側の安全ガードで Claude からは実行できません(本番DDLのため)。上記の手動適用が確実です。

### ② Vercel に `STRIPE_WEBHOOK_SECRET` を設定

1. まず ③ で endpoint を作ると `whsec_...` という **署名シークレット**が発行されます。先に③を実施し、値を控えてください。
2. https://vercel.com → プロジェクト → **Settings → Environment Variables**
3. 追加:
   - Name: `STRIPE_WEBHOOK_SECRET`
   - Value: `whsec_...`(③で取得)
   - Environment: **Production**(必要なら Preview も)
4. 保存後、**再デプロイ**(env 変更は再デプロイで反映)。

### ③ Stripe ダッシュボードで endpoint を登録

> ⚠️ **本番(Live mode)**で登録すること。右上のモード切替が「テスト」ではなく本番になっていることを確認。

1. https://dashboard.stripe.com → 右上を **本番モード**に
2. **開発者 → Webhook → エンドポイントを追加**
3. エンドポイント URL:
   ```
   https://bondex.express/api/stripe/webhook
   ```
4. **リッスンするイベント**を以下4つに絞って選択:
   - `charge.refunded`
   - `charge.dispute.created`
   - `payment_intent.payment_failed`
   - `checkout.session.completed`（旅行中の「追加」の決済リンク清算に必要）
5. 追加後の画面に表示される **署名シークレット `whsec_...`** をコピー → ② に設定 → 再デプロイ。

---

## 2. 動作確認の方法

### A. いちばん簡単: Stripe ダッシュボードからテスト送信

1. Stripe ダッシュボード → 開発者 → Webhook → 作成した endpoint を開く
2. **「テストイベントを送信」** → `charge.refunded` を選ぶ → 送信
3. 期待結果:
   - endpoint の応答が **200**(画面の配信ログで確認)
   - ※テストイベントは実在しない PaymentIntent なので、DB更新はされず
     サーバーログに `refund: shipment not found for PI ...` が出るのが**正常**。
     「200が返る=署名検証と受信経路がOK」の確認になります。

### B. 実データで end-to-end(本当に効いているかの最終確認)

実際の課金1件を少額返金して、DB とアラートが動くか見ます。

1. Stripe ダッシュボード(本番)→ 決済 → 実際に成立した BondEx の課金を1件開く
2. **返金**(全額または一部)
3. 期待結果:
   - **ops アラート**が届く(メール: `ALERT_EMAIL` 宛 / Slack: `SLACK_WEBHOOK_URL` 設定時)
     件名例: `【返金を検知】BDX-xxxxxx-L1 (代理店名)`
   - **DB に反映**。Supabase SQL Editor で:
     ```sql
     select booking_id, leg_index, refunded_at, refund_amount_yen
     from shipments
     where stripe_payment_intent_id = 'pi_xxx';  -- 返金した PaymentIntent
     ```
     → `refunded_at` と `refund_amount_yen` が入っていればOK。

### C. Stripe CLI(開発者向け・任意)

ローカルや任意環境に転送して試す方法:
```bash
stripe login
stripe listen --forward-to https://bondex.express/api/stripe/webhook
# 別ターミナルで:
stripe trigger charge.refunded
```
※ `stripe listen` は独自の一時 `whsec_` を表示します。CLIで試すときはその値を使う点に注意。

### 確認チェックリスト
- [ ] `sql/019` 適用済み(6列確認)
- [ ] Stripe(本番)で endpoint 登録・3イベント選択
- [ ] `STRIPE_WEBHOOK_SECRET` を Vercel(Production)に設定 → 再デプロイ
- [ ] テスト送信で 200 が返る(2-A)
- [ ] 実返金で ops アラート + DB反映(2-B)

---

## 3. (任意) H5 の環境変数 `APP_BASE_URL`

H5 の修正で内部 self-call の宛先は
`APP_BASE_URL` → `VERCEL_URL`(Vercel自動注入)→ `https://bondex.express` の順に決まります。
**未設定でも安全に動作**しますが、本番ドメインを明示したい場合のみ Vercel に設定:
- Name: `APP_BASE_URL` / Value: `https://bondex.express` / Env: Production

---

## 4. 他PC / 別セッションへの引き継ぎ

- このブランチ `claude/bondex-os-notion-5utpkf` を pull すれば、コードとこの手順書が揃います:
  ```bash
  git fetch origin claude/bondex-os-notion-5utpkf
  git checkout claude/bondex-os-notion-5utpkf
  ```
- PR #6 の説明にも同じ要約があります。
- ローカルのメモ `~/JOJO/state/bondex.md`(このリポジトリ外)には、まだ本修正が未記入です。
  次の1行を「確定事項」に追記推奨:
  > 2026-08-19 本番課金の安全性 High 5件を修正(誤課金の中核・個数変更禁止・OPERATOR_PASSWORD漏洩・返金/係争/決済失敗のwebhook検知)。根拠: PR #6 / `app/api/stripe/webhook/route.ts` ほか。

---

## 5. 修正ファイル早見表

| 修正 | 主なファイル |
|------|------|
| H2+H3 | `app/api/cron/sync-tracking/route.ts` |
| H4 | `app/api/shipments/route.ts`, `app/operator/dashboard/page.tsx` |
| H5 | `app/api/agency/booking/route.ts` |
| H1 | `app/api/stripe/webhook/route.ts`(新規), `lib/shipments-db.ts`, `sql/019_shipment_charge_state.sql` |
