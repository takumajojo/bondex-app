# BondEx B2C ホテル間配送 予約システム 最終設計書

- 版: v1.0（設計のみ・未実装）
- 作成日: 2026-10-22
- 対象トラック: PoC刷新トラック（bondex-app / bondex.express）
- 調査基準: `origin/main` = `f31ed09`（#77 まで）
- 状態: **PHASE 1（調査）完了 / PHASE 2・3（設計）完了 / PHASE 4 以降は承認待ち**

> 本書は「BondEx B2C Booking System 開発方針・確定事項」と「追加設計指示（4点）」を、既存コードの調査結果に当てはめて設計に落としたものです。
> 本番環境・本番DB・本番Stripe・既存予約処理には一切変更を加えていません。

---

## 0. 確定方針（変更しない前提）

| 項目 | 内容 |
|---|---|
| 対象区間 | **ホテル → ホテルのみ**。空港・駅・民泊・個人宅は B2C 画面に出さない |
| 対象施設 | フロントデスクにスタッフが常駐し、荷物の預かり・受け渡しができるホテルのみ。**集荷先・配送先の両方**が条件を満たすこと |
| 拒否対象 | Airbnb／民泊／無人ホテル／フロントなし／スタッフ非常駐／預かり不可／個人宅。**例外対応なし**。予約リクエストも受け付けない |
| 予約方式 | ゲスト予約（アカウント登録なし）。予約後は安全な専用リンクで確認 |
| 言語 | 英語・日本語（多言語拡張できる構造） |
| 決済 | Stripe 事前決済。B2B の請求書払い・代理店カード課金とは分離 |
| 変更・キャンセル | 初期は **BondEx への問い合わせ方式**。顧客による自動変更・自動返金なし |
| 価格 | 4,980円は**暫定参考値**。正式価格確定まで本番で有料予約を受け付けない |
| アフィリエイト | 今回は**実装しない**。将来の成果計算を妨げないデータ構造のみ用意 |
| 禁止 | 既存B2Bへの影響、既存DBの破壊的変更、本番Stripe変更、実課金 |

---

## 1. PHASE 1 調査結果（既存システムの事実）

根拠はすべて `origin/main` のファイル。

### 1.1 データ構造

- **予約・料金・課金・追跡・監査はすべて `shipments` 1テーブル（1区間＝1行）に載っている。** bookings / hotels / payments の独立テーブルは無い。予約は `booking_id` で行をまとめているだけ（`sql/001_shipments.sql`, `sql/003` の `(booking_id, leg_index)` UNIQUE）。
- **代理店は `shipments.agency text NOT NULL`（代理店名の文字列）で識別。** `agency_id` も FK も無い。課金（`lib/charge.ts:80-86`）、月次請求（`lib/invoice-build.tsx:110-117`, `app/api/cron/monthly-invoices/route.ts:66-72`）、RLS（`sql/002`）、通知、レポートがこの文字列で照合している。
- `shipments.status` の値は CHECK 制約で固定（`sql/011:24-25`）: `requested, pending, issued, picked_up, in_transit, delivered, failed, cancelled`。
- `agencies.payment_method` は `'invoice' | 'card'`（`sql/010:15`）。
- **ホテルマスタは無い。** 各行に Google `place_id`・ホテル名（ja/en）・都道府県・市区を非正規化して持つだけ。
- 民泊・個人宅は B2B では許可されている（`from_residence` / `to_residence` jsonb, `lib/residence.ts`, `sql/016`）。**「フロントあり・有人」の概念はコードに存在しない。**
- `delivery_overdue_alerted_at` はコードが参照しているが migration が無い（既存の schema drift。B2C とは別件）。

### 1.2 予約・料金・日付

- B2B 予約 API（`app/api/agency/booking/route.ts`）は `status:"requested"`, `amount_yen:0` で保存し、運営の発行操作で金額確定（`app/api/shipandco/create/route.ts:979`）。
- 冪等化は `booking_requests`（`sql/029`, request_key PK）、予約番号は `lib/booking-id.ts`（`BDX-` + 30字種×6桁、衝突確認つき）。
- 料金は `lib/pricing.ts:10` の `PRICING.regularPrice = 4980`（**税抜**・1個単価）。区間別・サイズ別の料金概念は無い。税は `lib/tax.ts`（10%、切り捨て）。
  - → B2C は**税込表示が必須**。参考値 4,980円（税抜）は税込 **5,478円**。
- 配達日: `lib/carrier.ts` の `minOffsetDays:1 / maxOffsetDays:7`（当日着不可）は**送り状発行時にしか検証されない**。予約 API にはサーバー側の過去日・当日チェックが無い。
- **地域別の所要日数（東京→関西は翌日 等）のロジックは無い。** LP の文言（`lib/landing-messages.ts`）と営業資料の「目安」のみ。
- 受付締切の表記が媒体ごとに食い違っている（LP=前日16:00 / 営業資料=前日18:00 / ポータル=前日17:00）。既存の未決事項。
- 祝日表は 2026〜2028年をハードコード（`lib/business-days.ts:14-30`）。

### 1.3 決済（Stripe）

- 現行は **SetupIntent でカード保存 → 集荷完了時に off_session で区間ごと課金**（`lib/charge.ts`）。安全ゲート `STRIPE_CHARGE_LIVE==="true"`。
- `chargeShipmentIfDue` は status が picked_up 以上になると3経路から自動で呼ばれる（`app/api/shipments/route.ts:259-265`, `app/api/cron/sync-tracking/route.ts:389`, `lib/tracking/reconcile.ts:154`）。スキップ条件は `charged_at` あり / `is_addition` / `billing_exempt` / `payment_method!=='card'` / 代理店行なし。
- Checkout の利用実績あり（旅行中の追加: `app/api/shipments/addition-settle/route.ts`、metadata `kind:"addition"`）。
- Webhook（`app/api/stripe/webhook/route.ts`）は署名検証あり。**event.id の重複排除テーブルは無い**（上書き更新で冪等にしている）。
- **アプリ内の返金処理は無い**（Stripe ダッシュボードで手動 → webhook で `refunded_at` 記録）。
- `getShipmentByPaymentIntentId`（`lib/shipments-db.ts:845-859`）は `maybeSingle`。1つの PaymentIntent を複数行で共有すると webhook が 500 を返し続ける。

### 1.4 ホテル連絡

- **自動送信は無い。** 運営が電話・メールで手動連絡し「連絡済み」を押す（`shipments.pickup_hotel_notified_at` / `guest_hotel_notified_at`）。期限は発送日の2営業日前（`lib/hotel-notification.ts:108`）。毎朝の督促 cron（`app/api/cron/hotel-contact/route.ts`）。
- 連絡先・方法・メモは `shipments.hotel_contact_info` jsonb（`lib/hotel-contact-info.ts`）。**誰が連絡したか、ホテルが受諾したかの専用記録は無い**（memo の自由記述のみ）。
- 公式サイトから電話番号を抽出（`lib/hotel-website-phone.ts`）、初回ホテル判定（`lib/hotel-history.ts`）、紹介メール（`lib/hotel-intro-email.ts`、日本語、運営がワンクリック送信）は再利用できる。
- 紹介メールの本文が約束する「発送前日の受け取り依頼メール」は**未実装**。
- 既存の確定事項: 「ホテル宛ての紹介メールは社外宛のため自動送信しない」。

