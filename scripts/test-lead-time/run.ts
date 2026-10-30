/**
 * 佐川の最短お届け日 (リードタイム) の回帰テスト。DB・佐川・Google・Ship&co はすべて偽物で、本番には触れない。
 *   実行: npx tsx --tsconfig scripts/test-lead-time/tsconfig.json scripts/test-lead-time/run.ts
 */
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { TABLES, CALLS, resetTables } from "./fakes/supabase"
import { SAVED } from "./fakes/shipments-db"
import { parseSagawaDaysHtml, earliestArrivalYmd, resolveSagawaLeadTime, OKINAWA_AIR_DAYS } from "@/lib/sagawa-lead-time"
import { sagawaLeadTimeViolation } from "@/lib/lead-time-check"
import { isNextDayEarlySlotRisky } from "@/lib/yamato-delivery"
import { POST as createShipment } from "@/app/api/shipandco/create/route"
import { GET as leadTimeApi } from "@/app/api/lead-time/route"

process.env.SHIPANDCO_API_KEY = "test"
process.env.GOOGLE_MAPS_API_KEY = "test"

// ---- 偽の外部 API (fetch) ----
const HIRO = "7300011" // 広島
const TOKYO = "1000005" // 東京・丸の内
const KANAZAWA = "9200853" // 金沢
const PLACES: Record<string, string> = {
  P_HIRO: "〒730-0011 広島県広島市中区基町6-78",
  P_TOKYO: "〒100-0005 東京都千代田区丸の内1-9-1",
  P_KANAZAWA: "〒920-0853 石川県金沢市本町2-15-1",
  P_UNKNOWN: "〒999-9999 北海道どこか市1-1",
}
let sagawaMode: "ok" | "fail" | "parse_fail" | "not_found" = "ok"
let sagawaDays = 2
let sagawaCalls = 0
const sagawaHtml = (days: number) =>
  `<html><body><!-- 結果 --><dl><dt>発送元</dt><dd>担当営業所：<a href="#">広島営業所</a></dd>
   <dt>お届け先</dt><dd>担当営業所：<a href="#">千代田営業所</a></dd></dl>
   <p class="result">発送日+ <strong>${days}</strong> 日</p></body></html>`
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.includes("maps.googleapis.com")) {
    const placeId = new URL(url).searchParams.get("place_id") ?? ""
    const addr = PLACES[placeId]
    return new Response(JSON.stringify({ result: addr ? { name: placeId, formatted_address: addr, address_components: [] } : undefined }))
  }
  if (url.includes("sagawa-exp.co.jp")) {
    sagawaCalls++
    if (sagawaMode === "fail") throw new Error("network down")
    if (sagawaMode === "parse_fail") return new Response("<html><body>メンテナンス中</body></html>")
    if (sagawaMode === "not_found") return new Response("<p>該当する郵便番号が見つかりません。</p>")
    return new Response(sagawaHtml(sagawaDays))
  }
  // Ship&co などそれ以外は失敗させる (発行まで進まないこと自体は検証対象外)
  return new Response(JSON.stringify({ error: "stub" }), { status: 500 })
}) as typeof fetch

function seed() {
  resetTables({
    sagawa_lead_times: [
      { from_zip: HIRO, to_zip: TOKYO, from_office: "広島営業所", to_office: "千代田営業所", days: 2, source: "tourist_matrix", fetched_at: "2026-10-30" },
      { from_zip: TOKYO, to_zip: HIRO, from_office: "千代田営業所", to_office: "広島営業所", days: 2, source: "tourist_matrix", fetched_at: "2026-10-30" },
      { from_zip: HIRO, to_zip: KANAZAWA, from_office: "広島営業所", to_office: "金沢営業所", days: 1, source: "tourist_matrix", fetched_at: "2026-10-30" },
      { from_zip: KANAZAWA, to_zip: HIRO, from_office: "金沢営業所", to_office: "広島営業所", days: 2, source: "tourist_matrix", fetched_at: "2026-10-30" },
    ],
    sagawa_zip_offices: [
      { zip: HIRO, office: "広島営業所" },
      { zip: "7300012", office: "広島営業所" }, // 同じ営業所の別の郵便番号
      { zip: KANAZAWA, office: "金沢営業所" },
    ],
    sagawa_office_lead_times: [
      { from_office: "広島営業所", to_office: "金沢営業所", days: 1 },
      { from_office: "金沢営業所", to_office: "広島営業所", days: 2 },
    ],
  })
  sagawaMode = "ok"
  sagawaDays = 2
  sagawaCalls = 0
  SAVED.length = 0
}

const jstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const addDays = (ymd: string, n: number) => earliestArrivalYmd(ymd, n)!
const createReq = (body: Record<string, unknown>) =>
  new NextRequest("https://bondex.express/api/shipandco/create", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  })
const createBody = (over: Record<string, unknown>) => ({
  refNumber: "BDX-TEST-L1", bookingId: "BDX-TEST", legIndex: 0, carrier: "sagawa",
  shipmentDate: addDays(jstToday(), 3),
  from: { hotel: "広島のホテル", placeId: "P_HIRO" },
  to: { hotel: "東京のホテル", placeId: "P_TOKYO" },
  ...over,
})

const tests: Array<[string, () => Promise<void> | void]> = [
  // ---- parseSagawaDaysHtml ----
  ["parse: 正常 (担当営業所2つ + 発送日+N日)", () => {
    const r = parseSagawaDaysHtml(sagawaHtml(3))
    assert.deepEqual(r, { fromOffice: "広島営業所", toOffice: "千代田営業所", days: 3, error: null })
  }],
  ["parse: 全角数字の日数も読める", () => {
    assert.equal(parseSagawaDaysHtml("担当営業所：札幌営業所 担当営業所：那覇営業所 発送日+３日").days, 3)
  }],
  ["parse: 該当なし → days=null + 佐川の文言", () => {
    const r = parseSagawaDaysHtml("<p>該当する郵便番号が見つかりません。</p>")
    assert.equal(r.days, null)
    assert.match(r.error ?? "", /該当/)
  }],
  ["parse: 構造変更 → parse_fail", () => {
    const r = parseSagawaDaysHtml("<html><body>メンテナンス中</body></html>")
    assert.equal(r.days, null)
    assert.equal(r.error, "parse_fail")
  }],

  // ---- earliestArrivalYmd ----
  ["最短日: 月末をまたぐ (10/31 + 2日 = 11/02)", () => assert.equal(earliestArrivalYmd("2026-10-31", 2), "2026-11-02")],
  ["最短日: 年末をまたぐ (12/31 + 3日 = 翌年 1/03・年末年始も暦日)", () => assert.equal(earliestArrivalYmd("2026-12-31", 3), "2027-01-03")],
  ["最短日: うるう年 (2028-02-28 + 1日 = 02-29)", () => assert.equal(earliestArrivalYmd("2028-02-28", 1), "2028-02-29")],
  ["最短日: 形式不正は null", () => assert.equal(earliestArrivalYmd("2026/10/31", 1), null)],

  // ---- 解決順 ----
  ["解決順1: 郵便番号ペア完全一致 (佐川に照会しない)", async () => {
    seed()
    const r = await resolveSagawaLeadTime(HIRO, TOKYO)
    assert.equal(r?.days, 2); assert.equal(r?.source, "zip_pair"); assert.equal(sagawaCalls, 0)
  }],
  ["解決順2: 営業所ペア (同じ営業所の別郵便番号)", async () => {
    seed()
    const r = await resolveSagawaLeadTime("7300012", KANAZAWA)
    assert.equal(r?.days, 1); assert.equal(r?.source, "office_pair"); assert.equal(sagawaCalls, 0)
  }],
  ["解決順3: どちらも無ければ佐川へ照会し、3テーブルに保存", async () => {
    seed(); sagawaDays = 3
    const r = await resolveSagawaLeadTime("0400001", "8120011")
    assert.equal(r?.days, 3); assert.equal(r?.source, "live"); assert.equal(sagawaCalls, 1)
    assert.ok(TABLES.sagawa_lead_times.some((x) => x.from_zip === "0400001" && x.to_zip === "8120011" && x.days === 3 && x.source === "live"))
    assert.ok(TABLES.sagawa_zip_offices.some((x) => x.zip === "0400001"))
    assert.ok(TABLES.sagawa_office_lead_times.some((x) => x.from_office === "広島営業所" && x.to_office === "千代田営業所"))
  }],
  ["解決順4: 佐川が落ちていたら null (例外を投げない)", async () => {
    seed(); sagawaMode = "fail"
    assert.equal(await resolveSagawaLeadTime("0400001", "8120011"), null)
  }],
  ["方向: 広島→金沢 1日 / 金沢→広島 2日 (行きの日数を帰りに流用しない)", async () => {
    seed()
    assert.equal((await resolveSagawaLeadTime(HIRO, KANAZAWA))?.days, 1)
    assert.equal((await resolveSagawaLeadTime(KANAZAWA, HIRO))?.days, 2)
  }],
  ["郵便番号 0000000 (FALLBACK_ZIP) や空は不明扱い", async () => {
    seed()
    assert.equal(await resolveSagawaLeadTime("0000000", TOKYO), null)
    assert.equal(await resolveSagawaLeadTime("", TOKYO), null)
    assert.equal(sagawaCalls, 0)
  }],

  ["沖縄 (90x) 発着は飛脚航空便の別ルール (通常便データ・佐川照会を使わない)", async () => {
    seed()
    TABLES.sagawa_lead_times.push({ from_zip: TOKYO, to_zip: "9000006", days: 3, source: "tourist_matrix" })
    const to = await resolveSagawaLeadTime(TOKYO, "9000006")
    assert.equal(to?.days, OKINAWA_AIR_DAYS); assert.equal(to?.source, "okinawa_air")
    const from = await resolveSagawaLeadTime("9040000", KANAZAWA)
    assert.equal(from?.days, OKINAWA_AIR_DAYS); assert.equal(from?.source, "okinawa_air")
    assert.equal(sagawaCalls, 0)
  }],
  ["沖縄: 東京→那覇 発送翌日は OK、発送当日は NG", async () => {
    seed()
    assert.equal(await sagawaLeadTimeViolation({ carrier: "sagawa", from: { zip: TOKYO }, to: { zip: "9000006" }, shipmentDate: "2026-11-10", deliveryDate: "2026-11-11" }), null)
    const v = await sagawaLeadTimeViolation({ carrier: "sagawa", from: { zip: TOKYO }, to: { zip: "9000006" }, shipmentDate: "2026-11-10", deliveryDate: "2026-11-10" })
    assert.equal(v?.earliestArrival, "2026-11-11")
  }],

  // ---- 判定 ----
  ["判定: ヤマト便は対象外", async () => {
    seed()
    const v = await sagawaLeadTimeViolation({ carrier: "yamato", from: { zip: HIRO }, to: { zip: TOKYO }, shipmentDate: "2026-11-10", deliveryDate: "2026-11-11" })
    assert.equal(v, null)
  }],
  ["判定: 個人宅の郵便番号でも引ける / 最短日ちょうどは OK", async () => {
    seed()
    const before = await sagawaLeadTimeViolation({ carrier: "sagawa", from: { zip: "730-0011" }, to: { zip: TOKYO }, shipmentDate: "2026-11-10", deliveryDate: "2026-11-11" })
    assert.equal(before?.earliestArrival, "2026-11-12")
    const exact = await sagawaLeadTimeViolation({ carrier: "sagawa", from: { zip: HIRO }, to: { zip: TOKYO }, shipmentDate: "2026-11-10", deliveryDate: "2026-11-12" })
    assert.equal(exact, null)
  }],
  ["午前中の警告: 最短日 (+2日) 着で午前中なら警告 / days 未指定は従来どおり翌日で判定", () => {
    assert.equal(isNextDayEarlySlotRisky("2026-11-10", "2026-11-12", "before-noon", 2), true)
    assert.equal(isNextDayEarlySlotRisky("2026-11-10", "2026-11-11", "before-noon", 2), false)
    assert.equal(isNextDayEarlySlotRisky("2026-11-10", "2026-11-11", "before-noon"), true)
    assert.equal(isNextDayEarlySlotRisky("2026-11-10", "2026-11-12", "not-specified", 2), false)
  }],

  // ---- /api/lead-time ----
  ["API: 広島→東京 / 東京→広島 = 2、広島→金沢 = 1、金沢→広島 = 2", async () => {
    seed()
    const q = async (from: string, to: string) =>
      (await (await leadTimeApi(new NextRequest(`https://bondex.express/api/lead-time?from=${from}&to=${to}&shipmentDate=2026-11-10`))).json()) as { days: number | null; earliestArrival?: string }
    const a = await q(HIRO, TOKYO), b = await q(TOKYO, HIRO), c = await q(HIRO, KANAZAWA), d = await q(KANAZAWA, HIRO)
    console.log("    ", JSON.stringify({ "広島→東京": a, "東京→広島": b, "広島→金沢": c, "金沢→広島": d }))
    assert.equal(a.days, 2); assert.equal(a.earliestArrival, "2026-11-12")
    assert.equal(b.days, 2); assert.equal(c.days, 1); assert.equal(d.days, 2)
  }],
  ["API: place_id でも引ける (Places の郵便番号経由)", async () => {
    seed()
    const r = (await (await leadTimeApi(new NextRequest("https://bondex.express/api/lead-time?from=P_HIRO&to=P_TOKYO&shipmentDate=2026-11-10"))).json()) as { days: number }
    assert.equal(r.days, 2)
  }],
  ["API: 不明なら { days: null }", async () => {
    seed(); sagawaMode = "fail"
    const r = (await (await leadTimeApi(new NextRequest("https://bondex.express/api/lead-time?from=0400001&to=8120011&shipmentDate=2026-11-10"))).json()) as { days: null }
    assert.deepEqual(r, { days: null })
  }],
  ["API: 本番設定 (OPERATOR_PASSWORD あり) で認証なしは 401", async () => {
    process.env.OPERATOR_PASSWORD = "pw"
    try {
      const res = await leadTimeApi(new NextRequest(`https://bondex.express/api/lead-time?from=${HIRO}&to=${TOKYO}&shipmentDate=2026-11-10`))
      assert.equal(res.status, 401)
      const ok = await leadTimeApi(new NextRequest(`https://bondex.express/api/lead-time?from=${HIRO}&to=${TOKYO}&shipmentDate=2026-11-10`, { headers: { authorization: "Bearer pw" } }))
      assert.equal(ok.status, 200)
    } finally {
      delete process.env.OPERATOR_PASSWORD
    }
  }],

  // ---- create route ----
  ["create: 佐川便で最短日より前 → 400 DELIVERY_BEFORE_LEAD_TIME", async () => {
    seed()
    const ship = addDays(jstToday(), 3)
    const res = await createShipment(createReq(createBody({ shipmentDate: ship, deliveryDate: addDays(ship, 1) })))
    const body = (await res.json()) as Record<string, unknown>
    console.log("    ", res.status, JSON.stringify(body))
    assert.equal(res.status, 400)
    assert.equal(body.code, "DELIVERY_BEFORE_LEAD_TIME")
    assert.equal(body.earliestArrival, addDays(ship, 2))
    assert.equal(body.days, 2)
  }],
  ["create: 最短日ちょうどならリードタイムでは弾かない", async () => {
    seed()
    const ship = addDays(jstToday(), 3)
    const body = (await (await createShipment(createReq(createBody({ shipmentDate: ship, deliveryDate: addDays(ship, 2) })))).json()) as Record<string, unknown>
    assert.notEqual(body.code, "DELIVERY_BEFORE_LEAD_TIME")
  }],
  ["create: ヤマト便は影響なし", async () => {
    seed()
    const ship = addDays(jstToday(), 3)
    const body = (await (await createShipment(createReq(createBody({ carrier: "yamato", shipmentDate: ship, deliveryDate: addDays(ship, 1) })))).json()) as Record<string, unknown>
    assert.notEqual(body.code, "DELIVERY_BEFORE_LEAD_TIME")
  }],
  ["create: 日数が不明 (佐川障害) なら通す", async () => {
    seed(); sagawaMode = "fail"
    const ship = addDays(jstToday(), 3)
    const body = (await (await createShipment(createReq(createBody({
      from: { hotel: "どこかのホテル", placeId: "P_UNKNOWN" }, shipmentDate: ship, deliveryDate: addDays(ship, 1),
    })))).json()) as Record<string, unknown>
    assert.notEqual(body.code, "DELIVERY_BEFORE_LEAD_TIME")
  }],
  ["create: deferred (30日超先) も同じ検証を通る (保存しない)", async () => {
    seed()
    const prev = process.env.AUTO_ISSUE_ENABLED
    process.env.AUTO_ISSUE_ENABLED = "true"
    try {
      const ship = addDays(jstToday(), 45)
      const res = await createShipment(createReq(createBody({ shipmentDate: ship, deliveryDate: addDays(ship, 1) })))
      assert.equal(res.status, 400)
      assert.equal(((await res.json()) as { code: string }).code, "DELIVERY_BEFORE_LEAD_TIME")
      assert.equal(SAVED.length, 0, "pending 行を保存しない")
      const ok = await createShipment(createReq(createBody({ shipmentDate: ship, deliveryDate: addDays(ship, 2) })))
      assert.equal(((await ok.json()) as { status: string }).status, "deferred")
      assert.equal(SAVED.length, 1)
    } finally {
      if (prev === undefined) delete process.env.AUTO_ISSUE_ENABLED
      else process.env.AUTO_ISSUE_ENABLED = prev
    }
  }],
]

let failed = 0
void (async () => {
  for (const [name, fn] of tests) {
    try {
      await fn()
      console.log(`  ✓ ${name}`)
    } catch (e) {
      failed++
      console.log(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`)
    }
  }
  void CALLS
  console.log(failed ? `\n${failed} 件失敗 / ${tests.length} 件` : `\n全 ${tests.length} 件 成功`)
  process.exit(failed ? 1 : 0)
})()
