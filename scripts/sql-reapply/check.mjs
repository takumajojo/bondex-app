// 移行の SQL を「もう一度流してよいか」を、ファイルの中身から判定する (2026-11-07 監査 B-09)。DB には触れない。
//   node scripts/sql-reapply/check.mjs                 → 全ファイルの一覧 (後の番号で上書きされる関数・トリガー)
//   node scripts/sql-reapply/check.mjs sql/074_...sql  → そのファイルを流し直す時に、続けて流し直すべき後のファイル。
//                                                       上書きされる部品があれば終了コード 2 (単独で流してはいけない)
// 考え方: create or replace function / create trigger は「最後に流したファイルの定義」が残る。古いファイルを
// 単独で流し直すと、後のファイルで直した定義 (例: 079 の no_card_consent) が黙って古い版に戻る。
import { readFileSync, readdirSync } from "node:fs"
import { join, basename, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const repo = join(dirname(fileURLToPath(import.meta.url)), "../..")
const files = readdirSync(join(repo, "sql")).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()
const defs = new Map() // 部品 → [ファイル...]
const perFile = new Map()
const dmlPerFile = new Map() // ファイル → データを書き換える文 (関数の本体の外)
for (const f of files) {
  const src = readFileSync(join(repo, "sql", f), "utf8").replace(/--[^\n]*/g, "")
  const objs = new Set()
  for (const m of src.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?("?[\w]+"?)\s*\(/gi)) objs.add(`function ${m[1].replace(/"/g, "").toLowerCase()}`)
  for (const m of src.matchAll(/create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+("?[\w]+"?)/gi)) objs.add(`trigger ${m[1].replace(/"/g, "").toLowerCase()}`)
  for (const m of src.matchAll(/create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?("?[\w]+"?)/gi)) objs.add(`view ${m[1].replace(/"/g, "").toLowerCase()}`)
  perFile.set(f, objs)
  // 関数の本体 ($$ … $$・$tag$ … $tag$) の外にある、データを書き換える文 (流し直すと既存の行を変えうる)
  const outside = src.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, " ")
  const dml = [...outside.matchAll(/(?:^|;)\s*(update\s+(?:public\.)?\w+|insert\s+into\s+(?:public\.)?\w+|delete\s+from\s+(?:public\.)?\w+)/gi)].map((m) => m[1].replace(/\s+/g, " ").toLowerCase())
  dmlPerFile.set(f, [...new Set(dml)])
  for (const o of objs) defs.set(o, [...(defs.get(o) ?? []), f])
}
function superseded(f) {
  const out = new Map() // 後のファイル → [部品]
  for (const o of perFile.get(f) ?? []) {
    for (const later of defs.get(o).filter((x) => x > f)) out.set(later, [...(out.get(later) ?? []), o])
  }
  return out
}
const target = process.argv[2]
if (target) {
  const f = basename(target)
  if (!perFile.has(f)) { console.error(`sql/ に無いファイルです: ${target}`); process.exit(1) }
  const s = superseded(f)
  const dml = dmlPerFile.get(f)
  if (dml.length) console.log(`${f}: データを書き換える文がある (流し直すと既存の行を変えうる。条件で守られているか中身を確かめる): ${dml.join(" / ")}`)
  if (!s.size) { console.log(`${f}: 後のファイルで上書きされる関数・トリガーは無い (このファイルの部品だけで見れば、流し直しても新しい定義を消さない)`); process.exit(0) }
  console.log(`${f} を流し直すと、次の部品が古い定義に戻る。続けて、番号の順に次のファイルを流し直すこと:`)
  for (const [later, objs] of [...s].sort()) console.log(`  ${later}  (${objs.join(", ")})`)
  process.exit(2)
}
console.log("ファイル | 後で上書きされる部品の数 | 続けて流し直すファイル | データを書き換える文")
for (const f of files) {
  const s = superseded(f)
  const dml = dmlPerFile.get(f)
  if (s.size || dml.length) console.log(`${f} | ${[...s.values()].flat().length} | ${[...s.keys()].sort().join(", ") || "-"} | ${dml.join(" / ") || "-"}`)
}
