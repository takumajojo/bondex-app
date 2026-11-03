// sql/062_pickup_requests.sql を PGlite (組み込み PostgreSQL) で検証する。本番・Supabase には一切触れない。
// PGlite はリポジトリの依存に入れていないため、作業用の空ディレクトリに入れてから実行する:
//   mkdir -p /tmp/pgtest && cd /tmp/pgtest && npm init -y && npm i @electric-sql/pglite@0.2.17
//   node <repo>/scripts/pickup-request/sql062.test.mjs <repo>/sql/062_pickup_requests.sql
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
const { PGlite } = await import(createRequire(process.cwd() + "/").resolve("@electric-sql/pglite"))

const sqlPath = process.argv[2]
const db = new PGlite()
let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ok  ", name) } else { fail++; console.log("  FAIL", name, detail ?? "") }
}

// 本番 shipments の関係する列だけを持つ最小スキーマ (型は本番と同じ)。
await db.exec(`
  create table public.shipments (
    id uuid primary key default gen_random_uuid(),
    booking_id text not null, leg_index int not null default 0,
    shipment_date date not null, status text not null default 'requested',
    carrier text default 'sagawa', tracking_numbers jsonb, pickup_requested_at timestamptz,
    suitcase_count int not null default 1, booking_type text not null default 'fit',
    from_hotel text default 'A', from_place_id text, from_residence jsonb, to_hotel text default 'B', to_place_id text,
    to_residence jsonb, expected_arrival date, delivery_time text,
    unique (booking_id, leg_index));
  create role anon; create role authenticated;
`)
const today = (await db.query(`select (now() at time zone 'Asia/Tokyo')::date as d`)).rows[0].d
const ins = async (b, l, date, status, tracking, picked) => (await db.query(
  `insert into shipments (booking_id, leg_index, shipment_date, status, tracking_numbers, pickup_requested_at)
   values ($1,$2,$3::date,$4,$5::jsonb,$6) returning id`, [b, l, date, status, tracking, picked])).rows[0].id
const off = (n) => `(now() at time zone 'Asia/Tokyo')::date + ${n}`
const dateOff = async (n) => (await db.query(`select (${off(n)})::text as d`)).rows[0].d

// 移行前の既存データ (本番の実態を模したもの)
const d4 = await dateOff(4), dPast = await dateOff(-5)
const S = {
  delivered: await ins("BDX-A", 0, dPast, "delivered", '["111111111111"]', new Date().toISOString()),
  deliveredNoMark: await ins("BDX-B", 0, dPast, "delivered", null, null),
  futureMarkedNoNum: await ins("BDX-C", 0, d4, "issued", null, new Date().toISOString()),
  futureIssuedNoMark: await ins("BDX-D", 0, d4, "issued", null, null),
  nov7requested: await ins("BDX-E", 1, d4, "requested", null, null), // 11月の未依頼4案件と同じ形
  cancelledMarked: await ins("BDX-F", 0, d4, "cancelled", null, new Date().toISOString()),
  pastRequestedNoMark: await ins("BDX-G", 0, dPast, "requested", null, null),
  futureWithNumber: await ins("BDX-H", 0, d4, "issued", '["222222222222"]', new Date().toISOString()),
}

await db.exec(readFileSync(sqlPath, "utf8"))
console.log("migration applied")

const reqs = async (id) => (await db.query(`select * from pickup_requests where shipment_id=$1 order by created_at`, [id])).rows
const one = async (id) => (await reqs(id))[0]

console.log("1. 既存データの3分類")
check("配達済み+番号 → 手動依頼済み (accepted)", (await one(S.delivered))?.state === "accepted" && (await one(S.delivered)).shipping_number === "111111111111")
check("配達済み(番号なし) → accepted", (await one(S.deliveredNoMark))?.state === "accepted")
check("移行した記録に集荷日・個数を入れる (TODO の要確認に出すため)", (await one(S.futureMarkedNoNum))?.pickup_date !== null && (await one(S.futureMarkedNoNum))?.piece_count === 1)
const snap = (await one(S.futureMarkedNoNum))?.request_snapshot
check("移行した記録に依頼内容 (snapshot) を入れる・キーはアプリと同じ10項目",
  !!snap && ["from_hotel","from_place_id","from_residence","to_hotel","to_place_id","to_residence","shipment_date","expected_arrival","delivery_time","suitcase_count"].every((k) => k in snap) && snap.from_hotel === "A" && snap.suitcase_count === 1, snap)
