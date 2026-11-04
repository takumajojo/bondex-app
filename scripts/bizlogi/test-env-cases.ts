// Biz-Logi テスト環境での実発行の試験 (SG の利用開始の確認後に使う)。2026-11-04 谷口さん指示で準備。
// 6つの試験を「本番と同じ経路」で流す: 区間の行 → buildLegInput (ホテルの住所の解決・京都の通り名の除去・宛名の折り返し)
// → previewBizLogiPickup (確認機能) → sendBizLogiPickup (DB で依頼を確保 → 発行依頼 → 結果の保存)。
// DB は組み込みの PostgreSQL (PGlite・sql/067〜076) で、本番・Supabase には触れない。Google は使わない (住所は下の固定値)。
//
//   問合番号は顧客側採番 (2026-11-04 SG 正式回答・sql/078)。dry-run は架空の番号範囲 (99999000000〜) だけを使う。
//   confirm / issue は SG から受け取った専用の範囲を --range=<先頭11桁の開始>-<終了> --range-note="<SG の通知>" で渡したときだけ動く
//   (推測の番号は使わない)。
//   既定 (--mode=dry-run): 外部へ一切送らない。模擬の Biz-Logi で、送信内容・判定・DB の保存を確かめる (今すぐ実行できる)
//   --mode=confirm                : テスト環境へ確認機能 (printOutFlg=0・採番なし) だけを送る
//   --mode=issue --yes-issue-test-env : テスト環境へ発行依頼 (printOutFlg=1・N01・テスト環境は課金・集荷なし)
//
//   PGLITE_DIR=<PGlite を入れたディレクトリ> npx tsx --tsconfig scripts/test-pickup-e2e/tsconfig.json scripts/bizlogi/test-env-cases.ts [--mode=...] [--case=1,40,long,kyoto,error,dup]
//
// 安全策 (scripts/bizlogi/test-env.ts と同じ): 接続値は .env.bizlogi-test.local だけ・BIZLOGI_ENV=test とテスト環境ホスト以外は拒否・
// 発行は --yes-issue-test-env のときだけ・パスワードは表示も記録もしない・結果はリポジトリ外 (~/JOJO/ops/bizlogi-test-log/) に記録・
// 失敗しても自動で再送しない。住所は仕様書 Ver2.82 の I/F 例にある SGシステムの住所と、公開の駅前の住所だけを使う。

import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { BizLogiClient, BIZLOGI_TEST_HOSTS, bizLogiConfigFromEnv } from "../../lib/bizlogi/client"
import type { ShippingResponse } from "../../lib/bizlogi/shipping"
import type { HotelPlaceDetails } from "../../lib/hotel-place"
import { buildLegInput, cleanOverrides, type PickupShipmentRow } from "../../lib/pickup-request/leg-input"
import { previewBizLogiPickup, sendBizLogiPickup } from "../../lib/pickup-request/bizlogi"
import { supabasePickupStore } from "../../lib/pickup-request/store"
import { initSchema, db } from "../test-pickup-e2e/fakes/supabase"

const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? "true"] as [string, string] }))
const mode = (args.get("mode") ?? "dry-run") as "dry-run" | "confirm" | "issue"
const only = new Set((args.get("case") ?? "1,40,long,kyoto,error,dup,num").split(","))
if (mode === "issue" && args.get("yes-issue-test-env") !== "true") throw new Error("発行依頼は --yes-issue-test-env を付けたときだけ実行します")

const LOG_DIR = `${homedir()}/JOJO/ops/bizlogi-test-log`
const log = (e: Record<string, unknown>) => {
  if (mode === "dry-run") return
  mkdirSync(LOG_DIR, { recursive: true })
  appendFileSync(`${LOG_DIR}/${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}.jsonl`, JSON.stringify({ at: new Date().toISOString(), script: "test-env-cases", mode, ...e }) + "\n")
}
const jst = (d: number) => new Date(Date.now() + 9 * 3600_000 + d * 86_400_000).toISOString().slice(0, 10)

