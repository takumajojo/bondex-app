/**
 * P0 の最終監査（2026-11-08）: 架空のホテルで、阪急の入口 → 予約 → カード登録（Stripe のテストモード）→ ホテルの確認
 * （保留・受けない・確認済み）→ 集荷の確認 → 30分後の請求 までを 1つの処理の中で通す。
 * ホテルを受けない・期限切れの予約に請求が起きないこと（Stripe の PaymentIntent が 0件）を、DB と Stripe の両方で確かめる。
 * ローカルの DB・Stripe のテストモード（sk_test_）だけ。Google への通信は止めて 0回であることを確かめる。外にメールは出ない（sandbox）。
 *   実行: set -a; . ./.env.local; set +a; npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-b2c/p0_audit_flow.ts
 *   前提: scripts/test-integ/seed-integrated-dev.sh ＋ sql/081〜083
 */
import Stripe from "stripe"
import crypto from "node:crypto"
import { execFileSync } from "node:child_process"
import { getSupabase } from "@/lib/supabase"
import { createB2cDraftOrder, resolveEntry, resolveEntryState } from "@/lib/b2c/booking-service"
import { finalizeB2cCard, loadOrderForGuest, startB2cCardRegistration } from "@/lib/b2c/card-service"
import { holdFacility, setFacilityStatus, setHotelAcceptance } from "@/lib/b2c/hotel-ops"
import { confirmPickup } from "@/lib/b2c/payment-ops"
import { runB2cCharges } from "@/lib/b2c/charge-service"
import { expireB2cConfirmationTimeouts } from "@/lib/b2c/notify"
import { generateEntryToken } from "@/lib/b2c/entry-link"
import { D } from "./dates/test-dates"

const SK = process.env.STRIPE_SECRET_KEY ?? ""
const PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("refusing: local DB only")
if (!SK.startsWith("sk_test_")) throw new Error("refusing: sk_test_ only")
if (process.env.B2C_NOTIFY_LIVE === "true") throw new Error("refusing: B2C_NOTIFY_LIVE must be off")
const stripe = new Stripe(SK, { maxNetworkRetries: 0 })
const TOKYO = "bdx-staging-mock-tokyo-0001", KYOTO = "bdx-staging-mock-kyoto-0002", OSAKA = "bdx-staging-mock-osaka-0003"
const OP = { operatorEmail: "ops-audit@example.invalid", credentialId: "audit-cred-0000000000001" }
const OP2 = { operatorEmail: "ops-audit2@example.invalid", credentialId: "audit-cred-0000000000002" }

let passed = 0, failed = 0
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400)) }
}
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "|", "-c", q], { encoding: "utf8" }).trim()
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex")
const googleCalls: string[] = []
const origFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (/googleapis\.com|google\.com/.test(url)) { googleCalls.push(url); throw new Error("google blocked in test") }
  if (/api\.stripe\.com/.test(url) && !String(init?.headers?.Authorization ?? init?.headers?.authorization ?? "Bearer sk_test_").includes("sk_test_")) throw new Error("non-test stripe key")
  return origFetch(input, init)
}) as typeof fetch

const stays = { origin: { checkIn: D("2026-11-10"), checkOut: D("2026-11-12") }, dest: { checkIn: D("2026-11-12"), checkOut: D("2026-11-15") } }
const qIn = (o: string, d: string) => ({ now: new Date(), originPlaceId: o, destPlaceId: d, ...stays, pieces: 1, pickupDate: D("2026-11-10"), deliveryDate: D("2026-11-12") })
const fac = (pid: string, status: "verified" | "unknown") =>
  sql(`insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('${pid}', 'mock', '${status}', ${status === "verified" ? "'seed@example.invalid', now()" : "null, null"}) on conflict (place_id) do update set status=excluded.status, checked_by=excluded.checked_by, last_verified_at=excluded.last_verified_at`)
const row = (n: number) => {
  const [id, status, reason, mode, ref, unit, total, cust] = sql(`select id, status, coalesce(cancel_reason,'-'), confirmation_mode, referrer_code, unit_net_yen, total_gross_yen, coalesce(stripe_customer_id,'') from b2c_orders where order_number=${n}`).split("|")
  return { id, status, reason, mode, ref, unit: Number(unit), total: Number(total), cust }
}
const pis = async (cust: string) => (cust ? (await stripe.paymentIntents.list({ customer: cust, limit: 10 })).data : [])
const pays = (id: string) => sql(`select coalesce(string_agg(kind || ':' || status || ':' || amount_yen, ',' order by created_at), '') from b2c_payments where order_id='${id}'`)

