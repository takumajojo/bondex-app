// sql/069_facilities.sql (ホテル受付可否の共通台帳) を PGlite で検証する。本番・Supabase には一切触れない。
//   PGlite を入れたディレクトリで: node <repo>/scripts/facilities/sql069.test.mjs <repo>/sql/069_facilities.sql
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
const { PGlite } = await import(createRequire(process.cwd() + "/").resolve("@electric-sql/pglite"))

const db = new PGlite()
let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ok  ", name) } else { fail++; console.log("  FAIL", name, detail ?? "") }
}
const rejects = async (name, sql, params, pattern) => {
  try {
    await db.query(sql, params)
    check(name, false, "エラーにならなかった")
  } catch (e) {
    check(name, pattern.test(String(e.message)), e.message)
  }
}
await db.exec(`create role anon; create role authenticated; create role service_role;`)
await db.exec(readFileSync(process.argv[2], "utf8"))
await db.exec(readFileSync(process.argv[2], "utf8")) // 2回流しても壊れない (再実行可能)

const P = (n) => `ChIJtestplace${String(n).padStart(6, "0")}`
const reg = async (pid) => (await db.query(`select public.facility_register_place($1) as id`, [pid])).rows[0].id
const gate = async (pid, side) => (await db.query(`select * from public.facility_gate($1,$2)`, [pid, side])).rows[0]
const set = async (fid, side, status, opts = {}) => (await db.query(
  `select * from public.facility_set_status($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
  [fid, side, status, opts.conditions ?? null, opts.rejectReason ?? null, opts.source ?? "operator",
   JSON.stringify(opts.evidence ?? {}), opts.confidence ?? null, opts.reason ?? "電話で確認", opts.actor ?? "谷口"])).rows[0]
const fac = async (id) => (await db.query(`select * from public.facilities where id=$1`, [id])).rows[0]
const checks = async (id) => (await db.query(`select * from public.facility_checks where facility_id=$1 order by checked_at`, [id])).rows

console.log("1. 登録と重複防止")
const a = await reg(P(1))
check("未登録の place_id は unknown で登録", (await fac(a)).pickup_status === "unknown" && (await fac(a)).delivery_status === "unknown")
check("同じ place_id は同じ施設 (重複登録しない)", (await reg(P(1))) === a)
check("施設名・住所は入らない (Google 由来を保存しない)", (await fac(a)).display_name === null && (await fac(a)).display_address === null)
await rejects("不正な place_id は登録しない", `select public.facility_register_place('bad id')`, [], /invalid_place_id/)
const same = await Promise.all([reg(P(2)), reg(P(2)), reg(P(2))])
check("同時に同じ place_id を登録しても1施設", new Set(same).size === 1, JSON.stringify(same))
check("台帳の施設数 = place_id の数", (await db.query(`select count(*)::int c from facilities`)).rows[0].c === 2)

console.log("2. 未登録・未確認の判定 (判断7)")
check("未登録は allow (拒否しない)", (await gate(P(999), "pickup")).result === "allow")
check("未確認・疑いなしは allow", (await gate(P(1), "delivery")).result === "allow")

console.log("3. 集荷元と配送先を別々に判定")
let r = await set(a, "pickup", "rejected", { rejectReason: "no_front", reason: "集荷時間帯にフロント無人 (電話で確認)" })
check("運営は受付不可にできる", r.ok && r.applied)
check("集荷元は deny", (await gate(P(1), "pickup")).result === "deny")
check("配送先は別 (未確認のまま allow)", (await gate(P(1), "delivery")).result === "allow")
r = await set(a, "delivery", "conditional", { conditions: "フロント 8-22時のみ受取" })
const g = await gate(P(1), "delivery")
check("条件付きは allow_with_conditions と条件", g.result === "allow_with_conditions" && g.conditions === "フロント 8-22時のみ受取")
check("条件付きは条件の入力が必須", (await set(a, "delivery", "conditional", {})).reason === "conditions_required")
check("受付不可は理由の区分が必須", (await set(a, "delivery", "rejected", {})).reason === "reject_reason_required")
check("理由・確認者は必須", (await set(a, "delivery", "accepted", { reason: " " })).reason === "reason_and_actor_required")
check("履歴が残る (確認者・理由・旧→新)", (await checks(a)).length === 2 && (await checks(a))[0].checked_by === "谷口" && (await checks(a))[0].new_status === "rejected")

console.log("4. 直接の書き換えは止まる")
await rejects("状態列を直接 update できない", `update facilities set pickup_status='accepted' where id=$1`, [a], /facility_status_guard/)
await rejects("新しい施設を accepted で直接 insert できない", `insert into facilities (pickup_status) values ('accepted')`, [], /facility_status_guard/)
await rejects("履歴は書き換えられない", `update facility_checks set reason='x' where facility_id=$1`, [a], /immutable/)
await rejects("履歴は削除できない", `delete from facility_checks where facility_id=$1`, [a], /immutable/)
await db.query(`insert into facility_checks (facility_id, side, new_status, source, reason, checked_by, check_txid) values ($1,'pickup','accepted','operator','x','x', 1)`, [a])
check("履歴の check_txid は偽れない (トリガーが今のトランザクションに置き換える)",
  (await db.query(`select bool_and(check_txid <> 1) b from facility_checks where facility_id=$1`, [a])).rows[0].b)
await rejects("別のトランザクションで書いた履歴では状態を変えられない", `update facilities set pickup_status='accepted' where id=$1`, [a], /facility_status_guard/)
// 同じトランザクションで履歴を書けば通る = facility_set_status と同じ条件 (外から呼ぶ経路も履歴が必須)
await db.exec(`begin`)
await db.query(`insert into facility_checks (facility_id, side, old_status, new_status, source, reason, checked_by) values ($1,'pickup','rejected','rejected','operator','x','x')`, [a])
let blocked = false
try { await db.query(`update facilities set pickup_status='accepted' where id=$1`, [a]) } catch { blocked = true }
await db.exec(`rollback`)
check("履歴の新しい状態と違う値には変えられない", blocked)

console.log("5. 自動判定の安全策 (判断6)")
const b = await reg(P(3))
r = await set(b, "both", "rejected", { source: "batch_municipal", confidence: "medium", rejectReason: "minpaku", reason: "届出住宅と住所が部分一致" })
check("確度が高くない自動判定は状態を変えない", r.ok && !r.applied && (await fac(b)).pickup_status === "unknown")
check("代わりに確認待ち (needs_review) になる", (await gate(P(3), "pickup")).result === "needs_review")
r = await set(b, "both", "rejected", { source: "batch_municipal", confidence: "high", rejectReason: "minpaku", reason: "届出住宅と番地・名前が一致", evidence: { source_key: "M30-1234" } })
check("確度 high・未確認なら自動で受付不可", r.applied && (await gate(P(3), "delivery")).result === "deny")
check("自動の受付不可は decided_by=auto で確認待ち", (await fac(b)).pickup_decided_by === "auto" && (await fac(b)).review_state === "pending")
const c = await reg(P(4))
await set(c, "both", "accepted", { reason: "フロント24時間・荷物預かり可 (電話)" })
r = await set(c, "both", "rejected", { source: "batch_website", confidence: "high", rejectReason: "unmanned", reason: "公式サイトに『無人』の語" })
check("運営が対応可能と確認した施設は、自動で受付不可にしない", !r.applied && (await gate(P(4), "pickup")).result === "allow")
check("食い違いは確認待ちとして一覧に出る", (await fac(c)).review_state === "pending" && /運営の確認済み/.test((await fac(c)).review_reason))
r = await set(b, "pickup", "accepted", { source: "batch_website", confidence: "high", reason: "x" })
check("自動判定で対応可能にはできない", !r.applied)
const d = await reg(P(5))
await set(d, "pickup", "rejected", { rejectReason: "hotel_refused", reason: "ホテルから配送を断られた" })
r = await set(d, "delivery", "rejected", { source: "batch_municipal", confidence: "high", rejectReason: "minpaku", reason: "x" })
check("運営が片側を確認した施設も、自動では変えない", !r.applied)

console.log("6. Google 由来の判定は法務確認まで記録しない")
let blockedGoogle = false
try { await set(await reg(P(6)), "pickup", "rejected", { source: "booking_google", confidence: "high", rejectReason: "no_front", reason: "x" }) } catch (e) { blockedGoogle = /google_derived_disabled/.test(e.message) }
check("booking_google は設定が false の間は拒否", blockedGoogle)
check("拒否された判定は履歴にも状態にも残らない", (await checks(await reg(P(6)))).length === 0)

console.log("7. place_id の変更")
const e = await reg(P(7))
await set(e, "both", "accepted", { reason: "確認済み" })
r = (await db.query(`select * from public.facility_link_place($1,$2,'谷口')`, [e, P(8)])).rows[0]
check("新しい place_id を同じ施設に結べる", r.ok)
check("新しい ID でも同じ判定", (await gate(P(8), "pickup")).result === "allow" && (await gate(P(8), "pickup")).facility_id === e)
check("古い ID も残り、同じ施設に結び付く (過去の予約)", (await gate(P(7), "pickup")).facility_id === e)
check("現在の ID は1つ", (await db.query(`select count(*)::int c from facility_place_ids where facility_id=$1 and is_current`, [e])).rows[0].c === 1)
r = (await db.query(`select * from public.facility_link_place($1,$2,'谷口')`, [e, P(1)])).rows[0]
check("別の施設の place_id は付け替えない (統合は運営の判断)", !r.ok && r.reason === "place_id_in_use")

console.log("8. 個人宅・民泊は原則受付不可 (判断5)")
const res = async (key, side) => (await db.query(`select * from public.facility_gate_residence($1,$2)`, [key, side])).rows[0]
check("未承認の個人宅は deny", (await res("東京都新宿区西新宿1-1-1-101", "pickup")).result === "deny")
const rid = (await db.query(`select public.facility_register_residence($1,$2,'谷口') as id`, ["東京都新宿区西新宿1-1-1-101", "西新宿1-1-1 101号室"])).rows[0].id
check("登録しただけ (未承認) は deny", (await res("東京都新宿区西新宿1-1-1-101", "pickup")).result === "deny")
await set(rid, "both", "conditional", { conditions: "ホストが 9-11時に立ち会い (連絡先あり)", reason: "受け渡し条件を確認" })
check("運営が条件を確認して承認した物件は通る", (await res("東京都新宿区西新宿1-1-1-101", "pickup")).result === "allow_with_conditions")
r = await set(rid, "both", "rejected", { source: "batch_municipal", confidence: "high", rejectReason: "minpaku", reason: "x" })
check("個人宅は自動判定で変えない", !r.applied)

console.log("9. B2C の既存条件 (両側とも確認済みでないと確定しない)")
const st = async (pid) => (await db.query(`select public.b2c_facility_status($1) as s`, [pid])).rows[0].s
check("運営が両側を対応可能と確認 → verified", (await st(P(4))) === "verified")
check("未登録 → unknown", (await st(P(998))) === "unknown")
const f3 = await reg(P(10))
await set(f3, "both", "conditional", { conditions: "8-22時のみ", reason: "確認" })
check("条件付きは verified にしない (B2C は確定しない)", (await st(P(10))) === "unknown")
check("受付不可 → unsupported", (await st(P(3))) === "unsupported")
const f2 = await reg(P(9))
await set(f2, "both", "accepted", { reason: "確認" })
check("運営が両側を確認すれば verified", (await st(P(9))) === "verified")

console.log("10. 権限")
const priv = async (fn) => (await db.query(`select has_function_privilege('anon', $1, 'execute') as a, has_function_privilege('authenticated', $1, 'execute') as b`, [fn])).rows[0]
for (const fn of ["public.facility_set_status(uuid,text,text,text,text,text,jsonb,text,text,text)", "public.facility_register_place(text)", "public.facility_gate(text,text)"]) {
  const p = await priv(fn)
  check(`匿名・代理店のロールは実行できない: ${fn.split("(")[0]}`, !p.a && !p.b)
}
check("RLS が有効", (await db.query(`select bool_and(relrowsecurity) b from pg_class where relname in ('facilities','facility_place_ids','facility_checks','facility_source_records','survey_regions','facility_settings')`)).rows[0].b)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
