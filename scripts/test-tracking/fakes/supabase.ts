import { S, rec } from "./state"

// PostgREST クエリビルダの最小限の偽物。shipments の select はフィルタを実際に適用する。
class Builder {
  private filters: Array<(r: Record<string, unknown>) => boolean> = []
  private op: "select" | "update" | "delete" | "insert" = "select"
  private payload: Record<string, unknown> | null = null
  private wantsReturn = false
  constructor(private table: string) {}
  select(_cols?: string) {
    if (this.op === "update") this.wantsReturn = true
    return this
  }
  update(p: Record<string, unknown>) { this.op = "update"; this.payload = p; return this }
  delete() { this.op = "delete"; return this }
  insert(p: Record<string, unknown>) { this.op = "insert"; this.payload = p; return this }
  not(col: string, op: string, val: unknown) {
    if (this.table === "shipments") S.lastShipmentQuery.push(["not", col, op, val])
    if (op === "is") this.filters.push((r) => r[col] !== null && r[col] !== undefined)
    if (op === "in") {
      const set = String(val).replace(/[()"]/g, "").split(",")
      this.filters.push((r) => !set.includes(String(r[col])))
    }
    return this
  }
  eq(col: string, val: unknown) {
    if (this.table === "shipments") S.lastShipmentQuery.push(["eq", col, val])
    this.filters.push((r) => r[col] === val)
    return this
  }
  order() { return this }
  limit() { return this }
  maybeSingle() { return this }
  then(resolve: (v: unknown) => void) {
    resolve(this.exec())
  }
  private exec() {
    if (this.table !== "shipments") return { data: [], error: null }
    if (this.op === "update" && S.beforeUpdate) S.beforeUpdate()
    const rows = S.shipments.filter((r) => this.filters.every((f) => f(r)))
    if (this.op === "select") return { data: rows.map((r) => ({ ...r })), error: null }
    if (this.op === "update") {
      const hit = rows
      for (const r of hit) Object.assign(r, this.payload)
      rec("shipments.update", this.payload, hit.length)
      return { data: this.wantsReturn ? hit.map((r) => ({ id: r.id })) : null, error: null }
    }
    return { data: null, error: null }
  }
}
export const getSupabase = () => ({ from: (t: string) => new Builder(t) })
export const isSupabaseConfigured = () => true
