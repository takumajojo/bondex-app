# B2C P0 の完成と staging E2E の準備（2026-11-07）

PoC刷新トラック。ブランチ `feat/b2c-p0-1107`（統合 a2d6c48 から・ローカルだけ・push していない）。

## 1. 作ったもの

| | 中身 | ファイル |
|---|---|---|
| P0-1 ホテルの確認 | 運営の画面に「ホテルの確認待ち」。未確認のホテルごとに名前・住所・郵便番号・地図・期限（残り時間・3時間未満は赤）・待っている予約（受付番号・集荷日・個数）・操作の記録。確認済み／保留／受けない。直前予約は集荷元・配送先ごとに 受けた／保留／断られた／連絡がつかない | `app/operator/b2c/hotel-panel.tsx`・`app/api/b2c/ops/hotel/route.ts`（GET を追加）・`lib/b2c/hotel-ops.ts` |
| P0-2 阪急向けの入口の URL | 期限つきの入口の token（期限は token の一部でハッシュに含まれる）。期限切れ・停止は「このリンクは使えなくなりました」。発行の道具（DB に接続しない） | `lib/b2c/entry-link.ts`・`lib/b2c/booking-service.ts`・`lib/b2c/api-common.ts`・`app/book/[token]/page.tsx`・`scripts/b2c-entry-link/issue.ts` |
| P0-3 staging の削除 | E2E の入口から作った予約と、その配送・請求・返金・通知・記録だけを消す。既定は dry-run | `scripts/staging/cleanup-e2e.sh`・`scripts/staging/cleanup-e2e.sql` |

**追加の migration はありません。** 既存の列（`b2c_facilities.checked_by / checked_at / check_note`・`b2c_order_events`・`b2c_hotel_acceptances.decided_by / decided_at`・`b2c_entry_links.status`）で足りました。

## 2. P0-1 ホテルの確認の決まりごと

- 見るのも操作も、メールのある個人のパスキーの運営者だけ。共有のパスワード・メールの無いパスキーは 403。
- どの操作も理由が必須です。実行の前に、確定・取消になる予約の受付番号を表示します。
- 取消になる操作（受けない・断られた・連絡がつかない）は、「取り消されて旅行者に通知が送られる」を確かめるチェックを入れないと実行できません。
- 二重の操作の防止:
  - ホテルは「未確認」の時だけ書き換えます。予約の受入は、その側が「未回答」の時だけ記録します。同時に 2回押されても、片方は 409 になります。
  - 確認済みのホテルを、この画面から「受けない」に変えることはできません。確定済みの予約に影響するため、別の手順にします。
- 保留は、状態と期限を変えません。待っている予約ごとに、記録（運営者・パスキー・理由・日時）を残すだけです。期限を過ぎると、今までどおり定期の処理が自動で取り消します。
- 予約・請求のガードは変えていません。確定は今までどおり DB の `b2c_confirm_order` が判定します。
  - カードが未登録の予約・期限を過ぎた予約・前日 18:30 を過ぎた予約は確定しません。
  - 取消は、予約が確認待ちのままの時だけ行います（`p_expect_status`）。
- 一覧は、旅行者の名前・メール・電話を返しません。受付番号から予約の詳細を開きます。

## 3. P0-2 入口の URL の発行と切り替え

### 3.1 token の形と期限

- token は推測できない乱数（32文字）です。期限つきの token は、先頭に `x<YYYYMMDD>_` が付きます。
- DB には token の sha256 だけを残します。
- 期限は、日本時間のその日の終わりまでです。期限を書き換えると別の token になるので、無効になります。

### 3.2 期限・停止の扱い

- 期限切れと停止は、410 を返します。画面は「このリンクは使えなくなりました」と案内します。
- 形が違う token や、DB に無い token は「見つからない」（404）にします。
- 止めるのは新しい予約だけです（入口・ホテル検索・見積・予約の作成）。
  - 予約を作った後のカード登録（開始・照合）は、期限で止めません。
  - 停止した入口は、カード登録も止めます（漏えいの時の緊急の手段）。

### 3.3 料金と個人情報

- 料金は紹介元によりません。紹介料・紹介元ごとの料金は足していません。
- 予約には、紹介元のコードと入口が残ります（今までどおり）。
- URL には旅行者の個人情報を入れません。

### 3.4 発行の手順（DB への 1行の追加。流すのは承認の後）

```bash
npx tsx scripts/b2c-entry-link/issue.ts --referrer HANKYU --name 阪急交通社 --name-en "Hankyu Travel" --expires 2027-03-31 --site https://bondex.express --target production
```

- 出力は 2つです。阪急に渡す URL（英語・日本語）と、DB に流す SQL です。
- SQL には token のハッシュだけが入ります。先頭で、本番の DB か（staging の時は試験環境の DB と印があるか）を確かめます。
- URL は、知っている人なら誰でも予約を始められる鍵です。チャット・GitHub・資料に貼らないでください。

### 3.5 一般公開との切り替え

