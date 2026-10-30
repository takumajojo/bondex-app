/**
 * 佐川 配達日数データ (data/sagawa-lead-times/*.csv) を service_role で upsert する。
 * sql/059_sagawa_lead_times_seed.sql (約1.1MB) を SQL Editor で流せないときの代替。結果は 059 と同じ
 * (何度実行しても同じ・既存行は CSV の値で上書き)。sql/058 を先に適用しておくこと。
 *
 *   実行: npx tsx --env-file=<.env.local のパス> scripts/sagawa-leadtime/import.ts
 *   必要な環境変数: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createClient } from "@supabase/supabase-js"

const DIR = join(__dirname, "../../data/sagawa-lead-times")
const BATCH = 500

function readCsv(name: string): Record<string, string>[] {
  const [header, ...lines] = readFileSync(join(DIR, name), "utf8").trim().split(/\r?\n/)
  const cols = header.split(",")
  // 値にカンマを含まない CSV (自前生成) なので単純分割で足りる
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])))
}

const nullIfEmpty = (v: string | undefined) => (v ? v : null)

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です")
  const sb = createClient(url, key, { auth: { persistSession: false } })

  const tables: Array<{ table: string; onConflict: string; rows: Record<string, unknown>[] }> = [
    {
      table: "sagawa_zip_offices",
      onConflict: "zip",
      rows: readCsv("zip_offices.csv").map((r) => ({
        zip: r.zip, office: r.office, prefecture: nullIfEmpty(r.prefecture), city: nullIfEmpty(r.city),
        town: nullIfEmpty(r.town), fetched_at: r.fetched_at,
      })),
    },
    {
      table: "sagawa_office_lead_times",
      onConflict: "from_office,to_office",
      rows: readCsv("office_pairs.csv").map((r) => ({
        from_office: r.from_office, to_office: r.to_office, days: Number(r.days),
        sample_from_zip: nullIfEmpty(r.sample_from_zip), sample_to_zip: nullIfEmpty(r.sample_to_zip), fetched_at: r.fetched_at,
      })),
    },
    {
      table: "sagawa_lead_times",
      onConflict: "from_zip,to_zip",
      rows: readCsv("zip_pairs.csv").map((r) => ({
        from_zip: r.from_zip, to_zip: r.to_zip, from_office: nullIfEmpty(r.from_office), to_office: nullIfEmpty(r.to_office),
        days: Number(r.days), source: r.source, fetched_at: r.fetched_at,
      })),
    },
  ]

  for (const t of tables) {
    for (let i = 0; i < t.rows.length; i += BATCH) {
      const { error } = await sb.from(t.table).upsert(t.rows.slice(i, i + BATCH), { onConflict: t.onConflict })
      if (error) throw new Error(`${t.table} [${i}..]: ${error.message}`)
    }
    const { count, error } = await sb.from(t.table).select("*", { count: "exact", head: true })
    if (error) throw new Error(`${t.table} count: ${error.message}`)
    console.log(`${t.table}: CSV ${t.rows.length} 行 → テーブル ${count} 行`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
