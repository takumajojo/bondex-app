/**
 * 入口の URL（/book/<token>）の発行（P0-2・2026-11-07）。**DB には接続しない**: URL と、DB に入れる SQL（token の sha256 だけ）を出すだけ。
 * SQL を流すのは承認の後（staging は scripts/staging/apply.sh と同じ確認の印つき・本番は本番の移行の手順）。
 *
 * 使い方:
 *   npx tsx scripts/b2c-entry-link/issue.ts --referrer HANKYU --name 阪急交通社 --name-en "Hankyu Travel" \
 *     --expires 2027-03-31 --site https://bondex.express --target production
 *   E2E の試験用（後で scripts/staging/cleanup-e2e.sh が紹介元のコードで消す）:
 *   npx tsx scripts/b2c-entry-link/issue.ts --referrer E2E1107A --name "E2E試験" --expires 2026-11-14 --site <Preview の URL> --target staging
 *   停止（URL を無効にする）の SQL だけ: --disable --referrer HANKYU --target production（その紹介元の有効な入口をすべて止める）
 *
 * 一般公開との切り替え: 紹介元ごとに入口を分ける。一般公開は紹介元 DIRECT の入口を発行して公開し、止める時は --disable。
 * 阪急の入口と一般公開の入口は別の行なので、片方だけを止められる。料金は紹介元によらず同じ（lib/b2c/pricing.ts）。
 * 出力の URL は「知っている人は誰でも予約を始められる」鍵。チャット・GitHub・資料に貼らない。漏れたら --disable で止めて発行し直す。
 */
import crypto from "node:crypto"
import { generateEntryToken, parseEntryToken, REFERRER_CODE_RE } from "../../lib/b2c/entry-link"

const STAGING_SYSID = "7702071863184491885"
const PROD_SYSID = "7642734024280108049"
const STAGING_REF = "oeucjrmuigtfnwowvzwr"

export interface IssueArgs { referrer: string; name?: string; nameEn?: string; expires?: string; site?: string; target: "staging" | "production" | "local"; disable?: boolean }

export function parseArgs(argv: string[]): IssueArgs {
  const a: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (!k.startsWith("--")) throw new Error(`unexpected argument: ${k}`)
    const key = k.slice(2)
    if (key === "disable") { a.disable = true; continue }
    const v = argv[++i]
    if (v === undefined || v.startsWith("--")) throw new Error(`missing value for ${k}`)
    a[key] = v
  }
  const target = a.target
  if (target !== "staging" && target !== "production" && target !== "local") throw new Error("--target staging|production|local is required")
  return { referrer: String(a.referrer ?? ""), name: a.name as string | undefined, nameEn: a["name-en"] as string | undefined, expires: a.expires as string | undefined, site: a.site as string | undefined, target, disable: a.disable === true }
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`

/** 流す先の DB を確かめる文（同じトランザクションの先頭）。staging = 試験環境の番号と印・本番 = 本番の番号で印が無い。 */
export function guardSql(target: IssueArgs["target"]): string {
  if (target === "local") return "-- local: 確認なし（ローカルの開発の DB だけ）"
  if (target === "staging") {
    return `do $g$ begin if (select system_identifier from pg_control_system())::text <> '${STAGING_SYSID}' then raise exception 'STOP: 試験環境の DB ではありません'; end if; if to_regclass('staging_guard.marker') is null or not exists (select 1 from staging_guard.marker where ref = '${STAGING_REF}') then raise exception 'STOP: 試験環境の印がありません'; end if; end $g$;`
  }
  return `do $g$ begin if (select system_identifier from pg_control_system())::text <> '${PROD_SYSID}' then raise exception 'STOP: 本番の DB ではありません'; end if; if to_regclass('staging_guard.marker') is not null then raise exception 'STOP: 試験環境の印があります（本番ではない）'; end if; end $g$;`
}

export function validateSite(site: string | undefined, target: IssueArgs["target"]): string {
  if (!site) throw new Error("--site is required (例: https://bondex.express)")
  let u: URL
  try { u = new URL(site) } catch { throw new Error("--site is not a URL") }
  if (u.hostname.endsWith(".invalid")) throw new Error("--site: .invalid の URL では発行しない（Preview の実際の URL を使う）")
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1"
  if (u.protocol !== "https:" && !local) throw new Error("--site must be https")
  if (target === "production" && u.hostname !== "bondex.express") throw new Error("--target production の URL は https://bondex.express だけ")
  if (target !== "production" && u.hostname === "bondex.express") throw new Error("本番の URL を staging・local の入口に使わない")
  if (u.pathname !== "/" || u.search || u.hash) throw new Error("--site はオリジンだけ（パス・クエリなし）")
  return u.origin
}

export function validateExpiry(expires: string | undefined, now: Date = new Date()): string | null {
  if (!expires) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) throw new Error("--expires must be YYYY-MM-DD")
  const end = Date.parse(`${expires}T23:59:59.999+09:00`)
  if (Number.isNaN(end) || new Date(`${expires}T00:00:00Z`).toISOString().slice(0, 10) !== expires) throw new Error("--expires is not a real date")
  if (end <= now.getTime()) throw new Error("--expires は今日以降")
  if (end - now.getTime() > 400 * 86400_000) throw new Error("--expires は 400日以内（長い期限の URL を作らない）")
  return expires
}

export function buildIssue(args: IssueArgs, now: Date = new Date()) {
  if (!REFERRER_CODE_RE.test(args.referrer)) throw new Error("--referrer は英大文字・数字の 3〜16文字（例: HANKYU）")
  if (args.disable) {
    return {
      url: null as string | null,
      sql: [
        "begin;", guardSql(args.target),
        `update public.b2c_entry_links set status = 'disabled', disabled_at = now() where referrer_code = ${lit(args.referrer)} and status = 'active';`,
        "commit;",
      ].join("\n"),
    }
  }
  const name = (args.name ?? "").trim()
  if (!name || name.length > 80) throw new Error("--name（紹介元の表示名・80文字まで）が必要")
  const nameEn = (args.nameEn ?? "").trim().slice(0, 80) || null
  const site = validateSite(args.site, args.target)
  const expires = validateExpiry(args.expires, now)
  if (args.referrer.startsWith("E2E") && (args.target === "production" || !expires)) throw new Error("E2E の入口は staging・local だけ、期限つきで発行する")
  const token = generateEntryToken(expires)
  if (!parseEntryToken(token).ok) throw new Error("internal: token shape")
  const hash = crypto.createHash("sha256").update(token).digest("hex")
  return {
    url: `${site}/book/${token}`,
    sql: [
      "begin;", guardSql(args.target),
      `insert into public.b2c_entry_links(referrer_code, referrer_name, referrer_name_en, token_hash) values (${lit(args.referrer)}, ${lit(name)}, ${nameEn ? lit(nameEn) : "null"}, '${hash}');`,
      "commit;",
    ].join("\n"),
    hash,
    expires,
  }
}

if (process.argv[1] && /issue\.ts$/.test(process.argv[1])) {
  try {
    const r = buildIssue(parseArgs(process.argv.slice(2)))
    if (r.url) {
      console.log("== 入口の URL（この画面にだけ出します。チャット・GitHub・資料に貼らない）")
      console.log(`英語: ${r.url}`)
      console.log(`日本語: ${r.url}?lang=ja`)
      console.log("")
    }
    console.log("== DB に流す SQL（token のハッシュだけ。流すのは承認の後）")
    console.log(r.sql)
  } catch (e) {
    console.error(`STOP: ${(e as Error).message}`)
    process.exit(1)
  }
}
