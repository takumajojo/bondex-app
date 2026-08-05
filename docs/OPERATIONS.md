# BondEx 運用・引き継ぎ仕様書（マスター）

最終更新: 2026-08-04 / 対象: bondex.express（B2B 手荷物配送手配サービス）

> このドキュメントは「別PCや別のClaude Codeセッションからでも、このプロジェクトを理解して安全に作業を続けられる」ことを目的とした引き継ぎ書です。
> 過程の履歴・決定の根拠は `~/JOJO/state/bondex.md`（開発ログ）に、作業ルールは リポジトリ直下の `CLAUDE.md` と `~/.claude/CLAUDE.md` にあります。まずそれらを読んでください。

---

## 1. これは何か（全体像）

- **BondEx** = 訪日旅行会社（代理店）向けに、旅行者の手荷物を宿泊施設間で配送する「取次（手配代行）」サービス。
- **法的建て付け**: BondEx（株式会社JOJO）は運送そのものは行わず、**実運送人（佐川急便／ヤマト運輸）への集荷取次・送り状作成を代行する取次**。運輸局より「運ばないので第一種貨物利用運送の登録は不要」と口頭確認済み（書面は未取得＝要弁護士/行政書士の最終確認）。送り状の**荷送人は旅行者**にして取次の実態と一致させている。
- **2トラック**:
  - レガシー運用: My Japan Planner（堀部様）と提携し ¥5,000/個 で既に運用中。
  - PoC刷新（このリポジトリ `bondex-poc-main`）: 本番 bondex.express。代理店セルフ登録→契約→発行依頼→自動発行まで実装済み。
- **料金**: 配送対象物1個あたり **¥5,000（消費税込）**。代理店へ月末締め・翌月末払いで請求（BondExが実運送運賃を立替）。

## 2. スタック・外部サービス

| 種別 | 内容 |
|---|---|
| フレーム | Next.js 16（App Router）/ TypeScript / Tailwind |
| ホスティング | **Vercel**（`git push origin main` で自動デプロイ）。プロジェクト名 `bondex-poc-main` |
| DB/認証 | **Supabase**（project `dscxftwfspgihkszfakk`）: Postgres + Auth（代理店ログイン）+ RLS |
| 送り状 | **Ship&co**（api.shipandco.com）: 佐川（既定）/ヤマト。**発行=従量課金**。TEST/LIVEは `SHIPANDCO_LIVE` |
| 住所解決 | Google Maps/Places API |
| 書類保管 | Google 共有ドライブ（サービスアカウント） |
| メール | **SMTP優先**（Gmail/jojo-tokyo.com）→ 失敗時 Resend フォールバック（`lib/mailer.ts`） |
| 決済 | Stripe（カード保存=SetupIntent。国内=請求書 or カード / 海外=カード） |
| AI | Anthropic API（旅程表の自動読取） |
| 計測 | GA4（G-M2LR1SYV92）/ Google Search Console |
| PDF | 生成=@react-pdf/renderer / 画面プレビュー=pdfjs-dist（canvas描画） |

## 3. 主要フロー

### 代理店（/agency/*, Supabase Auth）
1. `/agency/signup` 登録 → `status='pending'`
2. 運営が `/operator/agencies` で承認 → `status='active'`
3. **契約書に署名**（`/agency/contract`）: 実PDFをpdf.jsで表示→同意+手書きサイン→締結。`contract_status='signed'`。署名済PDFを会社+BondEx控えにメール送信。**未署名だと発行依頼はロック**（UI+サーバ側 `/api/agency/booking` 403）。
4. `/agency/new` で旅程を入力（AI旅程読取 + Google Placesホテル検索）→ 確認/プレビュー → 発行依頼。
   - 発送 **≤30日先**: その場で自動発行（サーバが内部で `/api/shipandco/create` を self-call）→ バウチャー+送り状を即DL、共有ドライブへ格納。
   - **>30日先**: `status='requested'` で保留（送り状は発送1ヶ月前から発行可のため）。

