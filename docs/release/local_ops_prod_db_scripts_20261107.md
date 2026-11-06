# 手元の運用の道具から本番の DB に触れる時の守り（2026-11-07）

対象：手元の作業コピー（`.env.local` など）に本番の Supabase の URL・service_role の鍵がある時、アプリの守り（`lib/env-guard.ts`）を通らずに本番へ届く 2つの道具。守りの本体は `lib/ops/script-db-guard.ts`（アプリからは使わない）。

| 道具 | 本番への操作 | 方針（谷口さんの判断・2026-11-07） |
|---|---|---|
| `scripts/sagawa-leadtime/import.ts` | 書き込み（佐川の配達日数の表の upsert） | 原則停止・明示の承認の時だけ |
| `scripts/pickup-request/check-excel-rows.ts` | 読み取り（Excel の二重依頼の照合） | 維持する。運営のモードだけ・読み取りだけ・照合できなければ Excel を作らない |

## 1. 本番への書き込み（import.ts）

- **既定は計画の表示だけ**（DB に接続しない）。接続先・行数・中身の要約・承認の文字列を表示する。
- staging・手元へ書く：`--write`。
- 本番へ書く：`--write --approve-prod-write=<承認の文字列>`。承認の文字列は `PRODWRITE-<道具>-<日本時間の日付>-<本番の ID>-<CSV の中身の要約>`。**その日・本番・その中身・その道具の時だけ**効く（日付が変わる・CSV が変わると無効）。秘密は含まない。
- 承認の文字列は**引数だけ**で受け取る（環境変数・`.env` に置いても効かない。ファイルに置いた承認が毎回効く形にしない）。
- 止めるもの：Vercel（Production・Preview）・CI の上／`BONDEX_ENV` が production 以外で本番／URL と鍵の接続先の食い違い（本番の URL に staging の鍵など）／知らない接続先／手元の URL に本番・staging の鍵／知らない指定（`--force` など）／本番以外に本番の承認を付けた。

手順（本番へ書く時）：
1. `npx tsx --env-file=<本番の接続情報> scripts/sagawa-leadtime/import.ts` → 計画と承認の文字列を確かめる
2. 計画（行数・中身の要約）を谷口さんに見せ、承認を受ける
3. 同じ日のうちに `… import.ts --write --approve-prod-write=<文字列>`

## 2. Excel の照合（check-excel-rows.ts）

- 本番の DB は**運営の照合のモード**（`--ops-mode=excel-check`）の時だけ読む。`output/sagawa-pickup/build_sheet.py` が必ず付ける（2026-11-07 更新済み）。照合を飛ばす指定は無い。
- 接続は**読み取りの要求（GET・HEAD）しか送れない**（service_role の鍵でも、書き込み・関数の POST は送る前に止まる）。
- 鍵：
  - `EXCEL_CHECK_READONLY_KEY`（読み取りだけの役割 `bondex_excel_reader` の鍵）があれば、それを使う。`build_sheet.py` は service_role の鍵を照合へ渡さない。
  - 無い間は**移行期**として service_role の鍵を使う（読み取りだけの接続で）。
  - anon などほかの役割の鍵は止める（RLS で行が見えず、依頼済みを「依頼なし」と誤って OK にしうるため）。
- 止めるもの（Excel を作らない）：モードが無い・不正な値（打ち間違いを「モードなし」にしない）／Vercel・CI の上／`BONDEX_ENV` が production 以外で本番／接続できない・500／関数の結果を確かめられない／区間が 0件。
- **照合が止まった時に Excel を手で作らない**（チェックリスト 8章）。

### 読み取りだけの役割（`sql/ops/excel_check_readonly.sql`・未適用）

- 役割 `bondex_excel_reader` は**表を直接読めない**。読めるのは関数 `excel_check_snapshot(text[])` だけ（定義者の権限で全部の行を読み、照合に要る列だけを返す・STABLE・書き込みなし）。表を直接読ませないのは、RLS で見えない行を「無い」としないため。
- anon・authenticated は関数を呼べない。
- 戻し方は SQL の末尾。
- 鍵の用意：この役割の名前（`role: bondex_excel_reader`）を持つ鍵を、プロジェクトの JWT の署名の仕組みで作る。**本番のプロジェクトが旧来の JWT の秘密か、新しい署名の鍵かで作り方が変わる**ので、適用の前に谷口さんが Supabase の画面（Settings → API / JWT Keys）で確かめる。作れない場合は、移行期の service_role の鍵（読み取りだけの接続）のまま運用し、鍵の取り替えの時に再検討する。

## 3. 試験（すべて手元・外への通信 0回）

| 試験 | 結果 |
|---|---|
| `npx tsx scripts/test-ops-guard/scripts.ts`（模擬の fetch） | 47/47：本番の書き込みの無断実行の防止 12・不正なモードと接続先 9・本番の鍵が混入した開発環境 2・Vercel（Preview・Production・空）と CI 10・読み取りの照合の正常動作 10・接続の失敗 4 |
| `bash scripts/test-excel-gate/failsafe.sh` | 4/4（変更なし） |
| `sql/ops/excel_check_readonly.sql` を手元の Supabase の Postgres（専用のコンテナ） | 適用・再適用（同じ結果）・RLS のある表の行も関数で見える・役割は表の SELECT・INSERT・UPDATE が拒否・anon と authenticated は関数を呼べない・空の入力・読み取りだけのトランザクションで動く・戻し方で役割と関数が消える |
| 手元の PostgREST（専用のコンテナ）で照合を通し | 読み取りの役割の鍵で、依頼済み・取消の申請中を NG、申請の処理の後に OK。役割の鍵での PATCH・表の読み取りは 42501 |
| `build_sheet.py`（手元の PostgREST・控えは一時の場所） | 依頼済み → 止まり Excel なし／依頼なし → Excel あり／同じ区間をもう一度 → 控えで止まる／DB に届かない → 止まる |
| 回帰 | 型・lint・environments 77/77・preview-hardening 54/54・preview 23/23 |