### 1.5 佐川・追跡・配達完了

- 2026-09-24 以降、BondEx は送り状を発行しない（`AUTO_ISSUE_ENABLED` 既定 OFF, `lib/waybill-issuance.ts`）。佐川への集荷依頼は**運営の手動メール/電話**＋`pickup_requested_at` 記録（`sql/038`, `app/api/operator/sagawa-pickup`）、`cron/daily-todo` が通知。
- 追跡の自動同期は**停止中**（`lib/tracking-pause.ts`、`TRACKING_SYNC_PAUSED` 既定 true）。佐川追跡 API は別ブランチで実装中・未コミット。
- **配達完了は現状、運営の手動ステータス変更のみ**（`PATCH /api/shipments`）。記録は `delivered_at` だけで、**担当者・根拠は記録されない**。
- 運営セッション（`lib/operator-session.ts`）は共有の運営ログインで、**個人の識別子を持たない**。パスキーは端末名 `label` のみ（`sql/031`）。

### 1.6 バウチャー・メール・公開ページ

- バウチャー生成 `regenerateVoucherPdf`（`lib/voucher-regen.tsx`）は代理店名・代理店連絡先・`expectedAgency` 所有者チェックに依存。ゲスト面は en/zh/it/fr/es で**日本語のゲスト面が無い**（`lib/guest-language.ts:9`）。ホテル面は日本語固定。
- メールは Resend → SMTP フォールバック（`lib/mailer.ts`）。**旅行者宛てメールはゼロ、shipments に旅行者のメール・電話列も無い。**
- 公開追跡 `/track/[bookingId]` は**予約番号だけで閲覧可**（トークンなし）。
- `middleware.ts` は `/api/*` を既定拒否。公開は `/api/agency/` `/api/track/` `/api/stripe/` `/api/cron/` `/api/demo/` `/api/g/` 等の prefix と一部の完全一致のみ。
- 規約（`app/legal/terms`）は英語・代理店前提、特商法表記（`app/legal/commercial-transactions`）は法人向け。**個人消費者向けの規約・特商法・キャンセルポリシーは無い。**
- **テスト基盤は無い**（jest / vitest / playwright なし）。
- ローカル開発は `.env.local` で**本番 Supabase を参照**する運用（読み取りのみ）。B2C の書き込みテストには別DBが必須。

---

## 2. 全体アーキテクチャ（ハイブリッド構成）

```
[旅行者 ブラウザ]
   │  /en/book  /book (ja)         ← 新規ページ（noindex）
   ▼
[/api/b2c/*]  ← 新規公開API（Turnstile + 分散レート制限 + 各ルートで自前検証）
   │
   ├─ b2c_orders / b2c_facilities / b2c_price_rules / b2c_transit_rules …  ← 新規テーブル（B2C専用）
   │
   │  決済完了（Webhook）で初めて ↓ を作る
   ▼
[shipments]  ← 既存。B2C 行は agency='BondEx Direct' 固定・charged_at を事前に立てる
   │
   └─ 既存の運営フロー（ダッシュボード / ホテル連絡督促 / 佐川集荷依頼 TODO / 追跡 / レポート）にそのまま載る
```

### 設計の核心（B2B を壊さないための4原則）

1. **未払い・未確認の B2C 予約は `shipments` に入れない。** 支払い完了（＝予約確定）の時点で初めて `shipments` 行を作る。これにより、`shipments.status` の CHECK 制約変更が不要になり、運営の発行キュー・ホテル連絡 cron・集荷漏れアラートに未確定の行が混ざらない。
2. **B2C の `shipments` 行は専用の代理店名 `BondEx Direct` に固定**し、その代理店行は `payment_method='invoice'` かつ `billing_exempt=true` にする。さらに行作成時に `charged_at`・`charge_amount_yen` を立てる。これで `chargeShipmentIfDue` は二重に必ずスキップし（`charged_at` あり／`billing_exempt`）、月次請求（`billing_exempt` を除外）にも混入しない。
   - 加えて `lib/charge.ts` の先頭に `if (shipment.agency === B2C_AGENCY_NAME) return skip` の明示ガードを1行だけ足す（防御の三重化）。B2B のロジックは変えない。
3. **Stripe の PaymentIntent は `b2c_orders` に持ち、`shipments.stripe_payment_intent_id` には入れない。** Webhook は `metadata.kind==="b2c_order"` を最初に判定して B2C 側へ分岐し、既存の `addition` 経路・返金/係争の既存処理には触れない。
4. **既存テーブルへの変更は「NULL 許容列の追加」のみ**（`shipments.b2c_order_id uuid NULL` の1列）。既存列の型変更・制約変更・削除はしない。

---

## 3. 施設適格性（最重要）

### 3.1 基本ルール

- **施設名だけでは判断しない。** 予約画面ではホテルを**検索・選択**させ、自由入力は受け付けない（Google Places `type=lodging`、`lib/places-search.ts` を再利用）。
- 施設の識別キーは Google `place_id`。
- 施設は次の4状態のどれかで管理し、**「確認済み」になる経路は BondEx 運営による確認だけ**とする。自動判定は「拒否」か「要確認」にしか振り分けない（自動で承認しない）。

| 状態 | 意味 | 予約画面での扱い |
|---|---|---|
| `verified`（確認済み） | 運営が判定基準をすべて確認した | 即時予約・決済できる |
| `unverified`（未確認） | マスタ未登録、または自動判定で要確認 | **決済前の予約リクエスト**として受け付ける |
| `rejected`（対象外） | 確認の結果、基準を満たさない | **予約もリクエストも不可** |
| `blocked`（禁止） | 自動判定で民泊・Airbnb等と判定、または運営が恒久禁止 | **予約もリクエストも不可**、検索結果に「対象外」と表示 |

- `verified` には**有効期限**を持たせる（既定 12か月）。期限切れは自動で `unverified` に戻す。
- 受け渡しトラブル（ホテルが受け取り拒否等）が起きた施設は、運営が `rejected` に落とせる。落とした時点で、その施設を含む未発送の B2C 予約は運営の例外キューに出る。

### 3.2 自動の事前ふるい分け（拒否・要確認への振り分けのみ）

予約者がホテルを選んだ時点でサーバー側で実行する。

- **自動 `blocked`**（予約もリクエストも不可）
  - Places の `types` に `lodging` が無い
  - 名称・types に民泊系の語を含む: `Airbnb`, `民泊`, `vacation rental`, `holiday home`, `Vrbo`, `self check-in`, `unmanned`, `無人`, `セルフチェックイン` 等（辞書は設定データで管理し運営が追加できる）
  - 住所に部屋番号（例: `#301`, `○○号室`）を含むマンション型の住所
- **自動 `unverified`**（リクエスト扱い）
  - 上記に当たらない、マスタ未登録のすべての施設
  - 名称に `apartment`, `guest house`, `hostel`, `condo`, `residence`, `stay`, `アパートメント`, `ゲストハウス` 等を含む施設は「要注意」フラグを付けて運営の確認画面で目立たせる（フロント常駐のホステルも実在するため自動拒否はしない）

