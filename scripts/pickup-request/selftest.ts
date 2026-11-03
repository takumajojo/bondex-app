// 佐川への集荷依頼 (lib/pickup-request) と、手入力の問合番号が消える不具合の回帰テスト。
// 実接続なし・DB なし・課金なし。  npx tsx scripts/pickup-request/selftest.ts
// DB 関数 (sql/062) そのものの検証は scripts/pickup-request/sql062.test.mjs (PGlite)。

import { buildShipmentUpsertRow } from "../../lib/shipments-db"
import { reissueBlocked } from "../../lib/shipment-reissue"
import { pickupRequestClosed, pickupRequestCutoff } from "../../lib/bizlogi/deadline"
import { BizLogiTransportError, type BizLogiClient } from "../../lib/bizlogi/client"
import type { ShippingResponse } from "../../lib/bizlogi/shipping"
import { describeResultCode } from "../../lib/bizlogi/codes"
import { buildLegInput, legRef, pickupNotes, type LegInputEnv, type PickupShipmentRow } from "../../lib/pickup-request/leg-input"
import { previewBizLogiPickup, sendBizLogiPickup, type BizLogiSendDeps } from "../../lib/pickup-request/bizlogi"
import { resolvePickupRequest } from "../../lib/pickup-request/service"
import { buildPickupTodo, type PickupTodoLeg } from "../../lib/pickup-request/todo"
import { LIVE_STATES, type PickupRequestRow } from "../../lib/pickup-request/state"
import type { ClaimInput, PickupStore, TransitionInput } from "../../lib/pickup-request/store"
import type { HotelPlaceDetails } from "../../lib/hotel-place"
import { currentIntervalHours } from "../../lib/tracking/poll-policy"
import { pickupSnapshot, snapshotChanges } from "../../lib/pickup-request/snapshot"
import { checkExcelRows, parseLegRef } from "../../lib/pickup-request/excel-check"
import { alertStaleSending } from "../../lib/pickup-request/watch"
import { bizLogiAvailability, recordManualFromTrackingNumber } from "../../lib/pickup-request/service"
import { cleanOverrides, overridesNote, PLACES_TIMEOUT_MS } from "../../lib/pickup-request/leg-input"
import { pastRecommendedTime } from "../../lib/bizlogi/deadline"

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}`, detail ?? "")
  }
}

// ── テスト用: sql/062 の判定を写したメモリ上の記録
class MemoryStore implements PickupStore {
  rows: PickupRequestRow[] = []
  tracking = new Map<string, string[]>()
  cancelled = new Set<string>()
  failTransition = false
  private seq = 0
  async claim(i: ClaimInput) {
    if (this.cancelled.has(i.shipmentId)) return { claimed: false, requestId: null, reason: "shipment_cancelled" }
    if (i.channel === "bizlogi" && (this.tracking.get(i.shipmentId)?.length ?? 0) > 0) return { claimed: false, requestId: null, reason: "tracking_number_exists" }
    if (this.rows.some((r) => r.shipment_id === i.shipmentId && (LIVE_STATES as readonly string[]).includes(r.state))) {
      return { claimed: false, requestId: null, reason: "live_request_exists" }
    }
    const id = `req-${++this.seq}`
    const now = new Date().toISOString()
    this.rows.push({
      id, shipment_id: i.shipmentId, booking_id: "BDX-T", leg_index: 0, channel: i.channel,
      state: i.channel === "manual" ? "accepted" : "sending", environment: i.environment,
      user_manage_number: i.manageNumber, shipping_number: null, print_request_id: null,
      piece_count: i.pieceCount, pickup_date: i.pickupDate, result_codes: null, error: null, note: i.note,
      requested_by: i.actor, resolved_by: null, created_at: now, sent_at: now, resolved_at: null, updated_at: now,
      request_snapshot: i.snapshot ?? null,
      ...({ attempt_owner: i.owner } as object),
    } as PickupRequestRow)
    return { claimed: true, requestId: id, reason: "claimed", snapshot: i.snapshot ?? null }
  }
  async transition(i: TransitionInput) {
    if (this.failTransition) throw new Error("db down")
    const r = this.rows.find((x) => x.id === i.requestId)
    if (!r) return { applied: false, state: null, reason: "not_found" }
    if (!i.from.includes(r.state)) return { applied: false, state: r.state, reason: "state_mismatch" }
    const owner = (r as unknown as { attempt_owner?: string }).attempt_owner
    if (r.state === "sending" && i.owner && owner !== i.owner) return { applied: false, state: r.state, reason: "owner_mismatch" }
    if (i.to === "accepted" && r.channel === "bizlogi" && !i.shippingNumber && !r.shipping_number) {
      return { applied: false, state: r.state, reason: "shipping_number_required" }
    }
    r.state = i.to
    if (i.snapshot) r.request_snapshot = i.snapshot
    if (i.shippingNumber) r.shipping_number = i.shippingNumber
    if (i.printRequestId) r.print_request_id = i.printRequestId
    if (i.error) r.error = i.error
    if (i.to === "accepted" && i.shippingNumber && !(this.tracking.get(r.shipment_id)?.length)) this.tracking.set(r.shipment_id, [i.shippingNumber])
    return { applied: true, state: i.to, reason: "applied" }
  }
  async listForShipments(ids: string[]) {
    return this.rows.filter((r) => ids.includes(r.shipment_id))
  }
  async get(id: string) {
    return this.rows.find((r) => r.id === id) ?? null
  }
}

const NOW = new Date("2026-11-05T03:00:00Z") // 11/5 12:00 JST
const ROW: PickupShipmentRow = {
  id: "ship-1", booking_id: "BDX-8QRV2Y", leg_index: 0, status: "requested", carrier: "sagawa",
  shipment_date: "2026-11-07", expected_arrival: "2026-11-08", delivery_time: "14-16",
  representative: "SMITH JOHN", booking_name: null, tour_number: "4091471", suitcase_count: 2,
  from_hotel: "Hotel A", from_hotel_ja: null, from_place_id: "pa", from_residence: null,
  to_hotel: "Hotel B", to_hotel_ja: null, to_place_id: "pb", to_residence: null, tracking_numbers: null,
}

const place = (name: string, addr: string, phone: string): HotelPlaceDetails => ({
  placeId: "x", name, formattedAddress: addr, components: [], internationalPhone: phone,
})
const ENV: LegInputEnv = {
  kokyakuCode: "160310400007",
  contactPhone: "03-0000-0000",
  placesKey: "test-key",
  fetchPlace: async (_n, _k, placeId) =>
    placeId === "pa"
      ? place("ホテルエー東京", "日本、〒160-0023 東京都新宿区西新宿2丁目2番1号", "+81 3-1111-2222")
      : place("ホテルビー京都", "日本、〒600-8216 京都府京都市下京区東塩小路町901", "+81 75-333-4444"),
}

const result = (code: string) => describeResultCode(code)
function okResponse(number = "100000000011", prid = "9001-1"): ShippingResponse {
  return {
    result: result("S0-0001"), ok: true, printRequestId: prid,
    details: [{ userManageNumber: "BDX8QRV2YL1", resultCodes: [result("S0-0001")], ok: true, shippingNumbers: [number] }],
  }
}
function errorResponse(code = "E2-0004"): ShippingResponse {
  return {
    result: result("E8-0001"), ok: false, printRequestId: null,
    details: [{ userManageNumber: "BDX8QRV2YL1", resultCodes: [result(code)], ok: false, shippingNumbers: [] }],
  }
}

function makeClient(issue: () => Promise<ShippingResponse>, check: () => Promise<ShippingResponse> = async () => ({ ...okResponse(), printRequestId: null, details: [{ ...okResponse().details[0], shippingNumbers: [] }] })) {
  const calls = { check: 0, issue: 0 }
  const client = {
    checkShipping: async () => {
      calls.check++
      return check()
    },
    requestShipping: async () => {
      calls.issue++
      return issue()
    },
  } as unknown as Pick<BizLogiClient, "checkShipping" | "requestShipping">
  return { client, calls }
}

async function main() {
  console.log("1. 手入力の問合番号が消える不具合 (回帰)")
  const reSave = buildShipmentUpsertRow({ booking_id: "BDX-1", leg_index: 0, status: "issued" })
  check("問合番号を渡さない再保存は tracking_numbers を含めない (null で上書きしない)", !("tracking_numbers" in reSave))
  check("送り状URL・Drive URL も含めない", !("label_url" in reSave) && !("drive_url" in reSave))
  const withNum = buildShipmentUpsertRow({ booking_id: "BDX-1", tracking_numbers: ["123456789012"], label_url: "https://x" })
  check("渡したときは保存する (Ship&co 発行時の挙動は不変)", JSON.stringify(withNum.tracking_numbers) === '["123456789012"]' && withNum.label_url === "https://x")
  check("明示的な null は従来どおり保存する", buildShipmentUpsertRow({ booking_id: "BDX-1", tracking_numbers: null }).tracking_numbers === null)
  check("手入力の番号がある issued 区間は再発行しない", reissueBlocked({ status: "issued", label_url: null, tracking_numbers: ["123456789012"] }))
  check("集荷済み以降は再発行しない", reissueBlocked({ status: "picked_up" }) && reissueBlocked({ status: "delivered" }))
  check("Ship&co 発行済み (送り状あり) も再発行しない", reissueBlocked({ status: "issued", label_url: "https://x" }))
  check("番号も送り状も無い issued・requested は従来どおり処理できる", !reissueBlocked({ status: "issued", tracking_numbers: [] }) && !reissueBlocked({ status: "requested" }))

  console.log("2. 締め時刻 (前日 20:00 JST)")
  check("11/7 集荷の締めは 11/6 20:00 JST", pickupRequestCutoff("2026-11-07")?.toISOString() === "2026-11-06T11:00:00.000Z")
  check("11/6 19:59 JST はまだ依頼できる", !pickupRequestClosed("2026-11-07", new Date("2026-11-06T10:59:00Z")))
  check("11/6 20:00 JST で締め", pickupRequestClosed("2026-11-07", new Date("2026-11-06T11:00:00Z")))
  check("当日集荷は締め超過", pickupRequestClosed("2026-11-07", new Date("2026-11-07T00:00:00Z")))
  check("不正な日付は依頼不可", pickupRequestClosed("2026/11/07", NOW))

  console.log("3. 区間 → 集荷依頼データ")
  const built = await buildLegInput(ROW, ENV)
  check("変換できる", built.ok, built)
  if (built.ok) {
    const i = built.input
    check("管理番号の元は 予約番号-L区間", i.legRef === "BDX-8QRV2Y-L1" && legRef(ROW) === "BDX-8QRV2Y-L1")
    check("集荷先 = 発送元ホテル (Places の日本語名・番地を正規化)", i.origin.name === "ホテルエー東京" && i.origin.address === "東京都新宿区西新宿2-2-1" && i.origin.postalCode === "1600023")
    check("依頼主の電話は BondEx の荷物連絡先", i.origin.tel === ENV.contactPhone)
    check("お届け先の電話はホテル代表 (国内表記)", i.destination.tel === "075-333-4444")
    check("サイズは送らない (佐川で自動付与・Excel と同じ)", i.weight === null)
    check("集荷時間帯は指定なし", i.pickupTimeCode === "00")
    check("記事欄は承認済み Excel と同じ内容", JSON.stringify(i.notes) === JSON.stringify(["BondEx手荷物配送", "品名 スーツケース", "荷物連絡先BondEx", "03-0000-0000", "ツアー4091471 14-16時"]))
  }
  const noArrival = await buildLegInput({ ...ROW, expected_arrival: ROW.shipment_date }, ENV)
  check("配達希望日が発送日で埋められているときは配達指定日を送らない", noArrival.ok && noArrival.input.deliveryDate === undefined)
  const noGuest = await buildLegInput({ ...ROW, representative: null }, ENV)
  check("旅行者名が無ければエラー (推測で埋めない)", !noGuest.ok)
  const noPlace = await buildLegInput(ROW, { ...ENV, fetchPlace: async () => null })
  check("住所を解決できなければエラー", !noPlace.ok)
  const res = await buildLegInput(
    { ...ROW, from_residence: { name: "山田太郎", phone: "090-0000-0000", zip: "150-0041", prefecture: "東京都", city: "渋谷区", street: "神南1丁目2番3号", building: "神南ハウス101" } },
    ENV,
  )
  check("個人宅は入力住所から組み立て、電話は BondEx の連絡先", res.ok && res.input.origin.address === "東京都渋谷区神南1-2-3" && res.input.origin.tel === ENV.contactPhone)
  check("記事欄は17文字以内に収める", pickupNotes({ tour_number: "1234567890123456789", delivery_time: null }, "x")[4].length <= 17)

  if (!built.ok) throw new Error("前提の変換に失敗")
  const input = built.input

  console.log("4. Biz-Logi 送信 (確保 → 確認機能 → 発行依頼 → 保存)")
  const deps = (store: MemoryStore, client: Pick<BizLogiClient, "checkShipping" | "requestShipping">, alerts: unknown[] = []): BizLogiSendDeps => ({
    store, client, environment: "test", now: () => NOW, alert: async (a) => void alerts.push(a),
  })
  const pv = await previewBizLogiPickup(ROW, input, { client: makeClient(async () => okResponse()).client, now: () => NOW })
  check("確認画面: 確認機能だけ使い指紋を返す", pv.ok && !!pv.fingerprint)
  const fp = pv.ok ? pv.fingerprint : ""

  {
    const store = new MemoryStore()
    const { client, calls } = makeClient(async () => okResponse("100000000011", "9001-1"))
    const out = await sendBizLogiPickup(ROW, input, { actor: "谷口", expectedFingerprint: fp }, deps(store, client))
    check("受付成功: 問合番号と発行受付IDを保存", out.outcome === "accepted" && store.rows[0].state === "accepted" && store.rows[0].shipping_number === "100000000011" && store.rows[0].print_request_id === "9001-1", out)
    check("問合番号を区間 (tracking_numbers) に保存", store.tracking.get("ship-1")?.[0] === "100000000011")
    check("確認機能 1回 → 発行依頼 1回", calls.check === 1 && calls.issue === 1)
    const again = await sendBizLogiPickup(ROW, input, { actor: "谷口", expectedFingerprint: fp }, deps(store, client))
    check("受付済みの区間へ再送 (連打) は確保で止まり通信しない", again.outcome === "blocked" && calls.issue === 1)
  }
  {
    const store = new MemoryStore()
    const { client, calls } = makeClient(async () => {
      await new Promise((r) => setTimeout(r, 20))
      return okResponse()
    })
    const [a, b] = await Promise.all([
      sendBizLogiPickup(ROW, input, { actor: "A", expectedFingerprint: fp }, deps(store, client)),
      sendBizLogiPickup(ROW, input, { actor: "B", expectedFingerprint: fp }, deps(store, client)),
    ])
    check("同時に2つ送っても発行依頼は1回だけ", calls.issue === 1 && [a.outcome, b.outcome].sort().join(",") === "accepted,blocked", [a, b])
  }
  {
    const store = new MemoryStore()
    await store.claim({ shipmentId: "ship-1", channel: "manual", environment: null, manageNumber: null, pieceCount: 2, pickupDate: "2026-11-07", actor: "谷口", owner: "m", note: null, snapshot: null })
    const { client, calls } = makeClient(async () => okResponse())
    const out = await sendBizLogiPickup(ROW, input, { actor: "谷口", expectedFingerprint: fp }, deps(store, client))
    check("Excel で手動依頼済みの区間は Biz-Logi で送らない", out.outcome === "blocked" && calls.check === 0 && calls.issue === 0)
  }
  {
    const store = new MemoryStore()
    const alerts: unknown[] = []
    const { client, calls } = makeClient(async () => {
      throw new BizLogiTransportError("Biz-Logi shipping 通信エラー: timeout", 0)
    })
    const out = await sendBizLogiPickup(ROW, input, { actor: "谷口", expectedFingerprint: fp }, deps(store, client, alerts))
    check("通信断 → 結果不明 (unknown)・運営へ通知", out.outcome === "unknown" && store.rows[0].state === "unknown" && alerts.length === 1)
    check("結果不明でも自動再送しない (発行依頼は1回)", calls.issue === 1)
    const retry = await sendBizLogiPickup(ROW, input, { actor: "谷口", expectedFingerprint: fp }, deps(store, client, alerts))
    check("結果不明の区間はボタンを押しても送れない", retry.outcome === "blocked" && calls.issue === 1)
    const manual = await store.claim({ shipmentId: "ship-1", channel: "manual", environment: null, manageNumber: null, pieceCount: 2, pickupDate: "2026-11-07", actor: "x", owner: "m", note: null, snapshot: null })
    check("結果不明の区間を Excel 依頼 (CSV) に切り替えられない", !manual.claimed)
  }
  {
    const store = new MemoryStore()
    const { client } = makeClient(async () => errorResponse("E2-0004"))
    const out = await sendBizLogiPickup(ROW, input, { actor: "谷口", expectedFingerprint: fp }, deps(store, client))
    check("エラーコード (発行受付IDなし) → 依頼失敗・課金なし", out.outcome === "failed" && store.rows[0].state === "failed")
  }
  {
    const store = new MemoryStore()
    const alerts: unknown[] = []
    const { client } = makeClient(async () => ({ ...okResponse(), printRequestId: null }))
    const out = await sendBizLogiPickup(ROW, input, { actor: "谷口", expectedFingerprint: fp }, deps(store, client, alerts))
    check("正常コードでも発行受付IDが無ければ成功にしない → unknown", out.outcome === "unknown" && alerts.length === 1)
  }
  {
    const store = new MemoryStore()
    const { client } = makeClient(async () => ({ ...okResponse(), details: [{ ...okResponse().details[0], shippingNumbers: [] }] }))
    const out = await sendBizLogiPickup(ROW, input, { actor: "谷口", expectedFingerprint: fp }, deps(store, client))
    check("問合番号が無ければ成功にしない → unknown", out.outcome === "unknown")
  }
  {
    const store = new MemoryStore()
    const alerts: Array<{ lines: string[] }> = []
    const { client } = makeClient(async () => okResponse("100000000099"))
    const orig = store.transition.bind(store)
    let n = 0
    store.transition = async (i) => {
      if (n++ === 0) throw new Error("db down") // 受付の保存だけ失敗させる
      return orig(i)
    }
    const out = await sendBizLogiPickup(ROW, input, { actor: "谷口", expectedFingerprint: fp }, deps(store, client, alerts as unknown[]))
    check("佐川は受付・BondEx 保存失敗 → unknown で止め、番号を運営へ通知", out.outcome === "unknown" && alerts.length === 1 && alerts[0].lines.join("").includes("100000000099"))
  }
  {
    const store = new MemoryStore()
    const { client, calls } = makeClient(async () => okResponse(), async () => errorResponse("E2-0001"))
    const out = await sendBizLogiPickup(ROW, input, { actor: "谷口", expectedFingerprint: fp }, deps(store, client))
    check("確認機能でエラー → 発行依頼は送らず failed", out.outcome === "failed" && calls.issue === 0)
  }
  {
    const store = new MemoryStore()
    const { client, calls } = makeClient(async () => okResponse())
    const late = await sendBizLogiPickup(ROW, input, { actor: "谷口", expectedFingerprint: fp }, { ...deps(store, client), now: () => new Date("2026-11-06T11:00:00Z") })
    check("締め (前日20:00) 超過は確保も通信もしない", late.outcome === "blocked" && store.rows.length === 0 && calls.check === 0)
    const changed = await sendBizLogiPickup(ROW, input, { actor: "谷口", expectedFingerprint: "different" }, deps(store, client))
    check("確認画面のあとに内容が変わったら送らない", changed.outcome === "blocked" && store.rows.length === 0)
    const withNumber = await sendBizLogiPickup({ ...ROW, tracking_numbers: ["123456789012"] }, input, { actor: "谷口", expectedFingerprint: fp }, deps(store, client))
    check("問合番号が入力済みの区間は送らない", withNumber.outcome === "blocked" && calls.issue === 0)
    const cancelled = await sendBizLogiPickup({ ...ROW, status: "cancelled" }, input, { actor: "谷口", expectedFingerprint: fp }, deps(store, client))
    check("取消済みの区間は送らない", cancelled.outcome === "blocked")
  }

  console.log("5. 運営の確認結果の記録")
  {
    const store = new MemoryStore()
    const { client } = makeClient(async () => okResponse())
    await sendBizLogiPickup(ROW, input, { actor: "谷口", expectedFingerprint: fp }, deps(store, client))
    const id = store.rows[0].id
    const none = await resolvePickupRequest(id, "confirm_none", { actor: "谷口" }, store)
    check("Biz-Logi で受付済みの依頼は「依頼なし」にできない", !none.ok)
    const ch = await resolvePickupRequest(id, "start_change", { actor: "谷口", note: "世田谷へ取消メール" }, store)
    check("取消の連絡 → change_pending", ch.ok && store.rows[0].state === "change_pending")
    const cd = await resolvePickupRequest(id, "cancel_done", { actor: "谷口", note: "反映確認の返信あり" }, store)
    check("佐川の返信を記録 → cancelled", cd.ok && store.rows[0].state === "cancelled")
  }
  {
    const store = new MemoryStore()
    const { client } = makeClient(async () => {
      throw new BizLogiTransportError("timeout", 0)
    })
    await sendBizLogiPickup(ROW, input, { actor: "谷口", expectedFingerprint: fp }, deps(store, client))
    const id = store.rows[0].id
    check("結果不明 → 受付済みの確認には問合番号が必要", !(await resolvePickupRequest(id, "confirm_accepted", { actor: "谷口" }, store)).ok)
    check("問合番号の形式を確認", !(await resolvePickupRequest(id, "confirm_accepted", { actor: "谷口", shippingNumber: "12" }, store)).ok)
    const ok = await resolvePickupRequest(id, "confirm_accepted", { actor: "谷口", shippingNumber: "1000-0000-0011" }, store)
    check("佐川に確認した番号で受付済みにする", ok.ok && store.rows[0].shipping_number === "100000000011")
  }
  {
    const store = new MemoryStore()
    await store.claim({ shipmentId: "ship-2", channel: "bizlogi", environment: "test", manageNumber: "X", pieceCount: 1, pickupDate: "2026-11-07", actor: "a", owner: "o", note: null, snapshot: null })
    const id = store.rows[0].id
    const early = await resolvePickupRequest(id, "confirm_none", { actor: "谷口" }, store, () => new Date())
    check("送信中 (5分未満) は運営が触れない", !early.ok)
    const later = await resolvePickupRequest(id, "confirm_none", { actor: "谷口" }, store, () => new Date(Date.now() + 6 * 60 * 1000))
    check("送信中のまま止まった (5分超) ものは確認結果を記録できる", later.ok)
  }

  console.log("6. 集荷依頼 TODO")
  const leg = (id: string, date: string, extra: Partial<PickupTodoLeg> = {}): PickupTodoLeg => ({
    id, booking_id: `BDX-${id}`, leg_index: 0, status: "requested", carrier: "sagawa", shipment_date: date,
    representative: "X", tour_number: null, from_hotel: "H", from_hotel_ja: null, from_residence: null, suitcase_count: 2, tracking_numbers: null, ...extra,
  })
  const req = (shipmentId: string, state: PickupRequestRow["state"], updated = "2026-11-05T02:00:00Z"): PickupRequestRow =>
    ({ id: `r-${shipmentId}`, shipment_id: shipmentId, state, channel: "bizlogi", updated_at: updated, shipping_number: null, error: null, note: null } as PickupRequestRow)
  const todo = buildPickupTodo(
    [
      leg("nov7", "2026-11-07"),
      leg("nov6", "2026-11-06"),
      leg("today", "2026-11-05", { status: "issued" }),
      leg("far", "2026-11-20"),
      leg("manual", "2026-11-06"),
      leg("unk", "2026-11-06"),
      leg("stale", "2026-11-08"),
      leg("canc", "2026-11-06", { status: "cancelled" }),
      leg("yamato", "2026-11-06", { carrier: "yamato" }),
    ],
    [req("manual", "accepted"), req("unk", "unknown"), req("stale", "sending", "2026-11-05T02:00:00Z"), req("canc", "accepted")],
    "2026-11-05",
    NOW,
  )
  const ids = todo.needRequest.map((t) => t.shipmentId)
  check("status='requested' の未依頼区間を出す (旧条件では漏れていた)", ids.includes("nov7") && ids.includes("nov6"))
  check("明日発送 = due・今日発送 = overdue・2日後以降 = upcoming", todo.needRequest.find((t) => t.shipmentId === "nov6")?.urgency === "due" && todo.needRequest.find((t) => t.shipmentId === "today")?.urgency === "overdue" && todo.needRequest.find((t) => t.shipmentId === "nov7")?.urgency === "upcoming")
  check("7日より先は出さない", !ids.includes("far"))
  check("手動依頼済み・結果不明・送信中の区間は『依頼が必要』に出さない", !ids.includes("manual") && !ids.includes("unk") && !ids.includes("stale"))
  check("取消・ヤマトの区間は出さない", !ids.includes("canc") && !ids.includes("yamato"))
  const kinds = Object.fromEntries(todo.attention.map((a) => [a.shipmentId, a.kind]))
  check("結果不明は要確認に出す", kinds.unk === "unknown")
  check("送信中のまま止まったものを要確認に出す", kinds.stale === "stale_sending")
  check("取消した区間に依頼が残っていれば取消連絡を促す", kinds.canc === "cancel_needed")
  check("手動依頼済み (正常) は要確認に出さない", !("manual" in kinds))

  console.log("7. 追跡との整合 (集荷前に Ship&co の照会枠を使わない)")
  const pollRow = (status: string, shipment_date: string) => ({ status, shipment_date, expected_arrival: "2026-11-09" }) as Parameters<typeof currentIntervalHours>[0]
  check("Biz-Logi 依頼済み (requested・番号あり) は集荷日前に照会しない", !isFinite(currentIntervalHours(pollRow("requested", "2026-11-07"), NOW)))
  check("pending も同様", !isFinite(currentIntervalHours(pollRow("pending", "2026-11-07"), NOW)))
  check("集荷日以降は集荷確認の間隔で照会する", isFinite(currentIntervalHours(pollRow("requested", "2026-11-05"), NOW)))
  check("issued の挙動は従来どおり", !isFinite(currentIntervalHours(pollRow("issued", "2026-11-07"), NOW)) && isFinite(currentIntervalHours(pollRow("issued", "2026-11-05"), NOW)))
  check("配送中は従来どおり", isFinite(currentIntervalHours(pollRow("in_transit", "2026-11-01"), NOW)))

  console.log("8. 依頼後の変更検知 (P1-2)")
  {
    const snap = pickupSnapshot(ROW)
    check("依頼時と同じなら変更なし", snapshotChanges(snap, ROW).length === 0)
    check("ホテル (place_id) の変更を検知", snapshotChanges(snap, { ...ROW, to_place_id: "pz", to_hotel: "Hotel Z" }).includes("到着ホテル"))
    check("集荷日・個数・時間帯の変更を検知", JSON.stringify(snapshotChanges(snap, { ...ROW, shipment_date: "2026-11-08", suitcase_count: 3, delivery_time: "16-18" })) === JSON.stringify(["集荷日", "配達時間帯", "個数"]))
    check("個人宅の住所はキー順が違っても同じなら変更なし", snapshotChanges({ ...snap, from_residence: { zip: "1", city: "a" } }, { ...ROW, from_residence: { city: "a", zip: "1" } }).length === 0)
    check("DB (jsonb) の日付文字列・数値とも一致する", snapshotChanges(JSON.parse(JSON.stringify(snap)), ROW).length === 0)
    check("依頼内容が無い古い記録は比較しない", snapshotChanges(null, ROW).length === 0)
    const legChanged = { ...leg("chg", "2026-11-07"), from_place_id: "pa", to_hotel: "Hotel B", to_place_id: "pz", to_residence: null, expected_arrival: "2026-11-08", delivery_time: "14-16" }
    const r = { ...req("chg", "accepted"), request_snapshot: { ...pickupSnapshot({ ...ROW, from_hotel: "H", suitcase_count: 2, shipment_date: "2026-11-07" }) } } as PickupRequestRow
    const t = buildPickupTodo([legChanged], [r], "2026-11-05", NOW)
    check("依頼後に到着ホテルが変わった区間を『変更連絡が必要』に出す", t.attention[0]?.kind === "changed_after_request" && (t.attention[0]?.changes ?? []).includes("到着ホテル"), t.attention)
    const r2 = { ...r, state: "change_pending" } as PickupRequestRow
    check("連絡中 (change_pending) は変更連絡の催促ではなく返信待ちとして出す", buildPickupTodo([legChanged], [r2], "2026-11-05", NOW).attention[0]?.kind === "change_pending")
  }
  {
    const store = new MemoryStore()
    await store.claim({ shipmentId: "ship-1", channel: "manual", environment: null, manageNumber: null, pieceCount: 2, pickupDate: "2026-11-07", actor: "谷口", owner: "m", note: null, snapshot: pickupSnapshot(ROW) })
    const id = store.rows[0].id
    check("世田谷への連絡はメモ必須 (メールを送っただけで完了にしない)", !(await resolvePickupRequest(id, "start_change", { actor: "谷口" }, store)).ok)
    await resolvePickupRequest(id, "start_change", { actor: "谷口", note: "到着ホテル変更をメール" }, store)
    check("反映の記録は返信内容が必須", !(await resolvePickupRequest(id, "change_done", { actor: "谷口", current: ROW }, store)).ok)
    const changedRow = { ...ROW, to_place_id: "pz", to_hotel: "Hotel Z" }
    const done = await resolvePickupRequest(id, "change_done", { actor: "谷口", note: "反映済みと返信あり", current: changedRow }, store)
    check("変更の反映を記録 → accepted・依頼内容を新しい内容に更新 (以後は変更扱いにしない)", done.ok && store.rows[0].state === "accepted" && snapshotChanges(store.rows[0].request_snapshot, changedRow).length === 0)
  }

  console.log("9. 問合番号はあるが記録なし (P1-1)")
  {
    const legs = [{ ...leg("num", "2026-11-07"), tracking_numbers: ["100000000011"] }, leg("none", "2026-11-07")]
    const t = buildPickupTodo(legs, [], "2026-11-05", NOW)
    check("番号がある区間は『依頼が必要』に出さない", !t.needRequest.some((x) => x.shipmentId === "num") && t.needRequest.some((x) => x.shipmentId === "none"))
    check("番号があるのに記録が無い区間は要確認 (記録漏れ) に出す", t.attention.some((a) => a.shipmentId === "num" && a.kind === "record_missing"))
    const store = new MemoryStore()
    const rec = await recordManualFromTrackingNumber(ROW, store)
    check("番号の手入力で手動依頼済みとして記録する", rec.recorded && store.rows[0]?.channel === "manual" && store.rows[0]?.state === "accepted")
    const again = await recordManualFromTrackingNumber(ROW, store)
    check("既に記録があれば何もしない (重複記録しない)", !again.recorded && store.rows.length === 1)
    const missing = await recordManualFromTrackingNumber(ROW, { ...store, claim: async () => { throw new Error('relation "public.pickup_requests" does not exist') } } as unknown as PickupStore)
    check("移行前 (テーブル無し) でも番号の保存を止めない", !missing.recorded && /移行前/.test(missing.note))
  }

  console.log("10. Excel を作る前の照合 (P1-8)")
  {
    const L = (ref: string, extra: Record<string, unknown> = {}) => {
      const p = parseLegRef(ref)!
      return { id: ref, booking_id: p.bookingId, leg_index: p.legIndex, status: "requested", tracking_numbers: null, pickup_requested_at: null, ...extra }
    }
    const legs = [L("BDX-A-L1"), L("BDX-B-L1"), L("BDX-C-L1", { tracking_numbers: ["1"] }), L("BDX-D-L1", { status: "cancelled" }), L("BDX-E-L1")]
    const reqs = [{ ...req("BDX-B-L1", "accepted"), channel: "bizlogi" } as PickupRequestRow, req("BDX-E-L1", "failed")]
    const v = checkExcelRows(["BDX-A-L1", "BDX-B-L1", "BDX-C-L1", "BDX-D-L1", "BDX-E-L1", "BDX-A-L1", "XYZ"], legs, reqs)
    check("未依頼は OK", v[0].ok)
    check("Biz-Logi 依頼済みは NG", !v[1].ok)
    check("問合番号あり・取消は NG", !v[2].ok && !v[3].ok)
    check("依頼失敗 (failed) の区間は Excel で依頼してよい", v[4].ok)
    check("同じ区間の2回目・形式違いは NG", !v[5].ok && !v[6].ok)
    const legacy = checkExcelRows(["BDX-A-L1"], [L("BDX-A-L1", { pickup_requested_at: "2026-11-01T00:00:00Z" })], [])
    check("移行前は『依頼済み』印で NG にする", !legacy[0].ok)
  }

  console.log("11. 送信中のまま止まった記録の通知 (P1-4)")
  {
    const rows = [
      { id: "s1", booking_id: "BDX-S", leg_index: 0, environment: "production", state: "sending", updated_at: "2026-11-05T02:40:00Z", pickup_date: "2026-11-07", stale_alerted_at: null as string | null },
      { id: "s2", booking_id: "BDX-T", leg_index: 0, environment: "production", state: "sending", updated_at: "2026-11-05T02:58:00Z", pickup_date: "2026-11-07", stale_alerted_at: null as string | null },
    ]
    const fakeSb = {
      from: () => {
        const f: Array<(r: (typeof rows)[number]) => boolean> = []
        let upd: Record<string, unknown> | null = null
        const q: Record<string, unknown> = {
          select: () => q,
          update: (d: Record<string, unknown>) => { upd = d; return q },
          eq: (c: string, v: unknown) => { f.push((r) => (r as Record<string, unknown>)[c] === v); return q },
          is: (c: string, v: unknown) => { f.push((r) => ((r as Record<string, unknown>)[c] ?? null) === v); return q },
          limit: () => q,
          then: (res: (v: { data: unknown[]; error: null }) => void) => {
            const m = rows.filter((r) => f.every((fn) => fn(r)))
            if (upd) m.forEach((r) => Object.assign(r, upd))
            res({ data: m.map((r) => ({ ...r })), error: null })
          },
        }
        return q
      },
    }
    const alerts: Array<{ subject: string }> = []
    const r1 = await alertStaleSending(fakeSb as never, async (a) => void alerts.push(a), NOW)
    check("5分以上『送信中』の記録だけ通知 (2分前のものは対象外)", r1.alerted === 1 && alerts.length === 1 && /BDX-S/.test(alerts[0].subject))
    const r2 = await alertStaleSending(fakeSb as never, async (a) => void alerts.push(a), NOW)
    check("同じ記録は2回通知しない", r2.alerted === 0 && alerts.length === 1)
    check("記録の状態は変えない (自動で解放・再送しない)", rows[0].state === "sending")
  }
  check("外部照会の時間制限: Places 8秒・Biz-Logi 20秒 (合計が API 上限60秒未満)", PLACES_TIMEOUT_MS === 8000 && PLACES_TIMEOUT_MS + 20000 * 2 < 60000)

  console.log("12. テスト環境と本番の取り違え防止 (P1-6)")
  {
    const base = { BIZLOGI_CUSTOMER_ID: "a", BIZLOGI_LOGIN_PASSWORD: "b", BIZLOGI_OKURI_CODE: "N01", BIZLOGI_KOKYAKU_CODE: "160310400007", BONDEX_SENDER_PHONE: "03-0000-0000" }
    const t = bizLogiAvailability({ ...base, BIZLOGI_ENV: "test", BIZLOGI_BASE_URL: "https://beccl-st.biz-blue.net/api" })
    check("テスト環境の設定ではアプリから送信しない (ボタンを出さない)", !t.available && /scripts\/bizlogi\/test-env/.test((t as { reason: string }).reason))
    const p = bizLogiAvailability({ ...base, BIZLOGI_ENV: "production", BIZLOGI_BASE_URL: "https://prod.example.test/api" })
    check("本番の設定なら使える", p.available)
  }

  console.log("13. 締め時刻と社内推奨時刻 (P1-5)")
  check("11/7 集荷: 11/6 17:59 は推奨時刻前", !pastRecommendedTime("2026-11-07", new Date("2026-11-06T08:59:00Z")))
  check("11/6 18:00 以降は推奨時刻を過ぎた (警告のみ)", pastRecommendedTime("2026-11-07", new Date("2026-11-06T09:00:00Z")))
  {
    const late = await previewBizLogiPickup(ROW, input, { client: makeClient(async () => okResponse()).client, now: () => new Date("2026-11-06T10:30:00Z") })
    check("18:00〜20:00 の送信は拒否せず、警告だけ付ける", late.ok && late.warnings[0]?.includes("18:00"))
    const store = new MemoryStore()
    const { client, calls } = makeClient(async () => okResponse())
    const fp2 = late.ok ? late.fingerprint : ""
    const sent = await sendBizLogiPickup(ROW, input, { actor: "谷口", expectedFingerprint: fp2 }, { ...deps(store, client), now: () => new Date("2026-11-06T10:30:00Z") })
    check("19:30 の送信は正常に依頼できる (20:00 前)", sent.outcome === "accepted" && calls.issue === 1)
  }

  console.log("14. 宛名の指定 (P1-7)")
  {
    const longHotel = (n: number) => "ホ".repeat(n)
    const env2: LegInputEnv = { ...ENV, fetchPlace: async (_n, _k, placeId) => (placeId === "pa" ? place(longHotel(30), "日本、〒160-0023 東京都新宿区西新宿2丁目2番1号", "+81 3-1111-2222") : place("ホテルビー京都", "日本、〒600-8216 京都府京都市下京区東塩小路町901", "+81 75-333-4444")) }
    const built2 = await buildLegInput(ROW, env2)
    const pv2 = built2.ok ? await previewBizLogiPickup(ROW, built2.input, { client: makeClient(async () => okResponse()).client, now: () => NOW }) : null
    const nm = pv2 && pv2.ok ? pv2.detail.irai?.nm ?? [] : []
    check("30文字のホテル名は2行に折り返して送る (1文字も落とさない)", !!pv2 && pv2.ok && nm.join("").replace(/\s/g, "") === `${longHotel(30)}気付SMITHJOHN様`, nm)
    const env3: LegInputEnv = { ...env2, fetchPlace: async (_n, _k, placeId) => (placeId === "pa" ? place(longHotel(45), "日本、〒160-0023 東京都新宿区西新宿2丁目2番1号", "+81 3-1111-2222") : place("ホテルビー京都", "日本、〒600-8216 京都府京都市下京区東塩小路町901", "+81 75-333-4444")) }
    const built4 = await buildLegInput(ROW, env3)
    const pv4 = built4.ok ? await previewBizLogiPickup(ROW, built4.input, { client: makeClient(async () => okResponse()).client, now: () => NOW }) : null
    check("2行 (50文字) にも収まらない宛名は切り詰めずエラーにする", !!pv4 && !pv4.ok && pv4.errors.some((e) => /宛名/.test(e)), pv4)
    const ov = cleanOverrides({ originName: "ホテル短縮名" })
    const built3 = await buildLegInput(ROW, env3, ov)
    const pv3 = built3.ok ? await previewBizLogiPickup(ROW, built3.input, { client: makeClient(async () => okResponse()).client, now: () => NOW }) : null
    check("運営が佐川向けの名称を入れれば送れる", !!pv3 && pv3.ok && built3.ok && built3.input.origin.name === "ホテル短縮名")
    check("指定した名称は記録のメモに残す", overridesNote(ov) === "佐川の宛名を運営が指定: 発送元「ホテル短縮名」")
    check("空欄は指定なし扱い", overridesNote(cleanOverrides({ originName: "  " })) === null)
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
