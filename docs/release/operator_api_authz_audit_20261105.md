# 運営の API の認可の監査（B2C に関わる操作）

作成: 2026-11-05。ブランチ `verify/b2c-golive`。試験: `scripts/test-integ/operator-authz.ts`（ルートを middleware を通さずに直接呼ぶ。69件）。

## 認証の方式の言葉

| 記号 | 意味 |
|---|---|
| **個人パスキー** | パスキーで入った v2 のセッションで、`operator_passkeys.operator_email`（メールのワンタイムコードで本人確認済み）がある運営者（`lib/b2c/operator-identity.ts`） |
| **運営** | middleware と同じ条件: 運営のセッションの cookie（v1 共有パスワード・v2 パスキー）か `Authorization: Bearer <OPERATOR_PASSWORD>`（`lib/operator-authz.ts` の `requireOperator`） |
| **cron** | `Authorization: Bearer <CRON_SECRET>`（サーバー間の定時の処理） |
| **旅行者の token** | 入口の秘密の token・予約の秘密のリンク（各ルートで照合） |

## 一覧

| API | 対象のデータ | 許可される操作 | 認可（ハンドラーの中） | 拒否されるもの | 状態 |
|---|---|---|---|---|---|
| `POST /api/b2c/ops/payments` | B2C の請求・集荷の確認・返金 | 集荷の確認・取消（`confirm_pickup`・`revoke_pickup`）・再試行（`retry_charge`）・保留の解除・取消（`release_hold`・`cancel_hold`）・個数の訂正（追加の請求・返金 `correct_pieces`）・返金（`refund`）・回収不能（`mark_uncollectible`） | 個人パスキー（既存） | v1・Bearer・代理店 JWT・未認証・メールなしのパスキー（403） | 試験済み（集荷の確認を 6種の呼び出しで） |
| `GET /api/b2c/ops/payments` | 旅行者の名前・額の一覧 | 一覧 | **個人パスキー（今回追加。以前は v1 も可）** | 同上 | 試験済み |
| `POST /api/b2c/ops/hotel` | 施設の確認・予約ごとの受入 → 確定・取消 | `facility`・`acceptance` | 個人パスキー（既存） | 同上 | 既存の試験（card・notify） |
| `GET/POST /api/b2c/ops/outbox` | 通知の送信待ち・結果不明の照合 | 一覧・手動の照合（送った・送っていない） | 個人パスキー（既存） | 同上 | 既存の試験（outbox_e2e） |
| `GET/POST /api/operator/pickup-request` | 集荷依頼（B2B・B2C）・変更と取消の申請と確定・結果の記録 | 確認・Biz-Logi の送信・Excel の記録・変更申請の作成・段階・確定・結果の記録 | **運営＋対象が B2C の区間なら個人パスキー（今回追加）**。対象は `shipmentId`・`changeId`・`requestId` から引く | B2C の区間: v1・Bearer・メールなしのパスキー（403）。全体: 未認証・代理店 JWT（401） | 試験済み（GET・POST） |
| `PATCH /api/shipments` | 区間の状態・日程・個数・メモ | 更新 | **運営＋B2C の区間なら個人パスキー（今回追加）** | 同上 | 試験済み |
| `GET /api/shipments`・`DELETE /api/shipments` | 区間の一覧・予約の削除 | 一覧・削除 | **運営（今回追加）**。削除は `BDX-` の予約だけで、B2C（`B2C-`）は消せない | 未認証・代理店 JWT | 型・回帰で確認 |
| `POST /api/operator/shipment/[id]/edit` | 区間の編集・問い合わせ番号 | 編集 | **運営＋B2C の区間なら個人パスキー（今回追加）**。B2C の区間の代理店名・代表者名はさらに 409（既存） | 同上 | 試験済み（charge_e2e の C16 も） |
| `POST /api/operator/shipment/[id]/correct`・`hotel-change`・`/api/operator/adjust-count`・`/api/shipandco/create`・`/api/shipments/addition-settle` | B2B の区間の訂正・ホテルの変更・個数の是正・発行・追加の精算 | B2B の区間だけ | middleware（運営）。**B2C の区間は 409 で止める（既存）** | B2C の区間は全員 409 | 既存の試験（charge_e2e C16） |
| `/api/b2c/cron/tick`・`/api/cron/pickup-watch`・`/api/cron/sync-tracking`・`/api/cron/sagawa-bulk-alert` | 定時の処理 | — | cron | 運営の cookie では呼べない | 既存・今回の G19 の試験 |
| `/api/b2c/stripe/webhook` | Stripe の通知 | — | Stripe の署名 | 署名なし 400 | 既存（charge_e2e） |
| `/api/b2c/orders`・`card/*`・`my/*`・`pay`・`quote`・`places`・`entry` | 旅行者の予約 | 予約・カード登録・確認・取消・支払 | 旅行者の token | 不正な token 404 | 既存（api_local・card・pay） |

## 区間が B2C か確かめられない時（DB の障害など）

`shipmentIsB2c()` は true / false / null（確かめられない）を返す。null の時は、個人パスキーの運営者だけが通り、それ以外は **503 `shipment_check_unavailable`**（B2C の区間かもしれないので通さない。B2B の区間を「B2C 扱い」の 403 で止めて理由が分からなくなるのを避ける）。
区間の行は全部の列で読む（B2C の列が無い古い DB でも、代理店名 `BondEx Direct` で判定できる・`lib/b2c/b2b-guard.ts`）。
経緯: 最初の実装は「読めなければ B2C 扱い（403）」で、B2C の列の無い試験の DB（Biz-Logi の結合試験）で B2B の区間の操作が全部 403 になった（88件中 60件の失敗）。上の形に直して 88/88。

## 認可の漏れ・残り（重要度つき）

| 重要度 | 内容 | 対応の案 |
|---|---|---|
| 中 | 運営の画面の一覧（ダッシュボード・予約の一覧・`GET /api/shipments`）は、B2C の区間の旅行者の名前・ホテルも v1（共有パスワード）の運営者に見える（既存。readiness 0.3 に記載） | 一覧で B2C の区間の名前を伏せるか、v1 を廃止する（事業の判断） |
| 中 | 運営の API 45本のうち、ハンドラーの中で認可を確かめるのは今回の 4本（＋ B2C の 3本）。残りの B2B の API は middleware だけに頼る | B2B の API にも `requireOperator` を順に足す（middleware と同じ条件なので B2B の動きは変わらない） |
| 低 | `pickup-request` の担当者名（`actor`）は自由入力（B2C の区間では個人パスキーの運営者が必要になったが、記録の名前は入力のまま） | B2C の区間の操作では、運営者のメールを記録に足す |
| 低 | 開発の環境（`OPERATOR_PASSWORD` が無い）では `requireOperator` は middleware と同じく通す。本番は middleware が 503 で止める | 本番・staging に `OPERATOR_PASSWORD` を必ず入れる（staging の誤接続の防止に足す案） |
