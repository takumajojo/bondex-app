/**
 * 追跡15回予算・配分ロジックの自己検証 (npx tsx scripts/tracking-poll-selftest.ts)。
 *
 * テスト基盤が無いプロジェクトのため、純粋関数 (lib/tracking/poll-policy) と、
 * cron/再送の判定ロジックをシナリオでシミュレートして、要件を満たすか assert する。
 *   - 集荷日は抑制・配達予定日は2時間ごと・1番号15回以内
 *   - 遅延/不在で収まらない場合は上限到達 → 別一覧・担当者通知・手動へ
 *   - 複数番号の確認漏れ防止 (全番号の完了で初めて leg 完了)
 *   - メールの重複防止・過去便への再送防止 (delivered_notified_at)
 */
import {
  shouldQueryLeg,
  TRACKING_MAX_QUERIES,
  type PollRow,
  type NumberMeta,
} from "../lib/tracking/poll-policy"

let failures = 0
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`)
  if (!cond) failures++
}

const STEP = 15 * 60 * 1000
const ymdJst = (t: number) => new Date(t + 9 * 3600000).toISOString().slice(0, 10)
const tOf = (ymd: string, hhmm = "00:00") => Date.parse(`${ymd}T${hhmm}:00+09:00`)
const addDays = (ymd: string, d: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)

// 1番号を、集荷日・配達日まで 15分刻みで cron 起動しながら照会をシミュレートする。
function simulate(o: { ship: string; arr: string; pickup: string; deliver: string }) {
  let queryCount = 0
  let lastCheckedAt: string | null = null
  let limitReached = false
  let detected = false
  // BondEx が認識しているステータス。照会して初めて実状況へ前進する (現実の cron と同じ)。
  let bondexStatus: PollRow["status"] = "issued"
  const start = tOf(addDays(o.ship, -1))
  const end = tOf(addDays(o.deliver, 14), "23:45")
  for (let t = start; t <= end; t += STEP) {
    const now = new Date(t)
    const today = ymdJst(t)
    const row: PollRow = {
      status: bondexStatus,
      shipment_date: o.ship,
      expected_arrival: o.arr,
      tracking_limit_reached: limitReached,
    }
    const meta: NumberMeta[] = [{ lastCheckedAt, queryCount, limitReached }]
    if (!shouldQueryLeg(row, meta, now)) continue
    queryCount++
    lastCheckedAt = now.toISOString()
    if (queryCount >= TRACKING_MAX_QUERIES) limitReached = true
    // 照会結果 = 実際の配送状況。前進のみ (集荷→配達)。
    if (today >= o.deliver) {
      bondexStatus = "delivered"
      detected = true
      break
    } else if (today >= o.pickup) {
      bondexStatus = "in_transit"
    }
  }
  return { queryCount, limitReached, detected }
}

// --- 配分 & 15回以内 ---
const nextday = simulate({ ship: "2026-11-10", arr: "2026-11-11", pickup: "2026-11-10", deliver: "2026-11-11" })
check("翌日配送: 15回以内で配達検知", nextday.detected && nextday.queryCount <= 15, `queries=${nextday.queryCount}`)

const sameN = simulate({ ship: "2026-11-10", arr: "2026-11-13", pickup: "2026-11-10", deliver: "2026-11-13" })
check("指定日配送(3日後): 15回以内で配達検知", sameN.detected && sameN.queryCount <= 15, `queries=${sameN.queryCount}`)

const delay = simulate({ ship: "2026-11-10", arr: "2026-11-11", pickup: "2026-11-10", deliver: "2026-11-20" })
check("遅延(予定11/実20): 収まらず上限到達→担当者通知/手動へ", delay.limitReached, `queries=${delay.queryCount}, detected=${delay.detected}`)

const absent = simulate({ ship: "2026-11-10", arr: "2026-11-11", pickup: "2026-11-10", deliver: "2026-11-18" })
check("不在/持戻で長期化: 上限到達→手動へ", absent.limitReached, `queries=${absent.queryCount}`)

// --- 集荷日の抑制: 発送予定日より前は照会しない ---
check(
  "集荷抑制: 発送予定日より前は照会しない",
  shouldQueryLeg(
    { status: "issued", shipment_date: "2026-11-15", expected_arrival: "2026-11-16", tracking_limit_reached: false },
    [{ queryCount: 0 }],
    new Date(tOf("2026-11-13", "10:00")),
  ) === false,
)

// --- 夜間は照会しない / 配達予定日の日中は照会する ---
const inTransit: PollRow = { status: "in_transit", shipment_date: "2026-11-10", expected_arrival: "2026-11-11", tracking_limit_reached: false }
check("夜間ガード: 23時は照会しない", shouldQueryLeg(inTransit, [{ queryCount: 0 }], new Date(tOf("2026-11-11", "23:00"))) === false)
check("配達予定日 日中(10時): 照会する", shouldQueryLeg(inTransit, [{ queryCount: 0 }], new Date(tOf("2026-11-11", "10:00"))) === true)

// --- 上限到達番号は照会しない ---
check(
  "上限到達番号(15回/limitReached)は照会しない",
  shouldQueryLeg(inTransit, [{ queryCount: 15, limitReached: true }], new Date(tOf("2026-11-11", "10:00"))) === false,
)

// --- 複数番号の確認漏れ防止: 最も遅れている番号を leg 代表にする (sync-tracking の bestStatus と同じ) ---
const PROG = ["issued", "picked_up", "in_transit", "delivered"]
const legStatus = (nums: string[]) => nums.reduce((min, s) => (PROG.indexOf(s) < PROG.indexOf(min) ? s : min))
check("複数番号: 1つでも未配達なら leg は未配達(確認漏れ防止)", legStatus(["delivered", "in_transit"]) === "in_transit")
check("複数番号: 全番号の完了で初めて leg=delivered", legStatus(["delivered", "delivered"]) === "delivered")

// --- メール重複 & 過去便再送の防止: delivered_notified_at で判定 (cron の再送ループと同じ条件) ---
type Row = { id: string; status: string; delivered_notified_at: string | null }
const rows: Row[] = [
  { id: "new-fail", status: "delivered", delivered_notified_at: null }, // 送信失敗 → 再送対象
  { id: "new-ok", status: "delivered", delivered_notified_at: "2026-11-11T00:00:00Z" }, // 送信済み → 対象外
  { id: "past", status: "delivered", delivered_notified_at: "2026-10-01T00:00:00Z" }, // 過去便(migration済) → 対象外
]
const resendTargets = rows.filter((r) => r.status === "delivered" && r.delivered_notified_at === null).map((r) => r.id)
check("再送: 送信失敗(NULL)のみ対象", resendTargets.length === 1 && resendTargets[0] === "new-fail")
check("メール重複防止: 送信済みは再送しない", !resendTargets.includes("new-ok"))
check("過去便へ再送しない", !resendTargets.includes("past"))

console.log(`\n${failures === 0 ? "✅ ALL PASS" : "❌ " + failures + " FAILED"}`)
process.exit(failures === 0 ? 0 : 1)
