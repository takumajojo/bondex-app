/**
 * B2C の請求の DB の関数の境界の試験（PGlite・メモリ内の PostgreSQL。共有の DB・Docker・外部には接続しない）。
 * 本物の sql/0xx（000 の土台・033・043・067・068・061・062・071・073・074・079・081・082）をそのまま流して確かめる:
 *   予約の時点・集荷の確認の前・30分の猶予の中は請求しない／1回だけ取り出す／取消・確認の取消／
 *   取消の申請中は請求しない（082）／追跡が先に集荷済みにした区間も確認できる（082）／取り消した追加の後の追加（082）／返金の上限・二重反映。
 * 実行: PGLITE_DIR=<@electric-sql/pglite を入れたフォルダ> WT=$(pwd) node scripts/test-b2c/charge_db_pglite.mjs
 *   082 の前の動き（不合格になるのが正しい）: SKIP_082=1 を付ける。戻し: EXTRA_SQL=sql/rollback/rollback_082.sql
 */
import { createRequire } from "node:module"
import fs from "node:fs"
const PGDIR = process.env.PGLITE_DIR
const req = createRequire(PGDIR + "/package.json")
const { PGlite } = await import(req.resolve("@electric-sql/pglite"))
const { uuid_ossp } = await import(req.resolve("@electric-sql/pglite/contrib/uuid_ossp"))
const { pgcrypto } = await import(req.resolve("@electric-sql/pglite/contrib/pgcrypto"))
export async function makeDb(files) {
  const db = new PGlite({ extensions: { uuid_ossp, pgcrypto } })
  await db.exec(`create role anon; create role authenticated; create role service_role;`)
  const WT = process.env.WT
  for (const f of files) {
    try { await db.exec(fs.readFileSync(`${WT}/${f}`, "utf8")) ; console.error("applied", f) }
    catch (e) { console.error("FAILED", f, e.message.slice(0, 300)); throw e }
  }
  return db
}

// PGlite（メモリ内）で本物の sql/0xx を流し、請求の DB 関数の境界を確かめる。外部・共有 DB には接続しない。
const FILES = ["scripts/test-b2c/db/000_base_from_prod.sql", "sql/033_hotel_change_schema.sql", "sql/043_shipment_change_requests.sql", "sql/067_pickup_requests.sql", "sql/068_change_requests_pickup_lock.sql", "sql/061_b2c_mvp.sql", "sql/062_b2c_stage4.sql", "sql/071_b2c_cutoff_1830.sql", "sql/073_b2c_outbox_hardening.sql", "sql/074_b2c_stage5_payments.sql", "sql/079_b2c_legal_versions.sql", "sql/081_b2c_leg_prefecture.sql", ...(process.env.SKIP_082 === "1" ? [] : ["sql/082_b2c_charge_safety.sql", "sql/082_b2c_charge_safety.sql"]), ...(process.env.EXTRA_SQL ? process.env.EXTRA_SQL.split(",") : [])]
const db = await makeDb(FILES)
const guard = async (fn) => { try { await fn() } catch (e) { fail++; console.log("  NG  (exception)", e.message, e.where ?? "") } }
const q = async (s, p) => (await db.query(s, p)).rows
const one = async (s, p) => (await q(s, p))[0]
let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) { pass++; console.log("  ok  " + name) } else { fail++; console.log("  NG  " + name, detail === undefined ? "" : JSON.stringify(detail)) } }

