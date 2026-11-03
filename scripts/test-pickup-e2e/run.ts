/**
 * 佐川への集荷依頼 (Biz-Logi 連携) の通し試験。運営画面が呼ぶ実際の API ルート → サービス → DB 関数 (sql/067・063)
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
const mock = {
  mode: "ok" as Mode, checks: 0, issues: 0, seq: 0, lastIssueXml: "", lastCheckXml: "",
  /** 発行依頼の直前に差し込む処理 (送信中の変更の再現) */
  beforeIssue: null as null | (() => Promise<void>),
}
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
      if (mock.beforeIssue) await mock.beforeIssue()
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

type DbResult = { error: { message: string } | null }
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

  console.log("6. 依頼後の区間の書き換えは DB が止める (Operator の直接編集のすり抜け防止)")
  await test("Biz-Logi 受付済み (番号あり) の区間はホテル変更自体を DB が拒否", async () => {
    await assert.rejects(
      db.query(`select apply_hotel_change($1::uuid,'guest','New','新','p-to2',null,'大阪府',false,null,false,'agency:t','T',true)`, [legA]),
      /physical_gate|pickup_request_live/,
    )
  })
  let legM = ""
  await test("Excel 依頼済み (番号なし) の区間: 本番の apply_hotel_change でもホテルを変えられない", async () => {
    legM = await newLeg()
    await call("POST", "/api/operator/sagawa-pickup", { shipmentId: legM, actor: "谷口" })
    await assert.rejects(
      db.query(`select apply_hotel_change($1::uuid,'guest','Test Hotel Osaka','テストホテル大阪','p-to2',null,'大阪府',false,null,false,'operator:t','T',false)`, [legM]),
      /pickup_request_live/,
    )
    assert.equal((await ship(legM)).to_hotel, "Test Hotel Kyoto")
  })
  await test("運営の訂正画面 (correct) で日程を変えても DB が止め、区間はそのまま", async () => {
    const correct = await import("../../app/api/operator/shipment/[id]/correct/route")
    const before = await ship(legM)
    const req = new NextRequest(`http://localhost/api/operator/shipment/${legM}/correct`, {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.8" },
      body: JSON.stringify({ shipmentDate: jst(5), reason: "訂正" }),
    })
    const res = await correct.POST(req, { params: Promise.resolve({ id: legM }) })
    assert.ok(res.status >= 400, String(res.status))
    assert.equal((await ship(legM)).shipment_date, before.shipment_date)
  })
  await test("各経路と同じ直接の書き込み (日程・個数・代表者名・ホテル・個人宅・時間帯・取消) はすべて拒否", async () => {
    const writes: Array<[string, Record<string, unknown>]> = [
      ["ダッシュボードの日程", { shipment_date: jst(6) }],
      ["個数調整", { suitcase_count: 7 }],
      ["代表者名", { representative: "NEW NAME" }],
      ["受取人", { recipient: "NEW" }],
      ["発送元ホテル", { from_hotel: "Other", from_place_id: "p-to2" }],
      ["到着先の個人宅", { to_residence: { zip: "1600023" } }],
      ["配達時間帯", { delivery_time: "18-20" }],
      ["取消 (ダッシュボード・個数0)", { status: "cancelled" }],
    ]
    for (const [label, patch] of writes) {
      const { error } = (await sb.from("shipments").update(patch).eq("id", legM)) as DbResult
      assert.ok(error && /pickup_request_live/.test(error.message), `${label}: ${error?.message}`)
    }
    const now = await ship(legM)
    assert.equal(now.status, "requested")
    assert.equal(now.suitcase_count, 2)
  })
  await test("佐川に渡す内容以外 (連絡の記録・メモ・依頼済み印・配送状態の前進) は書ける", async () => {
    for (const patch of [{ notes: "メモ" }, { hotel_contact_info: { guest: { memo: "x" } } }, { pickup_requested_at: new Date().toISOString() }, { status: "issued" }]) {
      const { error } = (await sb.from("shipments").update(patch).eq("id", legM)) as DbResult
      assert.ok(!error, error?.message)
    }
  })
  await test("集荷済み以降は対象外 (集荷時の個数訂正・課金の訂正を止めない)", async () => {
    const leg = await newLeg()
    await call("POST", "/api/operator/sagawa-pickup", { shipmentId: leg, actor: "谷口" })
    await db.query(`update shipments set status='picked_up' where id=$1`, [leg])
    await db.query(`update shipments set suitcase_count=4 where id=$1`, [leg])
    assert.equal((await ship(leg)).suitcase_count, 4)
  })
  await test("依頼前の区間は今までどおり直接変更できる (回帰)", async () => {
    const leg = await newLeg()
    await db.query(`update shipments set shipment_date = shipment_date + 1, suitcase_count = 3, representative = 'X', status='cancelled' where id=$1`, [leg])
    assert.equal((await ship(leg)).status, "cancelled")
  })

  console.log("7. 取消は申請 → 世田谷へ連絡 → 取消確認 → 確定")
  await test("依頼済みの区間の取消: 確認の前は区間も配送状態も元のまま。確認後に区間と依頼を同時に取消", async () => {
    const leg = await newLeg()
    await call("POST", "/api/operator/sagawa-pickup", { shipmentId: leg, actor: "谷口" })
    const c = await call("POST", "/api/operator/pickup-request", { action: "change_create", shipmentId: leg, kind: "cancel", fields: {}, reason: "旅行者の都合で取消", actor: "谷口" })
    assert.equal(c.status, 200, JSON.stringify(c.body))
    const id = String(c.body.changeId)
    const step = (b: Record<string, unknown>) => call("POST", "/api/operator/pickup-request", { action: "change_step", changeId: id, actor: "谷口", ...b })
    assert.equal((await step({ step: "contact", note: "世田谷へ取消メール" })).status, 200)
    assert.equal((await ship(leg)).status, "requested", "取消確認の前は取消にしない")
    assert.equal((await reqs(leg))[0].state, "change_pending")
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "change_apply", changeId: id, actor: "谷口" })).status, 409, "確認前は確定できない")
    assert.equal((await step({ step: "approve", note: "佐川から取消済みの返信", numberPolicy: "kept" })).status, 200)
    assert.equal((await ship(leg)).status, "requested", "承認の記録だけでは変えない")
    const ap = await call("POST", "/api/operator/pickup-request", { action: "change_apply", changeId: id, actor: "谷口" })
    assert.equal(ap.status, 200, JSON.stringify(ap.body))
    const s2 = await ship(leg)
    assert.equal(s2.status, "cancelled")
    assert.equal(s2.cancel_source, "sagawa_confirmed")
    assert.equal((await reqs(leg))[0].state, "cancelled")
    const t = await todo()
    assert.ok(!t.attention.some((x: { shipmentId: string }) => x.shipmentId === leg))
    const pvc = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: leg })
    assert.equal(pvc.body.ok, false, "取消済みは送れない")
  })
  await test("取消と問い合わせ番号の保存の競合: 取消済みの区間に番号は保存されない", async () => {
    const leg = await newLeg()
    await db.query(`update shipments set status='cancelled' where id=$1`, [leg])
    // 取消済みの区間には確保できない
    const cl = (await db.query(`select * from claim_pickup_request($1,'bizlogi','production','X',2,current_date,'a','o',null)`, [leg])).rows[0]
    assert.equal(cl.reason, "shipment_cancelled")
    // 確保の後に取消された場合を再現 (移行データなど)。受付の記録が来ても区間に番号を書かない
    const rid = (await db.query(`insert into pickup_requests (shipment_id, booking_id, leg_index, channel, state, attempt_owner) select id, booking_id, leg_index, 'bizlogi', 'sending', 'own' from shipments where id=$1 returning id`, [leg])).rows[0].id
    const tr = (await db.query(`select * from transition_pickup_request($1, array['sending'], 'accepted', 'own', 'a', '500000000099', 'P-x', null, null, null, null)`, [rid])).rows[0]
    assert.equal(tr.reason, "applied_shipment_cancelled")
    const s2 = await ship(leg)
    assert.ok(!s2.tracking_numbers || s2.tracking_numbers.length === 0, "区間に番号が入らない")
    assert.ok(/取消の連絡が必要/.test((await reqs(leg))[0].note))
    // どの経路でも、取消済みの区間に番号は書けない
    const { error } = (await sb.from("shipments").update({ tracking_numbers: ["500000000098"] }).eq("id", leg)) as DbResult
    assert.ok(error && /pickup_lock_cancelled_number/.test(error.message), error?.message)
  })
  await test("送信中 (sending) の区間は取消も変更も止まる", async () => {
    const leg = await newLeg()
    await db.query(`insert into pickup_requests (shipment_id, booking_id, leg_index, channel, state, attempt_owner) select id, booking_id, leg_index, 'bizlogi', 'sending', 'own2' from shipments where id=$1`, [leg])
    await assert.rejects(db.query(`update shipments set status='cancelled' where id=$1`, [leg]), /pickup_request_live/)
    const c = await call("POST", "/api/operator/pickup-request", { action: "change_create", shipmentId: leg, kind: "cancel", fields: {}, reason: "取消", actor: "谷口" })
    assert.equal(c.status, 409)
    assert.match(String(c.body.error), /送信中/)
  })

  console.log("8. 1個口・40個口・100個口")
  for (const n of [1, 19]) {
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
  await test("40個口・100個口: 20個以上のため送らずエラー表示・通信なし (99超の電文の検証は単体試験とテスト環境で確認済み)", async () => {
    for (const n of [40]) {
      const l = await newLeg({ suitcase_count: n })
      const c = mock.checks
      const r = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: l })
      assert.equal(r.body.ok, false)
      assert.equal(mock.checks, c)
    }
    const leg = await newLeg({ suitcase_count: 100 })
    const c0 = mock.checks
    const pv = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: leg })
    assert.equal(pv.body.ok, false)
    assert.ok((pv.body.errors as string[]).some((e) => /haisoKosu|個口|19個まで/.test(e)), JSON.stringify(pv.body.errors))
    assert.equal(mock.checks, c0)
  })

  console.log("10. 20個以上・団体は Biz-Logi で送らない (サーバ・DB で強制)")
  await test("20個: 確認は送信前に拒否・送信も拒否・通信なし。画面情報も『手動手配のみ』", async () => {
    const leg = await newLeg({ suitcase_count: 20 })
    const c0 = mock.checks, i0 = mock.issues
    const pv = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: leg })
    assert.equal(pv.body.ok, false)
    assert.ok((pv.body.errors as string[]).some((e) => /19個まで/.test(e)))
    const send = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_send", shipmentId: leg, fingerprint: "x", actor: "谷口", confirmNoManual: true })
    assert.equal(send.status, 409)
    assert.equal(mock.checks + mock.issues, c0 + i0)
    const g = await call("GET", "/api/operator/pickup-request", undefined, `?shipmentId=${leg}`)
    assert.equal((g.body.eligibility as { ok: boolean }).ok, false)
    const t = await todo()
    assert.ok(t.needRequest.find((x: { shipmentId: string }) => x.shipmentId === leg)?.manualOnlyReason)
  })
  await test("DB 関数でも拒否 (画面・API を通さない確保でも 20個以上・団体は不可)", async () => {
    const leg20 = await newLeg({ suitcase_count: 25 })
    const legG = await newLeg({ suitcase_count: 5, booking_type: "group" })
    const r1 = (await db.query(`select * from claim_pickup_request($1,'bizlogi','production','X',25,current_date,'a','o',null)`, [leg20])).rows[0]
    const r2 = (await db.query(`select * from claim_pickup_request($1,'bizlogi','production','X',5,current_date,'a','o',null)`, [legG])).rows[0]
    assert.equal(r1.reason, "too_many_pieces")
    assert.equal(r2.reason, "group_booking")
  })
  await test("19個は送れる・20個以上でも手動 (Excel) の記録はできる", async () => {
    const leg19 = await newLeg({ suitcase_count: 19 })
    const { send } = await previewAndSend(leg19)
    assert.equal(send!.status, 200)
    const leg30 = await newLeg({ suitcase_count: 30 })
    assert.equal((await call("POST", "/api/operator/sagawa-pickup", { shipmentId: leg30, actor: "谷口" })).status, 200)
    assert.equal((await reqs(leg30))[0].channel, "manual")
  })

  console.log("11. 受付後のホテル変更 (佐川の回答を記録してから反映)")
  const change = (body: Record<string, unknown>) => call("POST", "/api/operator/pickup-request", { actor: "谷口", ...body })
  const changes = async (leg: string) => (await db.query(`select *, stage as state from shipment_change_requests where shipment_id=$1 and kind not in ('correction','fields') order by created_at`, [leg])).rows
  let legH = ""
  let numH = ""
  await test("佐川の回答前は区間のホテル情報を変えない (登録・連絡の段階・反映の先回りは拒否)", async () => {
    legH = await newLeg()
    const { send } = await previewAndSend(legH)
    numH = String(send!.body.shippingNumber)
    const before = await ship(legH)
    const c = await change({ action: "change_create", shipmentId: legH, side: "guest", newHotel: "Test Hotel Osaka", newHotelJa: "テストホテル大阪", newPlaceId: "p-to2", newPrefecture: "大阪府", reason: "旅行者の宿泊先変更" })
    assert.equal(c.status, 200, JSON.stringify(c.body))
    const id = String(c.body.changeId)
    assert.equal((await change({ action: "change_apply", changeId: id })).status, 409, "未承認は反映できない")
    assert.equal((await change({ action: "change_step", changeId: id, step: "approve", note: "x", numberPolicy: "kept" })).status, 409, "連絡前に承認は記録できない")
    assert.equal((await change({ action: "change_step", changeId: id, step: "contact" })).status, 409, "連絡内容が必須")
    assert.equal((await change({ action: "change_step", changeId: id, step: "contact", note: "世田谷へ到着先変更をメール" })).status, 200)
    assert.equal((await reqs(legH))[0].state, "change_pending")
    assert.equal((await change({ action: "change_apply", changeId: id })).status, 409, "回答待ちは反映できない")
    const now = await ship(legH)
    assert.equal(now.to_hotel, before.to_hotel)
    assert.equal(now.to_place_id, before.to_place_id)
    assert.equal((await change({ action: "change_create", shipmentId: legH, side: "guest", newHotel: "X", newPlaceId: "p-to2", reason: "r" })).status, 409, "進行中の変更は1件まで")
  })
  await test("二重集荷依頼の防止: 変更の途中でも Biz-Logi の送信・Excel の記録はできない", async () => {
    const i0 = mock.issues
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: legH })).status, 409)
    assert.equal((await call("POST", "/api/operator/sagawa-pickup", { shipmentId: legH, actor: "谷口" })).body.alreadyRecorded, true)
    assert.equal(mock.issues, i0)
    assert.equal((await reqs(legH)).length, 1)
  })
  await test("佐川が承認 (番号維持) → 反映: ホテル更新・履歴保存・番号そのまま・要確認に出ない", async () => {
    const id = (await changes(legH))[0].id
    assert.equal((await change({ action: "change_step", changeId: id, step: "approve", note: "佐川: 変更可・番号そのまま", numberPolicy: "kept", newNumber: "123" })).status, 409, "維持なのに新番号は不可")
    assert.equal((await change({ action: "change_step", changeId: id, step: "approve", note: "佐川: 変更可・番号そのまま", numberPolicy: "kept" })).status, 200)
    assert.equal((await change({ action: "change_apply", changeId: id })).status, 200)
    const s2 = await ship(legH)
    assert.equal(s2.to_hotel, "Test Hotel Osaka")
    assert.equal(s2.to_place_id, "p-to2")
    assert.deepEqual(s2.tracking_numbers, [numH])
    const r = (await reqs(legH))[0]
    assert.equal(r.state, "accepted")
    assert.equal(r.shipping_number, numH)
    const hist = (await db.query(`select * from shipment_hotel_changes where shipment_id=$1`, [legH])).rows
    assert.equal(hist.length, 1)
    assert.equal(hist[0].old_hotel, "Test Hotel Kyoto")
    assert.match(hist[0].reason, /佐川の回答/)
    const c = (await changes(legH))[0]
    assert.equal(c.state, "applied")
    assert.equal(c.before.to_hotel, "Test Hotel Kyoto", "変更前の内容を申請に残す")
    assert.ok(c.hotel_change_id)
    assert.ok(!(await todo()).attention.some((x: { shipmentId: string }) => x.shipmentId === legH), "依頼内容も更新され、変更連絡の催促は出ない")
  })
  let legN = ""
  let oldN = ""
  await test("番号の振り直し: 形式・同じ番号・他の区間で使用中を拒否", async () => {
    legN = await newLeg({ agency: "T" })
    const { send } = await previewAndSend(legN)
    oldN = String(send!.body.shippingNumber)
    const c = await change({ action: "change_create", shipmentId: legN, side: null, reason: "佐川が番号を振り直し" })
    const id = String(c.body.changeId)
    await change({ action: "change_step", changeId: id, step: "contact", note: "世田谷へ確認" })
    for (const [num, why] of [["12345", "形式"], [oldN, "同じ番号"], [numH, "他の区間で使用中"]] as const) {
      const r = await change({ action: "change_step", changeId: id, step: "approve", note: "佐川: 新番号", numberPolicy: "changed", newNumber: num })
      assert.equal(r.status, 409, why)
    }
    assert.equal((await changes(legN))[0].state, "contacted")
  })
  await test("番号の振り直し → 反映: 旧番号と追跡明細を履歴に退避・区間と記録を新番号にそろえる", async () => {
    await db.query(`update shipments set tracking_detail = '[{"number":"x","queryCount":3}]'::jsonb where id=$1`, [legN])
    const id = (await changes(legN))[0].id
    assert.equal((await change({ action: "change_step", changeId: id, step: "approve", note: "佐川: 新番号 2000-0000-0001", numberPolicy: "changed", newNumber: "2000-0000-0001" })).status, 200)
    assert.equal((await change({ action: "change_apply", changeId: id })).status, 200)
    const s2 = await ship(legN)
    assert.deepEqual(s2.tracking_numbers, ["200000000001"])
    assert.equal(s2.tracking_detail, null, "新番号で追跡をやり直す")
    assert.equal((await reqs(legN))[0].shipping_number, "200000000001")
    const c = (await changes(legN))[0]
    assert.equal(c.old_shipping_number, oldN)
    assert.deepEqual(c.old_tracking_numbers, [oldN])
    assert.ok(c.old_tracking_detail, "旧番号の追跡明細を保存")
    assert.equal(s2.to_hotel, "Test Hotel Kyoto", "番号だけの変更ではホテルは変えない")
  })
  await test("振り直し後の追跡・通知・課金: 新番号だけを照会し、集荷メール・課金は1回ずつ", async () => {
    const { reconcileTrackingNow } = await import("../../lib/tracking/reconcile")
    const { chargeCalls } = await import("./fakes/charge")
    const queried: string[] = []
    const g = globalThis as unknown as { __capturedMails?: Array<{ subject?: string }> }
    g.__capturedMails = []
    const c0 = chargeCalls.filter((x) => x === legN).length
    const prov = { name: "mock", async fetchOne(_c: string, n: string) { queried.push(n); return { number: n, noData: false, status: "picked_up" as const, exception: null } } }
    await reconcileTrackingNow(sb as never, legN, prov as never)
    await reconcileTrackingNow(sb as never, legN, prov as never)
    assert.ok(queried.length > 0 && queried.every((n) => n === "200000000001") && !queried.some((n) => n === oldN), JSON.stringify(queried))
    assert.equal((await ship(legN)).status, "picked_up")
    assert.equal((g.__capturedMails ?? []).filter((m) => /集荷/.test(String(m.subject))).length, 1)
    assert.equal(chargeCalls.filter((x) => x === legN).length - c0, 1)
  })
  await test("佐川が変更不可と回答 → 区間の情報はそのまま・集荷依頼は受付済みに戻る", async () => {
    const leg = await newLeg()
    await previewAndSend(leg)
    const before = await ship(leg)
    const c = await change({ action: "change_create", shipmentId: leg, side: "pickup", newHotel: "Other", newPlaceId: "p-to2", reason: "発送元の変更希望" })
    const id = String(c.body.changeId)
    await change({ action: "change_step", changeId: id, step: "contact", note: "世田谷へ連絡" })
    assert.equal((await change({ action: "change_step", changeId: id, step: "reject", note: "佐川: 集荷当日のため変更不可" })).status, 200)
    const after = await ship(leg)
    assert.equal(after.from_hotel, before.from_hotel)
    assert.deepEqual(after.tracking_numbers, before.tracking_numbers)
    assert.equal((await reqs(leg))[0].state, "accepted")
    assert.equal((await changes(leg))[0].state, "rejected")
    assert.equal((await change({ action: "change_apply", changeId: id })).status, 409)
  })
  await test("集荷済み以降は申請できない。依頼前の区間の申請は佐川への連絡なし (運営の承認で反映)", async () => {
    const fresh = await newLeg()
    const pre = await change({ action: "change_create", shipmentId: fresh, side: "guest", newHotel: "X", newPlaceId: "p-to2", reason: "r" })
    assert.equal(pre.status, 200, JSON.stringify(pre.body))
    assert.equal((await changes(fresh))[0].needs_sagawa, false)
    assert.equal((await change({ action: "change_step", changeId: pre.body.changeId, step: "contact", note: "x" })).status, 409, "依頼前は世田谷への連絡は不要")
    assert.equal((await change({ action: "change_create", shipmentId: legN, side: "guest", newHotel: "X", newPlaceId: "p-to2", reason: "r" })).status, 409, "legN は集荷済み")
  })
  await test("運営の番号入力で、集荷依頼の記録と紐付いた番号は書き換えられない (振り直しは変更の記録から)", async () => {
    const edit = await import("../../app/api/operator/shipment/[id]/edit/route")
    const leg = await newLeg()
    const { send } = await previewAndSend(leg)
    const req = new NextRequest(`http://localhost/api/operator/shipment/${leg}/edit`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" }, body: JSON.stringify({ tracking: ["300000000003"] }) })
    const res = await edit.POST(req, { params: Promise.resolve({ id: leg }) })
    assert.equal(res.status, 409)
    assert.deepEqual((await ship(leg)).tracking_numbers, [String(send!.body.shippingNumber)])
  })
  await test("手動 (Excel) で依頼した番号なしの区間: 運営のホテル変更も直接はできず、変更申請から進める (2026-11-04 決定で変更)", async () => {
    const leg = await newLeg()
    await call("POST", "/api/operator/sagawa-pickup", { shipmentId: leg, actor: "谷口" })
    await assert.rejects(
      db.query(`select apply_hotel_change($1::uuid,'guest','Test Hotel Osaka','テストホテル大阪','p-to2',null,'大阪府',false,null,false,'operator:t','T',false) as id`, [leg]),
      /pickup_request_live/,
    )
    const c = await change({ action: "change_create", shipmentId: leg, side: "guest", newHotel: "Test Hotel Osaka", newHotelJa: "テストホテル大阪", newPlaceId: "p-to2", reason: "宿泊先変更" })
    assert.equal(c.status, 200, JSON.stringify(c.body))
    assert.equal((await changes(leg))[0].needs_sagawa, true, "手動の依頼でも世田谷への連絡が要る申請になる")
  })

  await test("変更先ホテルは Google で確認できる place_id だけ (手入力・存在しない place_id は登録しない)", async () => {
    const leg = await newLeg()
    await previewAndSend(leg)
    const bad = await change({ action: "change_create", shipmentId: leg, side: "guest", newHotel: "Typed Hotel", newPlaceId: "typed-by-hand", reason: "r" })
    assert.equal(bad.status, 422, JSON.stringify(bad.body))
    assert.match(String(bad.body.error), /検索し直して/)
    assert.equal((await changes(leg)).length, 0, "記録は作らない")
    assert.equal((await reqs(leg))[0].state, "accepted", "集荷依頼の状態も変えない")
    // 都道府県・市区は Google の値を正とする (画面から別の値が来ても上書き)
    const ok = await change({ action: "change_create", shipmentId: leg, side: "guest", newHotel: "Test Hotel Osaka", newHotelJa: "テストホテル大阪", newPlaceId: "p-to2", newPrefecture: "嘘県", reason: "r" })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal((await changes(leg))[0].fields.to_prefecture, "大阪府")
    assert.equal((await ship(leg)).to_place_id, "p-to", "登録だけではホテルは変わらない")
  })

  console.log("12. 代理店のホテル変更 (ポータルの表示と API の判定の一致)")
  const agencyHotel = async (id: string, body: Record<string, unknown>) => {
    const { AGENCY_TEST_TOKEN } = await import("./fakes/supabase")
    const route = await import("../../app/api/agency/shipment/[id]/hotel-change/route")
    ip++
    const req = new NextRequest(`http://localhost/api/agency/shipment/${id}/hotel-change`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${AGENCY_TEST_TOKEN}`, "x-forwarded-for": `10.8.${Math.floor(ip / 250)}.${ip % 250}` },
      body: JSON.stringify(body),
    })
    const res = await route.POST(req, { params: Promise.resolve({ id }) })
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }
  const hotelBody = { side: "guest", newHotel: "Test Hotel Osaka", newHotelJa: "テストホテル大阪", newPlaceId: "p-to2", newPrefecture: "大阪府" }
  const REQ_MSG = /変更申請として受け付けました/
  await test("代理店: 佐川へ依頼済み (Excel・番号なし) のホテル変更 → 変更申請 (202)・ホテルはそのまま", async () => {
    const leg = await newLeg()
    await call("POST", "/api/operator/sagawa-pickup", { shipmentId: leg, actor: "谷口" })
    const r = await agencyHotel(leg, hotelBody)
    assert.equal(r.status, 202, JSON.stringify(r.body))
    assert.match(String(r.body.message), REQ_MSG)
    assert.equal((await ship(leg)).to_hotel, "Test Hotel Kyoto")
    const c = (await changes(leg))[0]
    assert.equal(c.kind, "hotel_guest")
    assert.equal(c.needs_sagawa, true)
    assert.equal(c.requested_by, "agency")
    assert.equal(c.fields.to_prefecture, "大阪府", "都道府県は Google の値")
  })
  await test("代理店: Biz-Logi で受付済み (番号あり) も同じく変更申請", async () => {
    const leg = await newLeg()
    await previewAndSend(leg)
    const r = await agencyHotel(leg, hotelBody)
    assert.equal(r.status, 202, JSON.stringify(r.body))
    assert.equal((await ship(leg)).to_hotel, "Test Hotel Kyoto")
  })
  await test("代理店: 未依頼・締切前は直接変更・集荷済みは従来の手配済み", async () => {
    const free = await newLeg()
    const ok = await agencyHotel(free, hotelBody)
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal((await ship(free)).to_hotel, "Test Hotel Osaka")
    const picked = await newLeg({ status: "picked_up", tracking_numbers: JSON.stringify(["400000000001"]), pickup_requested_at: new Date().toISOString() })
    const p = await agencyHotel(picked, hotelBody)
    assert.equal(p.status, 409)
    assert.equal(p.body.error, "LOCKED", "集荷済み以降は従来の文言")
  })
  await test("ポータルの表示判定 (agencyHotelChangeLock・agencyChangeMode) が API の結果と一致", async () => {
    const { agencyHotelChangeLock, agencyChangeMode } = await import("../../lib/agency-self-service")
    const cases: Array<[string, Record<string, unknown>]> = [
      ["excel", {}],
      ["bizlogi", {}],
      ["free", {}],
      ["picked", { status: "picked_up", tracking_numbers: JSON.stringify(["400000000002"]) }],
    ]
    for (const [kind, over] of cases) {
      const leg = await newLeg(over)
      if (kind === "excel") await call("POST", "/api/operator/sagawa-pickup", { shipmentId: leg, actor: "谷口" })
      if (kind === "bizlogi") await previewAndSend(leg)
      const row = await ship(leg)
      const ui = agencyHotelChangeLock(row)
      const api = await agencyHotel(leg, hotelBody)
      const apiKind = api.status === 202 ? "request" : api.status === 409 && api.body.error === "LOCKED" ? "locked" : api.status === 200 ? null : `?${api.status}`
      assert.equal(apiKind, ui, `${kind}: 表示=${ui} API=${api.status} ${JSON.stringify(api.body)}`)
      const mode = agencyChangeMode(row)
      assert.equal(mode, kind === "excel" || kind === "bizlogi" ? "request" : kind === "picked" ? "locked" : "direct", kind)
    }
  })

  console.log("13. 送信と変更の競合・確保時の依頼内容と電文の一致 (段階A)")
  await test("送信中 (確保の後・発行依頼の通信中) の変更は DB が止め、電文と DB の依頼内容が一致する", async () => {
    const leg = await newLeg({ suitcase_count: 3 })
    let blockedMsg = ""
    mock.beforeIssue = async () => {
      const { error } = (await sb.from("shipments").update({ suitcase_count: 9, shipment_date: jst(7) }).eq("id", leg)) as DbResult
      blockedMsg = error?.message ?? "通ってしまった"
    }
    const { send } = await previewAndSend(leg)
    mock.beforeIssue = null
    assert.equal(send!.status, 200, JSON.stringify(send!.body))
    assert.match(blockedMsg, /pickup_request_live/)
    const s2 = await ship(leg)
    const snap = (await reqs(leg))[0].request_snapshot
    assert.equal(s2.suitcase_count, 3)
    assert.equal(snap.suitcase_count, 3)
    assert.equal(tag(mock.lastIssueXml, "haisoKosu"), String(snap.suitcase_count), "電文の個数 = 依頼内容")
    const digits = (v: unknown) => String(v ?? "").replace(/[^0-9]/g, "")
    assert.equal(digits(tag(mock.lastIssueXml, "shukaIraiShiteiDate")), digits(snap.shipment_date), "電文の集荷日 = 依頼内容")
    assert.equal(digits(tag(mock.lastIssueXml, "shiteiDate")), digits(snap.expected_arrival), "電文の配達指定日 = 依頼内容")
    assert.equal(snap.shipment_date, s2.shipment_date)
  })
  await test("確認のあと・確保の前に変更が入ったら送らない (依頼は void・通信なし・番号なし)", async () => {
    const leg = await newLeg()
    const pv = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: leg })
    assert.equal(pv.body.ok, true)
    // 送信処理が区間を読んだ直後 (確保の直前) に代理店が日程を変えた状況
    hooks.beforeRpc = (name) => {
      if (name === "claim_pickup_request") {
        hooks.beforeRpc = null
        void db.query(`update shipments set expected_arrival = expected_arrival + 1 where id=$1`, [leg])
      }
    }
    const i0 = mock.issues, c0 = mock.checks
    const send = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_send", shipmentId: leg, fingerprint: pv.body.fingerprint, actor: "谷口", confirmNoManual: true })
    hooks.beforeRpc = null
    assert.equal(send.status, 409, JSON.stringify(send.body))
    assert.match(String(send.body.reason), /区間が変わりました/)
    assert.equal(mock.issues, i0, "発行依頼は送らない")
    assert.equal(mock.checks, c0, "確認機能も送らない")
    assert.equal((await reqs(leg))[0].state, "void")
    assert.ok(!(await ship(leg)).tracking_numbers)
    // 確認し直せば送れる
    const { send: again } = await previewAndSend(leg)
    assert.equal(again!.status, 200)
  })
  await test("正式な承認後の反映: 日程の申請 (依頼後) → 連絡 → 承認 → 反映で区間と依頼内容がそろう", async () => {
    const leg = await newLeg()
    await previewAndSend(leg)
    const before = await ship(leg)
    const c = await call("POST", "/api/operator/pickup-request", { action: "change_create", shipmentId: leg, kind: "dates", fields: { shipment_date: jst(5), expected_arrival: jst(6) }, reason: "旅程変更", actor: "谷口" })
    assert.equal(c.status, 200, JSON.stringify(c.body))
    const id = String(c.body.changeId)
    const step = (b: Record<string, unknown>) => call("POST", "/api/operator/pickup-request", { action: "change_step", changeId: id, actor: "谷口", ...b })
    assert.equal((await step({ step: "approve", note: "x", numberPolicy: "kept" })).status, 409, "連絡の前に承認は記録できない")
    assert.equal((await step({ step: "contact", note: "世田谷へ日程変更をメール" })).status, 200)
    assert.equal((await ship(leg)).shipment_date, before.shipment_date, "回答前は変えない")
    assert.equal((await step({ step: "approve", note: "佐川: 変更可・番号そのまま", numberPolicy: "kept" })).status, 200)
    assert.equal((await ship(leg)).shipment_date, before.shipment_date, "承認の記録だけでは変えない")
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "change_apply", changeId: id, actor: "谷口" })).status, 200)
    const s2 = await ship(leg)
    const r = (await reqs(leg))[0]
    assert.equal(s2.shipment_date, jst(5))
    assert.equal(r.state, "accepted")
    assert.equal(r.request_snapshot.shipment_date, jst(5), "依頼内容も新しい日程")
    assert.deepEqual(s2.tracking_numbers, before.tracking_numbers, "番号は維持")
    assert.equal((await changes(leg))[0].before.shipment_date, before.shipment_date, "変更前を残す")
  })
  await test("代表者名の申請 (依頼後) は佐川の確認後に反映", async () => {
    const leg = await newLeg()
    await previewAndSend(leg)
    const c = await call("POST", "/api/operator/pickup-request", { action: "change_create", shipmentId: leg, kind: "representative", fields: { representative: "JANE DOE", recipient: "JANE DOE" }, reason: "代表者の変更", actor: "谷口" })
    const id = String(c.body.changeId)
    await call("POST", "/api/operator/pickup-request", { action: "change_step", changeId: id, actor: "谷口", step: "contact", note: "世田谷へ連絡" })
    assert.equal((await ship(leg)).representative, "TEST GUEST")
    await call("POST", "/api/operator/pickup-request", { action: "change_step", changeId: id, actor: "谷口", step: "approve", note: "佐川: 了解", numberPolicy: "kept" })
    await call("POST", "/api/operator/pickup-request", { action: "change_apply", changeId: id, actor: "谷口" })
    assert.equal((await ship(leg)).representative, "JANE DOE")
  })
  await test("19個 → 25個: 大口の印。佐川が承認すれば依頼を残して反映、不可なら個別再手配 (今の依頼を取消・手動で依頼し直し)", async () => {
    const leg = await newLeg({ suitcase_count: 19 })
    await previewAndSend(leg)
    const c = await call("POST", "/api/operator/pickup-request", { action: "change_create", shipmentId: leg, kind: "count", fields: { suitcase_count: 25 }, reason: "個数追加", actor: "谷口" })
    const id = String(c.body.changeId)
    assert.equal((await changes(leg))[0].large_lot, true, "20個以上は大口の印")
    await call("POST", "/api/operator/pickup-request", { action: "change_step", changeId: id, actor: "谷口", step: "contact", note: "世田谷へ 25個で対応可能か確認" })
    await call("POST", "/api/operator/pickup-request", { action: "change_step", changeId: id, actor: "谷口", step: "approve", note: "佐川: 今の番号で対応可", numberPolicy: "kept" })
    await call("POST", "/api/operator/pickup-request", { action: "change_apply", changeId: id, actor: "谷口" })
    assert.equal((await ship(leg)).suitcase_count, 25)
    assert.equal((await reqs(leg))[0].state, "accepted", "依頼を維持")
    // 不可の場合: 個別再手配
    const leg2 = await newLeg({ suitcase_count: 19 })
    await previewAndSend(leg2)
    const c2 = await call("POST", "/api/operator/pickup-request", { action: "change_create", shipmentId: leg2, kind: "rearrange", fields: { suitcase_count: 30 }, reason: "大口へ変更", actor: "谷口" })
    const id2 = String(c2.body.changeId)
    await call("POST", "/api/operator/pickup-request", { action: "change_step", changeId: id2, actor: "谷口", step: "contact", note: "世田谷へ確認" })
    await call("POST", "/api/operator/pickup-request", { action: "change_step", changeId: id2, actor: "谷口", step: "approve", note: "佐川: 今の依頼は取消・手配し直し", numberPolicy: "kept" })
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "change_apply", changeId: id2, actor: "谷口" })).status, 200)
    assert.equal((await ship(leg2)).suitcase_count, 30)
    assert.equal((await reqs(leg2))[0].state, "cancelled", "今の依頼は取消")
    assert.equal((await ship(leg2)).pickup_requested_at, null, "未依頼に戻る")
    const i0 = mock.issues
    const pv = await call("POST", "/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: leg2 })
    assert.ok(pv.status === 409 || pv.body.ok === false, "30個は Biz-Logi では送らない")
    assert.equal(mock.issues, i0)
    assert.equal((await call("POST", "/api/operator/sagawa-pickup", { shipmentId: leg2, actor: "谷口" })).status, 200, "手動 (Excel) で依頼し直して記録できる")
  })
  await test("変更申請の重複防止と、承認の手順の飛ばし・偽装の拒否", async () => {
    const leg = await newLeg()
    await previewAndSend(leg)
    const c = await call("POST", "/api/operator/pickup-request", { action: "change_create", shipmentId: leg, kind: "count", fields: { suitcase_count: 3 }, reason: "r", actor: "谷口" })
    const id = String(c.body.changeId)
    const dup = await call("POST", "/api/operator/pickup-request", { action: "change_create", shipmentId: leg, kind: "dates", fields: { expected_arrival: jst(9) }, reason: "r", actor: "谷口" })
    assert.equal(dup.status, 409)
    assert.match(String(dup.body.error), /進行中の変更申請/)
    // 承認前に反映の印を付けられない
    await assert.rejects(db.query(`update shipment_change_requests set apply_txid = txid_current() where id=$1`, [id]), /apply_txid requires an approved/)
    // 旧来の承認 (status だけ) は使えない
    await assert.rejects(db.query(`update shipment_change_requests set status='approved' where id=$1`, [id]), /needs_sagawa/)
    // 連絡の前に approved へ飛ばせない
    await assert.rejects(db.query(`update shipment_change_requests set stage='approved' where id=$1`, [id]), /invalid_stage/)
    await call("POST", "/api/operator/pickup-request", { action: "change_step", changeId: id, actor: "谷口", step: "contact", note: "連絡" })
    // 連絡の後に申請の中身を書き換えられない
    await assert.rejects(db.query(`update shipment_change_requests set fields='{"suitcase_count":15}' where id=$1`, [id]), /immutable/)
    await call("POST", "/api/operator/pickup-request", { action: "change_step", changeId: id, actor: "谷口", step: "approve", note: "佐川: 可", numberPolicy: "kept" })
    // 承認済みの申請に別のトランザクションで反映の印を付けても、区間の書き換えは通らない
    await db.query(`update shipment_change_requests set apply_txid = txid_current() where id=$1`, [id])
    await assert.rejects(db.query(`update shipments set suitcase_count = 3 where id=$1`, [leg]), /pickup_request_live/)
    // 同じトランザクションでも、申請の種類にない項目は変えられない
    await db.exec("begin")
    await db.query(`update shipment_change_requests set apply_txid = txid_current() where id=$1`, [id])
    let fieldErr = ""
    try { await db.query(`update shipments set suitcase_count = 3, shipment_date = shipment_date + 1 where id=$1`, [leg]) } catch (e) { fieldErr = (e as Error).message }
    await db.exec("rollback")
    assert.match(fieldErr, /pickup_lock_field/)
    // 正規の反映は通る
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "change_apply", changeId: id, actor: "谷口" })).status, 200)
    assert.equal((await ship(leg)).suitcase_count, 3)
    // 反映済みの申請をもう一度使っても書き換えられない
    await assert.rejects(db.query(`update shipments set suitcase_count = 4 where id=$1`, [leg]), /pickup_request_live/)
  })
  await test("実行権限: 申請・反映の関数とトリガーは匿名・代理店のロールから呼べない", async () => {
    for (const fn of ["public.apply_shipment_change(uuid,text)", "public.step_shipment_change(uuid,text,text,text,text,text)", "public.create_shipment_change(uuid,text,jsonb,text,text,text,text)", "public.claim_pickup_request(uuid,text,text,text,integer,date,text,text,text)"]) {
      const r = (await db.query(`select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') b`, [fn])).rows[0]
      assert.ok(!r.a && !r.b, fn)
    }
  })
  await test("旧来の代理店の締切後の申請 (依頼前) は今までどおり積めて、承認で反映できる (回帰)", async () => {
    const leg = await newLeg()
    // 代理店 PATCH (app/api/agency/shipment/[id]/route.ts) と同じ項目で積む (kind・stage は渡さない)
    await db.query(`insert into shipment_change_requests (shipment_id, booking_id, leg_index, requested_by, requester, agency, fields, status, over_deadline) values ($1,'BDX-OLD',0,'agency','T','T','{"suitcase_count":4}','pending',true)`, [leg])
    const row = (await db.query(`select * from shipment_change_requests where shipment_id=$1`, [leg])).rows[0]
    assert.equal(row.kind, "fields")
    assert.equal(row.stage, "requested")
    await db.query(`update shipments set suitcase_count = 4 where id=$1`, [leg])
    await db.query(`update shipment_change_requests set status='approved', decided_by='op' where id=$1`, [row.id])
    assert.equal((await db.query(`select stage from shipment_change_requests where id=$1`, [row.id])).rows[0].stage, "applied")
  })

  console.log("14. 段階C: 18:30 締切・代理店の変更申請・Operator の直接編集の案内")
  // 時計を動かす (経過時間はそのまま・指定の時刻から)。DB の now() は実時間のまま。
  const RealDate = Date
  let clockOffset = 0
  class ClockDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + clockOffset)
      else super(...(args as [string]))
    }
    static now() {
      return RealDate.now() + clockOffset
    }
  }
  globalThis.Date = ClockDate as unknown as DateConstructor
  const setJst = (ymd: string, hm: string) => {
    clockOffset = RealDate.parse(`${ymd}T${hm}+09:00`) - RealDate.now()
  }
  const resetClock = () => {
    clockOffset = 0
  }
  const dayBefore = (ymd: string) => new RealDate(RealDate.parse(`${ymd}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  const agencyPatch = async (id: string, body: Record<string, unknown>) => {
    const { AGENCY_TEST_TOKEN } = await import("./fakes/supabase")
    const route = await import("../../app/api/agency/shipment/[id]/route")
    ip++
    const req = new NextRequest(`http://localhost/api/agency/shipment/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${AGENCY_TEST_TOKEN}`, "x-forwarded-for": `10.7.${Math.floor(ip / 250)}.${ip % 250}` },
      body: JSON.stringify(body),
    })
    const res = await route.PATCH(req, { params: Promise.resolve({ id }) })
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }
  const D = jst(3)
  await test("締切の関数: 集荷前日 18:29:59 は前・18:30:00 と 18:31 は後 (JST)", async () => {
    const { isPastPickupCutoff, pickupCutoffAt, earliestBookableShipDate } = await import("../../lib/pickup-cutoff")
    const prev = dayBefore(D)
    assert.equal(pickupCutoffAt(D), new RealDate(`${prev}T18:30:00+09:00`).toISOString())
    assert.equal(isPastPickupCutoff(D, new RealDate(`${prev}T18:29:59.999+09:00`)), false)
    assert.equal(isPastPickupCutoff(D, new RealDate(`${prev}T18:30:00+09:00`)), true)
    assert.equal(isPastPickupCutoff(D, new RealDate(`${prev}T18:31:00+09:00`)), true)
    assert.equal(earliestBookableShipDate(new RealDate(`${prev}T18:29:00+09:00`)), D, "18:29 なら翌日の集荷を予約できる")
    assert.notEqual(earliestBookableShipDate(new RealDate(`${prev}T18:30:00+09:00`)), D, "18:30 以降は翌々日から")
    // サーバは UTC で動く: 18:30 JST = 09:30Z
    assert.ok(pickupCutoffAt(D)!.endsWith("T09:30:00.000Z"))
  })
  await test("代理店の直接変更 (代表者名): 18:29 は直接・18:30 と 18:31 は変更申請 (依頼前・BondEx の承認)", async () => {
    const prev = dayBefore(D)
    const results: Record<string, number> = {}
    for (const hm of ["18:29:00", "18:30:00", "18:31:00"]) {
      const leg = await newLeg({ shipment_date: D })
      setJst(prev, hm)
      const r = await agencyPatch(leg, { representative: `NAME ${hm}` })
      resetClock()
      results[hm] = r.status
      const s2 = await ship(leg)
      if (hm === "18:29:00") {
        assert.equal(r.status, 200, JSON.stringify(r.body))
        assert.equal(s2.representative, `NAME ${hm}`)
      } else {
        assert.equal(r.status, 202, `${hm}: ${JSON.stringify(r.body)}`)
        assert.equal(s2.representative, "TEST GUEST", "申請中は元のまま")
        const c = (await changes(leg))[0]
        assert.equal(c.kind, "representative")
        assert.equal(c.needs_sagawa, false, "依頼前は佐川への連絡なし (BondEx の承認)")
      }
    }
    assert.deepEqual(results, { "18:29:00": 200, "18:30:00": 202, "18:31:00": 202 })
  })
  await test("代理店のホテル変更: 18:29 は直接・18:31 は変更申請", async () => {
    const prev = dayBefore(D)
    const a = await newLeg({ shipment_date: D })
    setJst(prev, "18:29:00")
    const r1 = await agencyHotel(a, hotelBody)
    const b = await newLeg({ shipment_date: D })
    setJst(prev, "18:31:00")
    const r2 = await agencyHotel(b, hotelBody)
    resetClock()
    assert.equal(r1.status, 200, JSON.stringify(r1.body))
    assert.equal((await ship(a)).to_hotel, "Test Hotel Osaka")
    assert.equal(r2.status, 202, JSON.stringify(r2.body))
    assert.equal((await ship(b)).to_hotel, "Test Hotel Kyoto")
  })
  await test("予約 API: 集荷日の前日 18:31 は受け付けない (案内と最短の集荷日)・18:29 は締切で止めない", async () => {
    const booking = await import("../../app/api/agency/booking/route")
    const { AGENCY_TEST_TOKEN } = await import("./fakes/supabase")
    const body = { representative: "TEST GUEST", legs: [{ shipmentDate: D, expectedArrival: jst(4), fromHotel: "Test Hotel Tokyo", fromPlaceId: "p-from", toHotel: "Test Hotel Kyoto", toPlaceId: "p-to", suitcaseCount: 1 }] }
    const post = async () => {
      ip++
      const req = new NextRequest("http://localhost/api/agency/booking", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${AGENCY_TEST_TOKEN}`, "x-forwarded-for": `10.6.${Math.floor(ip / 250)}.${ip % 250}` },
        body: JSON.stringify(body),
      })
      const res = await booking.POST(req)
      return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> }
    }
    const prev = dayBefore(D)
    setJst(prev, "18:31:00")
    const late = await post()
    setJst(prev, "18:30:00")
    const at = await post()
    setJst(prev, "18:29:00")
    let early: { status: number; body: Record<string, unknown> } | null = null
    try { early = await post() } catch { early = { status: -1, body: {} } }
    resetClock()
    assert.equal(late.status, 400)
    assert.equal(late.body.code, "PAST_PICKUP_CUTOFF")
    assert.match(String(late.body.error), /18:30/)
    assert.equal(at.body.code, "PAST_PICKUP_CUTOFF", "18:30 ちょうども締切後")
    assert.notEqual(early!.body.code, "PAST_PICKUP_CUTOFF", JSON.stringify(early!.body))
  })
  await test("依頼後の代理店の変更 (日程・個数・取消): すべて変更申請・区間はそのまま・佐川への連絡が要る", async () => {
    const leg = await newLeg()
    await call("POST", "/api/operator/sagawa-pickup", { shipmentId: leg, actor: "谷口" })
    const before = await ship(leg)
    const r1 = await agencyPatch(leg, { suitcaseCount: 4 })
    assert.equal(r1.status, 202, JSON.stringify(r1.body))
    assert.equal((await changes(leg))[0].kind, "count")
    assert.equal((await changes(leg))[0].needs_sagawa, true)
    const dup = await agencyPatch(leg, { cancel: true })
    assert.equal(dup.status, 409, "処理中の申請があれば重ねて受けない")
    assert.match(String(dup.body.message), /処理中の変更申請/)
    // 1件目を取り下げてから取消を申請
    await call("POST", "/api/operator/pickup-request", { action: "change_step", changeId: (await changes(leg))[0].id, step: "withdraw", actor: "谷口" })
    const r2 = await agencyPatch(leg, { cancel: true })
    assert.equal(r2.status, 202, JSON.stringify(r2.body))
    const s2 = await ship(leg)
    assert.equal(s2.status, before.status, "取消の申請だけでは取消にしない")
    assert.equal(s2.suitcase_count, before.suitcase_count)
    assert.equal((await reqs(leg))[0].state, "accepted")
  })
  await test("個数の2週間前の締切 (依頼前・18:30 前) は変更申請として受け付ける (これまでは BondEx へ連絡)", async () => {
    const leg = await newLeg({ shipment_date: jst(5) })
    const r = await agencyPatch(leg, { suitcaseCount: 3 })
    assert.equal(r.status, 202, JSON.stringify(r.body))
    assert.equal((await changes(leg))[0].needs_sagawa, false)
    assert.equal((await ship(leg)).suitcase_count, 2)
  })
  await test("依頼前の申請 (締切後) は運営の承認画面で承認 → 反映。依頼済みの申請はそこでは承認できない", async () => {
    const decide = await import("../../app/api/operator/change-requests/[id]/route")
    const post = async (id: string, b: Record<string, unknown>) => {
      const req = new NextRequest(`http://localhost/api/operator/change-requests/${id}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.5.5.5" }, body: JSON.stringify(b) })
      const res = await decide.POST(req, { params: Promise.resolve({ id }) })
      return { status: res.status, body: (await res.json()) as Record<string, unknown> }
    }
    const pre = await newLeg({ shipment_date: jst(5) })
    await agencyPatch(pre, { suitcaseCount: 3 })
    const cPre = (await changes(pre))[0]
    const ok = await post(cPre.id, { action: "approve", note: "OK" })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal((await ship(pre)).suitcase_count, 3)
    assert.equal((await changes(pre))[0].state, "applied")
    const req = await newLeg()
    await call("POST", "/api/operator/sagawa-pickup", { shipmentId: req, actor: "谷口" })
    await agencyPatch(req, { suitcaseCount: 4 })
    const ng = await post((await changes(req))[0].id, { action: "approve" })
    assert.equal(ng.status, 409)
    assert.equal(ng.body.code, "NEEDS_SAGAWA")
    assert.equal((await ship(req)).suitcase_count, 2)
  })
  await test("Operator の直接編集: 依頼済みは訂正・ダッシュボード・個数調整・ホテル変更すべて 409 と変更申請への案内", async () => {
    const leg = await newLeg()
    await call("POST", "/api/operator/sagawa-pickup", { shipmentId: leg, actor: "谷口" })
    const correct = await import("../../app/api/operator/shipment/[id]/correct/route")
    const dash = await import("../../app/api/shipments/route")
    const adjust = await import("../../app/api/operator/adjust-count/route")
    const hotel = await import("../../app/api/operator/shipment/[id]/hotel-change/route")
    const mk = (url: string, method: string, b: unknown) => new NextRequest(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": `10.4.${ip++ % 250}.1` }, body: JSON.stringify(b) })
    const outs = [
      await correct.POST(mk(`/api/operator/shipment/${leg}/correct`, "POST", { shipmentDate: jst(6), expectedArrival: jst(7), reason: "x" }), { params: Promise.resolve({ id: leg }) }),
      await dash.PATCH(mk("/api/shipments", "PATCH", { id: leg, shipmentDate: jst(6) })),
      await adjust.POST(mk("/api/operator/adjust-count", "POST", { id: leg, newCount: 5, reasonCode: "customer_change" })),
      await hotel.POST(mk(`/api/operator/shipment/${leg}/hotel-change`, "POST", { side: "guest", newHotel: "Test Hotel Osaka", newHotelJa: "テストホテル大阪", newPlaceId: "p-to2", reason: "x" }), { params: Promise.resolve({ id: leg }) }),
    ]
    const labels = ["訂正", "ダッシュボード", "個数調整", "ホテル変更"]
    for (let i = 0; i < outs.length; i++) {
      const b = (await outs[i].json()) as Record<string, unknown>
      assert.equal(outs[i].status, 409, `${labels[i]}: ${outs[i].status} ${JSON.stringify(b)}`)
      assert.equal(b.code, "PICKUP_REQUEST_LIVE", labels[i])
      assert.match(String(b.error), /変更申請/, labels[i])
    }
    const s2 = await ship(leg)
    assert.equal(s2.suitcase_count, 2)
    assert.equal(s2.to_hotel, "Test Hotel Kyoto")
  })
  await test("Operator は依頼の確保の前なら 18:30 以降も直接編集できる (訂正)", async () => {
    const leg = await newLeg({ shipment_date: D })
    const correct = await import("../../app/api/operator/shipment/[id]/correct/route")
    setJst(dayBefore(D), "18:45:00")
    const res = await correct.POST(new NextRequest(`http://localhost/api/operator/shipment/${leg}/correct`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.3.3.3" }, body: JSON.stringify({ representative: "OPS FIXED", reason: "x" }) }), { params: Promise.resolve({ id: leg }) })
    resetClock()
    assert.equal(res.status, 200, JSON.stringify(await res.json()))
    assert.equal((await ship(leg)).representative, "OPS FIXED")
  })
  await test("旧来の「取消完了」等の操作は受け付けず、変更申請へ案内 (区間の取消と食い違わない)", async () => {
    const leg = await newLeg()
    await call("POST", "/api/operator/sagawa-pickup", { shipmentId: leg, actor: "谷口" })
    const rid = (await reqs(leg))[0].id
    for (const a of ["start_change", "change_done", "cancel_done"]) {
      const r = await call("POST", "/api/operator/pickup-request", { action: "resolve", requestId: rid, resolveAction: a, actor: "谷口", note: "x" })
      assert.equal(r.status, 409, a)
      assert.match(String(r.body.error), /変更申請/, a)
    }
    assert.equal((await reqs(leg))[0].state, "accepted")
    assert.equal((await ship(leg)).status, "requested")
  })
  await test("日程の申請を反映すると、締切 (change_deadline_at) も新しい集荷日の前日 18:30 に", async () => {
    const leg = await newLeg()
    await previewAndSend(leg)
    const c = await call("POST", "/api/operator/pickup-request", { action: "change_create", shipmentId: leg, kind: "dates", fields: { shipment_date: jst(7), expected_arrival: jst(8) }, reason: "r", actor: "谷口" })
    const id = String(c.body.changeId)
    await call("POST", "/api/operator/pickup-request", { action: "change_step", changeId: id, step: "contact", note: "連絡", actor: "谷口" })
    await call("POST", "/api/operator/pickup-request", { action: "change_step", changeId: id, step: "approve", note: "可", numberPolicy: "kept", actor: "谷口" })
    assert.equal((await call("POST", "/api/operator/pickup-request", { action: "change_apply", changeId: id, actor: "谷口" })).status, 200)
    const s2 = await ship(leg)
    assert.equal(new RealDate(s2.change_deadline_at).toISOString(), new RealDate(`${dayBefore(jst(7))}T18:30:00+09:00`).toISOString())
  })
  globalThis.Date = RealDate

  console.log("9. 大量予約・同時実行 (PGlite・参考値)")
  await test("3,000区間を手動依頼として記録 → TODO の読み込み・100件同時確保 (50区間×2)", async () => {
    await db.query(`insert into shipments (booking_id, leg_index, shipment_date, expected_arrival, from_hotel, to_hotel)
      select 'BDX-BULK'||g, 0, current_date + (g % 90) + 2, current_date + (g % 90) + 3, 'A', 'B' from generate_series(1,3000) g`)
    const ids: string[] = (await db.query(`select id from shipments where booking_id like 'BDX-BULK%' order by booking_id`)).rows.map((r: { id: string }) => r.id)
    let t0 = Date.now()
    for (const id of ids.slice(0, 2950)) {
      await db.query(`select * from claim_pickup_request($1,'manual',null,null,1,current_date,'bulk','o',null)`, [id])
    }
    const claimMs = Date.now() - t0
    t0 = Date.now()
    const t = await todo()
    const todoMs = Date.now() - t0
    const targets = ids.slice(2950, 3000)
    t0 = Date.now()
    const results = await Promise.all(
      [...targets, ...targets].map((id) => sb.rpc("claim_pickup_request", { p_shipment_id: id, p_channel: "bizlogi", p_environment: "production", p_manage_number: "X", p_piece_count: 1, p_pickup_date: jst(3), p_actor: "a", p_owner: "o", p_note: null })),
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