check("依頼済み印のみ・番号なし → 要確認 (needs_review)", (await one(S.futureMarkedNoNum))?.state === "needs_review")
check("旧発行 issued・印なし番号なし(今後) → needs_review", (await one(S.futureIssuedNoMark))?.state === "needs_review")
check("requested・印なし(11月の4案件の形) → 記録なし = 未依頼", (await reqs(S.nov7requested)).length === 0)
check("取消済み → 対象外", (await reqs(S.cancelledMarked)).length === 0)
check("過去の requested・印なし → 記録なし", (await reqs(S.pastRequestedNoMark)).length === 0)
check("今後・番号あり → accepted", (await one(S.futureWithNumber))?.state === "accepted")
const shipUnchanged = (await db.query(`select status, pickup_requested_at from shipments where id=$1`, [S.nov7requested])).rows[0]
check("移行で shipments は変更しない", shipUnchanged.status === "requested" && shipUnchanged.pickup_requested_at === null)

const claim = async (id, channel, owner = "o1") => (await db.query(
  `select * from claim_pickup_request($1,$2,'test','BDXE1',2,$3::date,'谷口',$4,null,$5::jsonb)`, [id, channel, d4, owner, JSON.stringify({ from_hotel: "A", suitcase_count: 2 })])).rows[0]
const trans = async (rid, from, to, o) => (await db.query(
  `select * from transition_pickup_request($1,$2::text[],$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb)`,
  [rid, from, to, o.owner ?? null, o.actor ?? null, o.number ?? null, o.prid ?? null, o.codes ?? null, o.error ?? null, o.note ?? null, o.snapshot ? JSON.stringify(o.snapshot) : null])).rows[0]

console.log("2. 二重依頼の防止")
const c1 = await claim(S.nov7requested, "bizlogi", "run-1")
check("未依頼の区間は Biz-Logi で確保できる (sending)", c1.claimed === true && (await one(S.nov7requested)).state === "sending")
const c2 = await claim(S.nov7requested, "bizlogi", "run-2")
check("同じ区間の2回目 (連打・並走) は拒否", c2.claimed === false && c2.reason === "live_request_exists")
const c3 = await claim(S.nov7requested, "manual")
check("送信中の区間を Excel 手動依頼として記録できない", c3.claimed === false)
let raw = null
try { await db.query(`insert into pickup_requests (shipment_id, booking_id, leg_index, channel, state) values ($1,'BDX-E',1,'manual','accepted')`, [S.nov7requested]) } catch (e) { raw = e.message }
check("関数を通さない直接 INSERT も一意制約で拒否", !!raw && /pickup_requests_one_live_per_leg/.test(raw), raw)
check("needs_review の区間は Biz-Logi で確保できない", (await claim(S.futureMarkedNoNum, "bizlogi")).reason === "live_request_exists")
check("問合番号がある区間は Biz-Logi で確保できない", (await claim(S.futureWithNumber, "bizlogi")).claimed === false)
check("取消済みの区間は確保できない", (await claim(S.cancelledMarked, "bizlogi")).reason === "shipment_cancelled")

console.log("3. 送信結果の保存")
const rid = c1.request_id
check("別の実行は結果を書けない (owner 不一致)", (await trans(rid, ["sending"], "accepted", { owner: "run-2", number: "999" })).reason === "owner_mismatch")
check("Biz-Logi の accepted は問合番号が必須", (await trans(rid, ["sending"], "accepted", { owner: "run-1" })).reason === "shipping_number_required")
const t1 = await trans(rid, ["sending"], "unknown", { owner: "run-1", error: "timeout" })
check("通信断 → unknown", t1.applied === true && (await one(S.nov7requested)).state === "unknown")
check("unknown の区間は再送のための確保ができない", (await claim(S.nov7requested, "bizlogi", "run-3")).claimed === false)
check("unknown の区間を Excel 手動依頼にもできない (CSV 自動切替の禁止)", (await claim(S.nov7requested, "manual")).claimed === false)
const t2 = await trans(rid, ["unknown"], "accepted", { actor: "谷口", number: "333333333333", note: "世田谷に確認・受付済み" })
const ship = (await db.query(`select tracking_numbers, pickup_requested_at, status from shipments where id=$1`, [S.nov7requested])).rows[0]
check("運営が佐川に確認 → accepted、問合番号を shipments に保存", t2.applied && JSON.stringify(ship.tracking_numbers) === '["333333333333"]' && ship.pickup_requested_at !== null)
check("集荷依頼の受付で配送状態 (status) は変わらない", ship.status === "requested")
check("遷移元が違えば適用しない", (await trans(rid, ["sending"], "failed", {})).reason === "state_mismatch")

