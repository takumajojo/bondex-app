import { DB } from "./db"
class B {
  private op = "select"
  private payload: Record<string, unknown> | null = null
  constructor(private t: string) {}
  select() { return this }
  update(p: Record<string, unknown>) { this.op = "update"; this.payload = p; return this }
  insert(p: Record<string, unknown>) { this.op = "insert"; this.payload = p; return this }
  eq() { return this }
  in() { return this }
  is() { return this }
  maybeSingle() { return this }
  then(res: (v: unknown) => void) {
    if (this.t === "agencies") {
      if (DB.agencyError) return res({ data: null, error: { message: "boom" } })
      return res({ data: { name: DB.shipment.agency, unit_price_yen: DB.unitPrice }, error: null })
    }
    if (this.t === "shipments" && this.op === "update") {
      DB.updates.push(this.payload!)
      Object.assign(DB.shipment, this.payload)
      return res({ data: [{ id: DB.shipment.id }], error: null })
    }
    if (this.t === "shipment_change_requests" && this.op === "insert") {
      DB.audits.push(this.payload!)
      return res({ data: null, error: null })
    }
    return res({ data: null, error: null })
  }
}
export const getSupabase = () => ({ from: (t: string) => new B(t) })
export const isSupabaseConfigured = () => true
