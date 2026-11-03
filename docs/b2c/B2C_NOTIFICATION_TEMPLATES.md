# B2C の旅行者への通知の文面（Phase 1A・Stage 4）

更新: 2026-11-04。実装は `lib/b2c/notify-templates.ts`（文面）と `lib/b2c/notify.ts`（送信・再試行・重複の防止）。

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
- 同じ通知は二度送らない（`b2c_outbox.dedupe_key`）。取消の時は、まだ送っていない確定・確認待ち・リマインドを送らない。
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
