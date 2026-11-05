/**
 * 未集荷の通知（lib/pickup-request/pickup-miss.ts）の初回の一斉送信の防止の試験（2026-11-06 監査）。DB・外部には接続しない。
 * 追跡の一時停止の間に集荷前のまま残った古い区間（pickup_alert_sent_at が空）に、初回の実行で運営と代理店へ一斉に送らないこと。
 *   実行: npx tsx --tsconfig scripts/test-b2c/tsconfig.json scripts/test-pickup-miss/lookback.ts
 */
import assert from "node:assert/strict"
import { alertPickupMisses, PICKUP_MISS_LOOKBACK_DAYS } from "@/lib/pickup-request/pickup-miss"
import type { OpsAlertInput } from "@/lib/ops-alert"

type Row = Record<string, unknown>
const NOW = new Date("2026-11-06T10:00:00Z") // 19:00 JST
const leg = (id: string, date: string, agency = "Old Agency"): Row => ({ id, booking_id: `BK-${id}`, leg_index: 0, agency, representative: "R", recipient: "R", shipment_date: date, status: "issued", from_hotel: "H", from_residence: null, to_hotel: "H2", to_residence: null, tracking_numbers: null, pickup_alert_sent_at: null })
const rows: Row[] = [leg("today", "2026-11-06"), leg("d1", "2026-11-05"), leg("d3", "2026-11-03"), leg("d4", "2026-11-02"), leg("old", "2026-09-30"), leg("older", "2026-07-01")]

// supabase の select・update の連鎖のうち、この関数が使う形だけを実装した偽物（条件を実際に当てる）
function fakeSb() {
  const q = (table: string) => {
    const conds: Array<(r: Row) => boolean> = []
    let patch: Row | null = null
    const api: Record<string, unknown> = {
      select: () => api,
      update: (p: Row) => ((patch = p), api),
      in: (c: string, v: unknown[]) => (conds.push((r) => v.includes(r[c])), api),
      lte: (c: string, v: string) => (conds.push((r) => String(r[c]) <= v), api),
      gte: (c: string, v: string) => (conds.push((r) => String(r[c]) >= v), api),
      eq: (c: string, v: unknown) => (conds.push((r) => r[c] === v), api),
      is: (c: string, v: unknown) => (conds.push((r) => (r[c] ?? null) === v), api),
      limit: () => api,
      then: (res: (v: unknown) => void) => {
        const src = table === "shipments" ? rows : []
        const hit = src.filter((r) => conds.every((f) => f(r)))
        if (patch) for (const r of hit) Object.assign(r, patch)
        res({ data: hit.map((r) => ({ ...r })), error: null })
      },
    }
    return api
  }
  return { from: q } as never
}

async function main() {
  const sent: OpsAlertInput[] = []
  const r = await alertPickupMisses(fakeSb(), async (i) => (sent.push(i), { emailSent: true, slackSent: false, errors: [] }), NOW)
  const ids = sent.map((s) => s.subject)
  assert.equal(PICKUP_MISS_LOOKBACK_DAYS, 3)
  assert.ok(ids.some((s) => s.includes("BK-today")) && ids.some((s) => s.includes("BK-d1")) && ids.some((s) => s.includes("BK-d3")), ids.join(" / "))
  console.log("  ok  今日（18:00 以降）・1日前・3日前の区間は通知する")
  assert.ok(!ids.some((s) => s.includes("BK-d4") || s.includes("BK-old") || s.includes("BK-older")), ids.join(" / "))
  console.log("  ok  4日より前の古い区間（追跡の停止の間に残ったもの）は、初回でも運営・代理店に送らない")
  assert.equal(r.alerted, 3)
  assert.ok(sent.every((s) => s.agencyEmail === null || s.agencyEmail === undefined), "代理店の主メールは agencies に無いので null")
  console.log("\n3 passed, 0 failed")
}
main().catch((e) => {
  console.error(e)
  console.log("\n1 failed")
  process.exit(1)
})
