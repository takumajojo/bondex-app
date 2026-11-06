# Vercel の Preview と本番の分離 — 手順と確かめ方（2026-11-07）

Preview（ブランチごとの試し表示）に本番の鍵が入っていた件の対処。**コードの守り（lib/env-guard.ts）だけでは、すでに作られた Preview は安全にならない。**
Vercel は、デプロイを作った時点の環境変数をそのデプロイの中に持ち続ける。環境変数を替えても、古い Preview は古い本番の鍵で動き続ける。
そのため、次の 3つがそろって初めて分離できる。

1. Preview の環境変数を staging のものに替える（これから作られる Preview のため）
2. 替える前に作られた Preview をすべて削除する（古い鍵を持つデプロイを残さない）
3. コードの守り（統合の承認の後）: 本番以外の配置が本番の資格情報を持っていたら、起動の時と実行の時の両方で止める

2026-11-07 の点検（`scripts/ops/vercel-preview-audit.py`）の結果: Preview に本番の鍵・スイッチの名前が 8件、まだ動く Preview が 91件（全 144件のうち）。

## 1. Vercel の操作（谷口さん・承認の後）

### 1-1. Preview の環境変数を替える（**順番を守る**）
**注意: 今の 20個の変数は、Production と Preview で「同じ 1つの登録」（設定先が production と preview の両方・種類は sensitive）。**
その登録の値を書き換えると本番の値も変わる。`vercel env rm` で消すと登録ごと消え、sensitive の値は読み戻せないので本番を元に戻せない。
（2026-11-07 Vercel の API の GET で確認・名前・ID・設定先だけを読んだ）

1. **設定先から Preview だけを外す**（20個それぞれ。値は触らない）
   - 画面: Settings → Environment Variables → 各変数の Edit → 「Preview」のチェックだけを外して保存（Production は残す）
   - API でやる場合: `PATCH /v10/projects/{projectId}/env/{envId}` に `{"target":["production"]}` だけを送る（値は送らない）
   - 終わったら、点検（2）の 1 で「Preview に残っている本番の鍵の名前」が 0件・本番の側の名前が今までどおりあることを確かめる
   - **本番が保たれていることの確認**（1 の直後・2 の前）:
     - `vercel env ls production` の名前の数が、作業の前と同じ（作業の前に名前だけを控えておく。値は表示しない）
     - 各変数の Edit の画面で、Production のチェックが残っていること
     - 動いている本番のデプロイは作った時点の値を持ち続けるので、この操作で本番は再デプロイされない。本番の URL が今までどおり応答すること
       （ログインしていない時の応答が作業の前と同じ）を見る。**本番の再デプロイはこの手順では行わない**
2. **Preview 専用の登録を新しく作る**（設定先は Preview だけ）
   - staging の値: `NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_ANON_KEY`・`SUPABASE_SERVICE_ROLE_KEY`（staging の Supabase `oeucjrmuigtfnwowvzwr`）、
     `STRIPE_SECRET_KEY`・`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`（Stripe のテストモード `sk_test_`・`pk_test_`）、`OPERATOR_PASSWORD`（本番と別の値）
   - 足す: `BONDEX_ENV=staging`・`STAGING_SUPABASE_REF=oeucjrmuigtfnwowvzwr`・`APP_BASE_URL`（staging の URL・本番のドメインは不可）・`MAIL_TEST_CAPTURE=1`
   - 費用だけの鍵（`ANTHROPIC_API_KEY`・`GOOGLE_MAPS_API_KEY`）は Preview 専用の別の鍵にするか、作らない
3. **Preview には作らない**（本番の鍵・外への実際の処理のスイッチ・本番の設定の流用）:
   `RESEND_API_KEY`・`SMTP_HOST`・`SMTP_PORT`・`SMTP_USER`・`SMTP_PASS`・`GOOGLE_DRIVE_SA_KEY`・`GOOGLE_DRIVE_ROOT_ID`・`SHIPANDCO_API_KEY`・`SHIPANDCO_LIVE`・
   `STRIPE_CHARGE_LIVE`・`ALERT_EMAIL`、それに今 Production だけにあるもの（`CRON_SECRET`・WhatsApp・Slack・LINE・Biz-Logi・`AUTO_ISSUE_ENABLED` など）。
   `RATE_LIMIT_PER_MINUTE` は秘密でも外への処理でもないので、Preview 用に同じ値で作ってよい
4. 前提: staging の Supabase に SQL 081・082・083 が入っていないと、Preview の集荷依頼の画面が読めない（081 の列）。
   staging の DB への適用は別の承認（この手順の範囲の外）。

### 1-2. 本番の判定に要る設定
- 「Automatically expose System Environment Variables」は **ON のまま（既定）**。本番は Vercel が入れる 3つ（`VERCEL=1`・`VERCEL_ENV=production`・
  `VERCEL_URL`）がそろった時だけ本番と判定する。無効にすると本番も起動しない（止まる側。誤って本番の鍵を使う側には倒れない）。
- `BONDEX_ENV` は Production には入れなくてよい（入れるなら `production`。`staging` など他の値は本番を止める）。
  `BONDEX_ENV=production` だけでは本番にならない（手元の道具が 1つの宣言で本番の資格情報を使えないようにするため）。

