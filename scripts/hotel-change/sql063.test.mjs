// sql/063 (ホテル変更関数の列名修正) を PGlite で検証する。本番には触れない。
//   PGlite を空ディレクトリに入れてから: node <repo>/scripts/hotel-change/sql063.test.mjs <repo>/sql
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
const { PGlite } = await import(createRequire(process.cwd() + "/").resolve("@electric-sql/pglite"))
const dir = process.argv[2]
const db = new PGlite()
let pass = 0, fail = 0
const check = (n, c, d) => { if (c) { pass++; console.log("  ok  ", n) } else { fail++; console.log("  FAIL", n, d ?? "") } }
await db.exec(`create table shipments (id uuid primary key default gen_random_uuid(), booking_id text, leg_index int default 0, status text, yamato_tracking jsonb,
  from_hotel text, from_hotel_ja text, from_place_id text, from_city text, from_prefecture text, to_hotel text, to_hotel_ja text, to_place_id text, to_city text, to_prefecture text,
  agency text, label_sent_at timestamptz, guest_hotel_notified_at timestamptz, pickup_hotel_notified_at timestamptz, change_deadline_at timestamptz, updated_at timestamptz,
  hotel_contact_info jsonb);
  create role anon; create role authenticated; create role service_role;`)
for (const f of ["033_hotel_change_schema.sql", "034_hotel_change_rpc.sql", "035_hotel_change_cancel_task.sql", "036_hotel_change_require_unissued.sql"]) await db.exec(readFileSync(`${dir}/${f}`, "utf8"))
await db.exec(`alter table shipments rename column yamato_tracking to tracking_numbers`) // 044 の改名 (本番と同じ状態)
const ins = async (status, tracking) => (await db.query(`insert into shipments (booking_id,status,tracking_numbers,from_hotel,to_hotel,agency,hotel_contact_info) values ('BDX-T',$1,$2::jsonb,'A','B','T','{"guest":{"x":1}}') returning id`, [status, tracking])).rows[0].id
const call = async (id, requireUnissued = true) => {
  try { return { ok: true, v: (await db.query(`select apply_hotel_change($1::uuid,'guest','New','新ホテル','pid','京都市','京都府',false,null,false,'agency:t','T',$2) as v`, [id, requireUnissued])).rows[0].v } }
  catch (e) { return { ok: false, e: e.message } }
}
const before = await call(await ins("requested", null))
check("修正前: 改名後は必ず失敗する (本番の現状の再現)", !before.ok && /yamato_tracking/.test(before.e), before)
await db.exec(readFileSync(`${dir}/063_fix_hotel_change_tracking_column.sql`, "utf8"))
const a = await ins("requested", null)
const r = await call(a)
const row = (await db.query(`select to_hotel, to_hotel_ja, hotel_contact_info from shipments where id=$1`, [a])).rows[0]
check("修正後: requested の区間でホテル変更できる", r.ok && row.to_hotel === "New" && row.to_hotel_ja === "新ホテル", r)
check("変更履歴が1件残る", (await db.query(`select count(*)::int n from shipment_hotel_changes where shipment_id=$1`, [a])).rows[0].n === 1)
check("到着先ホテルの連絡情報をリセット (本番定義どおり)", !("guest" in (row.hotel_contact_info ?? {})))
const b = await call(await ins("requested", '["100000000011"]'))
check("問合番号がある区間は physical_gate で拒否 (改名後の列で判定)", !b.ok && /physical_gate/.test(b.e), b)
const c = await call(await ins("picked_up", null), false)
check("集荷済み以降は拒否", !c.ok && /physical_gate/.test(c.e))
const d = await call(await ins("issued", null), true)
check("代理店セルフ (p_require_unissued) は requested/pending 以外を拒否", !d.ok && /unissued_required/.test(d.e))
const e = await call(await ins("issued", null), false)
check("運営 (p_require_unissued=false) は issued・番号なしなら変更できる", e.ok)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
