# 旅行者向けの規約の原案（Stage 6 の Blocker B1）

作成: 2026-11-04。第2版（同日）: D1〜D5 を反映・弁護士への依頼の案・実装との不一致・公開前の一覧を追加。状態: **原案（未公開・弁護士の確認の前）**。たくまさんの指示（2026-11-04「B1 を最優先・日本語と英語の原案・弁護士の確認が必要な事項を分ける」）。

| ファイル | 内容 |
|---|---|
| `01_business_conditions.md` | 事業条件 D0〜D5（締切・未集荷・遅延・サイズ・送れない物・規約の変更）と根拠 |
| `02_implementation_gaps.md` | 事業条件と今の実装の不一致（直していない・承認待ち） |
| `03_lawyer_request.md` | 弁護士への確認の依頼の文（案・L1〜L11） |
| `05_pre_publication_checklist.md` | 公開の前に法的な判断・確認が必要な項目 |
| `terms_ja.md` / `terms_en.md` | 旅行者向けの利用規約（予約サイト経由・阪急交通社の紹介の Beta）第2版 |
| `cancellation_ja.md` / `cancellation_en.md` | キャンセル規定（取消・返金・個数の違い） |
| `tokushoho_ja.md` / `tokushoho_en.md` | 特定商取引法に基づく表記（B2C 用） |
| このファイル | 原案が前提にしている実装の事実と根拠・弁護士の確認が必要な事項・社内で決める事項 |

**原則**: 原案は「いま実装されている動き」だけを書いた。実装に無い約束（補償の特約・キャンセル料・遅延の補償など）は書いていない。
本文の `【Lx】` は `03_lawyer_request.md`、`【D0】` は `01_business_conditions.md` の番号。法務の確認と社内の決定が済むまで公開しない（既存の `/legal/terms`・`/legal/privacy`・`/legal/commercial-transactions` は代理店向けのまま変えない）。

---

## 1. 原案が前提にしている事実（実装と根拠）