### 1-3. 古い Preview を削除する
- 削除の対象は「危険な設定で作られた可能性のあるデプロイ」。不正なアクセスがあったという意味ではない。
- **削除の前に記録を残す**（削除すると、そのデプロイの情報は Vercel から読めなくなる）:
  - デプロイの一覧（作った日時・ブランチ・コミット・PR・作った人・URL）: `vercel ls --format json` をすべてのページ
  - Preview へのアクセスの記録（日時・URL・パス・応答の番号だけ。IP と問い合わせの文字列は残さない）:
    `vercel logs requests -e preview --since 7d --until now --json` を 1週間ずつ遡る（2026-11-06 の時点で遡れたのは約30日・それより前は拒否される）
  - 実行の記録（`vercel logs -e preview`）は保存の期間が短い。残っていれば同じく集計だけを残す
  - 2026-11-06 15:51 の控え: `MyClaudecode/docs/vercel-deployments-audit-snapshot-20261106-1551.tsv`（全146件・削除の対象 93件）・
    `MyClaudecode/docs/vercel-preview-access-records-20261106.tsv`（Preview へのアクセス 9件・すべて 302 = ログインへの転送でアプリに届いていない）・
    確認できる期間とできない期間: `MyClaudecode/docs/vercel-preview-access-coverage-20261106.md`
- 1-1 を終えた時刻（`--since`）より前に作られた Preview をすべて削除する（点検の 2 の一覧）。**削除の直前に点検をもう一度流し、一覧を取り直す**
  （分離の前にどのブランチでも push すると、本番の鍵を持つ Preview が増える。2026-11-06 15:23・15:28 の hotfix の push で 2件増えて 93件になった）。
- Production のデプロイは削除しない。

### 1-4. 保護
- Deployment Protection（Vercel のログイン）が Preview で ON のままか。
- 「Protection Bypass for Automation」・共有リンク（Shareable Links）が無いか。あれば消す。

## 2. 確かめ方（読むだけ）

```bash
cd bondex-poc-main   # .vercel/project.json でリンク済みのディレクトリ
python3 -I ../<このリポジトリ>/scripts/ops/vercel-preview-audit.py --since 2026-11-07T15:00:00+09:00 --vercel <vercel CLI のパス>
```

- 1: Preview に残っている本番の鍵の名前 0件・足りない名前 0件
- 2: `--since` より前の、まだ動く Preview 0件
- 3: 「古い Preview・本番の鍵は残っていない」と出る（終了コード 0）
- 値が staging のものかは名前では分からない。新しい Preview を 1つ作り、起動できること（lib/env-guard.ts が本番の DB・本番の Stripe の鍵・
  本番の名前のメールの鍵があれば起動を止める）と、ログインしていない時に 401 か Vercel のログインに転送されることを確かめる。

## 3. 統合ブランチの push を再開する順番
0. 分離（1-1）が終わるまでは、統合ブランチに限らず**どのブランチの push も** Preview を作り、その Preview は本番の鍵を持つ。
   急ぎの修正を push した時は、その Preview も 1-3 の削除の対象に入れる。
1. 1-1〜1-4 と 2 の確かめ（谷口さん）
2. 守りのコミットの統合（コミットを指定した承認の後）
3. push で作られた新しい Preview が起動すること・本番の鍵の名前が無いことを、もう一度 2 で確かめる
4. 本番の再デプロイ（main への反映）は別の承認。反映の直後に本番が起動していること（ログインしていない時の 401）を見る

## 4. コードの守りの判定（lib/env-guard.ts）
| 配置 | 判定 | 本番の資格情報（本番の Supabase・Stripe の本番の鍵・実際の送り状・佐川への実際の依頼） |
|---|---|---|
| Vercel の Production（VERCEL=1・VERCEL_ENV=production・VERCEL_URL がそろう。BONDEX_ENV は無しか production） | 本番 | 使える（今までどおり） |
| BONDEX_ENV=production だけ・VERCEL_ENV=production だけ（手元の道具など） | 本番ではない | 持っていれば起動しない |
| VERCEL_ENV が production 以外（preview・development・空・知らない値） | 本番ではない | 起動しない・実行の時も使わない |
| BONDEX_ENV=staging | 本番ではない | staging の条件の全部を満たさないと起動しない |
| 何も無い（手元・または Vercel のシステム環境変数が無効の Preview） | 本番ではない | 持っていれば起動しない |

手元で本番を操作する管理の道具は、このアプリの守りを通さない別の経路（本番の鍵を手元に置かない・都度の承認と認証）で行う。
この守りは誤設定・誤操作の防止で、本番の鍵を持つ人の意図的な偽装は防げない。本番の鍵は本番の配置の外に置かない。

外への送信（メール・Slack・WhatsApp・LINE・Drive・自分自身の呼び出し）は、本番ではない配置・止める理由がある時、実行の時にもそれぞれの場所で止まる。
名前だけで見分けられない鍵（メール・Drive など）は、Vercel の上の本番以外の配置では「置いてはいけない名前」として扱う。