### 運営（/operator/*, 共有パスワード）
- `/operator`: 旅程アップロード or `requested` 依頼をワンクリック発行（バウチャー+Ship&co送り状+キャリア選択）。
- `/operator/dashboard`: 案件一覧、送り状/バウチャー再発行、Driveリンク、集荷漏れアラート。
- `/operator/agencies`: 代理店承認。 `/operator/claims`: クレーム管理。 `/operator/inquiries`: 問い合わせ一覧。
- 契約書PDF生成: `/api/contracts/generate?agency=名称`。

### お客様・ホテル
- バウチャー: 1区間=1PDF。ホテル名は英語主表示。ご利用ガイド任意同梱。
- 送り状: 佐川/ヤマト。荷送人=旅行者+発送元ホテル、集荷連絡先TEL=`BONDEX_SENDER_PHONE`。
- 追跡: `/track/[bookingId]`（公開・多言語）。cron `sync-tracking` で状態更新。

## 4. 認証・権限モデル

- **運営コンソール**: 単一の共有パスワード `OPERATOR_PASSWORD`（Cookie `bondex_op_auth` または `Authorization: Bearer <pw>`）。`middleware.ts` の `matcher` 許可リストで保護。**新しい運営用ルートを追加したら matcher に必ず追加すること**（漏れると無認証で叩ける）。
- **代理店ポータル**: Supabase Auth（メール+パスワード）。`/api/agency/*` は `lib/agency-auth.ts` の `resolveAgencyFromRequest()` でJWT検証し、**代理店名は必ずJWT由来に固定**（body由来を信用しない）。Supabase RLS で他社データを遮断。
- **service-role**（`lib/supabase.ts` の `getSupabase()`）はRLSをバイパスするので、代理店向けルートで使う場合は**必ず認証した代理店名で明示的に絞り込む**。

## 5. 環境変数（すべて Vercel に設定。ローカル `.env` はプレースホルダ）

| 変数 | 用途 | 必須 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase（公開） | ○ |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバのDB操作（RLSバイパス） | ○ |
| `OPERATOR_PASSWORD` | 運営コンソールの共有パスワード | ○ |
| `SHIPANDCO_API_KEY` | 送り状発行 | ○ |
| `SHIPANDCO_LIVE` | **"true"で実発行（課金・実集荷）。未設定/その他はTEST** | 本番化時 |
| `GOOGLE_MAPS_API_KEY` | ホテル住所解決 | ○ |
| `ANTHROPIC_API_KEY` | 旅程AI読取 | ○ |
| `BONDEX_SENDER_PHONE` | 送り状の集荷連絡先TEL（BondEx番号。個人携帯は不可） | 実発行前 |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` | メール送信（Gmail/jojo-tokyo.com）。**設定済・稼働中** | ○ |
| `ALERT_EMAIL` | 通知/控えの宛先 | ○ |
| `RESEND_API_KEY`/`ALERT_FROM_EMAIL` | メールのフォールバック（Resend） | 任意 |
| `GOOGLE_DRIVE_SA_KEY`/`GOOGLE_DRIVE_ROOT_ID` | 共有ドライブ格納 | ○ |
| `CRON_SECRET` | cron 認証（3本共通: sync-tracking / issue-due / monthly-invoices）。**GitHub Actions の Repository Secret にも同じ値** | ○ |
| `STRIPE_SECRET_KEY`/`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | カード保存 | 任意（未設定なら「準備中」） |
| `STRIPE_CHARGE_LIVE` | **"true"で集荷完了時に保存カードへ実課金**。未設定/その他は課金しない（コードは通るが無害） | 本番課金時（谷口さん承認） |
| `INVOICE_AUTOSEND` | **"true"で月次請求書を代理店へ直接自動送信**。未設定は運用(ALERT_EMAIL)控えのみ→手動転送 | 慣れてから |
| `SLACK_WEBHOOK_URL` | アラート通知（設定すれば） | 推奨 |
| `BONDEX_WHATSAPP_URL` | WhatsApp導線 | 任意 |

> ⚠️ **環境変数を変更したら必ず再デプロイ**（Vercel → Deployments → Redeploy）。保存だけでは反映されない。

## 6. デプロイ