async function book(entry: NonNullable<Awaited<ReturnType<typeof resolveEntry>>>, tag: string, o = TOKYO, d = KYOTO, card = true) {
  const r = await createB2cDraftOrder(entry, qIn(o, d), { name: "Audit Flow", email: `audit-${tag}-${Date.now()}@example.invalid`, whatsapp: "+44 7700 900123", language: "en", consent: true })
  if (!r.ok || !r.orderNumber || !r.accessToken) throw new Error(`draft ${tag}: ${JSON.stringify(r)}`)
  const orderNumber: number = r.orderNumber, accessToken: string = r.accessToken
  if (card) {
    const ord = (await loadOrderForGuest(entry, orderNumber, accessToken))!
    const s = await startB2cCardRegistration(stripe, PK, ord, true)
    if (!s.ok) throw new Error(`card start ${tag}: ${JSON.stringify(s)}`)
    const o2 = (await loadOrderForGuest(entry, orderNumber, accessToken))!
    await stripe.setupIntents.confirm(o2.stripe_setup_intent_id!, { payment_method: "pm_card_visa" })
    await finalizeB2cCard(stripe, o2.id, "guest")
  }
  return { n: orderNumber, token: accessToken }
}

async function main() {
  if (!getSupabase()) throw new Error("no supabase")
  process.env.BONDEX_ENV = "staging" // DB の接続を作った後（r1_mock_flow と同じ）
  process.env.STAGING_PLACES_MOCK = "true"
  delete process.env.GOOGLE_MAPS_API_KEY
  for (const d of ["2026-11-10", "2026-11-11", "2026-11-12"]) sql(`insert into b2c_ops_days(date, max_new_bookings, max_pieces) values ('${D(d)}', 500, 2000) on conflict (date) do update set max_new_bookings=500, max_pieces=2000, closed=false`)
  fac(TOKYO, "verified"); fac(OSAKA, "verified"); fac(KYOTO, "unknown")

  console.log("U1 阪急の入口: 発行 → 予約 → 紹介元のコード・定価")
  const t1 = generateEntryToken(D("2026-11-20"))
  sql(`insert into b2c_entry_links(referrer_code, referrer_name, referrer_name_en, token_hash) values ('HANKYU', '阪急交通社', 'Hankyu Travel', '${sha(t1)}')`)
  const entry = (await resolveEntry(t1))!
  ok("期限つきの入口が使える", entry?.referrerCode === "HANKYU")
  const a = await book(entry, "reject")
  const ra = row(a.n)
  ok("予約に紹介元 HANKYU を記録", ra.ref === "HANKYU", ra)
  ok("定価: 1個 4,980円（税抜）・税込 5,478円（紹介元による値引き・上乗せなし）", ra.unit === 4980 && ra.total === 5478, ra)
  ok("未確認のホテル（京都）を含む → カード登録の後も確認待ち", ra.status === "awaiting_hotel_confirmation" && ra.mode === "awaiting_hotel_verification", ra)
  ok("予約・カード登録の時点で請求 0件（DB・Stripe）", pays(ra.id) === "" && (await pis(ra.cust)).length === 0)

  console.log("U2 保留 → 受けない: 取消・請求なし（DB と Stripe で一貫）")
  const due0 = sql(`select confirmation_due_at from b2c_orders where id='${ra.id}'`)
  const h = await holdFacility(OP, KYOTO, "折り返し待ち")
  ok("保留: 確認待ちのまま・期限は同じ", h.ok && row(a.n).status === "awaiting_hotel_confirmation" && sql(`select confirmation_due_at from b2c_orders where id='${ra.id}'`) === due0, h)
  const rej = await setFacilityStatus(OP, KYOTO, "unsupported", "フロント無人")
  ok("受けない → 取消（hotel_unsupported）", rej.ok && rej.cancelled.includes(a.n) && row(a.n).status === "cancelled" && row(a.n).reason === "hotel_unsupported", rej)
  const pk = await confirmPickup(OP, a.n, "sagawa_driver", "ref-1", 1, "誤って集荷の確認")
  ok("取り消した予約の集荷の確認は拒否", !pk.ok, pk)
  const later = new Date(Date.now() + 3 * 3600_000)
  await runB2cCharges(stripe, later)
  ok("定期の請求を 3時間後の時刻で動かしても、取り消した予約に請求なし（DB 0件・Stripe 0件）", pays(ra.id) === "" && (await pis(ra.cust)).length === 0, pays(ra.id))
  ok("Stripe の顧客は作られている（カード登録済み）が PaymentIntent は 0件", !!ra.cust && (await pis(ra.cust)).length === 0)
  ok("取消の通知を積む（sandbox）", sql(`select count(*) from b2c_outbox where order_id='${ra.id}' and kind='cancelled'`) === "2")

  console.log("U3 確認済み → 集荷の確認 → 30分の猶予 → 請求 1回だけ")
  fac(KYOTO, "unknown")
  const b = await book(entry, "verify")
  const rb = row(b.n)
  ok("確認待ち", rb.status === "awaiting_hotel_confirmation")
  const [v1, v2] = await Promise.all([setFacilityStatus(OP, KYOTO, "verified", "電話で確認"), setFacilityStatus(OP2, KYOTO, "verified", "同時")])
  ok("2人同時の確認: 片方だけ成功", [v1.ok, v2.ok].filter(Boolean).length === 1 && [v1, v2].some((x) => x.error === "state_changed"), [v1, v2])
  ok("確定", row(b.n).status === "confirmed")
  ok("確認者・日時・理由の記録（ホテルと予約の記録）", /^ops-audit2?@example\.invalid\|t$/.test(sql(`select checked_by || '|' || (checked_at is not null)::text::char from b2c_facilities where place_id='${KYOTO}'`)) && sql(`select count(*) from b2c_order_events where order_id='${rb.id}' and event='facility_verified' and operator_email like 'ops-audit%' and reason <> ''`) === "1")
  ok("確定の時点でも請求 0件", pays(rb.id) === "" && (await pis(rb.cust)).length === 0)
  const t0 = Date.now()
  const cp = await confirmPickup(OP, b.n, "sagawa_driver", "ドライバーに手渡し", 1, "集荷を確認")
  ok("集荷の確認 → 請求の予定（scheduled・5,478円）", cp.ok && pays(rb.id) === "base:scheduled:5478", [cp, pays(rb.id)])
  const sched = Date.parse(sql(`select scheduled_at from b2c_payments where order_id='${rb.id}'`))
  ok("請求の予定は集荷の確認の 30分後", Math.abs(sched - (t0 + 30 * 60_000)) < 2 * 60_000, new Date(sched).toISOString())
  await runB2cCharges(stripe, new Date(t0 + 29 * 60_000))
  ok("29分後: まだ請求しない（Stripe 0件）", pays(rb.id) === "base:scheduled:5478" && (await pis(rb.cust)).length === 0, pays(rb.id))
  await runB2cCharges(stripe, new Date(t0 + 31 * 60_000))
  const p1 = await pis(rb.cust)
  ok("31分後: 請求 1回（succeeded・5,478円・Stripe も 1件）", pays(rb.id) === "base:succeeded:5478" && p1.length === 1 && p1[0].amount === 5478 && p1[0].status === "succeeded", [pays(rb.id), p1.map((p) => [p.amount, p.status])])
  await runB2cCharges(stripe, new Date(t0 + 40 * 60_000)); await runB2cCharges(stripe, new Date(t0 + 90 * 60_000))
  ok("請求の処理を繰り返しても二重に請求しない（Stripe 1件のまま）", (await pis(rb.cust)).length === 1 && pays(rb.id) === "base:succeeded:5478")
  const again = await setFacilityStatus(OP, KYOTO, "unsupported", "押し間違い")
  ok("確定・請求の後に「受けない」を押しても 409 相当（state_changed）・予約は取り消されない", !again.ok && again.error === "state_changed" && row(b.n).status === "confirmed")

  console.log("U4 保留中に期限を過ぎる → 既存の自動取消（期限は延びない）・請求なし")
  fac(KYOTO, "unknown")
  const c = await book(entry, "expire")
  const rc = row(c.n)
  await holdFacility(OP, KYOTO, "担当者不在・明日かけ直す")
  ok("保留の記録あり・確認待ちのまま", row(c.n).status === "awaiting_hotel_confirmation" && sql(`select count(*) from b2c_order_events where order_id='${rc.id}' and event='facility_hold'`) === "1")
  sql(`alter table b2c_orders disable trigger user; update b2c_orders set confirmation_due_at = now() - interval '1 minute' where id='${rc.id}'; alter table b2c_orders enable trigger user;`)
  const late = await setFacilityStatus(OP2, KYOTO, "verified", "期限の後に確認")
  ok("期限の後の確認済み: ホテルは記録するが、予約は確定しない（DB が期限で止める）", late.ok && late.stillWaiting.includes(c.n) && row(c.n).status === "awaiting_hotel_confirmation", late)
  const n = await expireB2cConfirmationTimeouts()
  ok("定期の処理の自動取消（confirmation_timeout）", n >= 1 && row(c.n).status === "cancelled" && row(c.n).reason === "confirmation_timeout", row(c.n))
  await runB2cCharges(stripe, later)
  ok("期限切れで取り消した予約に請求なし（DB・Stripe）", pays(rc.id) === "" && (await pis(rc.cust)).length === 0)

  console.log("U5 カード未登録・取消済みの予約は、ホテルの確認で確定しない")
  fac(KYOTO, "unknown")
  const d = await book(entry, "nocard", TOKYO, KYOTO, false)
  const e = await book(entry, "guestcancel")
  const re = row(e.n)
  sql(`select b2c_cancel_order('${re.id}', 'guest', 'guest')`)
  const v3 = await setFacilityStatus(OP, KYOTO, "verified", "電話で確認")
  ok("カード未登録の予約（下書き）は対象外・確定しない", v3.ok && !v3.confirmed.includes(d.n) && row(d.n).status !== "confirmed", [v3, row(d.n).status])
  ok("取消済みの予約は取消のまま（確定に戻らない）", !v3.confirmed.includes(e.n) && row(e.n).status === "cancelled" && row(e.n).reason === "guest")
  ok("どちらも請求 0件", pays(row(d.n).id) === "" && pays(re.id) === "")

  console.log("U6 直前予約: 集荷元・配送先の受入")
  fac(KYOTO, "verified")
  const f = await book(entry, "late1")
  const rf = row(f.n)
  sql(`alter table b2c_orders disable trigger user; update b2c_orders set status='awaiting_hotel_confirmation', confirmed_at=null, confirmation_mode='awaiting_hotel_acceptance', confirmation_due_at=now() + interval '6 hours' where id='${rf.id}'; delete from shipments where b2c_order_id='${rf.id}'; alter table b2c_orders enable trigger user;`)
  const o1 = await setHotelAcceptance(OP, f.n, "origin", "accepted", "集荷元了承")
  ok("集荷元の受入 → まだ確認待ち", o1.ok && row(f.n).status === "awaiting_hotel_confirmation", o1)
  const o2 = await setHotelAcceptance(OP2, f.n, "dest", "accepted", "配送先了承")
  ok("配送先の受入 → 確定", o2.ok && o2.confirmed.includes(f.n) && row(f.n).status === "confirmed", o2)
  ok("受入の記録: 側ごとに決めた運営者・日時・理由", sql(`select string_agg(side || ':' || decided_by || ':' || (decided_at is not null)::text || ':' || contact_note, ',' order by side) from b2c_hotel_acceptances where order_id='${rf.id}'`) === "dest:ops-audit2@example.invalid:true:配送先了承,origin:ops-audit@example.invalid:true:集荷元了承")
  const g = await book(entry, "late2")
  const rg = row(g.n)
  sql(`alter table b2c_orders disable trigger user; update b2c_orders set status='awaiting_hotel_confirmation', confirmed_at=null, confirmation_mode='awaiting_hotel_acceptance', confirmation_due_at=now() - interval '1 minute' where id='${rg.id}'; delete from shipments where b2c_order_id='${rg.id}'; alter table b2c_orders enable trigger user;`)
  await setHotelAcceptance(OP, g.n, "origin", "accepted", "了承")
  const g2 = await setHotelAcceptance(OP, g.n, "dest", "accepted", "了承（期限の後）")
  ok("期限の後に両方そろっても確定しない", g2.ok && row(g.n).status === "awaiting_hotel_confirmation", [g2, row(g.n)])
  await expireB2cConfirmationTimeouts()
  ok("自動取消・請求なし", row(g.n).status === "cancelled" && pays(rg.id) === "")
  const h2 = book(entry, "late3")
  const hh = await h2, rh = row(hh.n)
  sql(`alter table b2c_orders disable trigger user; update b2c_orders set status='awaiting_hotel_confirmation', confirmed_at=null, confirmation_mode='awaiting_hotel_acceptance', confirmation_due_at=now() + interval '6 hours' where id='${rh.id}'; delete from shipments where b2c_order_id='${rh.id}'; alter table b2c_orders enable trigger user;`)
  const rr = await setHotelAcceptance(OP, hh.n, "dest", "refused", "満室")
  ok("配送先が断った → 取消（hotel_refused）・請求なし", rr.ok && row(hh.n).status === "cancelled" && row(hh.n).reason === "hotel_refused" && pays(rh.id) === "")

  console.log("U7 入口の再発行・停止")
  const t2 = generateEntryToken(D("2026-11-20"))
  sql(`update b2c_entry_links set status='disabled', disabled_at=now() where referrer_code='HANKYU' and status='active'`) // issue.ts --disable と同じ SQL
  sql(`insert into b2c_entry_links(referrer_code, referrer_name, referrer_name_en, token_hash) values ('HANKYU', '阪急交通社', 'Hankyu Travel', '${sha(t2)}')`) // 再発行
  ok("古い URL は停止（disabled）・新しい URL は使える", (await resolveEntryState(t1)).state === "disabled" && (await resolveEntryState(t2)).state === "ok")
  ok("停止の前の予約の確定・請求の記録はそのまま（停止は新しい予約だけに効く）", row(b.n).status === "confirmed" && pays(rb.id) === "base:succeeded:5478")

  ok("Google への通信は 0回", googleCalls.length === 0, googleCalls)
  console.log(`p0_audit_flow: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