await db.exec(`
insert into b2c_entry_links(referrer_code, referrer_name, token_hash) values ('HNK', 'Test', 'th1');
insert into b2c_ops_days(date, max_new_bookings, max_pieces) select d::date, 500, 2000 from generate_series('2026-11-04'::date, '2026-11-20'::date, '1 day') d on conflict (date) do update set max_new_bookings=500, max_pieces=2000, closed=false;
insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('A','A','verified','x',now()),('B','B','verified','x',now());
`)
let seq = 0
async function order(pieces = 2) {
  seq++
  const unit = 2000
  const o = await one(`insert into b2c_orders(entry_link_id, referrer_code, guest_name, guest_email, guest_whatsapp, origin_place_id, dest_place_id, origin_snapshot, dest_snapshot,
      pickup_date, delivery_date, pieces, route_class, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen, price_rule_version, status, confirmation_mode,
      card_status, stripe_customer_id, stripe_payment_method_id, consent_version, consented_at, access_token_hash, confirmed_at, card_consent_version, card_consented_at)
    values ((select id from b2c_entry_links limit 1), 'HNK', 'G', 'g${seq}@example.invalid', '+819012345678', 'A', 'B', '{}', '{}', '2026-11-10', '2026-11-12', $1, 'standard', ${unit}, ${unit}*$1, (${unit}*$1)/10, ${unit}*$1 + (${unit}*$1)/10, 'v1', 'confirmed', 'instant',
      'registered', 'cus_x', 'pm_x', 'terms-v1', now(), 'ath${seq}', now(), 'card-v1', now()) returning id, order_number`, [pieces])
  const s = await one(`insert into shipments(booking_id, leg_index, agency, representative, shipment_date, expected_arrival, from_hotel, to_hotel, recipient, suitcase_count, status, channel, b2c_order_id)
    values ('B2C-${o.order_number}', 0, 'BondEx Direct', 'G', '2026-11-10', '2026-11-12', 'A', 'B', 'G', $1, 'issued', 'b2c', $2) returning id`, [pieces, o.id])
  return { id: o.id, n: o.order_number, sid: s.id }
}
const T0 = "2026-11-10T03:00:00Z"
const plus = (iso, min) => new Date(new Date(iso).getTime() + min * 60000).toISOString()
const confirm = (o, pieces = 2, now = T0) => one(`select b2c_confirm_pickup($1, 'ops@example.invalid', 'cred1', 'sagawa_tracking', 'ref', $2, 'reason', $3::timestamptz) r`, [o.id, pieces, now]).then((x) => x.r)
const claim = (now) => q(`select id, order_id, status from b2c_claim_charges($1::timestamptz, 50, 'w')`, [now])
const pay = (o, kind = "base") => one(`select * from b2c_payments where order_id=$1 and kind=$2 order by created_at desc limit 1`, [o.id, kind])

console.log("D01 予約の時点では請求の行が無い")
await guard(async () => {
  const a = await order()
  ok("確定した予約に請求の行 0", (await one(`select count(*)::int n from b2c_payments where order_id=$1`, [a.id])).n === 0)
  ok("集荷の確認の前は定期の処理で何も取らない", (await claim(plus(T0, 60 * 24 * 3))).filter((r) => r.order_id === a.id).length === 0)
})

console.log("D02 集荷の確認 → 30分は取らない → 後に 1回だけ取る")
await guard(async () => {
  const b = await order()
  const r = await confirm(b)
  ok("confirmed・scheduled", r.result === "confirmed" && r.payment_status === "scheduled", r)
  ok("29分では取らない", (await claim(plus(T0, 29))).filter((x) => x.order_id === b.id).length === 0)
  const c1 = (await claim(plus(T0, 31))).filter((x) => x.order_id === b.id)
  const c2 = (await claim(plus(T0, 32))).filter((x) => x.order_id === b.id)
  ok("31分で 1回・次の回は取らない（processing のまま）", c1.length === 1 && c2.length === 0, { c1, c2 })
  ok("2回目の集荷の確認は already_confirmed", (await confirm(b)).result === "already_confirmed")
})

console.log("D03 予約の取消・集荷の確認の取消 → 請求しない")
await guard(async () => {
  const c = await order()
  await confirm(c)
  ok("猶予の中の取消 → revoked・cancelled", (await one(`select b2c_revoke_pickup($1,'ops@example.invalid','cred1','誤り',$2::timestamptz) r`, [c.id, plus(T0, 10)])).r === "revoked" && (await pay(c)).status === "cancelled")
  ok("取消の後は取らない", (await claim(plus(T0, 60))).filter((x) => x.order_id === c.id).length === 0)
  const d = await order()
  await confirm(d)
  await db.query(`update b2c_orders set status='cancelled', cancelled_at=now(), cancel_reason='ops' where id=$1`, [d.id])
  const cl = (await claim(plus(T0, 31))).filter((x) => x.order_id === d.id)
  ok("予約が取消済み → 取らずに on_hold(order_cancelled)", cl.length === 0 && (await pay(d)).status === "on_hold" && (await pay(d)).hold_reason === "order_cancelled", await pay(d))
})

