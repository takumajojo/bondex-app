/**
 * 佐川への集荷依頼 (Biz-Logi 連携) の通し試験。運営画面が呼ぶ実際の API ルート → サービス → DB 関数 (sql/062・063)
 * までを、隔離 DB (PGlite) と模擬 Biz-Logi API・模擬 Google Places で動かす。本番 DB・本番 API・SG のテスト環境には触れない。
 *   実行 (PGlite を入れたディレクトリを PGLITE_DIR に指定):
 *   PGLITE_DIR=/path/to/pgtest npx tsx --tsconfig scripts/test-pickup-e2e/tsconfig.json scripts/test-pickup-e2e/run.ts
 */
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { db, hooks, initSchema } from "./fakes/supabase"
import { sentAlerts } from "./fakes/ops-alert"

process.env.MAIL_TEST_CAPTURE = "1" // メールは送らず捕捉する
process.env.TRACKING_SYNC_PAUSED = "false"
// ── 環境変数: 模擬の接続先だけ (実在しないホスト・外部通信は下の fetch で全部止める)
Object.assign(process.env, {
  BIZLOGI_BASE_URL: "https://mock-bizlogi.invalid/api",
  BIZLOGI_ENV: "production", // アプリは production のときだけ送る (P1-6)。接続先は模擬
  BIZLOGI_CUSTOMER_ID: "mockcustomer",
  BIZLOGI_LOGIN_PASSWORD: "mock-password",
  BIZLOGI_KOKYAKU_CODE: "100000000000",
  BIZLOGI_OKURI_CODE: "N01",
  BIZLOGI_LIVE: "true",
  BONDEX_SENDER_PHONE: "03-0000-0000",
  GOOGLE_MAPS_API_KEY: "mock-key",
})

// ── 模擬の外部 API
type Mode = "ok" | "issue-network-error" | "check-network-error" | "issue-error-code" | "issue-no-number"
const mock = { mode: "ok" as Mode, checks: 0, issues: 0, seq: 0, lastIssueXml: "", lastCheckXml: "" }
const tag = (xml: string, t: string) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(xml)?.[1] ?? ""
function shippingXml(body: string, opts: { ok: boolean; number?: string | null; prid?: string | null; codes?: string[] }) {
  const flg = tag(body, "printOutFlg")
  const um = tag(body, "userManageNumber")
  return `<?xml version="1.0" encoding="UTF-8"?><shippingResponse><printOutFlg>${flg}</printOutFlg><okuriCode>N01</okuriCode><outputLevel>000</outputLevel>
<resultCode>${opts.ok ? "S0-0001" : "E8-0001"}</resultCode>${opts.prid ? `<printRequestId>${opts.prid}</printRequestId>` : ""}
<printDataList><printDataDetail><userManageNumber>${um}</userManageNumber><resultCodeList>${(opts.codes ?? [opts.ok ? "S0-0001" : "E2-0004"]).map((c) => `<resultCode>${c}</resultCode>`).join("")}</resultCodeList>
${opts.number ? `<shippingNumberList><shippingNumber>${opts.number}</shippingNumber></shippingNumberList>` : ""}</printDataDetail></printDataList></shippingResponse>`
}
const PLACES: Record<string, { name: string; formatted_address: string; international_phone_number: string }> = {
  "p-from": { name: "テストホテル東京", formatted_address: "日本、〒160-0023 東京都新宿区西新宿2丁目2番1号", international_phone_number: "+81 3-1111-2222" },
  "p-to": { name: "テストホテル京都", formatted_address: "日本、〒600-8216 京都府京都市下京区東塩小路町901", international_phone_number: "+81 75-333-4444" },
  "p-to2": { name: "テストホテル大阪", formatted_address: "日本、〒530-0001 大阪府大阪市北区梅田3丁目1番1号", international_phone_number: "+81 6-5555-6666" },
}
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith("https://mock-bizlogi.invalid/api/shipping")) {
    const body = String(init?.body ?? "")
    const issue = tag(body, "printOutFlg") === "1"
    if (issue) {
      mock.issues++
      mock.lastIssueXml = body
      if (mock.mode === "issue-network-error") throw new TypeError("fetch failed (模擬: 通信断)")
      if (mock.mode === "issue-error-code") return new Response(shippingXml(body, { ok: false, codes: ["E2-0004"] }))
      if (mock.mode === "issue-no-number") return new Response(shippingXml(body, { ok: true, prid: `P-${mock.issues}`, number: null }))
      mock.seq++
      return new Response(shippingXml(body, { ok: true, prid: `P-${mock.issues}`, number: String(100000000000 + mock.seq) }))
    }
    mock.checks++
    mock.lastCheckXml = body
    if (mock.mode === "check-network-error") {
      const e = new Error("This operation was aborted")
      e.name = "AbortError"
      throw e
    }
    return new Response(shippingXml(body, { ok: true }))
  }
  if (url.includes("maps.googleapis.com/maps/api/place/details/json")) {
    const id = new URL(url).searchParams.get("place_id") ?? ""
    const p = PLACES[id]
    return new Response(JSON.stringify(p ? { result: { ...p, address_components: [] } } : {}))
  }
  throw new Error(`外部通信は禁止 (試験): ${url}`)
}) as typeof fetch
void realFetch