> 自動判定は補助にすぎない。拒否漏れは運営確認で必ず止まる（未確認のまま決済できる経路が存在しない）ので、ここで完璧を目指さない。

### 3.3 運営による確認（verified にする唯一の経路）

**判定基準（すべて満たした場合のみ verified）**

| No. | 基準 | 確認方法 |
|---|---|---|
| 01 | 旅館業法の許可を受けたホテル・旅館である（住宅宿泊事業法の届出住宅＝民泊、特区民泊ではない） | 公式サイト・自治体の公表情報を確認し、根拠URLを記録 |
| 02 | フロントデスクにスタッフが常駐している（少なくとも集荷時間帯 9〜18時と配達時間帯） | **公式電話番号へ電話して確認**（電話番号は公式サイト由来。Google の電話データは使わない＝既存方針） |
| 03 | 宿泊客の荷物をチェックイン前・チェックアウト後に預かれる | 同上の電話で確認 |
| 04 | 佐川急便の集荷担当へ荷物を引き渡せる（集荷先として） | 同上 |
| 05 | 宅配便で届いた宿泊客の荷物を受け取り、到着まで保管できる（配送先として） | 同上 |
| 06 | BondEx からの事前連絡の窓口（メール可否・担当部署）がある | 同上。メール連絡の同意を取れたら記録 |

- 集荷先としての可否（04）と配送先としての可否（05）は**別々に記録**する。片方だけ可の施設は、可の側でのみ予約を受け付ける。
- 確認記録は**誰が・いつ・どの方法で・誰と話したか・各基準の回答・根拠URL/メモ**を必ず残す（`b2c_facility_verifications`、後述）。
- 既存B2Bで配達完了実績があるホテル（`lib/hotel-history.ts` で抽出可能）は、確認候補リストとして運営画面に優先表示する。ただし**実績だけで verified にはしない**（B2Bは添乗員・代理店経由の運用で前提が違うため）。基準 01〜06 の確認は必須。

### 3.4 予約者側の確認（施設確認の代わりにはしない・追加の安全網）

予約フォームの STEP 3 で、以下に同意しないと先へ進めない。

- 英語:
  > Hotel-to-hotel delivery only. Both hotels must have a staffed front desk that can accept and hand over luggage. Airbnb, vacation rentals, and unmanned accommodations are not supported.
  > - [ ] I confirm that both are hotels with a staffed front desk, and that I have a reservation at each hotel under the name below.
- 日本語:
  > ホテル間の配送のみ承ります。集荷先・配送先ともに、スタッフが常駐し荷物の預かりと受け渡しができるフロントのあるホテルに限ります。Airbnb・民泊・無人の宿泊施設はご利用いただけません。
  > - [ ] 両方ともスタッフ常駐のフロントがあるホテルであり、下記の予約名で宿泊予約があることを確認しました。
- 両ホテルの**予約名**と、**集荷先のチェックアウト日・配送先のチェックイン日／チェックアウト日**を必須入力にする。ホテルへの事前連絡で、この予約名・日付で宿泊予約が実在するかをホテル側に照合してもらう（→ 6章）。

---

## 4. 予約フロー

### 4.1 画面フロー（スマートフォン優先）

| STEP | 画面 | 入力 | サーバー処理 |
|---|---|---|---|
| 1 | 区間と日程 | 集荷地域・配送先地域・集荷日・荷物の個数（1〜5） | 対応区間か・集荷日が受付可能か・配送予定日を算出 |
| 2 | 料金と配送予定日 | なし（表示のみ） | 料金ルールから税込総額を算出、見積IDを発行（有効15分） |
| 3 | ホテル | 集荷先ホテル・配送先ホテルを検索して選択、各ホテルの予約名と日付、同意チェック | 施設の適格性判定（3章）。ここで「即時予約」か「予約リクエスト」かが決まり、画面に明示 |
| 4 | お客様情報 | 氏名（ローマ字）、メール、電話（国番号つき・任意→推奨）、表示言語 | メール形式・電話形式の検証 |
| 5a | 確認して決済（**両ホテルが verified**） | 規約・キャンセル規定への同意 | **料金・日程・施設状態をサーバーで再検証** → Stripe Checkout へ |
| 5b | 確認してリクエスト送信（**どちらかが unverified**） | 規約への同意 | 予約リクエストとして保存。**決済はしない** |
| 6 | 完了 | — | 5a: 予約確定メール＋バウチャー / 5b: リクエスト受付メール（確認後に決済案内を送る旨） |

- 集荷時刻は既定 **11時**（チェックアウト時刻に合わせる。既存の運用方針）。B2C 画面では時刻を選ばせず、「チェックアウトまでにフロントへ預けてください」と案内する。
- 配送予定日は**システムが算出し、旅行者には選ばせない**（STEP 2 で表示）。午前指定などの時間帯指定は初期リリースでは提供しない。
- 地域の選択肢・個数の上限・受付期間は設定データで管理し、フロントエンドに固定しない。
- 初期リリースは **1予約＝1区間** に限定する（往復・多区間は将来）。これで PaymentIntent と区間が1対1になり、既存 webhook の `maybeSingle` 問題も避けられる。

### 4.2 予約の状態遷移（`b2c_orders.status`）

```
            ┌───────────── 両ホテル verified ─────────────┐
            │                                              ▼
 [quote] ─(STEP5)─┬─→ awaiting_payment ──決済成功──→ confirmed ──→ fulfilling ──→ completed
                  │        │  └─期限切れ→ expired           │             │
                  │        │  └─決済失敗→（awaiting_payment のまま再試行可）│
                  │                                          │             └→ delivery_failed（例外）
                  └─→ pending_review ──運営承認──→ awaiting_payment
                           └─運営拒否──→ rejected

 confirmed / fulfilling から: cancel_requested → cancelled（必要に応じ refunded / partially_refunded）
 hotel_refused（ホテル受け取り拒否）: 例外キュー → 代替手配 or cancelled + 全額返金
```

| 状態 | shipments 行 | 説明 |
|---|---|---|
| `pending_review` | なし | 未確認ホテルを含むリクエスト。運営の確認待ち |
| `awaiting_payment` | なし | 決済待ち（即時予約の Checkout 中、または承認後の決済案内送付済み） |
| `expired` | なし | 決済期限切れ。日程枠を解放 |
| `rejected` | なし | 運営がリクエストを拒否 |
| `confirmed` | **作成**（`status='requested'`） | 決済完了＝予約確定。既存の運営フローに載る |
| `fulfilling` | 連動 | 集荷済み以降（shipments が picked_up 以上） |
| `completed` | 連動 | 配送完了確定（7章） |
| `cancelled` | `cancelled` | 運営がキャンセル処理 |
| `delivery_failed` / `hotel_refused` | 連動 | 例外。運営対応 |

- 遷移はすべて**条件付き更新**（`update ... where id=$1 and status=$expected`）で行い、競合時は何もしない。遷移ごとに `b2c_order_events` に記録する。

### 4.3 未確認ホテルを含む予約リクエスト（追加指示 1）