// ── 住所 (Google Places の代わりの固定値。本番と同じ formatted_address の形)
const PLACES: Record<string, HotelPlaceDetails> = {
  // 仕様書 4.1 の I/F 例 (SGシステム)
  "sg-kyoto": { placeId: "sg-kyoto", name: "ＳＧシステム株式会社", formattedAddress: "日本、〒601-8104 京都府京都市南区上鳥羽角田町25", components: [], internationalPhone: "+81 75-000-0000" },
  "sg-osaka": { placeId: "sg-osaka", name: "ＳＧシステム株式会社", formattedAddress: "日本、〒554-0024 大阪府大阪市此花区島屋4丁目4-51", components: [], internationalPhone: "+81 6-0000-0000" },
  // 京都の通り名つき (2026-11-04 のテスト環境の住所照合: 通り名つき E2-0001・除去後 S0-0001)
  "kyoto-route": { placeId: "kyoto-route", name: "京都駅前テスト", formattedAddress: "日本、〒600-8216 京都府京都市下京区烏丸通塩小路下ル東塩小路町901", components: [], internationalPhone: "+81 75-000-0001" },
  // 長い名称 (ホテル名 気付 + 旅行者名様 が 25文字×2行に折り返して収まる長さ)
  "long-name": { placeId: "long-name", name: "ザ・グランドテストホテル京都駅前セントラルタワー", formattedAddress: "日本、〒601-8104 京都府京都市南区上鳥羽角田町25", components: [], internationalPhone: "+81 75-000-0002" },
  // 50文字に収まらない名称 (切り詰めずに止める → 運営が佐川向けの名称を入れれば送れる)
  "too-long": { placeId: "too-long", name: "ザ・グランドテストホテル京都駅前セントラルタワー＆スパ・エグゼクティブレジデンス本館", formattedAddress: "日本、〒601-8104 京都府京都市南区上鳥羽角田町25", components: [], internationalPhone: "+81 75-000-0003" },
}
const fetchPlace = (async (_name: string, _key: string, placeId?: string) => PLACES[placeId ?? ""] ?? null) as never

let seq = 0
async function leg(over: Partial<PickupShipmentRow> & { from_place_id: string; to_place_id: string }): Promise<PickupShipmentRow> {
  seq++
  const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().replace(/\D/g, "").slice(4, 12)
  const row = {
    booking_id: `BDXT${stamp}${seq}`, leg_index: 0, status: "requested", carrier: "sagawa", shipment_date: jst(2), expected_arrival: jst(3),
    delivery_time: null, representative: "TEST GUEST", booking_name: null, tour_number: null, suitcase_count: 1, booking_type: "fit",
    from_hotel: PLACES[over.from_place_id]?.name ?? "テスト", from_hotel_ja: null, from_residence: null,
    to_hotel: PLACES[over.to_place_id]?.name ?? "テスト", to_hotel_ja: null, to_residence: null, tracking_numbers: [],
    ...over,
  }
  const cols = ["booking_id", "leg_index", "status", "carrier", "shipment_date", "expected_arrival", "representative", "suitcase_count", "booking_type", "from_hotel", "from_place_id", "to_hotel", "to_place_id"]
  const r = await db.query(`insert into shipments (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`, cols.map((c) => (row as Record<string, unknown>)[c]))
  return { ...(row as PickupShipmentRow), id: r.rows[0].id }
}
const records = async (id: string) => (await db.query(`select state, channel, shipping_number, print_request_id, error from pickup_requests where shipment_id=$1 order by created_at`, [id])).rows

