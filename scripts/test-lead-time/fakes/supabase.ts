// テスト用のインメモリ Supabase。本番 DB には触れない。
// 対応: from(t).select().eq().in().lt().order().limit().maybeSingle() / upsert / update / insert
type Row = Record<string, unknown>
export const TABLES: Record<string, Row[]> = {}
export const CALLS: Array<{ table: string; op: string; filters: Array<[string, string, unknown]> }> = []
const PK: Record<string, string[]> = {
  sagawa_lead_times: ["from_zip", "to_zip"],
  sagawa_zip_offices: ["zip"],
  sagawa_office_lead_times: ["from_office", "to_office"],
}
export function resetTables(init: Record<string, Row[]> = {}) {
  for (const k of Object.keys(TABLES)) delete TABLES[k]
  for (const [k, v] of Object.entries(init)) TABLES[k] = v.map((r) => ({ ...r }))
  CALLS.length = 0
}
class B {
  private op = "select"
  private payload: Row | null = null
  private filters: Array<[string, string, unknown]> = []
  private single = false
  private lim = Infinity
  constructor(private t: string) {}
  select() { return this }
  update(p: Row) { this.op = "update"; this.payload = p; return this }
  insert(p: Row) { this.op = "insert"; this.payload = p; return this }
  upsert(p: Row) { this.op = "upsert"; this.payload = p; return this }
  delete() { this.op = "delete"; return this }
  eq(c: string, v: unknown) { this.filters.push(["eq", c, v]); return this }
  in(c: string, v: unknown[]) { this.filters.push(["in", c, v]); return this }
  lt(c: string, v: unknown) { this.filters.push(["lt", c, v]); return this }
  is() { return this }
  or() { return this }
  order() { return this }
  limit(n: number) { this.lim = n; return this }
  maybeSingle() { this.single = true; return this }
  private match(r: Row) {
    return this.filters.every(([op, c, v]) =>
      op === "eq" ? r[c] === v : op === "in" ? (v as unknown[]).includes(r[c]) : String(r[c]) < String(v),
    )
  }
  then(res: (v: unknown) => void) {
    CALLS.push({ table: this.t, op: this.op, filters: this.filters })
    const rows = (TABLES[this.t] ??= [])
    if (this.op === "upsert") {
      const pk = PK[this.t] ?? ["id"]
      const hit = rows.find((r) => pk.every((k) => r[k] === this.payload![k]))
      if (hit) Object.assign(hit, this.payload)
      else rows.push({ ...this.payload })
      return res({ data: null, error: null })
    }
    if (this.op === "insert") { rows.push({ ...this.payload }); return res({ data: null, error: null }) }
    const found = rows.filter((r) => this.match(r)).slice(0, this.lim)
    if (this.op === "update") { found.forEach((r) => Object.assign(r, this.payload)); return res({ data: found, error: null }) }
    if (this.op === "delete") return res({ data: null, error: null })
    return res({ data: this.single ? (found[0] ?? null) : found, error: null })
  }
}
export const getSupabase = () => ({ from: (t: string) => new B(t) })
export const isSupabaseConfigured = () => true
