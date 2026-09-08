#!/usr/bin/env npx tsx
/**
 * BondEx CRM Sync CLI
 *
 *   npx tsx scripts/crm-sync/cli.ts --input memo.json            # 既定は dry-run (書き込まない)
 *   npx tsx scripts/crm-sync/cli.ts --input memo.json --apply    # 実際に HubSpot へ書き込む
 *   cat memo.json | npx tsx scripts/crm-sync/cli.ts --apply
 *
 * 終了コード: 0=成功 / 1=同期エラーあり / 2=入力不正 / 3=設定不足
 */

import fs from "node:fs"
import { SyncInputSchema, formatZodError, isSampleData, type SyncInput } from "./schema"
import { createHubSpotClient, inspectTokenShape } from "../../lib/hubspot"
import { syncToHubSpot, type SyncReport } from "./sync"
import { appendApiLog, appendRunLog, loadEnvFiles, LOG_DIR } from "./store"

type Args = {
  input?: string
  apply: boolean
  force: boolean
  json: boolean
  validate: boolean
  check: boolean
  help: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, force: false, json: false, validate: false, check: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === "--input" || a === "-i") args.input = argv[++i]
    else if (a === "--apply") args.apply = true
    else if (a === "--dry-run") args.apply = false
    else if (a === "--force") args.force = true
    else if (a === "--json") args.json = true
    else if (a === "--validate") args.validate = true
    else if (a === "--check") args.check = true
    else if (a === "--help" || a === "-h") args.help = true
    else if (a.startsWith("--input=")) args.input = a.slice("--input=".length)
  }
  return args
}

const HELP = `BondEx CRM Sync — 営業メモを HubSpot へ同期する

使い方:
  npx tsx scripts/crm-sync/cli.ts --input <file.json> [--apply] [--force] [--json]

オプション:
  -i, --input <file>  入力 JSON。省略時は標準入力から読む
      --apply         実際に HubSpot へ書き込む (既定は dry-run で書き込まない)
      --force         同期済みの商談メモ・タスクを再作成する
      --json          結果を JSON で出力する (機械処理向け)
      --validate      入力 JSON の検証だけ行い、HubSpot へは一切接続しない
      --check         HubSpot への疎通とスコープを確認する (入力 JSON 不要・読み取りのみ)
  -h, --help          このヘルプ

必要な環境変数 (.env.local に置く):
  HUBSPOT_PRIVATE_APP_TOKEN  Private App のアクセストークン (必須)
  HUBSPOT_PORTAL_ID          ポータル ID (任意。設定するとログに HubSpot の URL が出る)
`

