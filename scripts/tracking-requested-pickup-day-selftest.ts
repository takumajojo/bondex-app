/**
 * 回帰テスト (npx tsx scripts/tracking-requested-pickup-day-selftest.ts)。2026-11-03。
 *
 * Biz-Logi で集荷依頼した区間は、status が requested (または pending) のまま集荷前から問合番号を持つ。
 * lib/tracking/poll-policy.ts で requested/pending も「集荷前」として集荷日前の照会を止めた (Ship&co 15回枠の保護)。
 * この変更で次が壊れていないことを確かめる:
 *   1. 集荷日当日 (JST 8時〜) には照会対象へ戻る。照会の判定は issued と完全に同じ
 *   2. 集荷を検知したら requested → picked_up へ進み、picked_up_at・代理店への集荷メールが動く
 *   3. 配達完了まで進み、完了メールが1通・冪等キー付き
 *   4. 課金フックは「集荷以降に到達したか」だけで呼ばれ、元の status (requested/issued) に依存しない (コード確認)
 * フェイク Supabase + モック provider + メール捕捉 (MAIL_TEST_CAPTURE)。実送信・実課金なし。
 */
process.env.MAIL_TEST_CAPTURE = "1"
delete process.env.STRIPE_CHARGE_LIVE

import { readFileSync } from "node:fs"
import { reconcileTrackingNow } from "../lib/tracking/reconcile"
import { shouldQueryLeg, currentIntervalHours, type PollRow } from "../lib/tracking/poll-policy"
import type { TrackingProvider, TrackingResult } from "../lib/tracking/types"

type Row = Record<string, unknown>
type Store = { shipments: Row[]; agencies: Row[]; agency_emails: Row[] }
const AGENCY_EMAIL = "ops@test.example"

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
let fail = 0
const check = (name: string, cond: boolean, d = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`)
  if (!cond) fail++
}
const caps = (): Array<Record<string, unknown>> =>
  ((globalThis as unknown as { __capturedMails?: Array<Record<string, unknown>> }).__capturedMails ?? [])
const resetCaps = () => ((globalThis as unknown as { __capturedMails: unknown[] }).__capturedMails = [])
const jst = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00+09:00`)