- `git push origin main` → Vercel が自動ビルド&デプロイ（GitHub `takumajojo/bondex-app`）。
- 反映確認は本番URLに `curl`（例: `curl -s https://bondex.express/...`）。旧デプロイと区別するため、新ビルド固有の文字列で確認する。
- ビルド確認: `npx tsc --noEmit`（既知の無関係エラー2件は `components/admin/screens/dashboard-overview.tsx` と `components/traveler/screens/status-dashboard.tsx` の旧プロトタイプ）。

## 7. Go-Live スイッチ・不可逆操作の注意

- **`SHIPANDCO_LIVE=true`**: これを入れて再デプロイすると、以降の発行は**実ラベル=課金+実集荷+取消不可**。まずは1件テスト発行で確認してから。**谷口さんの明示承認が必要な操作**。
- **`STRIPE_CHARGE_LIVE=true`**: 集荷完了（picked_up）時に、カード払い代理店の保存カードへ **¥5,000×個数を実課金**（off_session）。本番Stripeキーが前提。未設定なら課金コードは通るが1円も動かない。**谷口さんの明示承認が必要な操作**。二重課金は `shipments.charged_at` と Stripe idempotencyKey で二重防止。
- **`INVOICE_AUTOSEND=true`**: 月次請求書を代理店へ直接自動送信。未設定は運用控えのみ（谷口さんが中身を確認して手動転送）。初月は未設定で回すのが安全。
- 送り状の集荷連絡先 `BONDEX_SENDER_PHONE` を実番号にしてからLIVE化する（現状は仮 `000...`）。
- お客様向けCONTACT電話は未確定（バウチャーは電話非表示で運用可）。

## 8. データベース（Supabase）

- マイグレーションは `sql/001_*.sql` 〜 `sql/015_*.sql`。Supabase に順に適用。主なテーブル: `shipments`, `agencies`, `user_agencies`, `claim_cases`, `parse_log`, `contact_inquiries`, `agency_contract_signatures`。
- `sql/015_shipment_charges.sql`（適用済 2026-08-04）: `shipments` にカード課金記録カラム `charged_at` / `stripe_payment_intent_id` / `charge_amount_yen` / `charge_error` を追加。
- 適用は Supabase MCP（`apply_migration`）またはダッシュボードSQL。**適用漏れ事故の前例あり**（`contact_inquiries` 未作成で問い合わせが消失）→ 新テーブル追加時は本番適用を必ず確認。

## 9. 主要ファイルマップ

- 認証: `middleware.ts`（運営ゲート） / `lib/agency-auth.ts`（代理店JWT） / `lib/supabase.ts`
- 送り状: `app/api/shipandco/create/route.ts` / `lib/carrier.ts`（佐川/ヤマト定義） / `lib/yamato-delivery.ts`
- バウチャー: `lib/voucher-pdf.tsx` / `lib/voucher-regen.tsx` / `app/api/voucher/*`
- 契約: `lib/contract-content.ts`（**条文の唯一の情報源**） / `lib/contract-pdf.tsx`（PDF） / `components/contract-html.tsx` / `components/pdf-preview.tsx` / `app/agency/contract/page.tsx` / `app/api/agency/contract/route.ts`
- メール: `lib/mailer.ts`（SMTP→Resend） / `app/api/operator/mail-test`（診断）
- 代理店発行: `app/agency/new/page.tsx` / `app/api/agency/booking/route.ts`
- 運営: `app/operator/*` / `app/api/operator/*`
- 追跡/cron: `app/track/[bookingId]` / `app/api/cron/sync-tracking`
- Drive: `lib/google-drive.ts`

## 10. 監視・障害対応

### 通知の仕組み
- **運用アラート** `lib/ops-alert.ts` `sendOpsAlert()` … 配送異常（遅延・調査中・持戻）、集荷漏れ、**発行済みラベルのDB保存失敗（孤児）**、**pending保存失敗** を通知。**SMTP優先→Resendフォールバック**（`lib/mailer.ts` 経由。2026-08-04にSMTPへ配線）＋ `SLACK_WEBHOOK_URL` があればSlackにも。宛先=`ALERT_EMAIL`（+代理店）。
- **代理店向け通知** `lib/agency-notify.ts` … 発行依頼受付メール。同じく `sendMail`（SMTP）に配線。
- **メール送信診断** `GET /api/operator/mail-test`（operator）… 設定状況＋`?to=`で実送信テスト（機密値は返さない）。
- 全アラートは送信可否に関わらず `console.error` にも残す（Vercel Functions ログ / cron JSON で追跡可能）。

