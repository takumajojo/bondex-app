/**
 * 結合テスト (npx tsx scripts/tracking-reconcile-integ.ts)。
 *
 * 実際に reconcileTrackingNow() を動かし、フェイク Supabase + モック provider +
 * メール捕捉 (MAIL_TEST_CAPTURE) で、次を確認する:
 *   - 複数番号の一部取得失敗 → leg を delivered にしない (確認漏れ防止)
 *   - 全番号 delivered → 配送完了へ更新 + お客様へ完了メール1回 + delivered_notified_at 記録
 *   - 再実行 (再送相当) → 二重で完了メールを送らない (重複防止)
 *
 * 本番の顧客メールは送らず、送信フロー(宛先・冪等キー)だけを捕捉して検証する。
 */
process.env.MAIL_TEST_CAPTURE = "1"

import { reconcileTrackingNow } from "../lib/tracking/reconcile"
import type { TrackingProvider, TrackingResult } from "../lib/tracking/types"

type Row = Record<string, unknown>
type Store = { shipments: Row[]; agencies: Row[]; agency_emails: Row[] }

function match(rows: Row[], filters: Array<[string, string, unknown]>): Row[] {
  return rows.filter((r) =>
    filters.every(([op, c, v]) => (op === "is" ? (v === null ? r[c] == null : r[c] === v) : r[c] === v)),
  )
}
// reconcile が使う最小の chainable/thenable Supabase もどき。
function makeFakeSb(store: Store) {
  function from(name: keyof Store) {
    const rows = store[name]
    const filters: Array<[string, string, unknown]> = []
    let updateData: Row | null = null
    const self: Record<string, unknown> = {
      select: () => self,
      insert: () => self,
      order: () => self,
      update: (d: Row) => {
        updateData = d
        return self
      },
      eq: (c: string, v: unknown) => {
        filters.push(["eq", c, v])
        return self
      },
      is: (c: string, v: unknown) => {
        filters.push(["is", c, v])
        return self
      },
      maybeSingle: () => {
        const r = match(rows, filters)[0] ?? null
        return Promise.resolve({ data: r ? { ...r } : null, error: null })
      },
      then: (resolve: (v: { data: Row[]; error: null }) => void) => {
        const matched = match(rows, filters)
        if (updateData) matched.forEach((r) => Object.assign(r, updateData))
        resolve({ data: matched.map((r) => ({ ...r })), error: null })
      },
    }
    return self
  }
  return { from } as unknown as Parameters<typeof reconcileTrackingNow>[0]
}

const mockProvider = (map: Record<string, TrackingResult>): TrackingProvider => ({
  name: "mock",
  async fetchOne(_carrier, num) {
    return map[num] ?? { number: num, noData: true, status: null, exception: null }
  },
})
const delivered = (n: string): TrackingResult => ({ number: n, noData: false, status: "delivered", exception: null, deliveredAt: "2026-11-11T02:00:00Z" })
const noData = (n: string): TrackingResult => ({ number: n, noData: true, status: null, exception: null })

let fail = 0
const check = (name: string, cond: boolean, d = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`)
  if (!cond) fail++
}
const caps = (): Array<Record<string, unknown>> =>
  ((globalThis as unknown as { __capturedMails?: Array<Record<string, unknown>> }).__capturedMails ?? [])
const resetCaps = () => ((globalThis as unknown as { __capturedMails: unknown[] }).__capturedMails = [])

async function main() {
  const store: Store = {
    shipments: [
      {
        id: "s1", booking_id: "BDX-TEST01", leg_index: 0, agency: "T Agency", status: "in_transit", carrier: "sagawa",
        representative: "Taro", tracking_numbers: ["N1", "N2"], tracking_detail: [], tracking_limit_reached: false,
        delivered_notified_at: null, delivered_at: null, shipment_date: "2026-11-10",
        from_hotel: "A Hotel", to_hotel: "B Hotel", from_hotel_en: null, to_hotel_en: null,
        from_residence: null, to_residence: null, tour_number: null,
      },
    ],
    agencies: [{ id: "a1", name: "T Agency", contact_email: "ops@test.example", contact_person: "PIC", locale: "ja" }],
    agency_emails: [],
  }
  const sb = makeFakeSb(store)
  const S = () => store.shipments[0]

  // 1) 複数番号の一部取得失敗: N1=delivered, N2=noData → leg は delivered にしない
  resetCaps()
  await reconcileTrackingNow(sb, "s1", mockProvider({ N1: delivered("N1"), N2: noData("N2") }))
  check("複数番号 一部失敗: leg は delivered にならない", S().status !== "delivered", `status=${S().status}`)
  check("一部失敗: 完了メールを送らない", caps().length === 0)
  check("一部失敗: 回数は消費して記録 (N1)", Array.isArray(S().tracking_detail) && (S().tracking_detail as Row[]).some((d) => d.number === "N1" && d.queryCount === 1))

  // 2) 全番号 delivered → 配送完了へ更新 + 完了メール1通 + notified 記録 + 冪等キー
  resetCaps()
  await reconcileTrackingNow(sb, "s1", mockProvider({ N1: delivered("N1"), N2: delivered("N2") }))
  check("全番号 delivered: leg=delivered", S().status === "delivered")
  check("完了メール 1通送信", caps().length === 1, `sent=${caps().length}`)
  check("delivered_notified_at を記録", S().delivered_notified_at != null)
  check("冪等キー付き (delivered-BDX-TEST01-L1)", String(caps()[0]?.idempotencyKey ?? "").startsWith("delivered-BDX-TEST01-L1"))

  // 3) 再実行 (再送相当): 終端 delivered なので照会せず、完了メールは重複しない
  resetCaps()
  const r3 = await reconcileTrackingNow(sb, "s1", mockProvider({ N1: delivered("N1"), N2: delivered("N2") }))
  check("再実行: 二重で完了メールを送らない", caps().length === 0, r3.note)

  console.log(`\n${fail === 0 ? "✅ INTEG ALL PASS" : "❌ " + fail + " FAILED"}`)
  process.exit(fail === 0 ? 0 : 1)
}
void main()