- 受付条件: 集荷日が**4営業日後以降**（運営の施設確認＋ホテル事前連絡の期限＝発送2営業日前を間に合わせるため）。それより近い日程は「この日程では未確認ホテルを受け付けられません」と表示し、確認済みホテルでの予約を案内する。
- 運営の処理期限: 受付から**1営業日以内**に承認または拒否（ダッシュボードの「要対応」に表示。既存の要対応タイルに B2C 件数を追加）。
- 運営の確認画面（`/operator/b2c/requests/[id]`）でできること:
  1. 未確認ホテルごとに 3.3 の基準 01〜06 を記録 → 施設を `verified` または `rejected` に更新（この記録は以後の予約でも使われる＝施設マスタが育つ）
  2. 予約リクエストを **承認**（全ホテル verified になった場合のみ押せる）／**拒否**（理由必須・定型文から選択）
- 承認時: サーバーが料金・日程・施設状態を**再検証**し、Stripe Checkout セッションを発行して決済案内メールを送る。
  - 決済期限 = min(承認から48時間, 集荷日の受付締切)。期限切れで `expired`。
  - 料金はリクエスト受付時の見積額で固定するか、承認時の料金で再計算するか → **受付時の額で固定**を推奨（旅行者に不利な変更をしない）。ただし料金ルールが受付後に下がった場合は低い方を採用。
- 拒否時: 旅行者に理由（定型）と、確認済みホテルなら予約できる旨を送る。決済は発生していないので返金処理は不要。
- 民泊・Airbnb 等の `blocked` / `rejected` 施設を含む場合は、リクエストの送信ボタン自体を出さない（サーバー側でも 422 で拒否）。

---

## 5. 料金・配送日の設定データ

### 5.1 料金（`b2c_price_rules`）

| 列 | 内容 |
|---|---|
| `origin_zone` / `dest_zone` | 佐川の12地帯（`lib/sagawa-rates.ts` の都道府県→地帯を再利用）。`*` で全地帯 |
| `size_class` | 初期は `standard`（3辺合計160cm・30kg以内のスーツケース）。将来サイズ追加 |
| `unit_price_incl_tax_yen` | **税込**の1個単価 |
| `tax_rate` | 0.10（内税表示用に保持） |
| `effective_from` / `effective_to` | 適用期間 |
| `active` | 有効フラグ |

- 料金は区間別・サイズ別に設定でき、フロントエンドには固定しない（APIが返す値を表示するだけ）。
- **決済直前（Checkout セッション作成時）にサーバーで再計算**し、見積額と一致しなければセッションを作らず STEP 2 へ戻す。Webhook 受信時にも `amount_total` と `currency='jpy'` を注文の確定額と照合し、不一致は `confirmed` にせず運営へアラート。
- 初期データ: 正式価格が未定のため、**検証環境のみ**参考値 税込5,478円（＝税抜4,980円）を入れる。本番には正式価格の承認後に投入する。
- B2B の `lib/pricing.ts` とは**完全に分離**する（LP・特商法・代理店課金の 4,980円税抜表示に影響させない）。

### 5.2 配送日（`b2c_transit_rules` / `b2c_blackout_dates`）

| 列 | 内容 |
|---|---|
| `origin_zone` / `dest_zone` | 地帯の組み合わせ |
| `transit_days` | 集荷日から配送予定日までの日数（1 または 2）。**区間ごとに設定し、一律翌日にはしない** |
| `enabled` | B2C で受け付ける区間か（初期は運営が実績のある区間のみ ON） |
| `cutoff_days_before` / `cutoff_time_jst` | 受付締切（例: 集荷日の1日前 16:00） |
| `max_days_ahead` | 何日先まで受け付けるか（既定 60日） |

- `b2c_blackout_dates`: 年末年始・お盆・繁忙期など受付停止日（集荷日・配達日の両方に適用）。
- サーバーでの判定（予約 API・Checkout 作成・承認時の3回）:
  - 集荷日 > 今日（JST）。**当日集荷・当日配送は不可**
  - 現在時刻が受付締切より前
  - 集荷日・配送予定日がブラックアウトに当たらない
  - 配送予定日 ≤ 配送先ホテルのチェックアウト日（荷物が届く前に旅行者が出発しないこと）
  - 集荷日 ≤ 集荷先ホテルのチェックアウト日、かつ集荷日 ≥ 集荷先ホテルのチェックイン日
  - 配送予定日 < 配送先チェックイン日の場合は「チェックイン前の荷物保管」が必要になる旨をホテル事前連絡に含める（基準 05 で保管可を確認済みの施設のみ可）
- 東京〜関西の翌日配送は、実運用で確認できている区間として `transit_days=1` を入れる。それ以外の区間の日数は**運営が佐川の配達目安で確認してから**登録する（推測で入れない）。
- 受付締切の時刻は、既存の不一致（16/17/18時）を事業側で一本化してから設定する（**未決事項**）。

---

## 6. ホテルへの事前連絡（追加指示 3）

### 6.1 方針

旅行者がホテルに配送手配を説明しなくて済むよう、**予約確定（confirmed）時に、集荷先・配送先の両ホテルへの連絡タスクを自動で作る**。連絡そのものは既存方針（社外宛てメールの自動送信はしない）に合わせ、**初期は運営が内容を確認してワンクリックで送る**方式にする。

- B2C の `shipments` 行は confirmed 時点で作られるので、**既存のホテル連絡督促（`cron/hotel-contact`・ダッシュボードの期限バッジ・`HotelContactEditor`）にそのまま載る**。新しい督促の仕組みは作らない。
- 連絡手段は施設マスタ（`b2c_facilities.contact_method`）の値を使う。メール連絡の同意があるホテルはメール、無ければ電話。
- 連絡期限は既存と同じ**発送日の2営業日前**。

### 6.2 連絡内容（日本語・テンプレート化）

| 集荷先ホテル向け | 配送先ホテル向け |
|---|---|
| 予約番号、宿泊者の予約名、チェックアウト日、個数 | 予約番号、宿泊者の予約名、チェックイン日・チェックアウト日、個数 |
| 集荷日: ○月○日（佐川急便が伝票を持参して集荷） | 配達予定日: ○月○日（佐川急便が配達） |
| お願い: チェックアウト時に荷物をお預かりいただき、佐川急便の集荷担当へお渡しください | お願い: 荷物をお受け取りいただき、ご到着まで保管のうえお渡しください（チェックイン前着の場合はその旨を明記） |
| 宿泊予約の照合のお願い（予約名・日付で宿泊予約があるか） | 同左 |
| BondEx 連絡先（support@bondex.express ほか確定済みの窓口） | 同左 |

- 既存の紹介メール（`lib/hotel-intro-email.ts`）・バウチャーのホテル面（日本語）の文面と言い回しを揃える。
- 電話番号は**未確定**（既存の未決事項：バウチャー CONTACT の実電話番号。個人携帯は使わない）。テンプレートでは placeholder にしておく。

### 6.3 ホテルの回答の記録（新規 `b2c_hotel_notifications`）

既存の `hotel_contact_info` jsonb は自由記述のため、B2C では受諾状態を構造化して別テーブルに残す。

| 列 | 内容 |
|---|---|
| `shipment_id` / `b2c_order_id` / `facility_id` / `side`（pickup / delivery） | 対象 |
| `method`（email / phone） / `sent_at` / `sent_by_staff_id` | いつ・誰が・どの方法で |
| `response`（pending / accepted / reservation_not_found / refused / no_answer） | ホテルの回答 |
| `response_at` / `response_note` / `contact_person` | 回答の詳細 |

