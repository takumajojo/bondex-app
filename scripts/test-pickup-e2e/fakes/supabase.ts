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
  await db.exec(`
  create role anon; create role authenticated;
  create table shipments (id uuid primary key default gen_random_uuid(), booking_id text not null, leg_index integer not null default 0, agency text not null default 'T', representative text not null default 'TEST GUEST', traveler_count integer, booking_name text, shipment_date date not null, expected_arrival date not null, from_hotel text not null, from_city text, from_place_id text, from_check_in date, to_hotel text not null, to_city text, to_place_id text, to_check_out date, recipient text not null default 'X', suitcase_count integer default 1, amount_yen integer, tracking_numbers jsonb, label_url text, issuable_from date, ship_ref_number text, status text default 'requested', error_message text, notes text, created_at timestamptz default now(), updated_at timestamptz default now(), tour_number text, group_name text, tracking_detail jsonb, guest_language text, pickup_alert_sent_at timestamptz, drive_url text, delivery_time text, carrier text default 'sagawa', note_target text, from_hotel_en text, to_hotel_en text, charged_at timestamptz, stripe_payment_intent_id text, charge_amount_yen integer, charge_error text, from_residence jsonb, to_residence jsonb, item_type text, count_change_log jsonb, pickup_hotel_notified_at timestamptz, guest_hotel_notified_at timestamptz, booking_type text, tour_leader_name text, tour_leader_phone text, tour_leader_whatsapp text, is_addition boolean, addition_note text, stripe_checkout_session_id text, stripe_checkout_url text, from_prefecture text, from_hotel_ja text, to_prefecture text, to_hotel_ja text, refunded_at timestamptz, refund_amount_yen integer, disputed_at timestamptz, dispute_status text, payment_failed_at timestamptz, payment_failure_message text, label_to text, label_split boolean, label_sender text, label_sender_info jsonb, label_sent_at timestamptz, label_mail_due date, issue_claimed_at timestamptz, hotel_contact_info jsonb, change_deadline_at timestamptz, picked_up_at timestamptz, pickup_ack_at timestamptz, pickup_requested_at timestamptz, delivered_at timestamptz, origin_check_in date, delivery_overdue_alerted_at timestamptz, cancelled_at timestamptz, cancelled_by text, cancel_source text, pickup_time text, sagawa_cost_actual_yen integer, delivered_notified_at timestamptz, tracking_limit_reached boolean, unique (booking_id, leg_index));
  create table shipment_hotel_changes (id uuid primary key default gen_random_uuid(), shipment_id uuid not null, booking_id text not null, leg_index integer not null, side text not null, old_hotel text, new_hotel text, old_hotel_ja text, new_hotel_ja text, old_place_id text, new_place_id text, over_deadline boolean, reason text, old_slip_task boolean, changed_by text, agency text, changed_at timestamptz default now(), old_hotel_cancel_task boolean);
  `)
  await db.exec(readFileSync(`${repo}/sql/062_pickup_requests.sql`, "utf8"))
  await db.exec(readFileSync(`${repo}/sql/063_fix_hotel_change_tracking_column.sql`, "utf8"))
}

const jsonCol = (v: unknown) => v !== null && typeof v === "object" && !(v instanceof Date)

class Query {
  private op: "select" | "update" = "select"
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
    if (this.op === "update") this.returning = true
    this.cols = cols
    return this
  }
  update(p: Row) {
    this.op = "update"
    this.payload = p
    return this
  }
  eq(c: string, v: unknown) { this.where.push(`${c} = ${this.p(v)}`); return this }
  neq(c: string, v: unknown) { this.where.push(`${c} <> ${this.p(v)}`); return this }
  gte(c: string, v: unknown) { this.where.push(`${c} >= ${this.p(v)}`); return this }
  lte(c: string, v: unknown) { this.where.push(`${c} <= ${this.p(v)}`); return this }
  lt(c: string, v: unknown) { this.where.push(`${c} < ${this.p(v)}`); return this }
  in(c: string, arr: unknown[]) { this.where.push(`${c}::text = any(${this.p(arr.map(String))}::text[])`); return this }
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

const client = {
  from: (t: string) => new Query(t),
  async rpc(name: string, params: Row) {
    try {
      hooks.beforeRpc?.(name, params)
      const keys = Object.keys(params)
      const vals = keys.map((k) => {
        const v = params[k]
        if (k === "p_from_states") return v // text[]
        return jsonCol(v) ? JSON.stringify(v) : v
      })
      const args = keys.map((k, i) => `${k} := $${i + 1}${jsonCol(params[k]) && k !== "p_from_states" ? "::jsonb" : ""}`)
      const r = await db.query(`select * from ${name}(${args.join(", ")})`, vals)
      return { data: r.rows, error: null }
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
    }
  },
}

export const getSupabase = () => client
export const isSupabaseConfigured = () => true
