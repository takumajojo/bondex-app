/**
 * 今の版の規約・同意の文言の本文を b2c_legal_documents（sql/079）に登録する SQL を標準出力に書く。DB には接続しない。
 *   npx tsx scripts/b2c-legal/register-docs.ts > /tmp/register.sql   → 中身を確かめてから、対象の DB で流す
 * - 同じ版・種類・言語の行が既にあれば入れない（on conflict do nothing）。その上で、入っている本文の SHA-256 が
 *   今のファイルと一致するかを確かめ、違えば止める（公開した版の本文を黙って変えない。変えるなら版を上げる）。
 * - 本番に流すのは、規約を確定して版の名前を変え、公開の承認を受けた後だけ（docs/b2c/legal/05_pre_publication_checklist.md）。
 */
import { randomBytes } from "node:crypto"
import { currentB2cLegalDocuments } from "@/lib/b2c/legal"

const docs = currentB2cLegalDocuments()
const lit = (s: string) => {
  const tag = `b2c_${randomBytes(6).toString("hex")}`
  if (s.includes(`$${tag}$`)) throw new Error("tag collision")
  return `$${tag}$${s}$${tag}$`
}
const out: string[] = ["-- scripts/b2c-legal/register-docs.ts が作成。b2c_legal_documents への登録（追記だけ）", "begin;"]
for (const d of docs) {
  out.push(
    `insert into public.b2c_legal_documents (version, kind, lang, body, sha256) values (${lit(d.version)}, '${d.kind}', '${d.lang}', ${lit(d.body)}, '${d.sha256}') on conflict (version, kind, lang) do nothing;`,
  )
}
out.push("do $$ begin")
for (const d of docs) {
  out.push(
    `  if (select sha256 from public.b2c_legal_documents where version = ${lit(d.version)} and kind = '${d.kind}' and lang = '${d.lang}') is distinct from '${d.sha256}' then raise exception '本文が登録済みの版と違います: % % %', ${lit(d.version)}, '${d.kind}', '${d.lang}'; end if;`,
  )
}
out.push("end $$;", "commit;")
console.log(out.join("\n"))
console.error(`[register-docs] ${docs.length} 行（版 ${[...new Set(docs.map((d) => d.version))].join(", ")}）`)