| 項目 | 事実 | 根拠 |
|---|---|---|
| 事業者 | 株式会社JOJO・運営責任者 谷口 琢真・〒158-0092 東京都世田谷区野毛1-9-12・support@bondex.express（電話は請求があれば開示） | 既存の `app/legal/commercial-transactions/page.tsx`（公開済みの表記をそのまま使う）・`lib/contact-links.ts` |
| サービス | 日本国内のホテルからホテルへの手荷物の配送の手配。運送は佐川急便 | `B2C_PHASE1A_BETA_PLAN.md`・既存の規約の「取次」の考え方 |
| 申込みの経路 | 阪急交通社から案内された専用の予約 URL（紹介元のコードを記録） | `lib/b2c/booking-service.ts`（entry link） |
| 料金 | 1個 4,980円（税抜）＝5,478円（税込）。沖縄と本土の間は 1個 13,000円（税抜）＝14,300円（税込）。沖縄県内どうしは通常料金。消費税は合計の税抜額の 10%（1円未満切り捨て） | `lib/b2c/pricing.ts`・`lib/tax.ts` |
| 個数 | 1予約 1〜10個 | `lib/b2c/booking-service.ts`（B2C_BETA_MAX_PIECES） |
| 予約できる期間 | 集荷日の前日 18:30（日本時間）まで・180日先まで（**実装の値。17:00 にするかは D0 で決定待ち**） | `lib/pickup-cutoff.ts`・`lib/b2c/bookability.ts` |
| カード登録の期限 | 予約の締切の 30分前（前日 18:00）まで。カードの入力を 30分放置すると受付を取消 | `lib/b2c/card-service.ts` |
| 予約の確定 | カード登録と、集荷元・配送先のホテルの確認の後に確定。確認が期限までに取れなければ無料で取消（請求なし） | `sql/071_b2c_cutoff_1830.sql`（b2c_confirm_order）・`lib/b2c/hotel-gate.ts` |
| 預け方 | 集荷日の 11:00 までに集荷元のホテルのフロントへ預ける。送り状は佐川急便が持参 | `lib/b2c/notify-templates.ts` |
| 支払の方法 | クレジットカードだけ（Visa・Mastercard・JCB・American Express・Diners Club・Discover。銀聯は不可）。カード情報は Stripe が扱い、当社は保存しない | `components/b2c/card-step.tsx`・`lib/b2c/stripe.ts` |
| 支払の時期 | 予約の時はカードを登録するだけ（請求なし）。佐川急便が集荷したことを当社が確認してから 30分の後に請求 | `sql/074_b2c_stage5_payments.sql` |
| 請求する個数 | 佐川急便が実際に受け取った個数。予約と違う時は当社が根拠を確かめてから確定。多い時は同じ 1個あたりの料金、少ない時は少ない個数の料金 | 同上・予約の時の同意の文（`card-step.tsx`） |
| 請求の後に個数の違いが分かった時 | 多い → 追加の請求（同じ 1個あたりの料金）。少ない → 差額を返金 | 同上（`b2c_record_piece_correction`） |
| 支払ができなかった時 | メールで支払のページを案内（本人認証・別のカード）。案内は失敗の時と 1・3・7日後 | `lib/b2c/charge-service.ts`・`pay-service.ts` |
| 取消（旅行者） | 集荷日の前日 18:30（日本時間。D0 で決定待ち）までは予約の確認ページから無料。佐川急便に集荷を依頼した後は「取消の申込み」になり、佐川急便の確認の後に確定（集荷の前なので請求なし）。集荷の後は取消できない | `lib/b2c/my-booking.ts`・`sql/071`（b2c_request_cancel） |
| 取消（当社） | ホテルが受けられない・確認の期限切れ・カード登録が終わらない時は当社が無料で取消 | `sql/062`・`sql/071`（b2c_cancel_order） |
| 返金 | カードへ返金（明細への反映は数日〜数週間） | `lib/b2c/refund-service.ts` |
| 通知 | メール（阪急向け Beta はメールだけで開始。WhatsApp は承認の後） | `lib/b2c/notify.ts`・たくまさんへのヒアリング（2026-11-04） |
| 預けられない物 | 画面と通知は「貴重品・壊れやすい物・現金・パスポート」だけ。佐川急便の約款 6条1項7号・「送れないもの」のページとの照合は `01` の D4 | `booking-form.tsx`・`notify-templates.ts`・佐川急便の約款（2026-11-04 取得） |
| 破損・紛失 | 佐川急便の基準で調査・賠償（スーツケースは原則修理・修理の見積で賠償額・全損は減価償却で算出・保護カバー無しの外装の傷は原則困難）。BondEx 独自の補償の特約は無い | `docs/sagawa/BondEx_Sagawa_BizLogi_Master_FULL_20261103.txt` 198〜210（佐川の回答） |

## 2. 弁護士の確認が必要な事項・社内の決定

- 弁護士への確認の事項 L1〜L11 と依頼の文の案: `03_lawyer_request.md`
- 社内の事業条件 D0〜D5（2026-11-04 たくまさんが D1〜D5 を暫定の方針として採用。D0 = 締切は決定待ち）: `01_business_conditions.md`
- 事業条件と今の実装の不一致 G0〜G10: `02_implementation_gaps.md`
- 公開の前に片づける項目の一覧: `05_pre_publication_checklist.md`

## 3. 公開の手順（法務の確認と D0 の決定の後。詳しくは `05_pre_publication_checklist.md`）

1. 原案を確定し、`/legal/traveler/terms`・`/legal/traveler/cancellation`・`/legal/traveler/tokushoho`（日本語・英語）として公開する（代理店向けのページは変えない）。旅行者向けのプライバシーポリシー（L8）も同時に。
2. 予約画面の同意の文と、カード登録の画面の同意の文から各ページへリンクする。同意の版（`consent_version`）を新しい版にする。
3. 確定の通知（メール）と予約の確認のページにも規約へのリンクを入れる。