入口は紹介元ごとに別の行です。

- 一般公開する時は、紹介元 `DIRECT` の入口を発行して公開します。
- 止める時は、次の SQL を流します。片方だけを止められます。

  ```bash
  npx tsx scripts/b2c-entry-link/issue.ts --disable --referrer DIRECT --target production
  ```

- 新規の受付の全体を止める時は、今までどおり `B2C_BOOKING_ENABLED` を使います。

## 4. P0-3 staging の削除

```bash
bash scripts/staging/cleanup-e2e.sh --run E2E1107A --since 2026-11-07T09:00:00+09:00
```

既定は dry-run（何も消さない）です。件数と指紋を表示します。

```bash
bash scripts/staging/cleanup-e2e.sh --run E2E1107A --since 2026-11-07T09:00:00+09:00 --execute --confirm <指紋>
```

実際に消すのは、承認の後のこの形だけです。

### 4.1 本番では動かない（4重の確認）

1. 接続文字列に試験環境の ID があり、本番の ID が無いこと。DB に接続する前に確かめます。
2. DB の固有の番号が、本番と違い、試験環境と一致すること。
3. 試験環境の印（`staging_guard.marker`）があること。
4. 削除と同じトランザクションの先頭で、2 と 3 をもう一度確かめること。

### 4.2 消す対象

- 紹介元のコードが `E2E…` の入口から、開始の時刻より後に作った予約。
- その予約の配送・集荷の確認・請求・返金・ホテルの受入・通知・操作の記録・Stripe の Webhook の受付の記録。
- 予約が無くなった E2E の入口。
- 開始の後に作られ、他の予約が使っていない架空のホテル。

### 4.3 止める（何も消さない）条件

- 同じ入口に、開始より前の予約がある（コードの使い回し）。
- B2B の配送が混ざっている。
- 集荷依頼・集荷番号の台帳・事故の記録が、対象の配送を参照している。
- 請求が処理中、または結果が分からない。
- 扱っていない表（名前で探す）が、対象を参照している。
- dry-run の後に対象が増減した（指紋が合わない）。

操作の記録（追記だけの表）は、削除のトランザクションの中でだけ保護を外し、消した後に戻します。戻ったことは、同じトランザクションの中で確かめます。

## 5. staging E2E の運営の認証（案A）の設定の手順（設計・未実施）

### 5.1 足す・変える値

Vercel の Preview・ブランチ `integ/bizlogi-b2c` だけに設定します。

| 名前 | 値 | 今 |
|---|---|---|
| `STAGING_RESEND_API_KEY` | Resend の staging 専用の鍵（`re_…`）。Sensitive で登録 | 無い |
| `STAGING_MAIL_SEND` | `internal` | 無い |
| `OPERATOR_EMAILS` | `support@bondex.express` | bondex.express の 1つのアドレス（値を差し替える） |
| `MAIL_TEST_CAPTURE` | `1` | 設定済み（変えない） |
| `STAGING_PLACES_MOCK` | `true`（監査の指摘・架空のホテル） | 無い |

### 5.2 起こること

コード（`lib/mailer.ts`・`lib/env-guard.ts`）がこう動くことを、`scripts/test-staging-guard/case-a-auth.ts` で確かめました（21/21・送信は差し替え）。

- `support@bondex.express` 宛ての運営の認証コードのメールだけを、staging の鍵で実際に送ります。
- 旅行者・代理店・ホテル宛ては、記録だけにします。宛先に 1つでも社内でないものがあれば送りません。
- B2C の旅行者への通知は sandbox のままです（`B2C_NOTIFY_LIVE` は足さない）。WhatsApp は起動の守りが止めます。
- 書き間違いがあると、起動の守りが止めます（`STAGING_MAIL_SEND` が internal 以外・鍵の形・宛先が空・`MAIL_TEST_CAPTURE` を外す・本番の名前の鍵）。

### 5.3 手順（それぞれ承認の後）

1. Resend で staging 専用の鍵を作ります。権限は「送信だけ」、ドメインは bondex.express に限ります。名前の例: `bondex-staging-e2e`。鍵の値は、記録・チャットに残しません。
2. Biz-Logi 担当（Vercel の実行担当）が、5.1 の値を Preview・ブランチ限定で登録し、Preview を作り直します。
3. Preview の `/operator` で、`support@bondex.express` にコードを送ります（実メール 1通）。受信箱でコードを確かめて、パスキーを登録します。
4. B2C の操作ができることを確かめます（`/operator/b2c` の一覧が 403 にならない）。

### 5.4 注意

- E2E の旅行者・代理店のメールに `support@bondex.express` を使わないでください。`…@example.invalid` などを使います。
  - B2C の旅行者への通知は sandbox なので、どの宛先でも送りません。
  - B2B の通知は、メールの送信の処理（`sendMail`）を直接使います。社内の宛先だと実際に届きます。
- 試験の後は、`STAGING_MAIL_SEND` を外せば、すべて記録だけに戻ります。鍵は Resend で無効にします。