let pass = 0
let fail = 0
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    pass++
    console.log(`ok   ${name}`)
  } catch (e) {
    fail++
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`)
  }
}

const jst = (offset: number) => new Date(Date.now() + 9 * 3600 * 1000 + offset * 86_400_000).toISOString().slice(0, 10)
let legSeq = 0
async function newLeg(over: Record<string, unknown> = {}): Promise<string> {
  legSeq++
  const row = {
    booking_id: `BDX-E2E${String(legSeq).padStart(3, "0")}`, leg_index: 0, shipment_date: jst(3), expected_arrival: jst(4),
    from_hotel: "Test Hotel Tokyo", from_place_id: "p-from", to_hotel: "Test Hotel Kyoto", to_place_id: "p-to",
    suitcase_count: 2, delivery_time: "14-16", ...over,
  }
  const cols = Object.keys(row)
  const r = await db.query(`insert into shipments (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`, Object.values(row))
  return r.rows[0].id as string
}
const ship = async (id: string) => (await db.query(`select * from shipments where id=$1`, [id])).rows[0]
const reqs = async (id: string) => (await db.query(`select * from pickup_requests where shipment_id=$1 order by created_at`, [id])).rows

let ip = 0
const call = async (method: "GET" | "POST", path: string, body?: unknown, search = "") => {
  ip++
  const req = new NextRequest(`http://localhost${path}${search}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.${Math.floor(ip / 250)}.${ip % 250}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const mod = path.includes("sagawa-pickup") ? sagawaRoute : pickupRoute
  const res = method === "GET" ? await (mod as { GET: (r: NextRequest) => Promise<Response> }).GET(req) : await mod.POST(req)
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pickupRoute: any, sagawaRoute: any, todoMod: any, watchMod: any, excelMod: any, snapMod: any

async function previewAndSend(id: string, actor = "谷口", overrides?: unknown) {
  const pv = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: id, overrides })
  if (!pv.body.ok) return { pv, send: null }
  const send = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_send", shipmentId: id, fingerprint: pv.body.fingerprint, actor, confirmNoManual: true, overrides })
  return { pv, send }
}

