# B2C の旅行者への通知の文面（Phase 1A・Stage 4）

更新: 2026-11-04（4章を追加）。実装は `lib/b2c/notify-templates.ts`（文面）と `lib/b2c/notify.ts`（送信・再試行・重複の防止）。

## 1. 通知の一覧

| 種類 | いつ | 送る条件（送る直前に確かめる） | メール | WhatsApp のテンプレート |
|---|---|---|---|---|
| 予約確定 | 確定の時（DB の関数 `b2c_confirm_order` が積む） | 予約が confirmed | あり | `bondex_b2c_booking_confirmed` |
| ホテル確認待ち | カード登録の後、ホテルの条件が未達で awaiting に移った時（同上） | 予約が awaiting_hotel_confirmation のまま | あり | `bondex_b2c_awaiting_hotel` |
| ホテル確認の結果（確定） | 運営が施設を確認済み・受入を了承 → 確定 | 予約確定と同じ | 予約確定と同じ | 予約確定と同じ |
| 取消 | 旅行者の取消・ホテルが断った・確認の期限切れ・カードの入力の放置・運営の取消（`b2c_cancel_order`） | 予約が cancelled | あり | `bondex_b2c_cancelled` |
| 前日のリマインド | 集荷日の前日 18:00 以降 | confirmed・集荷前・集荷日が翌日 | あり | `bondex_b2c_pickup_tomorrow` |
| 当日のリマインド | 集荷日の 8:00〜11:00 | confirmed・集荷前・集荷日が当日・11:00 前 | あり | `bondex_b2c_pickup_today` |

- 言語は予約の言語（日本語で予約した人は日本語、英語の人は英語）。WhatsApp の言語コードは `ja` と `en_US`。
- 確認待ちの通知では「確定」を約束しない。確定の通知はホテルの条件を満たしてからだけ。
- 同じ通知は二度積まない（`b2c_outbox.dedupe_key`）。外への二重送信の防ぎ方（届いたか分からない時）は 4章。取消の時は、まだ送っていない確定・確認待ち・リマインドを送らない。
- 外に送るのは `B2C_NOTIFY_LIVE=true` の時だけ。WhatsApp は加えて `B2C_WHATSAPP_LIVE=true`（下のテンプレートの承認の後）。

## 2. Meta に申請する WhatsApp のテンプレート（案）

カテゴリーは「Utility（取引の連絡）」。`{{n}}` は差し込み値（順番は `lib/b2c/notify-templates.ts` の `renderWhatsApp` と同じ）。
申請の時の見本の値は、試験のダミーのデータ（例: 山田 花子・100001）を使う。

### bondex_b2c_booking_confirmed
差し込み: 1 お名前／2 受付番号／3 集荷日／4 集荷のホテル／5 お届け日／6 お届け先のホテル／7 予約の確認ページの URL

- ja: `{{1}} 様　BondEx のご予約が確定しました（受付番号 {{2}}）。集荷: {{3}} 11:00 までに {{4}} のフロントへお預けください。お届け: {{5}} {{6}}。料金は佐川急便の集荷の後にご登録のカードへ請求します。ご予約の確認・取消: {{7}}`
- en_US: `Hi {{1}}, your BondEx booking is confirmed (request {{2}}). Pickup: leave your bags at the front desk of {{4}} by 11:00 on {{3}}. Delivery: {{6}} on {{5}}. We charge your card after Sagawa picks up your bags. View or cancel: {{7}}`

### bondex_b2c_awaiting_hotel
差し込み: 1 お名前／2 受付番号／3 確認の期限（日本時間）／4 予約の確認ページの URL

- ja: `{{1}} 様　BondEx のご予約を受け付けました（受付番号 {{2}}）。まだ確定していません。{{3}} までにホテルに確認し、確定したらお知らせします。確定できない場合は自動で取り消し、料金はかかりません。確定するまでお荷物は預けないでください。ご予約の確認: {{4}}`
- en_US: `Hi {{1}}, we received your BondEx request ({{2}}). It is not confirmed yet. We will confirm with the hotel by {{3}} and let you know. If we cannot, it is cancelled automatically at no charge. Please do not leave your bags until it is confirmed. Details: {{4}}`

### bondex_b2c_cancelled
差し込み: 1 お名前／2 受付番号／3 取消の理由の文

- ja: `{{1}} 様　BondEx のご予約（受付番号 {{2}}）について。{{3}} 料金は一切かかりません。`
- en_US: `Hi {{1}}, about your BondEx booking ({{2}}): {{3}} There is no charge.`

### bondex_b2c_pickup_tomorrow
差し込み: 1 お名前／2 受付番号／3 集荷日／4 集荷のホテル／5 ホテルのスタッフ向けの案内の URL

- ja: `{{1}} 様　明日 {{3}} は BondEx の集荷日です（受付番号 {{2}}）。11:00 までに {{4}} のフロントへお預けください。送り状は佐川急便が持参します。フロント向けの案内: {{5}}`
- en_US: `Hi {{1}}, tomorrow ({{3}}) is your BondEx pickup day (request {{2}}). Leave your bags at the front desk of {{4}} by 11:00. Sagawa brings the labels. Note for the front desk: {{5}}`

### bondex_b2c_pickup_today
差し込み: 1 お名前／2 受付番号／3 集荷のホテル／4 ホテルのスタッフ向けの案内の URL

- ja: `{{1}} 様　本日は BondEx の集荷日です（受付番号 {{2}}）。11:00 までに {{3}} のフロントへお預けください。フロント向けの案内: {{4}}`
- en_US: `Hi {{1}}, today is your BondEx pickup day (request {{2}}). Please leave your bags at the front desk of {{3}} by 11:00. Note for the front desk: {{4}}`

## 3. 公開の前に必要なこと