console.log("D04 取消の申請（佐川の確認待ち）が残っている予約の請求")
await guard(async () => {
  const e = await order()
  // 旅行者が My Booking で取消を申請した状態（b2c_request_cancel が作る行と同じ: kind=cancel・stage=requested）
  await db.query(`insert into shipment_change_requests(shipment_id, booking_id, leg_index, requested_by, kind, stage, reason) values ($1, 'B2C-x', 0, 'operator', 'cancel', 'requested', '旅行者の取消の希望')`, [e.sid])
  const r = await confirm(e)
  const cl = (await claim(plus(T0, 31))).filter((x) => x.order_id === e.id)
  const p = await pay(e)
  ok("取消の申請が残っている間は請求を始めない（on_hold）", cl.length === 0 && p.status === "on_hold", { confirm: r.result, claimed: cl.length, status: p.status, hold: p.hold_reason })
  if (p.status === "on_hold") {
    ok("理由は cancel_pending", p.hold_reason === "cancel_pending", p.hold_reason)
    const rel = await one(`select b2c_resolve_charge_hold($1, 'release', 'ops@example.invalid', 'cred1', '確認中') r`, [p.id])
    const again = (await claim(plus(T0, 40))).filter((x) => x.order_id === e.id)
    ok("申請が残ったまま解除しても、取り出しの再確認で再び止まる", rel.r === "released" && again.length === 0 && (await pay(e)).status === "on_hold", { rel: rel.r, again: again.length })
    await db.query(`update shipment_change_requests set stage='rejected' where shipment_id=$1`, [e.sid])
    await one(`select b2c_resolve_charge_hold($1, 'release', 'ops@example.invalid', 'cred1', '佐川が取消を断った（集荷済み）') r`, [p.id])
    const fin = (await claim(plus(T0, 50))).filter((x) => x.order_id === e.id)
    ok("申請が却下された後に運営が解除 → 請求の取り出し 1回", fin.length === 1, fin)
  }
})

console.log("D05 追跡の同期が先に集荷済みにした区間の集荷の確認")
await guard(async () => {
  const f = await order()
  await db.query(`update shipments set status='picked_up', picked_up_at=now() where id=$1`, [f.sid]) // sync-tracking が佐川のスキャンで前進させた状態
  const r = await confirm(f)
  ok("運営が集荷を確認できる（請求の予定が作れる）", r.result === "confirmed", r)
  if (r.result === "confirmed") {
    const s1 = await one(`select status from shipments where id=$1`, [f.sid])
    ok("区間の状態は追跡の値のまま（picked_up）", s1.status === "picked_up")
    const f2 = await order()
    await db.query(`update shipments set status='delivered', picked_up_at='2026-11-10T02:00:00Z', delivered_at=now() where id=$1`, [f2.sid])
    const r2 = await confirm(f2)
    const s2 = await one(`select status, picked_up_at from shipments where id=$1`, [f2.sid])
    ok("配達済みの区間: 確認できる・delivered を picked_up に戻さない・集荷の時刻は追跡の値", r2.result === "confirmed" && s2.status === "delivered" && new Date(s2.picked_up_at).toISOString() === "2026-11-10T02:00:00.000Z", { r2: r2.result, s2 })
    const rv = await one(`select b2c_revoke_pickup($1,'ops@example.invalid','cred1','誤り',$2::timestamptz) r`, [f2.id, plus(T0, 5)])
    const s3 = await one(`select status, picked_up_at from shipments where id=$1`, [f2.sid])
    ok("その確認を取り消しても、区間は delivered のまま・集荷の時刻も残る", rv.r === "revoked" && s3.status === "delivered" && s3.picked_up_at !== null, { rv: rv.r, s3 })
    const f3 = await order()
    await db.query(`update shipments set status='cancelled' where id=$1`, [f3.sid])
    ok("取消済みの区間は確認できない（shipment_not_pickable）", (await confirm(f3)).result === "shipment_not_pickable")
  }
})