;(async () => {
  await initSchema(process.cwd())
  pickupRoute = await import("../../app/api/operator/pickup-request/route")
  sagawaRoute = await import("../../app/api/operator/sagawa-pickup/route")
  todoMod = await import("../../lib/pickup-request/todo")
  watchMod = await import("../../lib/pickup-request/watch")
  excelMod = await import("../../lib/pickup-request/excel-check")
  snapMod = await import("../../lib/pickup-request/snapshot")
  const { getSupabase } = await import("./fakes/supabase")
  const sb = getSupabase()
  const todo = () => todoMod.loadPickupTodo(sb, jst(0))

  console.log("1. 運営画面からの集荷依頼 (TODO → 確認 → 送信 → 記録)")
  let legA = ""
  let numA = ""
  await test("未依頼の区間が TODO の『依頼が必要』に出る (status=requested)", async () => {
    legA = await newLeg()
    const t = await todo()
    assert.ok(t.needRequest.some((x: { shipmentId: string }) => x.shipmentId === legA))
  })
  await test("パネル: 未依頼・Biz-Logi 利用可", async () => {
    const r = await call("GET", "/api/operator/pickup-request", undefined, `?shipmentId=${legA}`)
    assert.equal(r.status, 200)
    assert.equal(r.body.live, null)
    assert.equal((r.body.bizlogi as { available: boolean }).available, true)
  })
  await test("送信内容の確認 (確認機能のみ・採番なし): 住所・宛名・個数を表示", async () => {
    const c0 = mock.checks, i0 = mock.issues
    const pv = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: legA })
    assert.equal(pv.body.ok, true, JSON.stringify(pv.body))
    assert.equal((pv.body.origin as { name: string }).name, "テストホテル東京")
    assert.equal((pv.body.destination as { address: string }).address, "京都府京都市下京区東塩小路町901")
    assert.equal(mock.checks, c0 + 1)
    assert.equal(mock.issues, i0, "確認では発行依頼を送らない")
  })
  await test("送信 → 受付: 問合番号・発行受付IDを記録し、区間の問合番号と依頼済み印を入れる。配送状態は変えない", async () => {
    const i0 = mock.issues
    const { send } = await previewAndSend(legA)
    assert.equal(send!.status, 200, JSON.stringify(send!.body))
    numA = String(send!.body.shippingNumber)
    const r = (await reqs(legA))[0]
    assert.equal(r.state, "accepted")
    assert.equal(r.channel, "bizlogi")
    assert.equal(r.environment, "production")
    assert.ok(r.print_request_id)
    assert.ok(r.request_snapshot, "依頼内容を保存")
    const s = await ship(legA)
    assert.deepEqual(s.tracking_numbers, [numA])
    assert.ok(s.pickup_requested_at)
    assert.equal(s.status, "requested")
    assert.equal(mock.issues, i0 + 1)
  })
  await test("送信後は TODO の『依頼が必要』から消え、要確認にも出ない", async () => {
    const t = await todo()
    assert.ok(!t.needRequest.some((x: { shipmentId: string }) => x.shipmentId === legA))
    assert.ok(!t.attention.some((x: { shipmentId: string }) => x.shipmentId === legA))
  })

  console.log("2. 同時送信・連続クリック")
  await test("同じ区間へ5つ同時に送信 → 発行依頼は1回・成功1件・残り4件は拒否", async () => {
    const leg = await newLeg()
    const pv = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: leg })
    const i0 = mock.issues
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, k) => call("POST", "/api/operator/pickup-request", { action: "bizlogi_send", shipmentId: leg, fingerprint: pv.body.fingerprint, actor: `担当${k}`, confirmNoManual: true })),
    )
    assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.status)))
    assert.equal(results.filter((r) => r.status === 409).length, 4)
    assert.equal(mock.issues, i0 + 1)
    assert.equal((await reqs(leg)).length, 1, "記録は1件だけ")
  })
  await test("受付済みの区間で送信ボタンを再度押す → 拒否・通信なし", async () => {
    const c0 = mock.checks, i0 = mock.issues
    const r = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: legA })
    assert.equal(r.status, 409)
    assert.equal(mock.checks, c0)
    assert.equal(mock.issues, i0)
  })

  console.log("3. 手動 Excel と Biz-Logi の相互重複防止")
  await test("Excel で依頼済みを記録 → Biz-Logi の確認・送信とも拒否・通信なし", async () => {
    const leg = await newLeg()
    const m = await call("POST", "/api/operator/sagawa-pickup", { shipmentId: leg, actor: "谷口" })
    assert.equal(m.status, 200)
    const c0 = mock.checks, i0 = mock.issues
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: leg })).status, 409)
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "bizlogi_send", shipmentId: leg, fingerprint: "x", actor: "谷口", confirmNoManual: true })).status, 409)
    assert.equal(mock.checks + mock.issues, c0 + i0)
  })
  await test("Biz-Logi で受付済み → 『Excel で依頼済み』を押しても記録は増えない。取り消し (undo) は拒否", async () => {
    const m = await call("POST", "/api/operator/sagawa-pickup", { shipmentId: legA, actor: "谷口" })
    assert.equal(m.body.alreadyRecorded, true)
    assert.equal((await reqs(legA)).length, 1)
    const u = await call("POST", "/api/operator/sagawa-pickup", { shipmentId: legA, actor: "谷口", undo: true })
    assert.equal(u.status, 409)
    assert.equal((await reqs(legA))[0].state, "accepted")
  })
  await test("Excel を作る前の照合 (DB の記録で判定): Biz-Logi 受付済み・Excel 依頼済みは NG、未依頼は OK", async () => {
    const fresh = await newLeg()
    const manualLeg = (await db.query(`select shipment_id from pickup_requests where channel='manual' limit 1`)).rows[0].shipment_id
    const legs = (await db.query(`select id, booking_id, leg_index, status, tracking_numbers, pickup_requested_at from shipments where id = any($1::uuid[])`, [[legA, manualLeg, fresh]])).rows
    const requests = (await db.query(`select * from pickup_requests`)).rows
    const ref = (id: string) => { const l = legs.find((x: { id: string }) => x.id === id); return `${l.booking_id}-L${l.leg_index + 1}` }
    const v = excelMod.checkExcelRows([ref(legA), ref(manualLeg), ref(fresh)], legs, requests)
    assert.deepEqual(v.map((x: { ok: boolean }) => x.ok), [false, false, true])
  })

  console.log("4. 通信タイムアウト・結果不明")
  await test("発行依頼で通信断 → 結果不明 (202)・アラート1件・自動再送なし", async () => {
    const leg = await newLeg()
    mock.mode = "issue-network-error"
    const a0 = sentAlerts.length, i0 = mock.issues
    const { send } = await previewAndSend(leg)
    mock.mode = "ok"
    assert.equal(send!.status, 202)
    assert.equal(send!.body.outcome, "unknown")
    assert.equal(mock.issues, i0 + 1, "発行依頼は1回だけ")
    assert.equal(sentAlerts.length, a0 + 1)
    assert.match(sentAlerts.at(-1)!.subject, /結果不明/)
    assert.equal((await reqs(leg))[0].state, "unknown")
    // ボタンからも Excel 記録からも再依頼できない
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: leg })).status, 409)
    assert.equal((await call("POST", "/api/operator/sagawa-pickup", { shipmentId: leg, actor: "谷口" })).body.alreadyRecorded, true)
    assert.equal(mock.issues, i0 + 1)
    const t = await todo()
    assert.ok(t.attention.some((x: { shipmentId: string; kind: string }) => x.shipmentId === leg && x.kind === "unknown"))
    // 佐川に確認して番号付きで記録 → 受付済み
    const rid = (await reqs(leg))[0].id
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "resolve", requestId: rid, resolveAction: "confirm_accepted", actor: "谷口" })).status, 409, "番号なしでは記録できない")
    const ok = await call("POST", "/api/operator/pickup-request", { action: "resolve", requestId: rid, resolveAction: "confirm_accepted", actor: "谷口", shippingNumber: "123456789012", note: "世田谷に確認" })
    assert.equal(ok.status, 200)
    assert.deepEqual((await ship(leg)).tracking_numbers, ["123456789012"])
  })
  await test("確認機能の段階で通信断 → 未送信として失敗 (422)・発行依頼なし・直して再送できる", async () => {
    const leg = await newLeg()
    const pv = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: leg })
    mock.mode = "check-network-error"
    const i0 = mock.issues
    const s = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_send", shipmentId: leg, fingerprint: pv.body.fingerprint, actor: "谷口", confirmNoManual: true })
    mock.mode = "ok"
    assert.equal(s.status, 422)
    assert.equal(mock.issues, i0)
    assert.equal((await reqs(leg))[0].state, "failed")
    const again = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_send", shipmentId: leg, fingerprint: pv.body.fingerprint, actor: "谷口", confirmNoManual: true })
    assert.equal(again.status, 200)
  })
  await test("佐川がエラーコードを返す → 依頼失敗 (課金なし)・アラートなし", async () => {
    const leg = await newLeg()
    mock.mode = "issue-error-code"
    const a0 = sentAlerts.length
    const { send } = await previewAndSend(leg)
    mock.mode = "ok"
    assert.equal(send!.status, 422)
    assert.equal((await reqs(leg))[0].state, "failed")
    assert.equal(sentAlerts.length, a0)
  })
  await test("正常コードでも問合番号が無い応答 → 受付扱いにせず結果不明", async () => {
    const leg = await newLeg()
    mock.mode = "issue-no-number"
    const { send } = await previewAndSend(leg)
    mock.mode = "ok"
    assert.equal(send!.body.outcome, "unknown")
    assert.equal((await ship(leg)).tracking_numbers, null)
  })

  console.log("5. 佐川は受付・BondEx の保存に失敗")
  await test("受付の保存だけ失敗 → 結果不明で止め、アラートに問合番号。番号で記録して復旧", async () => {
    const leg = await newLeg()
    let failed = false
    hooks.beforeRpc = (name, p) => {
      if (name === "transition_pickup_request" && p.p_to_state === "accepted" && !failed) {
        failed = true
        throw new Error("模擬: DB 保存失敗")
      }
    }
    const a0 = sentAlerts.length
    const { send } = await previewAndSend(leg)
    hooks.beforeRpc = null
    assert.equal(send!.body.outcome, "unknown")
    const alert = sentAlerts.slice(a0).map((a) => a.lines.join(" ")).join(" ")
    const num = /問合番号 (\d{12})/.exec(String(send!.body.reason))?.[1]
    assert.ok(num && alert.includes(num), "アラートに佐川の問合番号を載せる")
    assert.equal((await reqs(leg))[0].state, "unknown")
    const rid = (await reqs(leg))[0].id
    const ok = await call("POST", "/api/operator/pickup-request", { action: "resolve", requestId: rid, resolveAction: "confirm_accepted", actor: "谷口", shippingNumber: num, note: "アラートの番号で記録" })
    assert.equal(ok.status, 200)
    assert.deepEqual((await ship(leg)).tracking_numbers, [num])
  })
  await test("保存が全部失敗 → 記録は『送信中』のまま (再送不可)。5分後の定時処理で1回だけ通知", async () => {
    const leg = await newLeg()
    hooks.beforeRpc = (name) => {
      if (name === "transition_pickup_request") throw new Error("模擬: DB 停止")
    }
    const i0 = mock.issues
    const { send } = await previewAndSend(leg)
    hooks.beforeRpc = null
    assert.equal(send!.body.outcome, "unknown")
    assert.equal((await reqs(leg))[0].state, "sending")
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: leg })).status, 409)
    assert.equal(mock.issues, i0 + 1)
    const later = new Date(Date.now() + 6 * 60 * 1000)
    const recorded: unknown[] = []
    const r1 = await watchMod.alertStaleSending(sb, async (a: unknown) => void recorded.push(a), later)
    const r2 = await watchMod.alertStaleSending(sb, async (a: unknown) => void recorded.push(a), later)
    assert.equal(r1.alerted, 1)
    assert.equal(r2.alerted, 0)
    assert.equal((await reqs(leg))[0].state, "sending", "自動で解放しない")
  })

  console.log("5b. 保存失敗からの復旧後: 正しい区間・状態の正常化・二重防止・追跡/通知/課金の継続")
  await test("アラートの番号で復旧した区間が、そのまま追跡 → 集荷検知 → 代理店通知 → 課金処理まで進む", async () => {
    const leg = await newLeg({ booking_id: "BDX-RECOVER", agency: "T" })
    const other = await newLeg({ booking_id: "BDX-OTHER", agency: "T" })
    let failed = false
    hooks.beforeRpc = (name, p) => {
      if (name === "transition_pickup_request" && p.p_to_state === "accepted" && !failed) { failed = true; throw new Error("模擬: DB 保存失敗") }
    }
    const a0 = sentAlerts.length
    const { send } = await previewAndSend(leg)
    hooks.beforeRpc = null
    assert.equal(send!.body.outcome, "unknown")
    // 1) アラートから番号と区間・記録IDを取り出せる
    const alert = sentAlerts.slice(a0).find((a) => /結果不明/.test(a.subject))!
    const text = alert.lines.join("\n")
    const num = /問合番号 (\d{12})/.exec(text)?.[1]
    const recordId = /記録ID: ([0-9a-f-]{36})/.exec(text)?.[1]
    assert.ok(num, "アラートに問合番号")
    assert.ok(alert.subject.includes("BDX-RECOVER-L1"), "アラートに区間番号")
    assert.equal(recordId, (await reqs(leg))[0].id, "アラートの記録IDはその区間の記録")
    // 2) その記録に番号を付けて受付済みにする (区間は記録に紐付いているので取り違えない)
    const ok = await call("POST", "/api/operator/pickup-request", { action: "resolve", requestId: recordId, resolveAction: "confirm_accepted", actor: "谷口", shippingNumber: num, note: "結果不明アラートの番号で記録" })
    assert.equal(ok.status, 200)
    assert.deepEqual((await ship(leg)).tracking_numbers, [num])
    assert.equal((await ship(other)).tracking_numbers, null, "別の区間には入らない")
    assert.equal((await reqs(leg))[0].state, "accepted")
    // 3) 二重送信の防止は維持 (ボタン・Excel とも)
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: leg })).status, 409)
    assert.equal((await call("POST", "/api/operator/sagawa-pickup", { shipmentId: leg, actor: "谷口" })).body.alreadyRecorded, true)
    assert.ok(!(await todo()).attention.some((x: { shipmentId: string }) => x.shipmentId === leg), "要確認から消える")
    // 4) 追跡 (即時照会の実処理) → 集荷検知 → 代理店へ集荷メール → 課金処理へ
    const { reconcileTrackingNow } = await import("../../lib/tracking/reconcile")
    const { chargeCalls } = await import("./fakes/charge")
    const g = globalThis as unknown as { __capturedMails?: Array<{ subject?: string; to?: unknown }> }
    g.__capturedMails = []
    const provider = { name: "mock", async fetchOne(_c: string, n: string) { return { number: n, noData: false, status: "picked_up" as const, exception: null, collectedAt: "2026-11-05T02:00:00Z" } } }
    const r = await reconcileTrackingNow(sb as never, leg, provider as never)
    const s2 = await ship(leg)
    assert.equal(s2.status, "picked_up", r.note)
    assert.ok(s2.picked_up_at)
    assert.ok((g.__capturedMails ?? []).some((m) => /集荷/.test(String(m.subject))), "代理店へ集荷メール")
    assert.ok(chargeCalls.includes(leg), "集荷確認後に課金処理が呼ばれる")
    // 5) 配達完了まで進む・完了メールは1通
    g.__capturedMails = []
    const done = { name: "mock", async fetchOne(_c: string, n: string) { return { number: n, noData: false, status: "delivered" as const, exception: null, deliveredAt: "2026-11-06T05:00:00Z" } } }
    await reconcileTrackingNow(sb as never, leg, done as never)
    assert.equal((await ship(leg)).status, "delivered")
    assert.equal((g.__capturedMails ?? []).length, 1)
    // 集荷依頼の記録は受付済みのまま (配送状態とは独立)
    assert.equal((await reqs(leg))[0].state, "accepted")
  })

  console.log("6. 依頼後の変更 (ホテル・日時・個数)")
  await test("Biz-Logi 受付済み (番号あり) の区間はホテル変更自体を DB が拒否", async () => {
    await assert.rejects(
      db.query(`select apply_hotel_change($1::uuid,'guest','New','新','p-to2',null,'大阪府',false,null,false,'agency:t','T',true)`, [legA]),
      /physical_gate/,
    )
  })
  let legM = ""
  await test("Excel 依頼済み (番号なし) の区間でホテル変更 → TODO に『世田谷へ変更連絡』と変わった項目", async () => {
    legM = await newLeg()
    await call("POST", "/api/operator/sagawa-pickup", { shipmentId: legM, actor: "谷口" })
    await db.query(`select apply_hotel_change($1::uuid,'guest','Test Hotel Osaka','テストホテル大阪','p-to2',null,'大阪府',false,null,false,'agency:t','T',true)`, [legM])
    const t = await todo()
    const a = t.attention.find((x: { shipmentId: string }) => x.shipmentId === legM)
    assert.equal(a?.kind, "changed_after_request")
    assert.ok(a.changes.includes("到着ホテル"))
  })
  await test("連絡・反映の記録は内容が必須。反映を記録すると要確認から消える", async () => {
    const rid = (await reqs(legM))[0].id
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "resolve", requestId: rid, resolveAction: "start_change", actor: "谷口" })).status, 409)
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "resolve", requestId: rid, resolveAction: "start_change", actor: "谷口", note: "世田谷へ到着先変更をメール" })).status, 200)
    let t = await todo()
    assert.equal(t.attention.find((x: { shipmentId: string }) => x.shipmentId === legM)?.kind, "change_pending")
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "resolve", requestId: rid, resolveAction: "change_done", actor: "谷口" })).status, 409)
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "resolve", requestId: rid, resolveAction: "change_done", actor: "谷口", note: "佐川から反映済みの返信" })).status, 200)
    t = await todo()
    assert.ok(!t.attention.some((x: { shipmentId: string }) => x.shipmentId === legM))
  })
  await test("日時・個数の変更も検知する", async () => {
    await db.query(`update shipments set suitcase_count = 5, shipment_date = shipment_date + 1, expected_arrival = expected_arrival + 1 where id=$1`, [legM])
    const a = (await todo()).attention.find((x: { shipmentId: string }) => x.shipmentId === legM)
    assert.equal(a?.kind, "changed_after_request")
    for (const k of ["集荷日", "配達日", "個数"]) assert.ok(a.changes.includes(k), k)
  })

  console.log("7. キャンセル (世田谷への連絡・確認)")
  await test("依頼済みの区間を取消 → 取消連絡を促す → 連絡 → 佐川の返信で取消完了 → 要確認から消える", async () => {
    const leg = await newLeg()
    await call("POST", "/api/operator/sagawa-pickup", { shipmentId: leg, actor: "谷口" })
    await db.query(`update shipments set status='cancelled' where id=$1`, [leg])
    let t = await todo()
    assert.equal(t.attention.find((x: { shipmentId: string }) => x.shipmentId === leg)?.kind, "cancel_needed")
    const rid = (await reqs(leg))[0].id
    await call("POST", "/api/operator/pickup-request", { action: "resolve", requestId: rid, resolveAction: "start_change", actor: "谷口", note: "世田谷へ取消メール" })
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "resolve", requestId: rid, resolveAction: "cancel_done", actor: "谷口" })).status, 409, "返信内容が必須")
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "resolve", requestId: rid, resolveAction: "cancel_done", actor: "谷口", note: "佐川から取消済みの返信" })).status, 200)
    t = await todo()
    assert.ok(!t.attention.some((x: { shipmentId: string }) => x.shipmentId === leg))
    assert.equal((await reqs(leg))[0].state, "cancelled")
    const pvc = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: leg })
    assert.equal(pvc.body.ok, false, "取消済みは確認でもエラー表示 (送れない)")
    assert.ok((pvc.body.errors as string[]).some((e) => /取消/.test(e)))
  })

  console.log("8. 1個口・40個口・100個口")
  for (const n of [1, 40]) {
    await test(`${n}個口: 電文の配送個口数=${n}・応答の問合番号は1つ`, async () => {
      const leg = await newLeg({ suitcase_count: n })
      const { send } = await previewAndSend(leg)
      assert.equal(send!.status, 200)
      assert.equal(tag(mock.lastIssueXml, "haisoKosu"), String(n))
      assert.equal(tag(mock.lastIssueXml, "okuriCode"), "N01")
      assert.equal(tag(mock.lastIssueXml, "backLayerFlg"), "1")
      assert.ok(tag(mock.lastIssueXml, "shukaIraiCode"), "集荷依頼情報を付ける (N01 で必須)")
      assert.equal((await ship(leg)).tracking_numbers.length, 1)
    })
  }
  await test("100個口: 仕様 (2桁) を超えるので送らずエラー表示・通信なし", async () => {
    const leg = await newLeg({ suitcase_count: 100 })
    const c0 = mock.checks
    const pv = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: leg })
    assert.equal(pv.body.ok, false)
    assert.ok((pv.body.errors as string[]).some((e) => /haisoKosu|個口/.test(e)), JSON.stringify(pv.body.errors))
    assert.equal(mock.checks, c0)
  })

  console.log("9. 大量予約・同時実行 (PGlite・参考値)")
  await test("3,000区間を手動依頼として記録 → TODO の読み込み・100件同時確保 (50区間×2)", async () => {
    await db.query(`insert into shipments (booking_id, leg_index, shipment_date, expected_arrival, from_hotel, to_hotel)
      select 'BDX-BULK'||g, 0, current_date + (g % 90) + 2, current_date + (g % 90) + 3, 'A', 'B' from generate_series(1,3000) g`)
    const ids: string[] = (await db.query(`select id from shipments where booking_id like 'BDX-BULK%' order by booking_id`)).rows.map((r: { id: string }) => r.id)
    let t0 = Date.now()
    for (const id of ids.slice(0, 2950)) {
      await db.query(`select * from claim_pickup_request($1,'manual',null,null,1,current_date,'bulk','o',null,null)`, [id])
    }
    const claimMs = Date.now() - t0
    t0 = Date.now()
    const t = await todo()
    const todoMs = Date.now() - t0
    const targets = ids.slice(2950, 3000)
    t0 = Date.now()
    const results = await Promise.all(
      [...targets, ...targets].map((id) => sb.rpc("claim_pickup_request", { p_shipment_id: id, p_channel: "bizlogi", p_environment: "production", p_manage_number: "X", p_piece_count: 1, p_pickup_date: jst(3), p_actor: "a", p_owner: "o", p_note: null, p_snapshot: null })),
    )
    const parMs = Date.now() - t0
    const claimed = results.filter((r) => (r.data as Array<{ claimed: boolean }> | null)?.[0]?.claimed).length
    console.log(`     2,950件の確保 ${claimMs}ms (1件 ${(claimMs / 2950).toFixed(2)}ms)・TODO 読込 ${todoMs}ms (依頼が必要 ${t.needRequest.length}件)・同時100件 ${parMs}ms`)
    assert.equal(claimed, 50, "同じ区間への2回目はすべて拒否")
    const live = (await db.query(`select count(*)::int n from pickup_requests where shipment_id = any($1::uuid[])`, [targets])).rows[0].n
    assert.equal(live, 50)
  })

  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail ? 1 : 0)
})()
