/**
 * B2C の確定・取消の後の大口集荷の集計し直し（lib/b2c/bulk-recount.ts）の試験。ローカルの Supabase（docker）だけ・ダミーのデータだけ。
 * メールは送らない（SAGAWA_BULK_EMAIL_ENABLED は使わない・MAIL_TEST_CAPTURE=1）。
 *   実行: set -a; . ./.env.local; set +a; npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-integ/bulk-recount.ts
 *   前提: scripts/test-integ/seed-integrated-dev.sh（本番と同じく 065 を含む）
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { NextRequest } from "next/server"

if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("refusing: local only")
process.env.MAIL_TEST_CAPTURE = "1"
delete process.env.SAGAWA_BULK_EMAIL_ENABLED

let passed = 0, failed = 0
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400)) }
}
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "|", "-c", q], { encoding: "utf8" }).trim()
const JST = 9 * 3600 * 1000
const today = new Date(Date.now() + JST).toISOString().slice(0, 10)
const D = new Date(Date.parse(`${today}T00:00:00Z`) + 10 * 86_400_000).toISOString().slice(0, 10) // 10日後の集荷
const PID = "bulk_test_place_1"
const group = () => sql(`select coalesce(max(total_pieces)::text,'-')||'|'||coalesce(bool_or(is_bulk)::text,'-')||'|'||count(*)||'|'||coalesce(max(status),'-') from sagawa_bulk_pickups where hotel_key='pid:${PID}' and pickup_date='${D}'`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function b2bLeg(bid: string, pieces: number): string {
  return sql(`insert into shipments (booking_id, leg_index, shipment_date, expected_arrival, from_hotel, from_place_id, to_hotel, status, suitcase_count, agency, representative, recipient)
    values ('${bid}', 0, '${D}', '${D}'::date + 1, 'Bulk Hotel', '${PID}', 'Other Hotel', 'issued', ${pieces}, 'Bulk Agency', 'Rep', 'Rcp') returning id`).split("\n")[0]
}
function b2cOrder(pieces: number, status = "card_pending"): string {
  return sql(`insert into b2c_orders (entry_link_id, referrer_code, guest_name, guest_email, guest_whatsapp, origin_place_id, dest_place_id, origin_snapshot, dest_snapshot,
      pickup_date, delivery_date, pieces, route_class, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen, price_rule_version, status, confirmation_mode, card_status,
      consent_version, consented_at, terms_version, terms_lang, terms_consented_at, card_consent_version, card_consented_at, access_token_hash)
    select id, 'HNK001', 'Bulk Guest', 'bulk@example.invalid', '+819000000000', '${PID}', 'bulk_test_place_2',
      jsonb_build_object('name','Bulk Hotel','check_in','${today}'), jsonb_build_object('name','Other Hotel','check_in','${D}','check_out',('${D}'::date+5)::text),
      '${D}', '${D}'::date + 1, ${pieces}, 'standard', 4980, 4980*${pieces}, 498*${pieces}, 5478*${pieces}, 'v1', '${status}', 'instant', 'registered',
      'v1', now(), 'v1', 'ja', now(), 'card-v1', now(), md5(random()::text)
    from b2c_entry_links limit 1 returning id`).split("\n")[0]
}

async function main() {
  sql(`insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('${PID}','Bulk Hotel','verified','t@example.invalid',now()), ('bulk_test_place_2','Other Hotel','verified','t@example.invalid',now()) on conflict (place_id) do update set status='verified'`)
  await sleep(1500)
  const { getSupabase } = await import("@/lib/supabase")
  const { recountBulkPickupsNow, scheduleBulkRecount } = await import("@/lib/b2c/bulk-recount")
  const sb = getSupabase()!

  console.log("1. スイッチ OFF（今の動きのまま）")
  delete process.env.SAGAWA_BULK_ALERT_ENABLED
  b2bLeg("BULK-B2B-1", 15)
  ok("OFF: 集計し直さない・集荷単位の表に何も書かない", (await recountBulkPickupsNow(sb)) === false && sql("select count(*) from sagawa_bulk_pickups") === "0")
  scheduleBulkRecount(sb, "test-off"); await sleep(800)
  ok("OFF: 予約の後の集計し直しも何もしない", sql("select count(*) from sagawa_bulk_pickups") === "0")

  console.log("2. ON: B2B と B2C を同じホテル・同じ集荷日で合算")
  process.env.SAGAWA_BULK_ALERT_ENABLED = "true"
  await recountBulkPickupsNow(sb)
  // main の決まり（lib/sagawa-bulk/core.ts 194行）: 大口（20個以上）か重複（同じホテル・同じ日に別の予約が 2件以上）の集荷単位だけを記録する
  ok("B2B の 1件の予約だけ（15個）: 大口でも重複でもないので集荷単位を作らない", group() === "-|-|0|-", group())
  const draft = b2cOrder(6, "card_pending")
  await recountBulkPickupsNow(sb)
  ok("未確定の B2C の予約（区間なし）は数えない（集荷単位は作られないまま）", group() === "-|-|0|-", group())
  const o1 = b2cOrder(6, "card_pending")
  ok("B2C の予約を確定（DB の確定が成功）", sql(`select b2c_confirm_order('${o1}')`) === "t" && sql(`select count(*) from shipments where b2c_order_id='${o1}'`) === "1")
  await recountBulkPickupsNow(sb)
  ok("確定の後の集計: 15＋6＝21個・大口・未連絡（pending）", group() === "21|true|1|pending", group())
  ok("集荷単位の顔ぶれに B2C の区間が入る", sql(`select count(*) from sagawa_bulk_pickup_members m join shipments s on s.id=m.shipment_id where s.b2c_order_id='${o1}' and m.removed_at is null`) === "1")

  console.log("3. 何度・同時に動いても同じ")
  await Promise.all([recountBulkPickupsNow(sb), recountBulkPickupsNow(sb), recountBulkPickupsNow(sb)])
  await recountBulkPickupsNow(sb)
  ok("同時に 3回＋もう 1回: 集荷単位は 1行・21個・pending のまま", group() === "21|true|1|pending", group())

  console.log("4. 取消の減算")
  ok("B2C の予約を取消（DB の取消が成功）", sql(`select b2c_cancel_order('${o1}', 'guest', 'guest')`) === "cancelled")
  await recountBulkPickupsNow(sb)
  // main の決まり（lib/sagawa-bulk/reconcile.ts）: 大口・重複でなくなった集荷単位は「解除（cleared）」にする（最後の数は記録として残す）
  ok("取消の後の集計: 残りは B2B の 15個だけ → 集荷単位は解除（cleared）", group() === "21|true|1|cleared", group())
  ok("解除の記録（cleared のイベント）が残る", sql(`select count(*) from sagawa_bulk_pickup_events e join sagawa_bulk_pickups g on g.id=e.group_id where g.hotel_key='pid:${PID}' and e.kind='cleared'`) === "1")

  console.log("5. DB の更新の後にアプリが止まった（集計し直しが呼ばれない）→ 定時の集計で戻る")
  const o2 = b2cOrder(7, "card_pending")
  sql(`select b2c_confirm_order('${o2}')`) // 確定したが、アプリはここで止まった（集計し直しを呼ばない）
  ok("呼ばれないと集計は古いまま（解除のまま・7個の確定が反映されていない）", group() === "21|true|1|cleared", group())
  Object.assign(process.env, { CRON_SECRET: "test-cron-secret" })
  const cron = await import("../../app/api/cron/sagawa-bulk-alert/route")
  const res = await cron.GET(new NextRequest("http://localhost/api/cron/sagawa-bulk-alert", { headers: { authorization: "Bearer test-cron-secret" } }))
  const body = await res.json()
  ok("定時の集計（/api/cron/sagawa-bulk-alert）の後: 15＋7＝22個・大口・pending に戻る（メールは送らない）", res.status === 200 && group() === "22|true|1|pending", [res.status, body, group()])
  ok("メールは送っていない（記録だけの形でも 0件）", ((globalThis as unknown as { __capturedMails?: unknown[] }).__capturedMails ?? []).length === 0)

  console.log("6. 応答の後に動く形（after。要求の外では待たずに動く）")
  sql(`select b2c_cancel_order('${o2}', 'guest', 'guest')`)
  scheduleBulkRecount(sb, "test-after")
  await sleep(2500)
  ok("呼び出しは待たずに戻り、少し後に集計し直されて解除（cleared）", group() === "22|true|1|cleared", group())

  console.log("7. 呼ぶ場所（DB の確定・取消が成功した時だけ）")
  const card = readFileSync("lib/b2c/card-service.ts", "utf8"), hotel = readFileSync("lib/b2c/hotel-ops.ts", "utf8")
  const my = readFileSync("lib/b2c/my-booking.ts", "utf8"), eff = readFileSync("lib/pickup-request/apply-effects.ts", "utf8")
  ok("カード登録で確定した時（状態が confirmed の時だけ）", /if \(order\.status === "confirmed"\) scheduleBulkRecount/.test(card))
  ok("ホテルの確認で確定・取消があった時だけ", /if \(out\.confirmed\.length \|\| out\.cancelled\.length\) scheduleBulkRecount/.test(hotel))
  ok("旅行者の取消が cancelled の時だけ", /if \(data === "cancelled"\) scheduleBulkRecount/.test(my))
  ok("佐川の確認の後に B2C の取消が確定した時", /scheduleBulkRecount\(sb, "b2c cancel applied"\)/.test(eff))
  void draft
  delete process.env.SAGAWA_BULK_ALERT_ENABLED
  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