async function main() {
  console.log("1. 照会の判定 (集荷日 2026-11-07・配達予定 11/08)")
  const row = (status: PollRow["status"]): PollRow => ({ status, shipment_date: "2026-11-07", expected_arrival: "2026-11-08" })
  const never = [{ lastCheckedAt: null, queryCount: 0 }]
  const times: Array<[string, string, boolean]> = [
    ["2026-11-05", "10:00", false], // 2日前
    ["2026-11-06", "19:00", false], // 前日 (依頼の締め前)
    ["2026-11-07", "07:59", false], // 当日・夜間ガード
    ["2026-11-07", "08:00", true], // 当日 8:00 から照会
    ["2026-11-07", "15:00", true],
    ["2026-11-07", "21:00", false], // 夜間ガード
    ["2026-11-08", "09:00", true], // 翌日も照会
  ]
  for (const [d, t, expected] of times) {
    const now = jst(d, t)
    const r = shouldQueryLeg(row("requested"), never, now)
    const p = shouldQueryLeg(row("pending"), never, now)
    const i = shouldQueryLeg(row("issued"), never, now)
    check(`${d} ${t}: requested=${expected}・pending/issued と同じ`, r === expected && p === i && r === i, `requested=${r} pending=${p} issued=${i}`)
  }
  const day = jst("2026-11-07", "16:30")
  const checkedAgo = (h: number) => [{ lastCheckedAt: new Date(day.getTime() - h * 3600_000).toISOString(), queryCount: 1 }]
  check("当日の照会間隔は issued と同じ8時間 (4h前に照会済み → まだ)", !shouldQueryLeg(row("requested"), checkedAgo(4), day) && !shouldQueryLeg(row("issued"), checkedAgo(4), day))
  check("8h以上経過 → 再照会 (issued と同じ)", shouldQueryLeg(row("requested"), checkedAgo(8.5), day) && shouldQueryLeg(row("issued"), checkedAgo(8.5), day))
  check("当日の間隔 = 8h (集荷フェーズ)", currentIntervalHours(row("requested"), day) === 8)
  check("15回上限に達した番号は requested でも照会しない", !shouldQueryLeg(row("requested"), [{ lastCheckedAt: null, queryCount: 15 }], day))
  check("配送中の扱いは不変 (配達予定日当日 2h)", currentIntervalHours({ status: "in_transit", shipment_date: "2026-11-07", expected_arrival: "2026-11-08" }, jst("2026-11-08", "10:00")) === 2)

  for (const startStatus of ["requested", "pending", "issued"] as const) {
    console.log(`2. 集荷日当日の照会 → 集荷検知 → 配達完了 (元の status=${startStatus})`)
    const store: Store = {
      shipments: [
        {
          id: "s1", booking_id: "BDX-PUDAY", leg_index: 0, agency: "T Agency", status: startStatus, carrier: "sagawa",
          representative: "Taro", tracking_numbers: ["100000000011"], tracking_detail: [], tracking_limit_reached: false,
          delivered_notified_at: null, delivered_at: null, picked_up_at: null, shipment_date: "2026-11-07",
          from_hotel: "A Hotel", to_hotel: "B Hotel", from_hotel_en: null, to_hotel_en: null,
          from_residence: null, to_residence: null, tour_number: null,
        },
      ],
      agencies: [{ id: "a1", name: "T Agency", contact_email: "ops@test.example", contact_person: "PIC", locale: "ja" }],
      agency_emails: [],
    }
    const sb = makeFakeSb(store)
    const S = () => store.shipments[0]
    const prov = (status: TrackingResult["status"], extra: Partial<TrackingResult> = {}): TrackingProvider => ({
      name: "mock",
      async fetchOne(_c, n) {
        return { number: n, noData: false, status, exception: null, ...extra }
      },
    })

    resetCaps()
    await reconcileTrackingNow(sb, "s1", prov("picked_up", { collectedAt: "2026-11-07T03:10:00Z" }))
    check(`[${startStatus}] 集荷を検知 → picked_up`, S().status === "picked_up", `status=${S().status}`)
    check(`[${startStatus}] picked_up_at に佐川の集荷時刻`, S().picked_up_at === "2026-11-07T03:10:00Z")
    // 代理店宛てだけを数える。社内への通知（lib/notify.ts の support@・ALERT_EMAIL 宛ての「集荷完了」）は本番でも送るので、別に確かめる
    // （2026-11-06: MAIL_TEST_CAPTURE=1 を「送れる」と扱うようにした後〔lib/mailer.ts mailerConfigured〕、試験でも社内への通知が記録されるようになった）
    const toAgency = () => caps().filter((c) => c.to === AGENCY_EMAIL)
    const toOthers = () => caps().filter((c) => c.to !== AGENCY_EMAIL)
    check(`[${startStatus}] 代理店へ集荷メール1通`, toAgency().length === 1 && /集荷|picked/i.test(String(toAgency()[0]?.subject ?? "")), JSON.stringify(caps().map((c) => c.subject)))
    check(`[${startStatus}] 社内への集荷完了の通知は社内の宛先だけ（代理店には 1通だけ）`, toOthers().length >= 1 && toOthers().every((c) => /集荷完了/.test(String(c.subject ?? ""))), JSON.stringify(toOthers().map((c) => c.subject)))

    resetCaps()
    await reconcileTrackingNow(sb, "s1", prov("delivered", { deliveredAt: "2026-11-08T05:00:00Z" }))
    check(`[${startStatus}] 配達完了 → delivered・完了メール1通・冪等キー`, S().status === "delivered" && toAgency().length === 1 && String(toAgency()[0]?.idempotencyKey ?? "").startsWith("delivered-BDX-PUDAY-L1"), JSON.stringify(caps().map((c) => [c.to === AGENCY_EMAIL ? "agency" : "internal", c.subject])))
    check(`[${startStatus}] delivered_at・delivered_notified_at を記録`, S().delivered_at === "2026-11-08T05:00:00Z" && S().delivered_notified_at != null)
  }

  console.log("3. 集荷前 (集荷依頼済み・未集荷) の照会結果で状態を変えない")
  {
    const store: Store = {
      shipments: [{ id: "s2", booking_id: "BDX-PRE", leg_index: 0, agency: "T Agency", status: "requested", carrier: "sagawa", representative: "Taro", tracking_numbers: ["100000000022"], tracking_detail: [], tracking_limit_reached: false, delivered_notified_at: null, shipment_date: "2026-11-07", from_hotel: "A", to_hotel: "B", from_hotel_en: null, to_hotel_en: null, from_residence: null, to_residence: null, tour_number: null }],
      agencies: [{ id: "a1", name: "T Agency", contact_email: "ops@test.example", contact_person: "PIC", locale: "ja" }],
      agency_emails: [],
    }
    const sb = makeFakeSb(store)
    resetCaps()
    await reconcileTrackingNow(sb, "s2", { name: "mock", async fetchOne(_c, n) { return { number: n, noData: true, status: null, exception: null } } })
    check("データ未登録 (集荷前) → requested のまま・メールなし", store.shipments[0].status === "requested" && caps().length === 0)
  }

  console.log("4. 課金・通知の条件が元の status に依存しないこと (コード確認)")
  const sync = readFileSync(new URL("../app/api/cron/sync-tracking/route.ts", import.meta.url), "utf8")
  const rec = readFileSync(new URL("../lib/tracking/reconcile.ts", import.meta.url), "utf8")
  const chargeGate = /if \(progressionRank\(bestStatus\) >= progressionRank\("picked_up"\)\) \{\s*try \{\s*(const r = )?await chargeShipmentIfDue/
  check("cron: 課金は『集荷以降に到達』だけが条件", chargeGate.test(sync))
  check("即時照会: 課金は『集荷以降に到達』だけが条件", chargeGate.test(rec))
  check("requested・pending は前進順の外 (rank -1) = issued より前として扱われる", /const PROGRESSION: ShipmentStatus\[\] = \["issued", "picked_up", "in_transit", "delivered"\]/.test(sync))

  console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ " + fail + " FAILED"}`)
  process.exit(fail === 0 ? 0 : 1)
}
void main()
