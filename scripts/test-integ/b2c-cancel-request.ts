/**
 * B2C の集荷依頼後の取消（My Booking → 取消申請）と、B2C の機能フラグが OFF の時の動きの試験。
 * 本番には接続しない: 開発サーバー・DB はローカルだけ（BASE・Supabase の URL が localhost でなければ止まる）。
 * 前提: scripts/test-b2c/db/seed-dev.sh の後に統合の SQL（067〜072）を適用し、開発サーバーが BASE で動いている。
 * 実行: set -a; . ./.env.local; set +a; BASE=http://localhost:3211 npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-integ/b2c-cancel-request.ts
 */
import crypto from "node:crypto"
import { NextRequest } from "next/server"
import { getSupabase } from "@/lib/supabase"
import { b2cAccessToken } from "@/lib/b2c/access-token"
import { loadMyBooking } from "@/lib/b2c/my-booking"
import { stepPickupChange } from "@/lib/pickup-request/change"
import { applyChangeWithEffects } from "@/lib/pickup-request/apply-effects"

const BASE = process.env.BASE ?? "http://localhost:3211"
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(BASE) || !/^http:\/\/(localhost|127\.0\.0\.1):/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("refusing: local only")

let passed = 0
let failed = 0
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail ?? "") }
}
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex")
const sb = getSupabase()!