console.log("4. 手入力の番号を上書きしない")
await db.query(`update shipments set tracking_numbers='["444444444444"]' where id=$1`, [S.futureIssuedNoMark])
const nr = await one(S.futureIssuedNoMark)
await trans(nr.id, ["needs_review"], "accepted", { actor: "谷口", number: "555555555555" })
check("既に番号がある shipments の tracking_numbers は上書きしない", JSON.stringify((await db.query(`select tracking_numbers from shipments where id=$1`, [S.futureIssuedNoMark])).rows[0].tracking_numbers) === '["444444444444"]')

console.log("5. 手動 (Excel) の記録と取り消し")
const sNew = await ins("BDX-I", 0, d4, "requested", null, null)
const m1 = await claim(sNew, "manual")
const mShip = (await db.query(`select pickup_requested_at from shipments where id=$1`, [sNew])).rows[0]
check("Excel 手動依頼 → accepted・pickup_requested_at を記録", m1.claimed && (await one(sNew)).state === "accepted" && mShip.pickup_requested_at !== null)
check("手動依頼済みの区間は Biz-Logi で確保できない", (await claim(sNew, "bizlogi")).reason === "live_request_exists")
await trans(m1.request_id, ["accepted"], "void", { actor: "谷口", note: "押し間違い" })
check("誤記録の取り消し (void) で pickup_requested_at を戻す", (await db.query(`select pickup_requested_at from shipments where id=$1`, [sNew])).rows[0].pickup_requested_at === null)
check("void 後は再び依頼できる", (await claim(sNew, "bizlogi", "run-9")).claimed === true)

console.log("6. 失敗・変更・取消")
const sF = await ins("BDX-J", 0, d4, "requested", null, null)
const f1 = await claim(sF, "bizlogi", "rf")
await trans(f1.request_id, ["sending"], "failed", { owner: "rf", codes: '["E2-0004"]', error: "住所不一致" })
check("明確な失敗 (failed) は有効な依頼に数えない → 直して再送できる", (await claim(sF, "bizlogi", "rf2")).claimed === true)
const sC = await ins("BDX-K", 0, d4, "requested", null, null)
const k1 = await claim(sC, "manual")
await trans(k1.request_id, ["accepted"], "change_pending", { actor: "谷口", note: "世田谷へ取消メール送信" })
check("変更・取消の連絡中 (change_pending) は有効 = 新しい依頼を出せない", (await claim(sC, "bizlogi")).claimed === false)
await trans(k1.request_id, ["change_pending"], "cancelled", { actor: "谷口", note: "佐川から反映確認の返信" })
check("佐川の返信後 cancelled → 有効な依頼なし", (await claim(sC, "manual")).claimed === true)
const back = await trans(f1.request_id, ["failed"], "accepted", { actor: "x", number: "1" })
check("有効な依頼がある区間で古い記録を有効へ戻せない", back.applied === false && back.reason === "live_request_exists", back)

console.log("6b. 依頼内容 (snapshot)")
const sS = await ins("BDX-S", 0, d4, "requested", null, null)
const cS = await claim(sS, "manual")
check("確保時に依頼内容を保存", JSON.stringify((await one(sS)).request_snapshot) === JSON.stringify({ from_hotel: "A", suitcase_count: 2 }))
await trans(cS.request_id, ["accepted"], "change_pending", { actor: "谷口", note: "世田谷へ連絡" })
check("snapshot を渡さない遷移では依頼内容を変えない", (await one(sS)).request_snapshot.suitcase_count === 2)
await trans(cS.request_id, ["change_pending"], "accepted", { actor: "谷口", note: "反映確認", snapshot: { from_hotel: "A2", suitcase_count: 3 } })
check("変更の反映を記録すると新しい依頼内容に置き換える", (await one(sS)).request_snapshot.from_hotel === "A2" && (await one(sS)).request_snapshot.suitcase_count === 3)
check("送信中のまま止まった通知用の列がある", "stale_alerted_at" in (await one(sS)))

console.log("7. 権限")
const grants = (await db.query(`select has_function_privilege('anon','claim_pickup_request(uuid,text,text,text,int,date,text,text,text,jsonb)','execute') as a`)).rows[0]
check("匿名ロールは確保関数を実行できない", grants.a === false)
const rls = (await db.query(`select relrowsecurity from pg_class where relname='pickup_requests'`)).rows[0]
check("RLS 有効", rls.relrowsecurity === true)

console.log("8. 移行の再実行")
const before = (await db.query(`select count(*)::int n from pickup_requests`)).rows[0].n
await db.exec(readFileSync(sqlPath, "utf8"))
check("062 を2回流しても記録が増えない", (await db.query(`select count(*)::int n from pickup_requests`)).rows[0].n === before)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