// ── Biz-Logi の接続 (dry-run は模擬)
type Client = Pick<BizLogiClient, "checkShipping" | "requestShipping">
let issues = 0
function mockClient(behavior: "ok" | "error" | "dup" | "range" | "dupOnIssue" = "ok"): Client {
  if (behavior === "dupOnIssue") {
    // 確認機能は通り、発行依頼で初めて E1-0206 が返る (例: 結果不明の後に誰かが同じ番号で送っていた)
    const okc = mockClient("ok")
    const dup = mockClient("dup")
    return { checkShipping: (d) => okc.checkShipping(d), requestShipping: async (d) => { issues++; return dup.checkShipping(d) } } as Client
  }
  const errCode = behavior === "dup" ? "E1-0206" : behavior === "range" ? "E1-0207" : "E2-0004"
  const resp = (issue: boolean, ums: string[], pieces: number, nums: Array<string | undefined>): ShippingResponse => ({
    ok: behavior === "ok", result: { code: behavior === "ok" ? "S0-0001" : "E8-0001", message: "", severity: behavior === "ok" ? "ok" : "error" },
    printRequestId: issue && behavior === "ok" ? `P-MOCK-${issues}` : null,
    details: ums.map((u, i) => ({
      userManageNumber: u,
      resultCodes: [{ code: behavior === "ok" ? "S0-0001" : errCode, message: behavior === "ok" ? "" : `模擬: ${errCode}`, severity: behavior === "ok" ? "ok" : "error" }],
      // 顧客側採番: 佐川は送った番号をそのまま返す (仕様書 p.36 1-6-1-4-1)
      shippingNumbers: issue && behavior === "ok" ? [nums[i] ?? String(500000000000 + issues)] : [],
      depot: null,
      pieces,
    })),
  }) as unknown as ShippingResponse
  return {
    async checkShipping(d) { return resp(false, d.map((x) => x.userManageNumber), d[0]?.haisoKosu ?? 0, d.map((x) => x.shippingNumber)) },
    async requestShipping(d) { await new Promise((r) => setTimeout(r, 50)); issues++; return resp(true, d.map((x) => x.userManageNumber), d[0]?.haisoKosu ?? 0, d.map((x) => x.shippingNumber)) },
  } as Client
}
function realClient(): { client: Client; kokyaku: string; phone: string } {
  const text = readFileSync(new URL("../../.env.bizlogi-test.local", import.meta.url), "utf8")
  const env: Record<string, string> = {}
  for (const line of text.split("\n")) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2] }
  if (env.BIZLOGI_ENV !== "test") throw new Error("BIZLOGI_ENV=test ではありません。テスト環境以外には接続しません")
  if (!BIZLOGI_TEST_HOSTS.includes(new URL(env.BIZLOGI_BASE_URL).hostname)) throw new Error("テスト環境のホストではありません")
  const cfg = bizLogiConfigFromEnv({ ...env, BIZLOGI_LIVE: mode === "issue" ? "true" : "" })
  if (cfg.environment !== "test") throw new Error("テスト環境の設定ではありません")
  const c = new BizLogiClient(cfg)
  // confirm モードでは発行依頼を物理的に呼べないようにする
  const client: Client = mode === "issue" ? c : { checkShipping: (d) => c.checkShipping(d), requestShipping: async () => { throw new Error("confirm モードでは発行しません") } }
  return { client, kokyaku: env.BIZLOGI_KOKYAKU_CODE, phone: env.BONDEX_SENDER_PHONE || "0000000000" }
}