async function newConfirmedOrder(daysAhead: number): Promise<{ id: string; token: string; shipmentId: string }> {
  const { data: link } = await sb.from("b2c_entry_links").select("id, referrer_code").limit(1).single()
  await sb.from("b2c_facilities").upsert([
    { place_id: "integ_A", name: "Integ Hotel A", status: "verified", checked_by: "test", last_verified_at: new Date().toISOString() },
    { place_id: "integ_B", name: "Integ Hotel B", status: "verified", checked_by: "test", last_verified_at: new Date().toISOString() },
  ])
  const id = crypto.randomUUID()
  const token = b2cAccessToken(id)
  const d = (n: number) => new Date(Date.now() + 9 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10)
  const { error } = await sb.from("b2c_orders").insert({
    id, entry_link_id: link!.id, referrer_code: link!.referrer_code, guest_name: "Integ Guest", guest_email: "integ@example.invalid",
    guest_whatsapp: "+819000000000", origin_place_id: "integ_A", dest_place_id: "integ_B",
    origin_snapshot: { name: "Integ Hotel A", check_in: d(0) }, dest_snapshot: { name: "Integ Hotel B", check_in: d(daysAhead), check_out: d(daysAhead + 5) },
    pickup_date: d(daysAhead), delivery_date: d(daysAhead + 1), pieces: 2, route_class: "standard", unit_net_yen: 3000, subtotal_net_yen: 6000,
    tax_yen: 600, total_gross_yen: 6600, price_rule_version: "v1", status: "card_pending", confirmation_mode: "instant",
    card_status: "registered", consent_version: "v1", consented_at: new Date().toISOString(), access_token_hash: sha(token), language: "ja",
    // sql/079: 確定にはカード登録の同意（後日の請求）が要る
    card_consent_version: "card-v1", card_consented_at: new Date().toISOString(), terms_version: "v1", terms_lang: "ja", terms_consented_at: new Date().toISOString(),
  })
  if (error) throw new Error(`insert order: ${error.message}`)
  const { data: confirmed } = await sb.rpc("b2c_confirm_order", { p_order_id: id })
  if (confirmed !== true) throw new Error("confirm failed")
  const { data: ship } = await sb.from("shipments").select("id").eq("b2c_order_id", id).single()
  return { id, token, shipmentId: ship!.id as string }
}
const post = (token: string) =>
  fetch(`${BASE}/api/b2c/my/cancel`, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": `10.9.${Math.floor(Math.random() * 200)}.1` }, body: JSON.stringify({ token }) })

async function main() {
  console.log("My Booking: 集荷依頼の前の取消（即時）")
  {
    const o = await newConfirmedOrder(4)
    const res = await post(o.token)
    const body = await res.json()
    ok("200・cancelled", res.status === 200 && body.result === "cancelled", body)
    const { data: ord } = await sb.from("b2c_orders").select("status").eq("id", o.id).single()
    const { data: sh } = await sb.from("shipments").select("status").eq("id", o.shipmentId).single()
    ok("予約・区間とも取消", ord?.status === "cancelled" && sh?.status === "cancelled", { ord, sh })
  }

  console.log("My Booking: 集荷依頼の後の取消（取消申請）")
  const o = await newConfirmedOrder(4)
  const { data: claim } = await sb.rpc("claim_pickup_request", {
    p_shipment_id: o.shipmentId, p_channel: "manual", p_environment: null, p_manage_number: null, p_piece_count: 2,
    p_pickup_date: (await sb.from("shipments").select("shipment_date").eq("id", o.shipmentId).single()).data!.shipment_date, p_actor: "op", p_owner: "op", p_note: null,
  })
  ok("集荷依頼を記録（手動）", Array.isArray(claim) && claim[0]?.claimed === true, claim)
  const { count: outBefore } = await sb.from("b2c_outbox").select("id", { count: "exact", head: true }).eq("order_id", o.id).eq("status", "pending")
  const res = await post(o.token)
  const body = await res.json()
  ok("500 ではなく 202・cancel_requested", res.status === 202 && body.result === "cancel_requested" && body.cancelRequested === true, { status: res.status, body })
  const { data: ord } = await sb.from("b2c_orders").select("status, card_status, stripe_payment_method_id").eq("id", o.id).single()
  const { data: sh } = await sb.from("shipments").select("status").eq("id", o.shipmentId).single()
  const { data: pr } = await sb.from("pickup_requests").select("state").eq("shipment_id", o.shipmentId).single()
  ok("佐川の確認の前は予約・区間・集荷依頼を変えない", ord?.status === "confirmed" && sh?.status === "issued" && pr?.state === "accepted", { ord, sh, pr })
  ok("カードは登録のまま（取消確定まで外さない）", ord?.card_status === "registered")
  const { count: outAfter } = await sb.from("b2c_outbox").select("id", { count: "exact", head: true }).eq("order_id", o.id).eq("status", "pending")
  ok("未送信の通知を取り消さない・取消の通知を積まない", outAfter === outBefore, { outBefore, outAfter })
  const { data: cr } = await sb.from("shipment_change_requests").select("kind, stage, requested_by, needs_sagawa").eq("shipment_id", o.shipmentId)
  ok("旅行者からの取消申請が1件（佐川の確認が要る）", cr?.length === 1 && cr[0].kind === "cancel" && cr[0].stage === "requested" && cr[0].requested_by === "guest" && cr[0].needs_sagawa === true, cr)
  const v = await loadMyBooking(o.token)
  ok("My Booking: 取消申請中と表示・取消ボタンは出さない", v?.cancelRequested === true && v?.canCancel === false && v?.stage === "confirmed", v && { cancelRequested: v.cancelRequested, canCancel: v.canCancel, stage: v.stage })
  const again = await post(o.token)
  const againBody = await again.json()
  ok("もう一度押しても申請は増えない（202・already_requested）", again.status === 202 && againBody.result === "already_requested", againBody)
  const { count: crCount } = await sb.from("shipment_change_requests").select("id", { count: "exact", head: true }).eq("shipment_id", o.shipmentId)
  ok("申請は1件のまま", crCount === 1)

  console.log("運営: 世田谷営業所へ確認 → 佐川の取消確認 → 確定（アプリの関数）")
  {
    const { data: c } = await sb.from("shipment_change_requests").select("id").eq("shipment_id", o.shipmentId).single()
    const early = await applyChangeWithEffects(c!.id as string, "integ-op")
    ok("佐川の確認の前は確定できない", early.ok === false)
    const s1 = await stepPickupChange({ changeId: c!.id as string, step: "contact", actor: "integ-op", note: "世田谷営業所へ電話" })
    const s2 = await stepPickupChange({ changeId: c!.id as string, step: "approve", actor: "integ-op", note: "佐川: 取消を確認", numberPolicy: "kept" } as never)
    ok("連絡・佐川の承認を記録", s1.ok && s2.ok, { s1, s2 })
    const ap = await applyChangeWithEffects(c!.id as string, "integ-op")
    ok("取消を確定", ap.ok === true, ap)
    const { data: ord2 } = await sb.from("b2c_orders").select("status, cancel_reason").eq("id", o.id).single()
    const { data: sh2 } = await sb.from("shipments").select("status").eq("id", o.shipmentId).single()
    const { data: pr2 } = await sb.from("pickup_requests").select("state").eq("shipment_id", o.shipmentId).single()
    ok("予約・区間・集荷依頼が同時に取消（理由は旅行者の取消）", ord2?.status === "cancelled" && ord2?.cancel_reason === "guest" && sh2?.status === "cancelled" && pr2?.state === "cancelled", { ord2, sh2, pr2 })
    const { data: outs } = await sb.from("b2c_outbox").select("kind, status").eq("order_id", o.id)
    ok("取消の通知（メール・WhatsApp）を積み、未送信の確定・リマインドは送らない",
      (outs ?? []).filter((x) => x.kind === "cancelled").length === 2 && !(outs ?? []).some((x) => x.kind !== "cancelled" && x.status === "pending"), outs)
    const { count: pays } = await sb.from("b2c_payments").select("id", { count: "exact", head: true }).eq("order_id", o.id)
    ok("請求は作られない（集荷前）", pays === 0)
    const v2 = await loadMyBooking(o.token)
    ok("My Booking: 取消済みと表示", v2?.stage === "cancelled" && v2?.cancelRequested === false, v2 && { stage: v2.stage, cancelRequested: v2.cancelRequested })
  }

  console.log("B2C の機能フラグが OFF")
  const saved = { b: process.env.B2C_BOOKING_ENABLED, m: process.env.B2C_MY_BOOKING_ENABLED }
  delete process.env.B2C_BOOKING_ENABLED
  delete process.env.B2C_MY_BOOKING_ENABLED
  const { POST: cancelPost } = await import("@/app/api/b2c/my/cancel/route")
  const { POST: quotePost } = await import("@/app/api/b2c/quote/route")
  const { POST: ordersPost } = await import("@/app/api/b2c/orders/route")
  const mk = (path: string, body: unknown) => new NextRequest(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "10.8.0.1" }, body: JSON.stringify(body) })
  const r1 = await cancelPost(mk("/api/b2c/my/cancel", { token: o.token }))
  ok("My Booking の取消は 503（何も変えない）", r1.status === 503)
  const r2 = await quotePost(mk("/api/b2c/quote", { token: "dev-hnk-local-token-0001" }))
  ok("見積もりは 503", r2.status === 503)
  const r3 = await ordersPost(mk("/api/b2c/orders", { token: "dev-hnk-local-token-0001" }))
  ok("新規予約は 503", r3.status === 503)
  const { count: crCount2 } = await sb.from("shipment_change_requests").select("id", { count: "exact", head: true }).eq("shipment_id", o.shipmentId)
  ok("OFF の間は申請も増えない", crCount2 === 1)
  if (saved.b !== undefined) process.env.B2C_BOOKING_ENABLED = saved.b
  if (saved.m !== undefined) process.env.B2C_MY_BOOKING_ENABLED = saved.m

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
