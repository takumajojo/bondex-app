/**
 * B2C のカード登録の障害の試験（Stage 3・D）。Stripe のテストモードへの通信を、わざと途中で失敗させる。
 *
 * - 通信の失敗（Stripe に届かない）／Stripe には届いたが返事が失われた（二重の作成が起きないか）／
 *   同時の要求の衝突（冪等キーの処理中）／照合の時の Stripe の障害／放置の片付けと登録の完了の競合
 * - 本番には接続しない: DB はローカルの Supabase だけ、鍵は sk_test_ だけ（どちらも違えば止まる）。
 *
 * 実行: set -a; . ./.env.local; set +a; BASE=http://localhost:3210 npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-b2c/card_faults.ts（ローカルの DB を使うので単体テストの tsconfig.json とは別）
 */
import assert from "node:assert/strict"
import Stripe from "stripe"
import { execFileSync } from "node:child_process"
import { resolveEntry } from "@/lib/b2c/booking-service"
import { expireStaleCardPending, finalizeB2cCard, loadOrderForGuest, startB2cCardRegistration } from "@/lib/b2c/card-service"
import { D } from "./dates/test-dates" // 試験の日付を実際の今日から見て有効な週へ（7日の倍数・時計はずらさない）

const BASE = process.env.BASE ?? "http://localhost:3210"
const SK = process.env.STRIPE_SECRET_KEY ?? ""
const DBURL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(BASE) || !/^http:\/\/(localhost|127\.0\.0\.1):/.test(DBURL)) throw new Error("refusing: local only")
if (!SK.startsWith("sk_test_")) throw new Error("refusing: STRIPE_SECRET_KEY must be sk_test_")
const TOK = "dev-hnk-local-token-0001"
const real = new Stripe(SK, { maxNetworkRetries: 0 })
const PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""
let passed = 0
let failed = 0
let ipN = 0

function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++
    console.log(`  ok  ${name}`)
  } else {
    failed++
    console.log(`  NG  ${name}`, detail ?? "")
  }
}
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-qtA", "-F", "|", "-c", q], { encoding: "utf8" }).trim()
}
async function post(path: string, body: unknown) {
  ipN++
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": `10.6.${ipN >> 8}.${(ipN % 250) + 1}` }, body: JSON.stringify(body) })
  return { status: r.status, data: (await r.json().catch(() => ({}))) as Record<string, any> }
}

/** 指定した Stripe の呼び出しだけを差し替えた Stripe（他は本物のテストモード）。 */
function faulty(over: Record<string, Record<string, (...a: any[]) => any>>): Stripe {
  return new Proxy(real, {
    get(target, prop: string) {
      const res = (target as any)[prop]
      if (!over[prop]) return res
      return new Proxy(res, { get: (t, m: string) => over[prop][m] ?? (typeof t[m] === "function" ? t[m].bind(t) : t[m]) })
    },
  }) as Stripe
}
const connErr = () => Object.assign(new Error("simulated network failure"), { type: "StripeConnectionError" })

let TOKYO = ""
let KYOTO = ""
async function draft(email: string) {
  const r = await post("/api/b2c/orders", {
    token: TOK, originPlaceId: TOKYO, destPlaceId: KYOTO,
    origin: { checkIn: D("2026-11-10"), checkOut: D("2026-11-12") }, dest: { checkIn: D("2026-11-12"), checkOut: D("2026-11-15") },
    pieces: 1, pickupDate: D("2026-11-10"), deliveryDate: D("2026-11-12"), name: "Fault Test", email, whatsapp: "+44 7700 900123", language: "en", consent: true,
  })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const entry = (await resolveEntry(TOK))!
  const load = async () => (await loadOrderForGuest(entry, r.data.orderNumber, r.data.accessToken))!
  return { load, n: r.data.orderNumber as number }
}

