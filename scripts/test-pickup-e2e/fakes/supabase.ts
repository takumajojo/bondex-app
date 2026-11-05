// Supabase クライアントの偽物: 組み込み PostgreSQL (PGlite) に SQL として流す。本番・Supabase には触れない。
// 使う範囲 (select/eq/neq/in/is/gte/lte/lt/or/order/limit/maybeSingle/update/rpc) だけを実装する。
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"

type Row = Record<string, unknown>
// PGlite はリポジトリの依存に入れていない。PGLITE_DIR (npm i @electric-sql/pglite 済みのディレクトリ) から読む。
const req = createRequire((process.env.PGLITE_DIR ?? process.cwd()) + "/")
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { PGlite } = req(req.resolve("@electric-sql/pglite")) as any

// 日付・時刻は Supabase と同じく文字列で返す
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db: any = new PGlite({ parsers: { 1082: (v: string) => v, 1114: (v: string) => v, 1184: (v: string) => v } })

/** 試験から差し込む: RPC の前に呼ばれ、例外を投げると DB エラーとして返る (保存失敗の再現)。 */
export const hooks: { beforeRpc: null | ((name: string, params: Row) => void) } = { beforeRpc: null }

export async function initSchema(repo: string) {
  // 本番 shipments の列構成 (2026-11-03 information_schema) に、既定値を検証に必要な分だけ付けたもの
  await db.exec(`create role anon; create role authenticated; create role service_role;`)
  await db.exec(readFileSync(`${repo}/scripts/test-pickup-e2e/schema-base.sql`, "utf8"))
  await db.exec(readFileSync(`${repo}/sql/043_shipment_change_requests.sql`, "utf8"))
  await db.exec(readFileSync(`${repo}/sql/067_pickup_requests.sql`, "utf8"))
  await db.exec(readFileSync(`${repo}/sql/063_fix_hotel_change_tracking_column.sql`, "utf8"))
  await db.exec(readFileSync(`${repo}/sql/068_change_requests_pickup_lock.sql`, "utf8"))
  await db.exec(readFileSync(`${repo}/sql/069_facilities.sql`, "utf8"))
  // 本番移行の最後の段 (ロック有効化・集荷依頼の記録の再開)。068 はロックを無効で作るので、ここで有効にする
  await db.exec(readFileSync(`${repo}/sql/072_enable_pickup_lock.sql`, "utf8"))
  await db.exec(readFileSync(`${repo}/sql/075_pickup_watch_alerts.sql`, "utf8"))
  await db.exec(readFileSync(`${repo}/sql/076_agency_change_atomic.sql`, "utf8"))
  await db.exec(readFileSync(`${repo}/sql/078_pickup_customer_numbering.sql`, "utf8"))
  // Biz-Logi の確保で変更申請・印を DB でも拒否する (2026-11-07 監査 B-14・B-01)
  await db.exec(readFileSync(`${repo}/sql/083_claim_pickup_guards.sql`, "utf8"))
  // B2C の区間の見分け (本番は sql/061 で足す列。B2B のコードは読まない)
  await db.exec(`alter table shipments add column if not exists channel text not null default 'b2b'`)
  // 集荷元のチェックアウト日 (本番は sql/054 が未適用のため、sql/081 で足す想定)
  await db.exec(`alter table shipments add column if not exists origin_check_out date`)
  // 佐川の配送日数の表 (送信前の配送日数の照合で読む・2026-11-06)
  await db.exec(readFileSync(`${repo}/sql/058_sagawa_lead_times.sql`, "utf8"))
}

const jsonCol = (v: unknown) => v !== null && typeof v === "object" && !(v instanceof Date)