### 定期ジョブ（すべて GitHub Actions → `CRON_SECRET` 認証）
- **`sync-tracking`** … `.github/workflows/sync-tracking.yml`（毎時）→ `/api/cron/sync-tracking`。追跡状態更新＋集荷漏れ/異常アラート。集荷完了→カード課金フック、配達完了→代理店通知もここで発火。
- **`issue-due`** … `.github/workflows/issue-due.yml`（毎日08:10 JST）→ `/api/cron/issue-due`。発送日が今日〜30日先で未発行（requested/pending）の予約を運用へダイジェスト通知。**発行漏れ防止の要**（自動発行はしない・運用が /operator から手動発行）。
- **`monthly-invoices`** … `.github/workflows/monthly-invoices.yml`（毎月1日09:20 JST）→ `/api/cron/monthly-invoices`。請求書払い代理店の前月分請求書を生成し運用（`INVOICE_AUTOSEND=true`なら代理店へも）送付。手動再送は Actions の "Run workflow" で対象月を指定可。
- ⚠️ **cronのデッドマンズスイッチが未実装**（下記アクション参照）。GitHub Actionsのスケジュールは停止しても気づけない。

### すぐ気づくために（推奨・未実装）
1. **cronのハートビート**: 1日1回「同期が走った」旨を `ALERT_EMAIL` に送る、または healthchecks.io 等のデッドマンズスイッチにpingし、来なくなったら通知。
2. **cronの部分失敗をアラート**: `sync-tracking` が per-row 失敗（`failures[]`）や未知ステータス（`unmapped[]`）を抱えても200で終わるので、`failures.length>0` で `sendOpsAlert`。
3. **エラートラッキング**（任意）: Sentry無料枠を入れると未捕捉例外を集約できる。

### 障害時に見る場所
- Vercel → Deployments/Functions のログ（保持短め）。
- GitHub Actions（sync-tracking の実行履歴）。
- Supabase（DB直接。テーブル/行の確認）。
- 運営画面: `/operator/dashboard`（`failed` 案件が見える）、`/operator/inquiries`（問い合わせ）、`/api/operator/mail-test`（メール設定確認）。

## 11. 既知の課題・残タスク（go-live 観点）

- [ ] **SHIPANDCO_LIVE=true**（実発行解禁）＋実荷1件テスト … 谷口さん承認事項
- [ ] **`BONDEX_SENDER_PHONE` 実番号設定**（現状 仮 `000...`）
- [ ] 取次の**法規制 最終確認**（弁護士/行政書士。運輸局書面が未取得）
- [ ] お客様向けCONTACT電話番号の確定（バウチャー案A）
- [ ] `bondex.express/partner` 受け皿ページ（後回し）
- [ ] WhatsApp導線（`BONDEX_WHATSAPP_URL`）
- （レガシー）金沢・高山・広島のパートナー拠点、レガシー↔PoC統合方針

## 12. 第三者レビュー（2026-08-04）— 是正状況

3観点（セキュリティ／コード正しさ／障害対応）で実施。

### 即修正済み（本日デプロイ）
- Ship&co の **二重発行・二重課金防止**（発行前に issued 済みを確認し短絡＝冪等ガード）
- **孤児検知アラート**（発行済みなのにDB保存失敗→即通知）／ **pending保存失敗アラート**（自動発行漏れ防止）
- **アラートをSMTPに配線**（ops-alert/agency-notify を Resend専用→SMTP優先＝実働経路で通知）
- **契約プレビューの無限ローディング→未確認署名リスク** を修正（PDF取得失敗時もHTML全文を必ず表示）
- **公開 Stripe PaymentIntent 生成**（金額任意＝カードテスト脆弱性・レガシー未使用）を削除
- **Ship&coトークンの流出ファイル**（`.env<token>` 誤生成）を削除