console.log("D06 追加の請求を取り消した後に、もう一度個数の訂正（追加）")
await guard(async () => {
  const g = await order()
  await confirm(g)
  await claim(plus(T0, 31))
  await db.query(`update b2c_payments set status='succeeded', succeeded_at=now(), stripe_payment_intent_id='pi_g' where order_id=$1 and kind='base'`, [g.id])
  const x1 = await one(`select b2c_record_piece_correction($1, 3, 'sagawa_driver', 'ref', 'ops@example.invalid', 'cred1', '増えた', $2::timestamptz) r`, [g.id, plus(T0, 60)])
  ok("1回目の追加 → extra_scheduled", x1.r.result === "extra_scheduled", x1.r)
  // 運営が追加の請求を止めて取り消す（on_hold → cancel）
  await db.query(`update b2c_payments set status='on_hold', hold_reason='other_charge_active' where id=$1`, [x1.r.payment_id])
  await one(`select b2c_resolve_charge_hold($1, 'cancel', 'ops@example.invalid', 'cred1', 'やめる') r`, [x1.r.payment_id])
  let x2, err = null
  try { x2 = await one(`select b2c_record_piece_correction($1, 3, 'sagawa_driver', 'ref2', 'ops@example.invalid', 'cred1', '再確認で増えた', $2::timestamptz) r`, [g.id, plus(T0, 90)]) } catch (e) { err = e.message }
  ok("取り消した追加の後でも、もう一度追加の請求を作れる", !err && x2?.r?.result === "extra_scheduled", { err, r: x2?.r })
  if (!err) ok("新しい追加のキーは取り消した追加と別（extra:…:2）", (await one(`select charge_key from b2c_payments where id=$1`, [x2.r.payment_id])).charge_key.endsWith(":2"))
})

console.log("D07 佐川の正式な個数: 一部の番号が null（JSON の null）")
await guard(async () => {
  const h = await order()
  await confirm(h)
  await db.query(`update shipments set tracking_detail='[{"number":"1","pieceCount":1},{"number":"2","pieceCount":null}]'::jsonb where id=$1`, [h.sid])
  const r = await one(`select b2c_charge_check(p) r from b2c_payments p where order_id=$1`, [h.id])
  const i = await order()
  await confirm(i)
  await db.query(`update shipments set tracking_detail='[{"number":"1","pieceCount":1},{"number":"2"}]'::jsonb where id=$1`, [i.sid])
  const r2 = await one(`select b2c_charge_check(p) r from b2c_payments p where order_id=$1`, [i.id])
  console.log(`  info (P3・修正していない) pieceCount が JSON の null: ${r.r} / キーが無い: ${r2.r}`)
})

console.log("D08 返金: 合計は請求額まで・キーは連番")
await guard(async () => {
  const j = await order()
  await confirm(j)
  await db.query(`update b2c_payments set status='succeeded', succeeded_at=now(), stripe_payment_intent_id='pi_j' where order_id=$1 and kind='base'`, [j.id])
  const p = await pay(j)
  const r1 = await one(`select b2c_request_refund($1, $2, 'r', 'ops@example.invalid', 'cred1') r`, [p.id, p.amount_yen])
  const r2 = await one(`select b2c_request_refund($1, 1, 'r', 'ops@example.invalid', 'cred1') r`, [p.id])
  ok("全額の返金の受付の後、追加の返金は拒否", r1.r.result === "requested" && r2.r.result === "exceeds_refundable", [r1.r, r2.r])
  await one(`select b2c_apply_refund_result($1, 'succeeded', 're_1', null) r`, [r1.r.refund_id])
  const again = await one(`select b2c_apply_refund_result($1, 'succeeded', 're_1', null) r`, [r1.r.refund_id])
  const ev = await one(`select count(*)::int n from b2c_order_events where order_id=$1 and event='refund_succeeded'`, [j.id])
  ok("同じ返金の結果を 2回反映しても 1回（記録 1件・refunded）", again.r === "ok" && ev.n === 1 && (await pay(j)).status === "refunded", { again: again.r, ev: ev.n })
  const mism = await one(`select b2c_apply_refund_result($1, 'succeeded', 're_OTHER', null) r`, [r1.r.refund_id])
  ok("別の Stripe の返金の ID は拒否", mism.r === "refund_id_mismatch")
})

console.log("D09 成功した請求は戻せない・PaymentIntent は差し替えられない")
await guard(async () => {
  const k = await order()
  await confirm(k)
  await db.query(`update b2c_payments set status='succeeded', succeeded_at=now(), stripe_payment_intent_id='pi_k' where order_id=$1 and kind='base'`, [k.id])
  let e1 = null, e2 = null
  try { await db.query(`update b2c_payments set status='failed' where order_id=$1`, [k.id]) } catch (e) { e1 = e.message }
  try { await db.query(`update b2c_payments set stripe_payment_intent_id='pi_other' where order_id=$1`, [k.id]) } catch (e) { e2 = e.message }
  ok("succeeded → failed は拒否", !!e1)
  ok("PaymentIntent の差し替えは拒否", !!e2)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