1. 上の 5つのテンプレート（日本語・英語の 10件）を Meta に申請し、承認を得る。承認された文面と差し込みの順が違えば、`renderWhatsApp` を合わせる。
2. メールの送信の設定（`SMTP_*` または `RESEND_API_KEY`）が本番にあることを確かめ、試しの宛先に 1通ずつ送って表示を確かめる。
3. `B2C_SITE_URL`（My Booking のリンクの先）と `B2C_ACCESS_TOKEN_SECRET`（32文字以上。変えると過去のリンクが使えなくなる）を本番に入れる。
4. 定期の処理（`POST /api/b2c/cron/tick`・`CRON_SECRET`）を数分おきに呼ぶ仕組みを作り、`B2C_SCHEDULER_ENABLED=true` にする（既存の B2B の定期の処理と同じく GitHub Actions を想定。本番への反映は別の承認）。
5. 本番の DB に `sql/073_b2c_outbox_hardening.sql` を当てる（`sql/062` の後。別の承認）。
6. メールの送信手段は **Resend を推奨**（冪等キーが効き、結果が分からない時に自動で安全に再送できる）。SMTP だけの時は、結果が分からない通知は自動で再送せず運営の照合になる。

## 4. 送信待ちの滞留・再試行・重複・期限切れの方針（2026-11-04）

実装: `sql/073_b2c_outbox_hardening.sql`（取る順・期限・止まった送信の片付け・滞留の状況）、`lib/b2c/notify.ts`（送信）、`lib/b2c/outbox-ops.ts` と `POST /api/b2c/ops/outbox`（運営の照合）。試験: `scripts/test-b2c/outbox_e2e.ts`。

### 4.1 取る順（古い通知が溜まってもリマインドを遅らせない）
- 重要度 → 期限の近い順 → 予定の時刻の順。重要度: 当日のリマインド 10、前日のリマインド 20、取消・予約確定 30、確認待ち 40。
- 1回の処理は 20件ずつ取り、時間の上限（50秒）まで取り続ける。上限を過ぎたら、まだ送っていない行は待ちに戻して次回へ。
- 取る処理は DB の 1つの SQL（`FOR UPDATE SKIP LOCKED`）。定期の処理が重なっても、同じ通知を 2つの処理が取らない。
- 送信の失敗した通知は、待ち時間（2分・5分・15分・1時間・3時間）の間は取らないので、後ろの通知を塞がない。1通の送信は 20秒で打ち切る。

### 4.2 期限（期限を過ぎた通知は送らない = expired）
| 通知 | 期限（日本時間） |
|---|---|
| 当日のリマインド | 集荷日の 11:00 |
| 前日のリマインド | 集荷日の 0:00（当日に「明日は集荷日」と送らない） |
| 予約確定 | 集荷日の 11:00 |
| 確認待ち | ホテルの確認の期限 |
| 取消 | 積んでから 2日 |
期限を過ぎた通知は送らずに expired にし、運営に知らせる（必要なら旅行者に直接連絡）。

### 4.3 結果の 3つの分け方と再試行
送り始める前に「送り始めた時刻」と送る文面を DB に記録する。記録できなければ送らない。

| 結果 | 例 | 扱い |
|---|---|---|
| 届いた | 相手が受け付けた | sent |
| 確実に送れていない | 接続できない・429・宛先の誤り | 待ち時間を空けて再試行（最大 6回）。直らない失敗・上限 → failed |
| 届いたか分からない | 時間切れ・切断・相手の 5xx・**送った直後に DB の記録が失敗** | 下の表 |

DB の一意の制約（dedupe_key）は「同じ通知を二度積まない」ことしか守れない。外のサービスに届いたかどうかは DB には分からないため、届いたか分からない時は送信手段ごとに決める:

| 送信手段 | 冪等キー | 届いたか分からない時 |
|---|---|---|
| メール（Resend） | あり（24時間。dedupe_key を使う） | 同じ文面・同じキーで自動で再試行。届いていれば Resend が 1通にまとめるので、旅行者に 2通届かない。最初の送信から 23時間を過ぎたら自動では再試行しない |
| メール（SMTP だけ） | なし | 自動で再送しない。unknown にして運営が照合 |
| WhatsApp | なし | 自動で再送しない。unknown にして運営が照合（同じ内容はメールでも届いている） |

送った直後に DB の記録が失敗した時: 記録を 3回試し、それでもだめなら行は「送信中・送り始めの記録あり」のまま残る（ログに outbox の番号を出す）。10分後の片付けで、冪等なメールは同じキーで再試行、冪等でない手段は unknown にして運営に知らせる。処理が送る前に落ちた行（送り始めの記録が無い）は、まだ送っていないので自動で再試行する。

### 4.4 運営の照合（unknown・failed・expired）
- 定期の処理が、1行 1回、まとめて運営に知らせる（Slack・メール）。
- 運営は送信サービスの記録（Resend のログ・WhatsApp Manager の配信の記録）で確かめ、`POST /api/b2c/ops/outbox` で選ぶ: **届いていた**（→ sent）／**再送**（→ 待ちに戻す。期限切れは不可。メールは同じ冪等キー）／**送らない**（→ cancelled。別の手段で連絡した時）。理由は必須で、運営者と理由を予約の記録に残す。個人のパスキーのログインだけ（共有パスワードは不可）。運営用の画面はまだ無い（API だけ）。

### 4.5 滞留の知らせ
- 15分以上遅れた送信待ち・10分以上遅れた集荷のリマインド・10分以上止まった送信がある時、運営に知らせる（1時間に 1回まで）。
- 本番（B2C_NOTIFY_LIVE=true）で知らせる手段（Slack・メール）が無い時は、定期の処理が 503 を返す（定期の処理の側で失敗として見える）。
