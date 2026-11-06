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
- 前提：067・068 の後（2026-11-07 の本番には `pickup_requests` が無い）。

### 実現できるか（2026-11-07・本番は読むだけで確認）

| 確かめたこと | 結果 | 意味 |
|---|---|---|
| 本番の鍵の方式（手元の鍵の種類・役割・ID だけを見た。値は見ていない） | anon・service_role とも **旧来の JWT（HS256）・kid なし** | 旧来の JWT の秘密で、役割 `bondex_excel_reader` の鍵を作れる |
| `postgres` の権限 | RLS を通らない（bypassrls）・役割を作れる（createrole） | 関数（所有者 postgres）が全部の行を読める。役割を作れる |
| `authenticator` の所属 | anon・authenticated・service_role | SQL で新しい役割を足せば、PostgREST がその役割に切り替わる |
| `public` の関数の既定の権限 | **新しい関数に anon・authenticated の実行の権限が自動で付く** | SQL の revoke が要る（入っている。試験で anon・authenticated が呼べないことを確認） |
| 役割の時間の上限 | anon 3秒・authenticated 8秒 | 新しい役割にも 8秒を付けた |
| Supabase のゲートウェイ（Supabase の文書） | `apikey` の欄は anon・service_role（または publishable・secret）の鍵だけ。自分で作った鍵は `Authorization: Bearer` だけ | **最初の作り（役割の鍵を apikey に入れていた）は本番で 401 になっていた**。apikey に公開の anon の鍵・Bearer に役割の鍵へ直した。試験でゲートウェイの決まりをまねて確認 |

判断：**実現できる**（旧来の JWT の方式のままの間）。条件と注意：
- 鍵を作るには **JWT の秘密**（Supabase の画面 Settings → JWT）が要る。この秘密は service_role の鍵も作れるので、**谷口さんが自分の端末で 1回だけ作り、秘密はどこにも保存しない**。作り方：Supabase の文書の `supabase gen bearer-jwt --role …` か、HS256 で `role: bondex_excel_reader`・`exp` を入れて署名する（有効期限は必須。照合は期限の無い鍵・期限切れを止める。CLI で期限を指定できるかは作る時に確かめる。未確認）。期限は 90日を目安に、作り直しの日を運営の予定に入れる。
- 本番を新しい署名の鍵（非対称）へ移し、旧来の秘密を無効にすると、**この鍵も無効になり照合が止まる**（安全側。Excel は作れない）。移す時は、自分の秘密の鍵を取り込む方法で作り直す。
- service_role の鍵の取り替えは、旧来の方式では JWT の秘密の取り替え（anon の鍵も変わり、本番のアプリの再デプロイが要る）になる。その時にこの鍵も作り直す。取り替えの計画と同時に決める。

代わりの案（鍵を作れない・作りたくない時）：
1. **移行期のまま**：service_role の鍵を、読み取りの要求しか送れない接続で使う（今の既定）。誤操作は防げるが、鍵そのものは書き込める。
2. **本番のアプリに照合の入口を作る**（運営の端末は照合専用の合言葉だけを持つ。鍵はサーバーに置いたまま）。本番のデプロイが要るので、Stage 0 の後に検討。
3. Postgres に直接つなぐ読み取りだけのログインの役割（`default_transaction_read_only`）。データベースのパスワードを運営の端末に置く・接続のライブラリを足すので、2 より劣る。

### 複数の端末で Excel を作る時の制約

- 同じ区間の Excel の二度作りを止める控え（`exported_legs.jsonl`）は、**その端末だけ**のファイル。別の端末で作った Excel は見えない。DB の照合は「運営画面で Excel で依頼済みを記録した後」しか止められない（記録の前の間は通る）。
- だから今は **Excel を作る端末を 1台に決める**（運営の決まり）。
- 複数の端末で作る時は、DB の側で「この区間の Excel を作った」を先に確保する仕組みが要る（区間ごとに一意の確保の表と、確保だけができる関数。読み取りだけの役割とは別の、書き込みの最小の権限）。設計と承認は別。

## 3. 試験（すべて手元・外への通信 0回）

| 試験 | 結果 |
|---|---|
| `npx tsx scripts/test-ops-guard/scripts.ts`（模擬の fetch） | 53/53（11/07 第2版。ゲートウェイの決まり・鍵の期限・接続先の確かめの 6件を追加）：本番の書き込みの無断実行の防止 12・不正なモードと接続先 9・本番の鍵が混入した開発環境 2・Vercel（Preview・Production・空）と CI 10・読み取りの照合の正常動作 10・接続の失敗 4 |
| `bash scripts/test-excel-gate/failsafe.sh` | 4/4（変更なし） |
| `sql/ops/excel_check_readonly.sql` を手元の Supabase の Postgres（専用のコンテナ） | 適用・再適用（同じ結果）・RLS のある表の行も関数で見える・役割は表の SELECT・INSERT・UPDATE が拒否・anon と authenticated は関数を呼べない・空の入力・読み取りだけのトランザクションで動く・戻し方で役割と関数が消える |
| 手元の PostgREST（専用のコンテナ）で照合を通し | 読み取りの役割の鍵で、依頼済み・取消の申請中を NG、申請の処理の後に OK。役割の鍵での PATCH・表の読み取りは 42501 |
| `build_sheet.py`（手元の PostgREST・控えは一時の場所） | 依頼済み → 止まり Excel なし／依頼なし → Excel あり／同じ区間をもう一度 → 控えで止まる／DB に届かない → 止まる |
| `bash scripts/test-excel-gate/readonly-role-e2e.sh`（専用のコンテナ・ゲートウェイのまね。`BUILD_SHEET=…` で build_sheet.py も） | 16/16：役割の鍵を apikey に入れると 401・apikey=anon と Bearer で 200・役割の鍵での書き込みと anon の関数の呼び出しは 42501・依頼なし OK・依頼済み NG・取消の申請中 NG・期限切れ・公開の鍵なし・権限なし・結果を確かめられない・DB に届かないはすべて止まる／build_sheet.py：依頼済みと権限なしは Excel なし・依頼なしは Excel あり・二度目は控えで止まる |
| 回帰 | 型・lint・environments 77/77・preview-hardening 54/54・preview 23/23 |