- 運営が「連絡済み」を押すと、既存の `pickup_hotel_notified_at` / `guest_hotel_notified_at` も同時に更新する（既存の督促を止めるため）。
- 回答が `refused` / `reservation_not_found` の場合は、予約を `hotel_refused` にして例外キューへ出す（→ 8章）。施設を `rejected` にするかは運営が判断（予約が無かっただけなら施設は verified のまま）。
- 将来、ホテルからの回答をメール内のボタン（ログイン不要の署名付きURL）で受ける拡張を想定してテーブルを作る。今回は実装しない。

---

## 7. 配送完了の確定（追加指示 4）

### 7.1 確定の方法は2つだけ

| 方法 | 条件 | 記録 |
|---|---|---|
| **配送会社の追跡情報**（`carrier_tracking`） | 追跡APIの配達完了イベントを受信 | 追跡番号、イベント時刻、プロバイダ（sagawa/shipandco）、イベントの生データ参照 |
| **BondEx 運営の手動確認**（`operator_manual`） | 追跡が使えない・遅れている場合 | **担当者、確認日時、確認根拠（必須）** |

- 手動確認の根拠は選択式＋自由記述: `hotel_phone`（配送先ホテルに電話で受領を確認）/ `hotel_email` / `carrier_inquiry`（佐川の問合せで確認）/ `customer_confirmed`（旅行者が受領を連絡）/ `other`。根拠の詳細（話した相手、メール件名など）を必須入力にする。
- 現在、追跡の自動同期は停止中なので、**初期リリースの配送完了は運営の手動確認が主**になる。

### 7.2 担当者の識別

既存の運営ログインは共有で個人を識別できない（1.5）。B2B の認証方式は変えず、次で対応する。

- 新規テーブル `operator_staff`（id, 表示名, active）を作り、B2C の手動操作（施設確認・承認/拒否・ホテル連絡記録・配送完了確定・キャンセル・返金）では**担当者の選択を必須**にする。
- あわせて、その操作に使ったパスキーの `credential_id`（ある場合）をサーバー側で記録する（自己申告の担当者名を裏付ける補助）。
- 将来、運営ログインを個人アカウント化する際はこの列を本人IDに置き換える。

### 7.3 データ構造（新規 `shipment_delivery_confirmations`）

| 列 | 内容 |
|---|---|
| `id` | |
| `shipment_id`（FK） / `b2c_order_id`（NULL 可） | 対象区間 |
| `delivered_item_count` | 配送完了した個数（アフィリエイトの「1個500円」の母数） |
| `source` | `carrier_tracking` / `operator_manual` |
| `delivered_at` | 配達された日時（追跡ならイベント時刻、手動なら確認できた配達日時） |
| `confirmed_at` / `confirmed_by_staff_id` / `confirmed_by_credential_id` | いつ・誰が確定したか |
| `evidence_type` / `evidence_detail` / `carrier_event_ref` | 根拠 |
| `revoked_at` / `revoked_by_staff_id` / `revoke_reason` | 誤確定の取り消し（行は消さない） |

- 有効な確定は1区間につき1件（`unique(shipment_id) where revoked_at is null`）。
- 確定時に既存の `shipments.status='delivered'` と `delivered_at` も更新する（既存のダッシュボード・レポートと整合させるため）。B2C 行の手動確定は**この新しい画面からのみ**行い、既存の `PATCH /api/shipments` で B2C 行を delivered にした場合は、担当者・根拠の入力を求めて確定記録を作るまで `b2c_orders` を `completed` にしない。
- 将来B2Bでも同じテーブルを使えるよう、`b2c_order_id` は NULL 許容にしておく（今回は B2C 行のみ記録）。

---

## 8. 変更・キャンセル・返金（追加指示 2）

### 8.1 方針

- 旅行者は**問い合わせフォーム（予約確認ページから予約番号つきで開く）またはメール**で BondEx に依頼する。旅行者による自動変更・自動キャンセル・自動返金は実装しない。
- 予約確認ページには「変更・キャンセルはお問い合わせください」と、受付期限（規定確定後）を表示する。

### 8.2 運営の処理画面（`/operator/b2c/orders/[id]`）

| 操作 | できる条件 | 処理 |
|---|---|---|
| ホテル変更 | 集荷前・新しいホテルが verified | 既存 RPC `apply_hotel_change` を使用（旧ホテルへの取消連絡タスクも既存どおり作られる）。料金差があれば差額の扱いは事業判断 |
| 日程変更 | 集荷前・新日程が配送日ルールを満たす | `shipments` の日付更新＋ホテル連絡のやり直し（連絡済みフラグのリセット） |
| 個数変更 | 集荷前 | 増える場合: 追加分の決済リンク（既存 addition-settle の仕組みを参考に B2C 用を作る）/ 減る場合: 部分返金 |
| キャンセル | いつでも（集荷後は配送停止できないため実質は返金判断のみ） | `shipments` を `cancelled`（既存の監査列 `cancelled_at/by/source='operator'` を使う）、`b2c_orders` を `cancelled` |
| 返金 | 決済済み | 下記 8.3 |

- すべての操作で**担当者・理由（必須）**を記録し、`b2c_order_events` に before/after を残す。

### 8.3 返金

- アプリ内から `stripe.refunds.create` を実行する（**検証環境の Stripe テストモードのみで実装・テスト**）。
  - 金額は全額／部分（上限=決済額−既返金額をサーバーで検証）
  - `idempotencyKey = refund_<order_id>_<連番>`（同じ操作の二重送信で二重返金しない）
  - 返金レコードを `b2c_refunds` に先に `requested` で作り、Stripe の応答で `succeeded / failed` に更新
  - Webhook `charge.refunded` で最終額を照合して `b2c_orders.refunded_amount_yen` を更新
- 返金額の上限超過・二重押しはサーバーで拒否する。
- キャンセル料・返金条件は**未確定**。規定が決まるまでは「運営が金額を入力する」方式にし、既定値を持たせない。

---

## 9. 決済（Stripe）詳細

### 9.1 方式

- **Stripe Checkout（`mode:"payment"`、on-session）**を使う。カード情報は BondEx を通らない（PCI 対象を最小化）。Apple Pay / Google Pay は Checkout 標準で使える。
- `metadata`: `kind:"b2c_order"`, `b2c_order_id`, `booking_id`
- `expires_at`: 即時予約は 30分、承認後の決済案内は前述の決済期限。
- 旅行者のメールを `customer_email` に渡し、Stripe の領収書メールも使う。BondEx の「領収書」は既存 `buildChargeInvoice` を流用せず（代理店宛て前提のため）、B2C 用の簡易領収書（ja/en）を確認ページから出す。

### 9.2 二重決済・二重予約・Webhook 重複の防止

