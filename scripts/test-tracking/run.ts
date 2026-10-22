/**
 * 配送チェック (定時の sync-tracking と、番号入力時の即時照会 reconcile) の回帰テスト。
 * DB・Ship&co・メールはすべて fakes/ の偽物に差し替えて動かす (本番には一切触れない)。
 *   実行: npx tsx --tsconfig scripts/test-tracking/tsconfig.json scripts/test-tracking/run.ts
 */
process.env.TRACKING_SYNC_PAUSED = "false" // 停止スイッチは env が優先。テストでは照会を動かす
process.env.CRON_SECRET = "test-secret"
process.env.SHIPANDCO_API_KEY = "x"

import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { S, reset, called } from "./fakes/state"
import { getSupabase } from "./fakes/supabase"
import type { SupabaseClient } from "@supabase/supabase-js"

const AUTH = { authorization: "Bearer test-secret" }
const syncReq = (headers: Record<string, string> = AUTH) =>
  new NextRequest("https://bondex.express/api/cron/sync-tracking", { headers })

function ship(over: Record<string, unknown>) {
  return {
    id: "s1", booking_id: "BDX-TEST01", leg_index: 0, agency: "A", status: "issued", carrier: "sagawa",
    representative: "R", recipient: "R", from_hotel: "F", to_hotel: "T", from_residence: null, to_residence: null,
    tour_number: null, shipment_date: "2026-09-29", tracking_numbers: ["500000000001"], tracking_detail: null,
    ...over,
  }
}
const EXC = (n: string) => ({ number: n, status: null, rawStatus: "exception", exception: "exception (carrier-reported problem)" })
const DELIVERED = (n: string) => ({ number: n, status: "delivered", rawStatus: "delivered" })

;(async () => {
  const { GET: syncTracking } = await import("@/app/api/cron/sync-tracking/route")
  const { reconcileTrackingNow } = await import("@/lib/tracking/reconcile")
  const sb = getSupabase() as unknown as SupabaseClient

  const tests: Array<[string, () => Promise<void>]> = [
    ["認証: 合言葉なしは 401", async () => {
      const res = await syncTracking(syncReq({}))
      assert.equal(res.status, 401)
    }],

    ["定時: 集荷前(issued)の異常は通知しない・状態は進めない", async () => {
      S.shipments = [ship({})]
      S.trackingResults["500000000001"] = EXC("500000000001")
      const body = await (await syncTracking(syncReq())).json()
      assert.equal(called("opsAlert").length, 0)
      assert.deepEqual(body.alertsSent, [])
      assert.equal(S.shipments[0].status, "issued")
      const d = (S.shipments[0].tracking_detail as Array<Record<string, unknown>>)[0]
      assert.equal(d.alertedException, undefined)
    }],

    ["定時: 集荷後(picked_up)の異常は従来どおり1回だけ通知する", async () => {
      S.shipments = [ship({ status: "picked_up" })]
      S.trackingResults["500000000001"] = EXC("500000000001")
      await syncTracking(syncReq())
      await syncTracking(syncReq())
      assert.equal(called("opsAlert").length, 1)
    }],

    ["定時: 配達完了で状態更新・課金・完了メールが1回ずつ。次回は送らない", async () => {
      S.shipments = [ship({ status: "picked_up" })]
      S.trackingResults["500000000001"] = DELIVERED("500000000001")
      const body = await (await syncTracking(syncReq())).json()
      assert.equal(S.shipments[0].status, "delivered")
      assert.equal(called("charge").length, 1)
      assert.deepEqual(called("agencyEmail").map((c) => c.args[0]), ["delivered"])
      assert.equal(body.deliveryNotified, 1)
      await syncTracking(syncReq())
      assert.equal(called("agencyEmail").length, 1)
    }],

    ["定時: 並走した即時照会に先を越されたら課金・完了メールを出さない", async () => {
      S.shipments = [ship({ status: "picked_up" })]
      S.trackingResults["500000000001"] = DELIVERED("500000000001")
      S.beforeUpdate = () => { S.shipments[0].status = "delivered" }
      const body = await (await syncTracking(syncReq())).json()
      assert.equal(called("charge").length, 0)
      assert.equal(called("agencyEmail").length, 0)
      assert.equal(body.deliveryNotified, 0)
      assert.equal(called("shipments.update")[0].args[1], 0, "条件付き update は0行")
    }],

    ["即時照会: 配達完了なら状態更新・完了メール1回", async () => {
      S.shipments = [ship({ status: "picked_up" })]
      S.trackingResults["500000000001"] = DELIVERED("500000000001")
      const r = await reconcileTrackingNow(sb, "s1")
      assert.equal(r.delivered, true)
      assert.equal(S.shipments[0].status, "delivered")
      assert.deepEqual(called("agencyEmail").map((c) => c.args[0]), ["delivered"])
    }],

    ["即時照会: 並走した定時に先を越されたら完了メールを出さない", async () => {
      S.shipments = [ship({ status: "picked_up" })]
      S.trackingResults["500000000001"] = DELIVERED("500000000001")
      S.beforeUpdate = () => { S.shipments[0].status = "delivered" }
      const r = await reconcileTrackingNow(sb, "s1")
      assert.equal(r.changed, false)
      assert.equal(called("agencyEmail").length, 0)
      assert.equal(called("charge").length, 0)
    }],

    ["即時照会→定時の順に動いても完了メールは合計1通", async () => {
      S.shipments = [ship({ status: "picked_up" })]
      S.trackingResults["500000000001"] = DELIVERED("500000000001")
      await reconcileTrackingNow(sb, "s1")
      await syncTracking(syncReq())
      assert.equal(called("agencyEmail").length, 1)
    }],
  ]

  let failed = 0
  for (const [name, fn] of tests) {
    reset()
    try {
      await fn()
      console.log(`ok   ${name}`)
    } catch (e) {
      failed++
      console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : e}`)
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`)
  process.exit(failed ? 1 : 0)
})()
