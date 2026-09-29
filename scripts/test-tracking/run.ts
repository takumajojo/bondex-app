/**
 * 配送チェック (sync-tracking) と送り状No入力 (operator edit) の回帰テスト。
 * DB・Ship&co・メールはすべて fakes/ の偽物に差し替えて動かす (本番には一切触れない)。
 *   実行: npx tsx --tsconfig scripts/test-tracking/tsconfig.json scripts/test-tracking/run.ts
 */
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { S, reset, called } from "./fakes/state"
import { GET as syncTracking } from "@/app/api/cron/sync-tracking/route"
import { POST as editShipment } from "@/app/api/operator/shipment/[id]/edit/route"

process.env.CRON_SECRET = "test-secret"
process.env.SHIPANDCO_API_KEY = "x"

const AUTH = { authorization: "Bearer test-secret" }
const syncReq = (qs = "", headers: Record<string, string> = AUTH) =>
  new NextRequest(`https://bondex.express/api/cron/sync-tracking${qs}`, { headers })

function ship(over: Record<string, unknown>) {
  return {
    id: "s1", booking_id: "BDX-TEST01", leg_index: 0, agency: "A", status: "issued", carrier: "sagawa",
    representative: "R", recipient: "R", from_hotel: "F", to_hotel: "T", tour_number: null,
    shipment_date: "2026-09-29", yamato_tracking: ["500000000001"], yamato_tracking_detail: null,
    ...over,
  }
}
const EXC = (n: string) => ({ number: n, status: null, rawStatus: "exception", exception: "exception (carrier-reported problem)" })
const DELIVERED = (n: string) => ({ number: n, status: "delivered", rawStatus: "delivered" })

const tests: Array<[string, () => Promise<void>]> = [
  ["認証: 合言葉なしは 401", async () => {
    const res = await syncTracking(syncReq("", {}))
    assert.equal(res.status, 401)
  }],

  ["集荷前(issued)の異常は通知しない・状態は進めない・alertedException を付けない", async () => {
    S.shipments = [ship({})]
    S.trackingResults["500000000001"] = EXC("500000000001")
    const body = await (await syncTracking(syncReq())).json()
    assert.equal(called("opsAlert").length, 0)
    assert.deepEqual(body.alertsSent, [])
    assert.equal(S.shipments[0].status, "issued")
    const d = (S.shipments[0].yamato_tracking_detail as Array<Record<string, unknown>>)[0]
    assert.equal(d.alertedException, undefined)
    assert.equal(d.rawStatus, "exception")
  }],

  ["集荷後(picked_up)の異常は従来どおり通知する", async () => {
    S.shipments = [ship({ status: "picked_up" })]
    S.trackingResults["500000000001"] = EXC("500000000001")
    const body = await (await syncTracking(syncReq())).json()
    assert.equal(called("opsAlert").length, 1)
    assert.equal(body.alertsSent.length, 1)
  }],

  ["集荷後の異常は2回目以降は重複通知しない", async () => {
    S.shipments = [ship({ status: "picked_up" })]
    S.trackingResults["500000000001"] = EXC("500000000001")
    await syncTracking(syncReq())
    await syncTracking(syncReq())
    assert.equal(called("opsAlert").length, 1)
  }],

  ["配達完了: 状態更新・課金・完了メールが1回ずつ", async () => {
    S.shipments = [ship({ status: "picked_up" })]
    S.trackingResults["500000000001"] = DELIVERED("500000000001")
    const body = await (await syncTracking(syncReq())).json()
    assert.equal(S.shipments[0].status, "delivered")
    assert.ok(S.shipments[0].delivered_at)
    assert.equal(called("charge").length, 1)
    assert.deepEqual(called("agencyEmail").map((c) => c.args[0]), ["delivered"])
    assert.equal(body.deliveryNotified, 1)
    // 次の実行では delivered は対象外 → 二度と送らない
    await syncTracking(syncReq())
    assert.equal(called("agencyEmail").length, 1)
  }],

  ["並走で先を越されたら (status 条件付き update が0行) 課金・完了メールを出さない", async () => {
    S.shipments = [ship({ status: "picked_up" })]
    S.trackingResults["500000000001"] = DELIVERED("500000000001")
    // 読み取り後・更新前に、別の実行がこの区間を delivered に進めた
    S.beforeUpdate = () => { S.shipments[0].status = "delivered" }
    const body = await (await syncTracking(syncReq())).json()
    assert.equal(called("charge").length, 0)
    assert.equal(called("agencyEmail").length, 0)
    assert.equal(body.deliveryNotified, 0)
    assert.equal(called("shipments.update")[0].args[1], 0, "条件付き update は0行")
  }],

  ["区間指定: その区間だけ・別名ロック・全体アラートは走らない", async () => {
    S.shipments = [
      ship({ id: "s1", status: "picked_up" }),
      ship({ id: "s2", booking_id: "BDX-OTHER", yamato_tracking: ["500000000002"], status: "picked_up" }),
    ]
    S.trackingResults["500000000001"] = DELIVERED("500000000001")
    S.trackingResults["500000000002"] = DELIVERED("500000000002")
    const body = await (await syncTracking(syncReq("?shipmentId=s1"))).json()
    assert.equal(body.checked, 1)
    assert.equal(S.shipments[0].status, "delivered")
    assert.equal(S.shipments[1].status, "picked_up", "他の区間は触らない")
    assert.deepEqual(called("lock.acquire").map((c) => c.args[0]), ["sync-tracking:s1"])
    assert.equal(called("listPickupMisses").length, 0)
    assert.equal(called("listDeliveryOverdue").length, 0)
    assert.equal(S.lockHeld.size, 0, "ロックは解放される")
  }],

  ["区間指定は定時実行のロック中でも動く (定時実行も区間指定のロック中に動く)", async () => {
    S.shipments = [ship({ status: "picked_up" })]
    S.lockHeld.add("sync-tracking")
    const b1 = await (await syncTracking(syncReq("?shipmentId=s1"))).json()
    assert.notEqual(b1.skipped, "already running")
    S.lockHeld = new Set(["sync-tracking:s1"])
    const b2 = await (await syncTracking(syncReq())).json()
    assert.notEqual(b2.skipped, "already running")
  }],

  ["全体実行: 定時ロック名で動き、集荷漏れ/配達遅延チェックも走る", async () => {
    S.shipments = [ship({})]
    await syncTracking(syncReq())
    assert.deepEqual(called("lock.acquire").map((c) => c.args[0]), ["sync-tracking"])
    assert.equal(called("listPickupMisses").length, 1)
    assert.equal(called("listDeliveryOverdue").length, 1)
  }],
]