let pass = 0
let fail = 0
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`    ok   ${name}`) } else { fail++; console.log(`    FAIL ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 300)) }
}

async function main() {
  await initSchema(process.cwd())
  await db.exec(`update pickup_request_settings set claims_paused = false`)
  // 問合番号の範囲。dry-run は架空 (99999000000〜99999000049)。confirm / issue は SG の範囲を渡したときだけ
  if (mode === "dry-run") {
    await db.query(`insert into pickup_number_ranges (environment, body_start, body_end, next_body, source_note, created_by)
                    values ('test', 99999000000, 99999000049, 99999000000, '模擬 (dry-run 専用・SG の範囲ではない)', 'test-env-cases')`)
  } else {
    const m = /^(\d{11})-(\d{11})$/.exec(args.get("range") ?? "")
    const note = (args.get("range-note") ?? "").trim()
    if (!m || !note) throw new Error("SG から受け取った問合番号の範囲を --range=<開始11桁>-<終了11桁> --range-note=\"<SG の通知>\" で指定してください (推測の番号は使いません)")
    await db.query(`insert into pickup_number_ranges (environment, body_start, body_end, next_body, source_note, created_by) values ('test', $1, $2, $1, $3, 'test-env-cases')`, [m[1], m[2], note])
  }
  const real = mode === "dry-run" ? null : realClient()
  const kokyaku = real?.kokyaku ?? "100000000000"
  const env = { kokyakuCode: kokyaku, contactPhone: real?.phone ?? "0300000000", placesKey: "unused", fetchPlace }
  const store = supabasePickupStore()
  const alerts: unknown[] = []
  const deps = (client: Client) => ({ store, client, environment: "test" as const, numbering: "customer" as const, alert: async (a: unknown) => void alerts.push(a) })
  const pvDeps = (client: Client) => ({ client, store, environment: "test" as const, numbering: "customer" as const })
  const client = real?.client ?? mockClient()
  console.log(`モード: ${mode}${mode === "dry-run" ? " (外部へ送らない・模擬の Biz-Logi)" : " (Biz-Logi テスト環境)"}`)

  // 1件を「本番と同じ経路」で流す
  async function run(row: PickupShipmentRow, c: Client, overrides: Record<string, string> = {}) {
    const built = await buildLegInput(row, env, cleanOverrides(overrides))
    if (!built.ok) return { built, preview: null, send: null }
    const preview = await previewBizLogiPickup(row, built.input, pvDeps(c))
    if (!preview.ok || mode === "confirm") return { built, preview, send: null }
    const send = await sendBizLogiPickup(row, built.input, { actor: "接続試験", expectedFingerprint: preview.fingerprint }, deps(c))
    return { built, preview, send }
  }
  const show = (label: string, d: { shippingNumber?: string; haisoKosu: number; otodokeNm: string[]; otodokeAdd: string[]; otodokeYubin: string; irai?: { nm: string[]; add: string[]; yubin: string }; shukaIrai?: { shukaIraiShiteiDate?: string } }) => {
    console.log(`    送信内容 (${label}): 個数 ${d.haisoKosu}・集荷日 ${d.shukaIrai?.shukaIraiShiteiDate ?? "-"}・問合番号 ${d.shippingNumber ?? "(システム採番)"} (採番区分 1)`)
    console.log(`      集荷先 〒${d.irai?.yubin} ${d.irai?.add.join(" / ")}・宛名 ${d.irai?.nm.join(" / ")}`)
    console.log(`      届け先 〒${d.otodokeYubin} ${d.otodokeAdd.join(" / ")}・宛名 ${d.otodokeNm.join(" / ")}`)
  }

  if (only.has("1")) {
    console.log("\n■ T1 1個口 (通常のホテル → ホテル)")
    console.log("  期待: 確認 S0-0001 → 発行 S0-0001・発行受付ID・問合番号1つ / DB: 受付済み (accepted)・番号を保存 / 合格: 番号が10〜12桁で DB と一致")
    const row = await leg({ from_place_id: "sg-kyoto", to_place_id: "sg-osaka", suitcase_count: 1 })
    const r = await run(row, client)
    if (r.preview?.ok) show("確認", r.preview.detail)
    check("確認機能が S0-0001 (エラーなし)", !!r.preview?.ok, r.preview)
    if (mode !== "confirm") {
      const rec = await records(row.id)
      check("発行 → 受付済み・問合番号1つ", r.send?.outcome === "accepted" && /^\d{10,12}$/.test(rec[0]?.shipping_number ?? ""), { send: r.send, rec })
      check("DB の記録は1件 (accepted)", rec.length === 1 && rec[0].state === "accepted", rec)
      const sent = r.preview?.ok ? r.preview.detail.shippingNumber : null
      const ar = (await db.query(`select assigned_number from pickup_requests where shipment_id=$1`, [row.id])).rows[0]
      check("顧客側採番: 送った番号 = 記録の番号 = 佐川の応答の番号・チェックデジット (mod 7) が正しい",
        !!sent && sent === rec[0]?.shipping_number && sent === ar?.assigned_number && Number(BigInt(sent.slice(0, 11)) % BigInt(7)) === Number(sent[11]), { sent, rec, ar })
    }
    log({ case: "T1", preview: r.preview?.ok, send: r.send, records: await records(row.id) })
  }

  if (only.has("40")) {
    console.log("\n■ T2 40個口")
    console.log("  BondEx の当面の運用ルール: Biz-Logi で送るのは1〜19個だけ (20個以上は佐川へ事前連絡のうえ手動 Excel・2026-11-04 谷口さん)")
    console.log("  ※ 佐川 API の上限ではない (個口数は2桁 = 99個まで・100個で E1-0004)。40個口は佐川側では受け付けられる想定で、下の台本で確かめる")
    console.log("  期待 (アプリの経路): 送らずに止める (blocked)・DB に記録なし / 期待 (佐川側の確認・test-env.ts --step=confirm --pieces=40): S0-0001・発行なら問合番号1つ")
    const row = await leg({ from_place_id: "sg-kyoto", to_place_id: "sg-osaka", suitcase_count: 40 })
    const r = await run(row, client)
    check("アプリの経路では送らない (確認の段階で止まる)", r.preview?.ok === false && /20個以上|手動/.test(JSON.stringify(r.preview)), r.preview)
    check("DB に記録なし・佐川へ発行していない", (await records(row.id)).length === 0)
    console.log("  佐川側の40個口の確認は、従来の台本で行う: npx tsx scripts/bizlogi/test-env.ts --step=confirm --pieces=40 (発行は --step=issue --yes-issue-test-env --pieces=40)")
    log({ case: "T2", preview: r.preview })
  }

  if (only.has("long")) {
    console.log("\n■ T3 長い宛名")
    console.log("  期待: 25文字×2行に折り返して1文字も落とさない → 確認 S0-0001 / 50文字を超える名称は送らずに止める (切り詰めない) → 運営が佐川向けの名称を入れれば送れる")
    // 24文字のホテル名 + 20文字の旅行者名 = 1行 (25文字) には収まらず、2行 (50文字) には収まる
    const row = await leg({ from_place_id: "long-name", to_place_id: "sg-osaka", representative: "ALEXANDRA MONTGOMERY" })
    const r = await run(row, client)
    if (r.preview?.ok) show("確認", r.preview.detail)
    const nm = r.preview?.ok ? r.preview.detail.irai?.nm.join("") ?? "" : ""
    check("長い名称が2行に折り返され、ホテル名を落としていない", r.preview?.ok === true && nm.replace(/\s/g, "").includes("ザ・グランドテストホテル京都駅前セントラルタワー".replace(/\s/g, "")), r.preview)
    if (mode !== "confirm") check("発行 → 受付済み", r.send?.outcome === "accepted", r.send)
    // 44文字のホテル名 / 38文字の旅行者名は、ホテル名 気付 + 旅行者名様 が 50文字に収まらない
    const tooLong = await leg({ from_place_id: "too-long", to_place_id: "sg-osaka", representative: "MAXIMILIAN ALEXANDER VON HOHENZOLLERN" })
    const r2 = await run(tooLong, client)
    check("50文字に収まらない名称は送らずに止める (切り詰めない)", r2.built.ok === false || r2.preview?.ok === false, r2.preview ?? r2.built)
    check("止めた区間は DB に記録なし", (await records(tooLong.id)).length === 0)
    const r3 = await run(tooLong, client, { originName: "グランドテストホテル京都", guestName: "HOHENZOLLERN MAXIMILIAN" })
    if (r3.preview?.ok) show("運営が名称を指定", r3.preview.detail)
    check("運営が佐川向けの名称を入れれば送れる", r3.preview?.ok === true, r3.preview ?? r3.built)
    log({ case: "T3", preview: r.preview?.ok, send: r.send, tooLong: r2.preview ?? r2.built, override: r3.preview?.ok })
  }

  if (only.has("kyoto")) {
    console.log("\n■ T4 京都の住所 (通り名つき)")
    console.log("  期待: 送信前に通り名を除く (烏丸通塩小路下ル → なし) → 確認 S0-0001 (2026-11-04 の住所照合と同じ) / 発行 → 受付済み")
    const row = await leg({ from_place_id: "sg-kyoto", to_place_id: "kyoto-route" })
    const r = await run(row, client)
    if (r.preview?.ok) show("確認", r.preview.detail)
    const add = r.preview?.ok ? r.preview.detail.otodokeAdd.join("") : ""
    check("通り名を除いた住所で送る", r.preview?.ok === true && add.includes("東塩小路町") && !add.includes("烏丸通"), add)
    check("郵便番号は 6008216", r.preview?.ok === true && r.preview.detail.otodokeYubin === "6008216", r.preview?.ok ? r.preview.detail.otodokeYubin : null)
    if (mode !== "confirm") check("発行 → 受付済み", r.send?.outcome === "accepted", r.send)
    log({ case: "T4", address: add, preview: r.preview?.ok, send: r.send })
  }

  if (only.has("error")) {
    console.log("\n■ T5 エラー応答")
    console.log("  期待: エラーコード → 送信失敗 (failed)・問合番号なし・自動で再送しない / DB: failed の記録1件 (有効な依頼ではない = 運営が直して再依頼できる)")
    if (mode === "dry-run") {
      const row = await leg({ from_place_id: "sg-kyoto", to_place_id: "sg-osaka" })
      const bad = mockClient("error")
      const built = await buildLegInput(row, env, {})
      const pv = built.ok ? await previewBizLogiPickup(row, built.input, pvDeps(mockClient())) : null
      const send = built.ok && pv?.ok ? await sendBizLogiPickup(row, built.input, { actor: "接続試験", expectedFingerprint: pv.fingerprint }, deps(bad)) : null
      const rec = await records(row.id)
      check("佐川のエラーコード → failed・番号なし", send?.outcome === "failed" && rec[0]?.state === "failed" && !rec[0]?.shipping_number, { send, rec })
      check("自動で再送しない (発行の呼び出しは1回)", issues >= 1)
    } else {
      // 実環境では、郵便番号と住所の不一致で佐川にエラーを返させる (確認機能で判定・採番なし)
      const row = await leg({ from_place_id: "sg-kyoto", to_place_id: "sg-osaka" })
      const built = await buildLegInput(row, env, {})
      if (built.ok) built.input.destination.postalCode = "6018104" // 大阪の住所に京都の郵便番号
      const pv = built.ok ? await previewBizLogiPickup(row, built.input, pvDeps(client)) : null
      check("確認機能でエラー (E2-0001 等) を返し、送信に進まない", pv?.ok === false, pv)
      check("DB に記録なし (確認で止まったため)", (await records(row.id)).length === 0)
      log({ case: "T5", preview: pv })
      console.log("  ほかのエラー (必須項目不足・不正な値・特殊文字・認証・時間切れ) は従来の台本: npx tsx scripts/bizlogi/test-env.ts --step=errors (すべて確認機能)")
    }
  }

  if (only.has("dup")) {
    console.log("\n■ T6 重複発行の防止 (同じ区間を2つ同時に送る)")
    console.log("  期待: 発行依頼は1回だけ・1つは受付済み・もう1つは送らずに止める (live_request_exists) / DB: 有効な記録1件 / 受付済みの区間はもう一度送れない")
    const row = await leg({ from_place_id: "sg-kyoto", to_place_id: "sg-osaka" })
    const built = await buildLegInput(row, env, {})
    if (!built.ok) throw new Error(built.errors.join(" / "))
    const pv = await previewBizLogiPickup(row, built.input, pvDeps(client))
    if (!pv.ok) throw new Error(`確認で止まりました: ${JSON.stringify(pv)}`)
    if (mode === "confirm") {
      console.log("  confirm モードでは発行しないため、この試験は issue モードで行う (確認機能は S0-0001)")
    } else {
      let calls = 0
      const counting: Client = { checkShipping: (d) => client.checkShipping(d), requestShipping: async (d) => { calls++; return client.requestShipping(d) } }
      const [a, b] = await Promise.all([
        sendBizLogiPickup(row, built.input, { actor: "接続試験A", expectedFingerprint: pv.fingerprint }, deps(counting)),
        sendBizLogiPickup(row, built.input, { actor: "接続試験B", expectedFingerprint: pv.fingerprint }, deps(counting)),
      ])
      const outs = [a.outcome, b.outcome].sort()
      check("発行依頼は1回だけ", calls === 1, calls)
      check("1つは受付済み・もう1つは止まる", outs.join(",") === "accepted,blocked", [a, b])
      const rec = await records(row.id)
      check("DB の有効な記録は1件", rec.filter((x: { state: string }) => ["sending", "accepted", "unknown"].includes(x.state)).length === 1, rec)
      const again = await sendBizLogiPickup(row, built.input, { actor: "接続試験C", expectedFingerprint: pv.fingerprint }, deps(counting))
      check("受付済みの区間はもう一度送れない", again.outcome === "blocked" && calls === 1, again)
      log({ case: "T6", outcomes: [a, b, again], calls, records: rec })
    }
  }

  if (only.has("num") && mode === "dry-run") {
    console.log("\n■ T7 顧客側採番の異常 (dry-run だけ: 模擬の応答)")
    // E1-0206 (重複): 成功でも失敗でもなく結果不明・番号はそのまま・自動で再送しない
    const a = await leg({ from_place_id: "sg-kyoto", to_place_id: "sg-osaka" })
    const ba = await buildLegInput(a, env, {})
    const pa = ba.ok ? await previewBizLogiPickup(a, ba.input, pvDeps(mockClient())) : null
    const before = issues
    const sa = ba.ok && pa?.ok ? await sendBizLogiPickup(a, ba.input, { actor: "接続試験", expectedFingerprint: pa.fingerprint }, deps(mockClient("dup"))) : null
    const ra = await records(a.id)
    check("E1-0206 → 結果不明 (成功・失敗のどちらにもしない)", sa?.outcome === "unknown" && ra[0]?.state === "unknown" && /E1-0206/.test(ra[0]?.error ?? ""), { sa, ra })
    check("確認機能で E1-0206 → 発行依頼は送らない", issues === before)
    const a2 = await leg({ from_place_id: "sg-kyoto", to_place_id: "sg-osaka" })
    const ba2 = await buildLegInput(a2, env, {})
    const pa2 = ba2.ok ? await previewBizLogiPickup(a2, ba2.input, pvDeps(mockClient())) : null
    const before2 = issues
    const sa2 = ba2.ok && pa2?.ok ? await sendBizLogiPickup(a2, ba2.input, { actor: "接続試験", expectedFingerprint: pa2.fingerprint }, deps(mockClient("dupOnIssue"))) : null
    const ra2 = await records(a2.id)
    check("発行依頼で E1-0206 → 結果不明・問合番号を記録しない・再送しない (呼び出し1回)", sa2?.outcome === "unknown" && ra2[0]?.state === "unknown" && !ra2[0]?.shipping_number && issues === before2 + 1, { sa2, ra2 })
    check("E1-0206 の番号は使い続ける (使わなくしない・別の番号で送り直さない)", (await db.query(`select active from pickup_number_ledger where shipment_id=$1`, [a.id])).rows[0]?.active === true)
    // E1-0207 (範囲外): 失敗・その番号は使わなくする・次は別の番号
    const b = await leg({ from_place_id: "sg-kyoto", to_place_id: "sg-osaka" })
    const bb = await buildLegInput(b, env, {})
    const pb = bb.ok ? await previewBizLogiPickup(b, bb.input, pvDeps(mockClient())) : null
    const n1 = pb?.ok ? pb.detail.shippingNumber : null
    const sb1 = bb.ok && pb?.ok ? await sendBizLogiPickup(b, bb.input, { actor: "接続試験", expectedFingerprint: pb.fingerprint }, deps(mockClient("range"))) : null
    check("E1-0207 → 送信失敗・番号を使わなくする", sb1?.outcome === "failed" && (await db.query(`select active from pickup_number_ledger where number=$1`, [n1])).rows[0]?.active === false, sb1)
    const pb2 = bb.ok ? await previewBizLogiPickup(b, bb.input, pvDeps(mockClient())) : null
    check("次の確認では別の番号になる", !!pb2?.ok && pb2.detail.shippingNumber !== n1, pb2)
    // 佐川のエラー (E2-0004・佐川に登録なし): 同じ区間の送り直しは同じ番号
    const c = await leg({ from_place_id: "sg-kyoto", to_place_id: "sg-osaka" })
    const bc = await buildLegInput(c, env, {})
    const pc = bc.ok ? await previewBizLogiPickup(c, bc.input, pvDeps(mockClient())) : null
    const nc = pc?.ok ? pc.detail.shippingNumber : null
    if (bc.ok && pc?.ok) await sendBizLogiPickup(c, bc.input, { actor: "接続試験", expectedFingerprint: pc.fingerprint }, deps(mockClient("error")))
    const pc2 = bc.ok ? await previewBizLogiPickup(c, bc.input, pvDeps(mockClient())) : null
    check("送信失敗 (佐川に登録なし) の後の送り直しは同じ番号", !!pc2?.ok && pc2.detail.shippingNumber === nc, { nc, again: pc2 })
    const sc2 = bc.ok && pc2?.ok ? await sendBizLogiPickup(c, bc.input, { actor: "接続試験", expectedFingerprint: pc2.fingerprint }, deps(mockClient())) : null
    check("送り直し → 受付済み (同じ番号)", sc2?.outcome === "accepted" && (sc2 as { shippingNumber?: string }).shippingNumber === nc, sc2)
    // 範囲の使い切り: 送らずに止める
    await db.exec(`update pickup_number_ranges set next_body = body_end + 1 where environment = 'test' and active`)
    const d = await leg({ from_place_id: "sg-kyoto", to_place_id: "sg-osaka" })
    const bd = await buildLegInput(d, env, {})
    const pd = bd.ok ? await previewBizLogiPickup(d, bd.input, pvDeps(mockClient())) : null
    check("範囲を使い切ったら送らずに止める (新しい範囲の登録を案内)", pd?.ok === false && /使い切りました/.test(JSON.stringify(pd)), pd)
    await db.exec(`update pickup_number_ranges set active = false where environment = 'test'`)
    const pe = bd.ok ? await previewBizLogiPickup(d, bd.input, pvDeps(mockClient())) : null
    check("範囲が未登録なら送らずに止める (推測の番号は使わない)", pe?.ok === false && /範囲が未登録/.test(JSON.stringify(pe)), pe)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(`中止: ${e instanceof Error ? e.message : String(e)}`); log({ aborted: String(e) }); process.exit(1) })