| リスク | 対策 |
|---|---|
| 予約ボタンの二重押し | クライアント生成の `request_key`（UUID）を `b2c_orders.request_key UNIQUE` で受ける。同じキーは既存の注文を返す |
| 同じ注文で Checkout を2回作る | 注文に `active_checkout_session_id` を持ち、有効なセッションがあれば再利用。作成時は `idempotencyKey = checkout_<order_id>_<attempt>` |
| 決済後の予約二重作成 | `shipments` の `(booking_id, leg_index)` UNIQUE（既存）＋ `b2c_orders` の `confirmed` への条件付き遷移 |
| Webhook の重複・順不同 | 新規 `stripe_webhook_events`（`event_id` PK）に**先に INSERT（on conflict do nothing）**し、既処理なら 200 で即終了。処理失敗時は行を `failed` にして 500 を返し、Stripe の再送で再実行 |
| 決済完了を Webhook だけに頼る危険 | 完了画面（success_url）でもサーバーから Checkout セッションを照会し、`paid` なら同じ確定処理（冪等）を呼ぶ |
| 金額の改ざん | 金額は常にサーバーの料金ルールから算出。Webhook で `amount_total` を照合 |
| 決済済みなのに日程・施設が無効になった | 確定処理で再検証し、無効なら `confirmed` にせず運営の例外キューへ（運営が全額返金） |