### 追加是正（2026-08-04 第2弾: フロー網羅監査＋穴埋め）
- **[最重要] 1ヶ月超先の予約が永遠に発行されない穴** を封鎖: 発送30日前に入った未発行予約を毎朝ダイジェスト通知する `cron/issue-due` を新設（+ 発送日超過分は集荷漏れアラートが `requested` も対象に）。手荷物の発行漏れ→未出荷事故を二重の網で検知。
- **カード課金の未実装** を実装: 集荷完了時に保存カードへ off_session 個別課金（`lib/charge.ts`）。**`STRIPE_CHARGE_LIVE=true` まで無害**（フラグ+本番キーが揃うまで1円も動かない）。`charged_at`＋idempotencyKey で二重課金防止。sync-tracking と手動ステータス更新の両経路でフック。**課金成功時に「請求書 兼 領収書」PDFを生成し代理店へメール送付（必須）**＋控えを運用へ。代理店は `/agency` ポータルの決済済み行から `/api/agency/invoice?shipment_id=` でいつでも再DL可（`buildChargeInvoice`・内税表示・`invoice-pdf paid`）。メール未達は ops アラート。
- **請求書の税額バグ** を修正: `¥5,000税込` を税抜扱いして10%上乗せ（＝10%過大請求）していたのを**内税表示**に（`invoice-pdf.tsx` `taxInclusive`）。月次自動生成＋送付 `cron/monthly-invoices` を新設（既定は運用控えのみ→`INVOICE_AUTOSEND=true`で代理店直送）。
- **承認/クレーム/配達完了の通知漏れ** を封鎖: 代理店承認時・クレーム受付時・配達完了時に通知を追加。
- **レガシー削除**: 未使用の `/api/email`（本番で実送信しないダミー）を削除。

### 要対応（重要度順）
1. **[要ローテーション] Ship&coトークン**: 流出ファイルにあった live トークンをShip&coで再発行し `SHIPANDCO_API_KEY` を差替え。
2. **[HIGH] 運営ゲートの多層防御**: `middleware.ts` の手書き matcher が唯一の認証。新ルートを入れ忘れると無認証公開に。プレフィックス化 or ハンドラ内でもop認証。
3. **[本番課金前] 発行の多額/スパイク防止**: 代理店自動発行に上限・確認・異常アラート無し（最大¥2.5M/予約）。
4. **[MED] 公開コストAPI**（`/api/places`,`/api/places/staticmap`,`/api/analyze-luggage`,`/api/photos/upload`）を認証/クォータ or 削除。
5. **[MED] レート制限が実効なし**（`lib/rate-limit.ts` はメモリ内）→ 共有ストア(KV)。
6. **[MED] 運営パスワードがCookieに平文**→ ランダムセッショントークン＋定数時間比較＋ロックアウト。
7. **[MED] 電子署名の改ざん耐性**: 署名済みPDF(のハッシュ)を保存せず都度再生成。署名時にハッシュ保存。
8. **[MED] cronのハートビート/部分失敗アラート**（section 10）。
9. **[MED] ログのPII**（`shipandco/create` が氏名/住所/電話を出力）をマスキング。
10. [LOW] 署名済み契約番号が再DLで変わる／佐川31–50日が不要deferred／長い氏名でcapNameが敬称脱落／mailerのSMTP成功判定。

### 問題なしと確認
代理店分離(RLS+JWT)、契約なりすまし不可、`SHIPANDCO_LIVE`のfail-safe、Stripe card-confirmのなりすまし防止、秘密情報の非コミット、cronのBearer認証。

## 13. Claude Code で作業するときの約束事

- 作業前に読む: リポジトリ直下 `CLAUDE.md`（状態ファイル更新ルール）、`~/.claude/CLAUDE.md`（品質基準・404衛生・完了の定義=証拠必須）、開発ログ `~/JOJO/state/bondex.md`。
- 意思決定が確定したら `~/JOJO/state/bondex.md` に「日付・結論・根拠パス」を1行追記（過程は書かない）。
- 個人携帯 `+81-90-1680-1142` を**コード/PDF/LPに絶対載せない**。未確認の連絡先はプレースホルダで仮置き。
- 顧客向け成果物に丸数字①②等の「AIっぽい表記」を使わない。
- 本番反映は「実URLへのcurl等の証拠」まで取ってから完了とする。