async function main() {
  const place = async (q: string) => (await post("/api/b2c/places", { token: TOK, query: q, lang: "en" })).data.candidates[0].placeId as string
  TOKYO = await place("Keio Plaza Hotel Tokyo")
  KYOTO = await place("Hotel Granvia Kyoto")
  for (const [pid, nm] of [[TOKYO, "Keio Plaza Hotel Tokyo"], [KYOTO, "Hotel Granvia Kyoto"]]) {
    sql(`insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('${pid}', '${nm}', 'verified', 'e2e@example.invalid', now()) on conflict (place_id) do update set status='verified', checked_by='e2e@example.invalid', last_verified_at=now()`)
  }
  // 受付の上限（既定 1日 5件）に他の試験の順番で左右されないよう、この試験で使う日の枠を自分で用意する（ローカルの DB だけ）
  sql(`insert into b2c_ops_days(date, max_new_bookings, max_pieces) values ('${D("2026-11-10")}', 500, 2000) on conflict (date) do update set max_new_bookings=500, max_pieces=2000, closed=false`)
  const stamp = Date.now()

  console.log("D1 Stripe に届かない（通信の失敗）→ 失敗を返し、やり直しで 1つだけ作る")
  {
    const email = `d1-${stamp}@example.invalid`
    const o = await draft(email)
    const s = faulty({ customers: { create: async () => { throw connErr() } } })
    const r = await startB2cCardRegistration(s, PK, await o.load(), true)
    ok("通信の失敗は server_error（画面はやり直しを案内）", !r.ok && r.error === "server_error", r)
    const ord = await o.load()
    ok("予約は card_pending（枠は確保）・Customer の記録なし", ord.status === "card_pending" && !ord.stripe_customer_id, ord)
    const r2 = await startB2cCardRegistration(real, PK, ord, true)
    ok("やり直しは成功（client_secret）", r2.ok && "clientSecret" in r2)
    const list = await real.customers.list({ email, limit: 10 })
    ok("Stripe の Customer は 1つ", list.data.length === 1, list.data.length)
  }

  console.log("D2 Stripe には届いたが返事が失われた（Customer）→ やり直しで同じ Customer（二重に作らない）")
  {
    const email = `d2-${stamp}@example.invalid`
    const o = await draft(email)
    const s = faulty({ customers: { create: async (p: any, opt: any) => { await real.customers.create(p, opt); throw connErr() } } })
    const r = await startB2cCardRegistration(s, PK, await o.load(), true)
    ok("返事が失われたら server_error", !r.ok)
    await startB2cCardRegistration(real, PK, await o.load(), true)
    const list = await real.customers.list({ email, limit: 10 })
    ok("Stripe の Customer は 1つ（冪等キーで同じものが返る）", list.data.length === 1, list.data.length)
    ok("DB の Customer はそれと同じ", (await o.load()).stripe_customer_id === list.data[0]?.id)
  }

  console.log("D3 Stripe には届いたが返事が失われた（SetupIntent）→ やり直しで同じ SetupIntent")
  {
    const o = await draft(`d3-${stamp}@example.invalid`)
    const s = faulty({ setupIntents: { create: async (p: any, opt: any) => { await real.setupIntents.create(p, opt); throw connErr() } } })
    const r = await startB2cCardRegistration(s, PK, await o.load(), true)
    ok("返事が失われたら server_error", !r.ok)
    const ord = await o.load()
    ok("DB には SetupIntent の記録なし（まだ返事を受けていない）", !ord.stripe_setup_intent_id)
    const r2 = await startB2cCardRegistration(real, PK, ord, true)
    const sis = await real.setupIntents.list({ customer: (await o.load()).stripe_customer_id!, limit: 10 })
    ok("やり直しで成功・Stripe の SetupIntent は 1つ", r2.ok && sis.data.length === 1, sis.data.length)
  }

  console.log("D4 同じ予約の要求の衝突（Stripe の冪等キーが処理中）→ stripe_busy（画面が少し待って呼び直す）")
  {
    const o = await draft(`d4-${stamp}@example.invalid`)
    const s = faulty({ customers: { create: async () => { throw Object.assign(new Error("idempotency in progress"), { type: "StripeIdempotencyError", statusCode: 409 }) } } })
    const r = await startB2cCardRegistration(s, PK, await o.load(), true)
    ok("stripe_busy を返す", !r.ok && r.error === "stripe_busy", r)
  }

  console.log("D5 照合の時に Stripe が止まっている → 状態を変えない・後の照合で確定")
  {
    const o = await draft(`d5-${stamp}@example.invalid`)
    await startB2cCardRegistration(real, PK, await o.load(), true)
    const ord = await o.load()
    await real.setupIntents.confirm(ord.stripe_setup_intent_id!, { payment_method: "pm_card_visa" })
    const s = faulty({ setupIntents: { retrieve: async () => { throw connErr() } } })
    let threw = false
    try {
      await finalizeB2cCard(s, ord.id, "guest")
    } catch {
      threw = true
    }
    const mid = await o.load()
    ok("Stripe の障害では例外（画面の照合は 502・Webhook は 500 で再送）・DB は registering のまま", threw && mid.card_status === "registering" && mid.status === "card_pending", mid)
    const fin = await finalizeB2cCard(real, ord.id, "guest")
    ok("復旧後の照合で confirmed", fin.view?.status === "confirmed", fin)
  }

  console.log("D6 放置の片付けと、ちょうど同じ時に登録が終わった → 取り消さずに確定")
  {
    const o = await draft(`d6-${stamp}@example.invalid`)
    await startB2cCardRegistration(real, PK, await o.load(), true)
    const ord = await o.load()
    await real.setupIntents.confirm(ord.stripe_setup_intent_id!, { payment_method: "pm_card_visa" })
    sql(`alter table b2c_orders disable trigger user; update b2c_orders set updated_at = now() - interval '45 minutes' where id='${ord.id}'; alter table b2c_orders enable trigger user;`)
    const res = await expireStaleCardPending(real, new Date(), 50)
    const after = await o.load()
    ok("取り消さない（Stripe で登録が終わっていれば確定）", after.status === "confirmed" && res.finalized >= 1, { res, status: after.status })
  }

  console.log("D7 放置の片付けで Stripe の取消が失敗（直前に処理中になった等）→ 予約は取り消さない")
  {
    const o = await draft(`d7-${stamp}@example.invalid`)
    await startB2cCardRegistration(real, PK, await o.load(), true)
    const ord = await o.load()
    sql(`alter table b2c_orders disable trigger user; update b2c_orders set updated_at = now() - interval '45 minutes' where id='${ord.id}'; alter table b2c_orders enable trigger user;`)
    const s = faulty({ setupIntents: { cancel: async () => { throw Object.assign(new Error("setup_intent_unexpected_state"), { code: "setup_intent_unexpected_state" }) } } })
    await expireStaleCardPending(s, new Date(), 50)
    ok("Stripe で取り消せなければ予約は card_pending のまま", (await o.load()).status === "card_pending")
    await expireStaleCardPending(real, new Date(), 50)
    ok("次の片付けで（Stripe も取り消して）cancelled", (await o.load()).status === "cancelled")
  }

  console.log("D8 CVC の失敗のカードのまま放置 → 取り消す（同じ予約を何度も見続けない）")
  {
    const o = await draft(`d8-${stamp}@example.invalid`)
    await startB2cCardRegistration(real, PK, await o.load(), true)
    const ord = await o.load()
    await real.setupIntents.confirm(ord.stripe_setup_intent_id!, { payment_method: "pm_card_cvcCheckFail" })
    await finalizeB2cCard(real, ord.id, "guest")
    sql(`alter table b2c_orders disable trigger user; update b2c_orders set updated_at = now() - interval '45 minutes' where id='${ord.id}'; alter table b2c_orders enable trigger user;`)
    await expireStaleCardPending(real, new Date(), 50)
    const after = await o.load()
    ok("cancelled（card_timeout）", after.status === "cancelled", after.status)
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