- 対象イベント: `checkout.session.completed`, `checkout.session.async_payment_succeeded/failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `payment_intent.payment_failed`。
- 既存 webhook ルートは同じエンドポイント（`/api/stripe/webhook`）を使い、**冒頭で `metadata.kind==="b2c_order"` を判定して B2C ハンドラへ分岐**するだけにする。`addition` の分岐・既存の返金/係争処理は変更しない。`charge.refunded` 等で B2C の PaymentIntent が来た場合も、`b2c_orders` を先に引いて見つかれば B2C 側で処理し、既存の `getShipmentByPaymentIntentId` には渡さない。

### 9.3 安全スイッチ

| 環境変数 | 既定 | 意味 |
|---|---|---|
| `B2C_ENABLED` | `false` | B2C ページ・API 全体の公開。false の間は 404 |
| `B2C_PAID_BOOKING_ENABLED` | `false` | 有料予約の受付。**正式価格の承認まで本番は false 固定** |
| `B2C_STRIPE_SECRET_KEY` | なし | B2C 専用キー。**`sk_test_` 以外ならサーバーが起動時に拒否**（本番キーの許可は別途承認後にコード変更で解除） |
| `B2C_STRIPE_WEBHOOK_SECRET` | なし | B2C 用の署名シークレット |

- B2B の `STRIPE_SECRET_KEY` / `STRIPE_CHARGE_LIVE` とは別系統にし、B2C の作業で B2B の課金設定に触れない。
  - 同じ Stripe アカウントを使う場合でも、Webhook のエンドポイントを分けるか（推奨: `/api/b2c/stripe/webhook` を新設）は実装前に決める。**推奨は分離**（既存 webhook ルートに一切手を入れずに済む）。上記 9.2 の「分岐」案はエンドポイントを共有する場合の代替。

---

## 10. 予約後の旅行者体験

### 10.1 確認ページ（専用リンク）

- URL: `/b2c/r/<access_token>`（32バイトの乱数。DBには **SHA-256 ハッシュのみ**保存）。
- 予約番号だけで見られる既存 `/track/[bookingId]` は、B2C ではメールで番号が広く出回るため**個人情報を表示しない**既存仕様のまま使い、詳細（氏名・メール・ホテル予約名）は確認ページだけに出す。
- 表示: 予約番号／集荷先ホテル／配送先ホテル／集荷予定日／配送予定日／個数／決済金額（税込）／ホテルへの預け方／配送状況／問い合わせ先／変更・キャンセルの問い合わせ導線。
- リンクを紛失した場合: 予約番号＋メールアドレスを入力すると、**登録メール宛てに**リンクを再送（画面には出さない）。

### 10.2 バウチャー

- 既存 `regenerateVoucherPdf` を再利用する。B2C 行は `agency='BondEx Direct'`、連絡先表示は `contactDisplayMode='bondex_support'` に固定。
- **日本語のゲスト面が無い**ため、`lib/guest-language.ts` に `ja` を追加する必要がある（B2B のバウチャーにも ja 選択肢が増える＝影響あり。ja を選ばない限り既存出力は変わらないことをテストで確認）。
- ホテル面（日本語）は既存のまま。フロントで提示する画面として、確認ページにも「ホテルスタッフ向け表示（日本語）」ボタンを付ける。

### 10.3 メール（ja / en）

| タイミング | 内容 |
|---|---|
| 予約確定 | 確認ページリンク、バウチャー PDF 添付、預け方 |
| リクエスト受付 | 確認中であること、期限、まだ決済されていないこと |
| リクエスト承認 | 決済リンクと期限 |
| リクエスト拒否 | 理由（定型）と代替の案内 |
| 前日リマインド | 集荷日前日 18時: 「明日チェックアウト時にフロントへ預けてください」 |
| 集荷完了／配送完了 | 状況（追跡または手動確定に連動） |
| キャンセル・返金 | 処理内容と金額 |

- テンプレートは `lib/b2c/i18n/{en,ja}.ts` の辞書方式で、言語を足すときはファイル追加のみで済む構造にする。
- 送信は既存 `lib/mailer.ts`。送信ログを `b2c_notifications_log` に残す（再送の判断用）。

---

## 11. DB 設計（新規テーブル・既存への追加）

すべて新規 migration（`sql/052_b2c_*.sql` 以降）。**既存テーブルへの変更は NULL 許容列の追加1件と、`BondEx Direct` 代理店行の INSERT 1件のみ**。RLS は全テーブル有効・ポリシーなし（service_role 専用）。

| テーブル | 主な列 | 備考 |
|---|---|---|
| `b2c_facilities` | `id`, `place_id UNIQUE`, `name_ja`, `name_en`, `prefecture`, `zone`, `status`(verified/unverified/rejected/blocked), `pickup_ok`, `delivery_ok`, `pre_checkin_hold_ok`, `license_type`, `contact_method`, `contact_email`, `official_phone`, `official_website`, `verified_until`, `flags jsonb`, `updated_at` | 施設マスタ |
| `b2c_facility_verifications` | `facility_id`, `criteria jsonb`(01〜06の回答), `result`, `method`, `contact_person`, `evidence_url`, `note`, `staff_id`, `credential_id`, `created_at` | 確認履歴（追記のみ） |
| `b2c_blocklist_terms` | `term`, `match`(name/type/address), `action`(block/flag) | 自動ふるい分けの辞書 |
| `b2c_price_rules` | 5.1 参照 | |
| `b2c_transit_rules` / `b2c_blackout_dates` | 5.2 参照 | |
| `b2c_quotes` | `id`, 区間・日程・個数, `amount_incl_tax_yen`, `price_rule_id`, `expires_at` | 見積のスナップショット |
| `b2c_orders` | `id`, `booking_id UNIQUE`, `request_key UNIQUE`, `status`, `locale`, 旅行者（`guest_name`, `guest_email`, `guest_phone`）, 両ホテルの `facility_id`・予約名・チェックイン/アウト日, 日程, 個数, 金額スナップショット, `stripe_checkout_session_id UNIQUE`, `stripe_payment_intent_id UNIQUE`, `paid_at`, `refunded_amount_yen`, `access_token_hash UNIQUE`, `payment_due_at`, `attribution jsonb`, `consents jsonb`（規約版数・同意日時・IP） | 注文の主体 |
| `b2c_order_events` | `order_id`, `type`, `from_status`, `to_status`, `actor`(guest/system/staff), `staff_id`, `payload jsonb`, `created_at` | 監査（追記のみ） |
| `b2c_refunds` | `order_id`, `amount_yen`, `reason`, `stripe_refund_id UNIQUE`, `status`, `staff_id`, `idempotency_key UNIQUE` | |
| `stripe_webhook_events` | `event_id PK`, `type`, `received_at`, `processed_at`, `status`, `error` | B2C 用の重複排除 |
| `b2c_hotel_notifications` | 6.3 参照 | |
| `shipment_delivery_confirmations` | 7.3 参照 | B2B でも将来使える汎用名 |
| `operator_staff` | `id`, `display_name`, `active` | 担当者 |
| `b2c_notifications_log` | `order_id`, `kind`, `to`, `locale`, `sent_at`, `provider_id`, `error` | 旅行者宛てメール |
| **既存 `shipments`** | `b2c_order_id uuid NULL`（FK→b2c_orders） | 追加のみ。B2B 行は NULL |
| **既存 `agencies`** | 行 INSERT: `name='BondEx Direct'`, `payment_method='invoice'`, `billing_exempt=true`, `status='active'`, 契約署名なし | B2C 行の所属先。ポータルログイン用ユーザーは作らない |

### 11.1 アフィリエイト対応の余地（今回は実装しない）

- `b2c_orders.attribution jsonb`: ランディング時の参照元（`?ref=` / UTM / 最終クリック時刻）を**一次データとして保存だけ**しておく。成果計算・紹介者マスタ・支払いは作らない。
- 将来の成果計算は「`shipment_delivery_confirmations` の有効な確定（取り消しなし）× `delivered_item_count` × 500円」で、`b2c_orders.status` が cancelled / refunded の注文、配送未完了を除外すれば出せる。区間が異なれば `shipment_id` が異なるので別成果になる。30日・ラストクリックは `attribution` の時刻で判定できる。
- 個人情報の観点: `attribution` に紹介元の個人情報は入れない（コードのみ）。

---

## 12. API 設計（新規 `/api/b2c/*`）

| メソッド・パス | 用途 | 認証・防御 |
|---|---|---|
| `GET /api/b2c/config` | 地域・個数上限・受付期間・表示文言 | 公開・キャッシュ可 |
| `POST /api/b2c/quote` | STEP 1→2 の見積 | 公開・レート制限 |
| `GET /api/b2c/facilities/search?q=` | ホテル検索（Places）＋適格性の付与 | 公開・**Turnstile＋レート制限**（Places 従量課金の乱用防止） |
| `POST /api/b2c/orders` | STEP 5（即時予約 or リクエスト） | 公開・Turnstile・`request_key` 必須 |
| `POST /api/b2c/orders/:id/checkout` | Checkout セッション作成（再検証込み） | アクセストークン |
| `GET /api/b2c/r/:token` | 確認ページのデータ | アクセストークン |
| `POST /api/b2c/r/:token/inquiry` | 変更・キャンセルの問い合わせ | アクセストークン・レート制限 |
| `POST /api/b2c/resend-link` | 確認リンクの再送 | 公開・Turnstile・結果を常に同じ応答にする（存在確認に使わせない） |
| `POST /api/b2c/stripe/webhook` | B2C 用 Webhook（推奨: 分離） | Stripe 署名 |
| `/api/operator/b2c/*` | 施設確認・承認/拒否・ホテル連絡記録・配送完了確定・変更/キャンセル/返金 | 既存の運営認証（middleware 既定拒否のまま） |

- `middleware.ts` への追加は **`/api/b2c/` の prefix 1件のみ**（`/api/operator/b2c/*` は運営認証のまま）。prefix の判定は `startsWith("/api/b2c/")` で、`/api/operator/` 配下が漏れないことをテストで確認する。
- レート制限は既存のインメモリ実装（serverless で実効性が弱い）ではなく、Supabase のテーブルを使った簡易カウンタで実装する（外部の有料サービスを増やさない）。
- 1予約あたりのホテル検索回数に上限を設け、Places API の費用を抑える（費用は 15章）。

---

## 13. 既存 B2B への影響とリスク

### 13.1 変更が必要な既存ファイル（最小限）

| ファイル | 変更 | B2B への影響 | 確認方法 |
|---|---|---|---|
| `middleware.ts` | 公開 prefix に `/api/b2c/` を追加 | 誤ると運営 API が漏れる | 運営 API 全件が未認証で 401 になるテスト |
| `lib/charge.ts` | 先頭に B2C 代理店のスキップ1行 | B2B 行は条件に当たらない | B2B のカード代理店で課金判定が従来どおりのテスト |
| `lib/guest-language.ts` | `ja` を追加 | バウチャーの言語選択肢が増える | ja 以外のバウチャー PDF が変化しないこと（バイト比較 or テキスト抽出比較） |
| `lib/voucher-regen.tsx` | B2C 行で連絡先を BondEx 固定にする分岐 | 代理店行は従来どおり | 既存予約の再生成結果が同じ |
| `components/operator/*`・ダッシュボード | B2C 件数タイル・B2C 行のバッジ・リンク追加 | 表示の追加のみ | 画面確認 |
| `app/api/shipments/route.ts` | B2C 行を delivered にする際に確定記録を求める分岐 | B2B 行は従来どおり | B2B 行の手動ステータス変更の回帰 |
| （エンドポイント共有の場合のみ）`app/api/stripe/webhook/route.ts` | 冒頭で B2C 分岐 | 既存分岐に影響しうる | **分離を推奨**＝このファイルは変更しない |

### 13.2 主なリスクと対策

| リスク | 内容 | 対策 |
|---|---|---|
| 誤課金 | B2C 行に集荷時の自動課金が走る | `charged_at` 事前セット＋`billing_exempt`＋明示ガードの三重化。回帰テスト必須 |
| 請求混入 | B2C 行が代理店の月次請求に入る | 専用代理店名・`billing_exempt=true`（月次請求の対象外条件） |
| レポートの見え方 | 実績レポート・売上集計に `BondEx Direct` が1代理店として出る | 意図どおり（B2C の実績として見える）。売上額は `shipments.amount_yen` に**税抜額**を入れて B2B と単位を揃える |
| 運営負荷 | 未確認ホテルの確認・ホテル連絡が手作業で増える | 1日あたりの処理上限を設定し、超えたら新規リクエストを一時停止できるスイッチ |
| 公開 API の乱用 | Places 費用・スパム予約 | Turnstile・レート制限・メール確認 |
| 個人情報 | 旅行者のメール・電話・宿泊先と日程（所在が分かる情報） | RLS 全拒否、確認ページはトークン、追跡ページは匿名化のまま、保存期間を規定（例: 配送完了後 2年で匿名化） |
| 本番DBでの検証 | 現状ローカルが本番 Supabase を参照 | **B2C の開発・テストは別DB（ローカル Supabase CLI）でのみ行う**。本番参照の `.env.local` で B2C の書き込み系を動かさないガード（`B2C_ENABLED` かつ DB の URL が本番 ref なら起動拒否） |

---

## 14. テスト計画（PHASE 5・6）

### 14.1 基盤

- `vitest`（単体・結合）と `@playwright/test`（E2E・モバイル表示）を **devDependencies に追加**（本番バンドルには入らない）。
- DB は **ローカル Supabase（CLI・Docker）** に migration を流して使う。Stripe は**テストモード**と Stripe CLI の webhook 転送。本番 Supabase・本番 Stripe には接続しない。

### 14.2 必須テスト

| 区分 | テスト |
|---|---|
| 適格性（**最重要**） | 民泊語を含む施設が blocked／`lodging` 以外が blocked／部屋番号つき住所が blocked／rejected・blocked を含む予約・リクエストが API で 422／unverified を含む予約は決済に進めない（Checkout 作成 API を直接叩いても 409）／verified 期限切れは unverified 扱い／集荷可・配送可の片側だけの施設 |
| 料金 | 区間別・サイズ別の選択、税込総額、適用期間の切り替え、見積と決済直前の再計算の不一致で拒否、Webhook の金額不一致で確定しない |
| 配送日 | 当日集荷不可、受付締切の前後、ブラックアウト、`transit_days` 1/2、チェックアウト日との関係、無効区間 |
| 予約 | 即時予約の正常系、リクエスト→承認→決済、リクエスト→拒否、決済期限切れ |
| 決済 | 成功、失敗→再試行、二重押し（同じ request_key）、Checkout 二重作成、Webhook 重複・順不同・遅延、success_url と Webhook の競合 |
| 返金 | 全額・部分、上限超過の拒否、二重押し、Webhook との照合 |
| ホテル連絡 | confirmed で連絡タスクが作られる、既存督促に載る、回答 refused で例外キュー |
| 配送完了 | 追跡による確定、手動確定で担当者・根拠が必須、取り消し、1区間1件 |
| 言語 | 全画面・エラー・メールの ja/en 切替、未翻訳キーが無いこと（辞書のキー一致テスト） |
| バウチャー | B2C 行の生成、ja ゲスト面、B2B 既存予約の出力が変わらないこと |
| セキュリティ | アクセストークンの総当たり耐性、リンク再送が存在確認に使えない、運営 API が未認証で 401、`sk_live_` で起動拒否 |
| アクセシビリティ | axe（Playwright）で重大違反ゼロ、キーボード操作、フォームのラベル・エラーの読み上げ |
| モバイル | 375px 幅で全 STEP を完了、横スクロールなし |
| B2B 回帰 | 代理店予約の作成、カード代理店の集荷時課金（テストモード）、月次請求の集計対象、ホテル連絡督促、レポート、バウチャー再生成 |

---

## 15. 運用費の見込み（承認前の試算）

| 項目 | 前提 | 月額の目安 |
|---|---|---|
| Stripe 決済手数料 | 国内カード 3.6%（既存の前提）。税込5,478円×月100個の場合 | 約 19,700円（売上の3.6%。件数に比例） |
| Google Places（ホテル検索） | Text Search の従量課金。1予約あたり検索3回上限×月100予約＝300回 | 無料枠内〜数百円程度の想定（**単価は実装前に Google の現行料金表で確認する**） |
| Cloudflare Turnstile | 無料プラン | 0円 |
| Supabase / Vercel / Resend | 既存プランの範囲（件数増でメール送信数が増える） | 現行プランの範囲内の想定（**Resend の送信上限は実装前に確認**） |
| ローカル Supabase（テスト用） | Docker で実行 | 0円 |

- 新しい有料サービスは追加しない設計にしている。

---

## 16. 未決事項（事業側の判断が必要）

| No. | 事項 | 影響 |
|---|---|---|
| 01 | **B2C の正式販売価格**（区間別・サイズ別） | 本番の有料受付開始の条件 |
| 02 | **個人から代金を受け取る形の法的整理**（現在の整理は「取次業」で JOJO は運送契約の当事者にならない。個人から運送代金を含む料金を預かる場合、既存の未決事項「収納代行の3要件を満たせるか」に直結する） | **本番公開の前提条件。弁護士確認を推奨** |
| 03 | キャンセル料・返金条件・変更期限 | 8章の運営画面の既定値、規約 |
| 04 | 配送遅延時、ホテルが預かれない時の対応と補償 | 例外キューの処理手順、規約 |
| 05 | B2C 利用規約・特定商取引法に基づく表示（個人向け）・プライバシーポリシー（ja/en） | 公開の前提。特商法の電話番号の扱い（個人携帯は使わない） |
| 06 | 受付締切の時刻の一本化（16/17/18時の不一致） | 5.2 の設定値 |
| 07 | 初期に受け付ける区間と各区間の配送日数 | 5.2 の設定値（推測で入れない） |
| 08 | 未確認ホテルの確認を1日何件まで受けられるか、処理期限1営業日でよいか | 4.3 の運用 |
| 09 | ホテル事前連絡のメールを将来自動送信にするか（現方針は手動ワンクリック） | 6章 |
| 10 | バウチャー・メールに載せる問い合わせ先電話番号 | 10章・6章（placeholder のまま実装） |
| 11 | Stripe の Webhook エンドポイントを分離するか（推奨: 分離） | 9.3 |
| 12 | 荷物サイズの上限（3辺160cm・30kg）と1予約の最大個数（推奨: 5個） | 4.1・5.1 |

---

## 17. PHASE 2 の残作業（競合 UX 分析）

- 本書の画面フロー（4.1）は、確定方針の STEP 1〜6 と既存の代理店フォームの知見から設計した。**競合サービス（国内の手ぶら観光・ホテル間配送サービス等）の実際の画面・料金・入力項目は今回は実測していない。**
- 画面の詳細設計（PHASE 2 の完了）として、実装着手前に競合3〜5社の予約画面を実際に操作して、入力項目数・料金表示・対象施設の説明の仕方を記録し、本書 4.1 に反映する。

---

## 18. PHASE 4 実装計画（承認後に着手）

各段階の終わりに結果を報告し、次の段階は個別承認を得てから進める。

| 段階 | 内容 | 本番影響 |
|---|---|---|
| 4-1 | テスト基盤（vitest / playwright / ローカル Supabase）、新規 migration（ローカルのみ適用）、純関数（適格性判定・料金・配送日・状態遷移）とその単体テスト | なし |
| 4-2 | 公開 API・予約画面（ja/en）・Stripe テストモード決済・Webhook（分離エンドポイント） | なし（`B2C_ENABLED=false` でデプロイされても 404） |
| 4-3 | 運営画面（施設確認、リクエスト承認/拒否、ホテル連絡記録、配送完了確定、変更/キャンセル/返金） | 既存運営画面に B2C の表示が増える |
| 4-4 | 既存ファイルの最小変更（13.1）＋ B2B 回帰テスト | 13.1 の範囲 |
| 4-5 | メール・バウチャー・確認ページ | なし |
| 7 | 本番公開前の確認: 本番 migration の適用（谷口さんが SQL Editor で実行）、本番 env、規約・特商法の掲載、正式価格の投入 | **個別承認が必要** |
| 8 | 段階的公開: 招待リンクのみ → 対応区間を限定して公開 → 全区間 | **個別承認が必要** |

- 作業は専用ブランチ（例: `feat/b2c-booking`）・専用の作業ツリーで行い、`git add -A` を使わずパス指定でステージする（既存運用ルール）。push・PR マージは谷口さんが判断。