class Query {
  private op: "select" | "update" | "insert" | "delete" = "select"
  private cols = "*"
  private where: string[] = []
  private params: unknown[] = []
  private orders: string[] = []
  private lim: number | null = null
  private single = false
  private payload: Row | null = null
  private returning = false
  constructor(private table: string) {}
  private p(v: unknown) {
    this.params.push(v)
    return `$${this.params.length}`
  }
  select(cols = "*") {
    if (this.op === "update" || this.op === "insert") this.returning = true
    this.cols = cols
    return this
  }
  update(p: Row) {
    this.op = "update"
    this.payload = p
    return this
  }
  insert(p: Row) {
    this.op = "insert"
    this.payload = p
    return this
  }
  delete() {
    this.op = "delete"
    return this
  }
  eq(c: string, v: unknown) { this.where.push(`${c} = ${this.p(v)}`); return this }
  neq(c: string, v: unknown) { this.where.push(`${c} <> ${this.p(v)}`); return this }
  gte(c: string, v: unknown) { this.where.push(`${c} >= ${this.p(v)}`); return this }
  lte(c: string, v: unknown) { this.where.push(`${c} <= ${this.p(v)}`); return this }
  lt(c: string, v: unknown) { this.where.push(`${c} < ${this.p(v)}`); return this }
  in(c: string, arr: unknown[]) { this.where.push(`${c}::text = any(${this.p(arr.map(String))}::text[])`); return this }
  not(c: string, op: string, v: unknown) {
    if (op === "in") {
      const list = String(v).replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""))
      this.where.push(`not (${c}::text = any(${this.p(list)}::text[]))`)
    } else if (op === "is") this.where.push(v === null ? `${c} is not null` : `${c} is not ${v ? "true" : "false"}`)
    else throw new Error(`fake: not(${op}) 未対応`)
    return this
  }
  is(c: string, v: unknown) { this.where.push(v === null ? `${c} is null` : `${c} is ${v ? "true" : "false"}`); return this }
  or(expr: string) {
    const parts = expr.split(",").map((t) => {
      const [c, op, ...rest] = t.split(".")
      const v = rest.join(".")
      if (op === "is" && v === "null") return `${c} is null`
      const sym: Record<string, string> = { eq: "=", gte: ">=", lte: "<=", lt: "<", gt: ">" }
      if (!sym[op]) throw new Error(`or: 未対応の演算子 ${op}`)
      return `${c} ${sym[op]} ${this.p(v)}`
    })
    this.where.push(`(${parts.join(" or ")})`)
    return this
  }
  order(c: string, o?: { ascending?: boolean }) { this.orders.push(`${c} ${o?.ascending === false ? "desc" : "asc"}`); return this }
  limit(n: number) { this.lim = n; return this }
  maybeSingle() { this.single = true; return this }
  then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
    this.exec().then(resolve, reject)
  }
  private async exec() {
    const w = this.where.length ? ` where ${this.where.join(" and ")}` : ""
    try {
      if (this.op === "insert") {
        const entries = Object.entries(this.payload ?? {})
        const cols = entries.map(([k]) => k).join(", ")
        const vals = entries.map(([, v]) => `${this.p(jsonCol(v) ? JSON.stringify(v) : v)}${jsonCol(v) ? "::jsonb" : ""}`).join(", ")
        const r = await db.query(`insert into ${this.table} (${cols}) values (${vals})${this.returning ? ` returning ${this.cols}` : ""}`, this.params)
        return { data: this.returning ? (this.single ? r.rows[0] : r.rows) : null, error: null }
      }
      if (this.op === "delete") {
        await db.query(`delete from ${this.table}${w}`, this.params)
        return { data: null, error: null }
      }
      if (this.op === "update") {
        const sets = Object.entries(this.payload ?? {}).map(([k, v]) => `${k} = ${this.p(jsonCol(v) ? JSON.stringify(v) : v)}${jsonCol(v) ? "::jsonb" : ""}`)
        const sql = `update ${this.table} set ${sets.join(", ")}${w}${this.returning ? ` returning ${this.cols}` : ""}`
        const r = await db.query(sql, this.params)
        return { data: this.returning ? r.rows : null, error: null }
      }
      const sql = `select ${this.cols} from ${this.table}${w}${this.orders.length ? ` order by ${this.orders.join(", ")}` : ""}${this.lim ? ` limit ${this.lim}` : ""}`
      const r = await db.query(sql, this.params)
      return { data: this.single ? (r.rows[0] ?? null) : r.rows, error: null }
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
    }
  }
}

/** 代理店ログインの代わり: Bearer AGENCY_TEST_TOKEN を代理店 T の利用者として扱う (試験専用)。 */
export const AGENCY_TEST_TOKEN = "agency-test-token"
const client = {
  from: (t: string) => new Query(t),
  auth: {
    async getUser(token: string) {
      return token === AGENCY_TEST_TOKEN
        ? { data: { user: { id: "00000000-0000-0000-0000-00000000a001" } }, error: null }
        : { data: { user: null }, error: { message: "invalid token" } }
    },
  },
  async rpc(name: string, params: Row) {
    try {
      hooks.beforeRpc?.(name, params)
      const keys = Object.keys(params)
      const vals = keys.map((k) => {
        const v = params[k]
        if (k === "p_from_states" || k === "p_keys") return v // text[]
        return jsonCol(v) ? JSON.stringify(v) : v
      })
      const args = keys.map((k, i) => `${k} := $${i + 1}${jsonCol(params[k]) && k !== "p_from_states" && k !== "p_keys" ? "::jsonb" : ""}`)
      const r = await db.query(`select * from ${name}(${args.join(", ")})`, vals)
      return { data: r.rows, error: null }
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
    }
  },
}

export const getSupabase = () => client
export const isSupabaseConfigured = () => true