// ── 送り状No入力 (operator edit) → 即時チェック呼び出し ──
const realFetch = globalThis.fetch
function editReq(body: unknown) {
  return new NextRequest("https://bondex.express/api/operator/shipment/s1/edit", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}
const ctx = { params: Promise.resolve({ id: "s1" }) }
function stubFetch(resp: unknown, ok = true) {
  const seen: Array<{ url: string; auth: string | null }> = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") })
    return new Response(JSON.stringify(resp), { status: ok ? 200 : 500 })
  }) as typeof fetch
  return seen
}

tests.push(
  ["番号を保存したら、その区間の即時チェックを合言葉付きで呼ぶ", async () => {
    S.shipments = [ship({ status: "picked_up" })]
    const seen = stubFetch({ checked: 1, skipped: 1, deliveryNotified: 0 })
    const body = await (await editShipment(editReq({ tracking: "500017221255" }), ctx)).json()
    assert.equal(seen.length, 1)
    assert.equal(seen[0].url, "https://bondex.express/api/cron/sync-tracking?shipmentId=s1")
    assert.equal(seen[0].auth, "Bearer test-secret")
    assert.equal(body.trackingSynced, true)
    assert.deepEqual(S.shipments[0].yamato_tracking, ["500017221255"])
  }],
  ["番号を空にしたときは即時チェックを呼ばない", async () => {
    S.shipments = [ship({})]
    const seen = stubFetch({})
    const body = await (await editShipment(editReq({ tracking: "" }), ctx)).json()
    assert.equal(seen.length, 0)
    assert.equal(body.trackingSynced, false)
    assert.deepEqual(S.shipments[0].yamato_tracking, [])
  }],
  ["即時チェックが走行中で飛ばされたら trackingSynced=false", async () => {
    S.shipments = [ship({})]
    stubFetch({ ok: true, skipped: "already running" })
    const body = await (await editShipment(editReq({ tracking: "500017221255" }), ctx)).json()
    assert.equal(body.trackingSynced, false)
  }],
  ["即時チェックが失敗しても保存自体は成功する", async () => {
    S.shipments = [ship({})]
    stubFetch({ error: "x" }, false)
    const res = await editShipment(editReq({ tracking: "500017221255" }), ctx)
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.equal(body.trackingSynced, false)
  }],
)

;(async () => {
  let failed = 0
  for (const [name, fn] of tests) {
    reset()
    try {
      await fn()
      console.log(`ok   ${name}`)
    } catch (e) {
      failed++
      console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : e}`)
    } finally {
      globalThis.fetch = realFetch
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`)
  process.exit(failed ? 1 : 0)
})()
