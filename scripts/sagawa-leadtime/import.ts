/**
 * 佐川 配達日数データ (data/sagawa-lead-times/*.csv) を service_role で upsert する。
 * sql/059_sagawa_lead_times_seed.sql (約1.1MB) を SQL Editor で流せないときの代替。結果は 059 と同じ
 * (何度実行しても同じ・既存行は CSV の値で上書き)。sql/058 を先に適用しておくこと。
 *
 *   計画だけ (既定・DB に接続しない): npx tsx --env-file=<.env のパス> scripts/sagawa-leadtime/import.ts
 *   staging・手元へ書く:              … import.ts --write
 *   本番へ書く (谷口さんの承認の後):   … import.ts --write --approve-prod-write=<計画に出た承認の文字列>
 *   必要な環境変数: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *
 * 本番への書き込みは、環境変数に本番の鍵があるだけでは動かない (2026-11-07・lib/ops/script-db-guard.ts)。承認の文字列は
 * その日 (日本時間)・本番・CSV の中身に結びつき、引数でだけ受け取る。Vercel・CI の上では動かない。
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createClient } from "@supabase/supabase-js"
import { assertWriteAllowed, classifyDbTarget, contentDigest, prodWriteApprovalCode, ScriptGuardError } from "../../lib/ops/script-db-guard"

const DIR = join(__dirname, "../../data/sagawa-lead-times")
const BATCH = 500
const TOOL = "sagawa-leadtime"
const FILES = ["zip_offices.csv", "office_pairs.csv", "zip_pairs.csv"]

function parseCsv(text: string): Record<string, string>[] {
  const [header, ...lines] = text.trim().split(/\r?\n/)
  const cols = header.split(",")
  // 値にカンマを含まない CSV (自前生成) なので単純分割で足りる
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])))
}

const nullIfEmpty = (v: string | undefined) => (v ? v : null)

export interface ImportDeps {
  readFile?: (name: string) => string
  fetch?: typeof fetch
  log?: (s: string) => void
  now?: Date
}

/** 終了コード (0 = 成功・計画の表示、1 = 止めた・失敗)。process.exit はここでは呼ばない (試験で使うため)。 */
export async function run(argv: string[], env: Record<string, string | undefined>, deps: ImportDeps = {}): Promise<number> {
  const log = deps.log ?? console.log
  try {
    const readFile = deps.readFile ?? ((n: string) => readFileSync(join(DIR, n), "utf8"))
    const texts = FILES.map((f) => readFile(f))
    const [zipOffices, officePairs, zipPairs] = texts.map(parseCsv)
    const digest = contentDigest(texts)
    const url = env.NEXT_PUBLIC_SUPABASE_URL
    const key = env.SUPABASE_SERVICE_ROLE_KEY
    const target = classifyDbTarget(url, key)
    const mode = assertWriteAllowed(TOOL, target, digest, argv, env, deps.now)

    const tables: Array<{ table: string; onConflict: string; rows: Record<string, unknown>[] }> = [
      {
        table: "sagawa_zip_offices",
        onConflict: "zip",
        rows: zipOffices.map((r) => ({
          zip: r.zip, office: r.office, prefecture: nullIfEmpty(r.prefecture), city: nullIfEmpty(r.city),
          town: nullIfEmpty(r.town), fetched_at: r.fetched_at,
        })),
      },
      {
        table: "sagawa_office_lead_times",
        onConflict: "from_office,to_office",
        rows: officePairs.map((r) => ({
          from_office: r.from_office, to_office: r.to_office, days: Number(r.days),
          sample_from_zip: nullIfEmpty(r.sample_from_zip), sample_to_zip: nullIfEmpty(r.sample_to_zip), fetched_at: r.fetched_at,
        })),
      },
      {
        table: "sagawa_lead_times",
        onConflict: "from_zip,to_zip",
        rows: zipPairs.map((r) => ({
          from_zip: r.from_zip, to_zip: r.to_zip, from_office: nullIfEmpty(r.from_office), to_office: nullIfEmpty(r.to_office),
          days: Number(r.days), source: r.source, fetched_at: r.fetched_at,
        })),
      },
    ]

    if (mode === "plan") {
      log(`計画 (DB には接続していません・書き込みなし)\n  接続先: ${target}\n  中身の要約: ${digest}`)
      for (const t of tables) log(`  ${t.table}: ${t.rows.length} 行を upsert`)
      if (target === "production") {
        log(`\n本番へ書くには、この計画を谷口さんに見せて承認を受け、同じ日のうちに次を付けて流してください:\n  --write --approve-prod-write=${prodWriteApprovalCode(TOOL, digest, deps.now)}`)
      } else {
        log("\n書くには --write を付けてください")
      }
      return 0
    }

    const sb = createClient(url!, key!, { auth: { persistSession: false }, global: deps.fetch ? { fetch: deps.fetch } : undefined })
    log(`書き込み: 接続先 ${target}・中身の要約 ${digest}`)
    for (const t of tables) {
      for (let i = 0; i < t.rows.length; i += BATCH) {
        const { error } = await sb.from(t.table).upsert(t.rows.slice(i, i + BATCH), { onConflict: t.onConflict })
        if (error) throw new Error(`${t.table} [${i}..]: ${error.message}`)
      }
      const { count, error } = await sb.from(t.table).select("*", { count: "exact", head: true })
      if (error) throw new Error(`${t.table} count: ${error.message}`)
      log(`${t.table}: CSV ${t.rows.length} 行 → テーブル ${count} 行`)
    }
    return 0
  } catch (e) {
    log(`中止: ${e instanceof ScriptGuardError ? e.message : e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}

if (require.main === module) {
  run(process.argv.slice(2), process.env).then((code) => process.exit(code))
}
