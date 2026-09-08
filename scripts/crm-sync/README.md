# BondEx CRM Sync

ChatGPT で整理した営業内容を HubSpot（会社・担当者・取引・商談メモ・タスク）へ同期する。

## 標準運用

`/bondex-sync` が唯一の正規入口。ChatGPT で整理した営業メモを渡すと、検証 → dry-run →
（承認後）本番反映 → Create/Update件数とURLの報告、まで一貫して行う。

`scripts/crm-sync/example.input.json` は自己テスト専用のサンプルであり、
**本番の HubSpot には絶対に反映しない**。CLI にもガードがあり、このサンプルの
会社名・ドメインを検出すると `--apply` を機械的に拒否する。

## 使い方

Claude Code から:

```
/bondex-sync   ← 続けて営業メモを貼る
```

コマンドラインから:

```bash
npm run crm:sync -- --input memo.json            # dry-run（書き込まない・既定）
npm run crm:sync -- --input memo.json --apply    # 実際に書き込む
npm run crm:sync -- --input memo.json --validate # JSON の検証だけ（HubSpot に接続しない）
npm run crm:sync -- --check                      # 疎通・スコープ確認（読み取りのみ・入力不要）
npm run crm:sync:test                            # モックによる自己テスト（トークン不要）
```

| オプション | 意味 |
| --- | --- |
| `--input <file>` / `-i` | 入力 JSON。省略時は標準入力 |
| `--apply` | 実際に HubSpot へ書き込む。**付けない限り書き込みは起きない** |
| `--force` | 同期済みの商談メモ・タスクを作り直す |
| `--validate` | 入力検証のみ。ネットワークに出ない |
| `--check` | トークン形式・疎通・スコープ・パイプラインを確認（読み取りのみ） |

`npm run crm:token` はクリップボードのトークンを検証して `.env.local` に書き込む
（値は画面にもログにも出さない。元ファイルは `.env.local.bak` に退避）。
| `--json` | 結果を JSON で出力 |

終了コード: `0` 成功 / `1` エラーあり / `2` 入力不正 / `3` 設定不足

## 事前準備

HubSpot → 設定 → 連携 → 非公開アプリ → 対象アプリ → **認証**タブで
「アクセストークンを表示する」を押し、**コピーボタン**でコピーする。
（文字を範囲選択してコピーすると端が欠けることがある）

そのまま次を実行すると、形式を検証したうえで `.env.local` に書き込まれる:

```bash
npm run crm:token
```

手で置く場合は `.env.local` に直接（`.env.example` に記載あり）:

```
HUBSPOT_PRIVATE_APP_TOKEN=pat-na1-________-____-____-____-____________
HUBSPOT_PORTAL_ID=12345678
```

トークンは `pat-<地域>-<UUID>` の **44 文字**固定。1 文字でも欠けると HubSpot は
`401 INVALID_AUTHENTICATION` を返す（欠けたトークンでも見た目は本物らしいので、
`--check` で形式から検証すること）。

必要スコープ:

- `crm.objects.companies.read` / `.write`
- `crm.objects.contacts.read` / `.write`
- `crm.objects.deals.read` / `.write`
- `crm.schemas.deals.read`（パイプライン・ステージの取得に必要）

## 入力 JSON

雛形は [`example.input.json`](./example.input.json)、正式な定義は [`schema.ts`](./schema.ts)。

必須は `company.name` のみ。`contacts` / `deal` / `meeting` / `tasks` はいずれも任意で、
書かれていない項目は送信しない（推測で埋めない）。

## 処理の流れ

```
Company 検索 → 無ければ作成 / あれば差分だけ更新
  └ Contact 検索 → 作成 or 更新 → Company に関連付け
      └ Deal 検索 → 作成 or 更新 → Company / Contact に関連付け
          ├ Meeting（商談メモ）作成 → Company / Deal / Contact に関連付け
          └ Task 作成 → Company / Deal / Contact に関連付け
```

## 重複防止

三段構えで、同じ営業メモを何度流しても増殖しない。

1. **ローカル台帳** `logs/bondex-sync/ledger.json`
   同期キーごとに作成済み ID を記録。HubSpot の検索インデックスは反映が数秒遅れるため、
   連続実行に対してはこれが最終防衛線になる。
2. **カスタムプロパティ** `bondex_sync_key`
   ポータルに定義されていれば自動で使う（無くても動く）。台帳を持たない別 PC からの
   実行でも横断的に照合できる。定義は任意。
3. **自然キー検索**
   会社は `domain` →`name`、担当者は `email` →（姓名＋所属会社）、取引は `取引名＋会社`、
   商談メモとタスクは `件名＋日時`。

同期キーは `syncKey` の明示指定、無ければ **会社名 + 取引名 + 商談日時** から生成する。

### 重要な安全側の挙動

**重複確認の検索が失敗したときは、作成せずに中止する。** 認証エラーや HubSpot 側の 5xx を
「該当なし」と解釈して新規作成に倒れると、まさに防ぎたい重複が生まれるため。
中止した場合は理由が結果に出る。

## ログ

| ファイル | 内容 |
| --- | --- |
| `logs/bondex-sync/YYYY-MM-DD.jsonl` | API 呼び出し 1 件 1 行（メソッド・パス・ステータス） |
| `logs/bondex-sync/YYYY-MM-DD.runs.jsonl` | 実行単位のサマリ |
| `logs/bondex-sync/ledger.json` | 同期台帳（冪等性の根拠） |

`logs/` は `.gitignore` 済み。顧客情報を含むためコミットしない。
トークンはログに一切出力しない。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `../../lib/hubspot.ts` | HubSpot API クライアント（再試行・dry-run・監査ログ） |
| `schema.ts` | 入力 JSON の定義（zod） |
| `sync.ts` | 同期の中核ロジック |
| `store.ts` | 環境変数読み込み・台帳・ログ |
| `cli.ts` | コマンドライン入口 |
| `selftest.ts` | モックによる自己テスト |

## テスト

`npm run crm:sync:test` は HubSpot API をモックして次を検証する（実トークン不要）。

1. 初回同期で 5 種のオブジェクトが作られ、関連付けされる
2. 同じ入力の再実行で新規作成が 0 件
3. 台帳を失っても自然キー検索で重複を作らない
4. 検索が落ちているときは作成せず中止する
5. dry-run で書き込みが 0 件