function printMissingToken(): void {
  console.error("[設定不足] HUBSPOT_PRIVATE_APP_TOKEN が未設定です。")
  console.error("  bondex-poc-main/.env.local に次の行を追加してください:")
  console.error("    HUBSPOT_PRIVATE_APP_TOKEN=pat-na1-xxxxxxxx")
  console.error("  トークンは HubSpot > 設定 > 連携 > 非公開アプリ から発行できます。")
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

function actionLabel(action: string): string {
  return action === "created" ? "新規作成" : action === "updated" ? "更新" : "既存を再利用"
}

/** 全角を 2 桁として数え、端末上で列が揃うように空白を詰める */
function padDisplay(text: string, width: number): string {
  let w = 0
  for (const ch of text) w += /[\u3000-\u9fff\uff00-\uff60\u30a0-\u30ff]/.test(ch) ? 2 : 1
  return text + " ".repeat(Math.max(1, width - w))
}

function printReport(report: SyncReport): void {
  const mode = report.dryRun ? "DRY-RUN (書き込みなし)" : "APPLY (HubSpot へ書き込み済み)"
  const counts = report.counts
  const lines: string[] = []
  lines.push("")
  lines.push(`■ BondEx CRM Sync 結果 — ${mode}`)
  lines.push(`  同期キー: ${report.syncKey}`)
  lines.push(
    `  件数: 新規作成 ${counts.created} 件 / 更新 ${counts.updated} 件 / 既存を再利用 ${counts.reused} 件`,
  )
  lines.push("")

  const row = (kind: string, o?: { label: string; action: string; id: string; url?: string }) => {
    if (!o) return
    lines.push(`  ${padDisplay(kind, 10)}${padDisplay(actionLabel(o.action), 12)}${o.label}`)
    lines.push(`  ${" ".repeat(10)}└ ${o.url ?? `id=${o.id}`}`)
  }

  row("会社", report.company)
  for (const c of report.contacts) row("担当者", c)
  row("取引", report.deal)
  row("商談メモ", report.meeting)
  row("Note", report.note)
  for (const t of report.tasks) row("タスク", t)

  lines.push("")
  lines.push(
    `  関連付け: ${report.associations} 件` +
      (report.associationsSkipped > 0 ? ` (張り済みのため ${report.associationsSkipped} 件はスキップ)` : ""),
  )

  if (report.skipped.length) {
    lines.push("")
    lines.push("  重複防止によりスキップ:")
    for (const s of report.skipped) lines.push(`    - ${s}`)
  }

  if (report.errors.length) {
    lines.push("")
    lines.push("  エラー:")
    for (const e of report.errors) lines.push(`    ! ${e}`)
  }

  lines.push("")
  lines.push(`  ログ: ${LOG_DIR}`)
  if (report.dryRun) {
    lines.push("")
    lines.push("  ※ まだ HubSpot には何も書き込んでいません。内容が正しければ --apply を付けて再実行してください。")
  }
  lines.push("")
  console.log(lines.join("\n"))
}

/** 同期に必要なスコープ。不足していると実行時に 403 で落ちる */
const REQUIRED_SCOPES = [
  "crm.objects.companies.read",
  "crm.objects.companies.write",
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.deals.read",
  "crm.objects.deals.write",
  "crm.schemas.deals.read",
]

/** --check: 読み取りのみで疎通・スコープ・パイプラインを確認する */
async function runCheck(): Promise<number> {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN
  if (!token) {
    printMissingToken()
    return 3
  }

  const client = createHubSpotClient({ token, dryRun: true, onLog: appendApiLog })
  const problems: string[] = []
  console.log("\n■ HubSpot 接続確認\n")

  // 形式チェックは「参考情報」に留める。HubSpot 側が仕様を変えることもあり、
  // こちらの正規表現を根拠に実行を止めると、有効なトークンまで弾いてしまう。
  // 実際に叩いて 401 が返ったときだけ、この情報を原因の手がかりとして出す。
  const shapeProblem = inspectTokenShape(token)

  const ping = await client.ping()
  if (ping.ok) {
    console.log("  ✓ 認証         トークンは有効です")
    if (shapeProblem) {
      console.log(`  · 参考         想定と違う形式ですが認証は通りました (${shapeProblem})`)
    }
  } else {
    console.log(`  ✗ 認証         ${ping.error}`)
    if (shapeProblem) {
      console.log("")
      console.log(`  トークンの形が想定と違います: ${shapeProblem}`)
      console.log("  欠けている可能性が高いので、HubSpot からコピーし直してください。")
      console.log("    HubSpot > 設定 > 連携 > 非公開アプリ > 対象アプリ > 認証タブ")
      console.log("    「アクセストークンを表示する」→ コピーボタン → `npm run crm:token`")
    } else {
      console.log("")
      console.log("  形式は正しいので、トークンが失効しているか、別のポータルのものです。")
      console.log("  HubSpot > 設定 > 連携 > 非公開アプリ でトークンを再生成してください。")
    }
    console.log("")
    return 1
  }

  const info = await client.getTokenInfo()
  if (info.ok && info.data.scopes) {
    const granted = new Set(info.data.scopes)
    const missing = REQUIRED_SCOPES.filter((s) => !granted.has(s))
    if (missing.length === 0) {
      console.log("  ✓ スコープ     同期に必要な権限がすべて付与されています")
    } else {
      console.log("  ✗ スコープ     以下が不足しています:")
      for (const m of missing) console.log(`                   - ${m}`)
      problems.push("スコープ不足")
    }
    if (info.data.hubId) {
      console.log(`  ✓ ポータル     ID ${info.data.hubId}`)
      if (!process.env.HUBSPOT_PORTAL_ID) {
        console.log(`                 .env.local に HUBSPOT_PORTAL_ID=${info.data.hubId} を追記すると`)
        console.log("                 同期結果に HubSpot レコードの URL が出ます (任意)")
      }
    }
  } else {
    console.log("  ? スコープ     トークン情報を取得できませんでした (権限確認は実行時になります)")
  }

  const pipelines = await client.getDealPipelines()
  if (pipelines.ok && pipelines.data.results?.length) {
    const chosen =
      pipelines.data.results.find((p) => p.id === "default") ??
      [...pipelines.data.results].sort((a, b) => a.displayOrder - b.displayOrder)[0]
    const firstStage = [...(chosen.stages ?? [])].sort((a, b) => a.displayOrder - b.displayOrder)[0]
    console.log(`  ✓ パイプライン 「${chosen.label}」の「${firstStage?.label ?? "?"}」に取引を作成します`)
  } else {
    console.log(`  ✗ パイプライン 取得できません: ${pipelines.ok ? "パイプラインが 0 件" : pipelines.error}`)
    problems.push("パイプライン取得不可")
  }

  const hasSyncKey = await client.hasProperty("companies", "bondex_sync_key")
  console.log(
    hasSyncKey
      ? "  ✓ 同期キー     カスタムプロパティ bondex_sync_key を利用します"
      : "  · 同期キー     bondex_sync_key は未定義です (任意。無くてもドメイン/メール等で重複を防ぎます)",
  )

  console.log(
    problems.length === 0
      ? "\n  同期を実行できる状態です。まず dry-run で内容を確認してください。\n"
      : `\n  ${problems.join(" / ")} を解消してください。\n`,
  )
  return problems.length === 0 ? 0 : 1
}

/** 入力テキストを検証済みの SyncInput にする。失敗時は終了コードを返す */
function readInput(raw: string): { ok: true; data: SyncInput } | { ok: false; code: number } {
  if (!raw.trim()) {
    console.error("[入力不正] 入力が空です。--input <file.json> か標準入力で JSON を渡してください。")
    return { ok: false, code: 2 }
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (err) {
    console.error(`[入力不正] JSON として読めません: ${err instanceof Error ? err.message : String(err)}`)
    return { ok: false, code: 2 }
  }

  const result = SyncInputSchema.safeParse(json)
  if (!result.success) {
    console.error("[入力不正] 入力 JSON が仕様を満たしていません:")
    for (const line of formatZodError(result.error)) console.error(`  - ${line}`)
    return { ok: false, code: 2 }
  }
  return { ok: true, data: result.data }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP)
    return 0
  }

  loadEnvFiles()

  if (args.check) return runCheck()

  // --validate は接続前に済ませたいので、入力を先に読む
  const inputText = args.input ? fs.readFileSync(args.input, "utf8") : await readStdin()
  const parsed = readInput(inputText)
  if (!parsed.ok) return parsed.code

  if (args.validate) {
    console.log("入力 JSON は仕様を満たしています (HubSpot へは接続していません)。")
    console.log(`  会社: ${parsed.data.company.name} / 担当者 ${parsed.data.contacts.length} 名 / 取引 ${parsed.data.deal ? 1 : 0} 件 / 商談メモ ${parsed.data.meeting ? 1 : 0} 件 / タスク ${parsed.data.tasks.length} 件`)
    return 0
  }

  if (args.apply && isSampleData(parsed.data)) {
    console.error("[実行拒否] これはサンプルデータです。本番の HubSpot へは反映できません。")
    console.error("  scripts/crm-sync/example.input.json はテスト専用の入力です。--apply の対象にしないでください。")
    return 2
  }

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN
  if (!token) {
    printMissingToken()
    return 3
  }

  const report = await syncToHubSpot(parsed.data, {
    token,
    dryRun: !args.apply,
    force: args.force,
    portalId: process.env.HUBSPOT_PORTAL_ID,
    onLog: appendApiLog,
  })

  appendRunLog({
    at: report.startedAt,
    syncKey: report.syncKey,
    dryRun: report.dryRun,
    company: report.company?.label,
    counts: {
      contacts: report.contacts.length,
      tasks: report.tasks.length,
      associations: report.associations,
      errors: report.errors.length,
    },
    errors: report.errors,
  })

  if (args.json) console.log(JSON.stringify(report, null, 2))
  else printReport(report)

  return report.errors.length > 0 ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[想定外のエラー] ${err instanceof Error ? err.stack : String(err)}`)
    process.exit(1)
  })
