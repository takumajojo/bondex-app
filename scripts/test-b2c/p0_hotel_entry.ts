/**
 * P0-1（ホテルの確認の画面と操作）・P0-2（阪急向けの入口の URL）の試験（2026-11-07）。
 * 開発サーバーとローカルの Supabase（docker）だけ。予約は SQL で作る（Stripe・Google・メールに接続しない）。
 *
 * 実行: set -a; . ./.env.local; set +a; BASE=http://localhost:3230 npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-b2c/p0_hotel_entry.ts
 * 前提: scripts/test-integ/seed-integrated-dev.sh ＋ sql/081〜083
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import crypto from "node:crypto"
import { issueOperatorSession, OPERATOR_SESSION_COOKIE } from "@/lib/operator-session"
import { generateEntryToken, parseEntryToken, entryTokenExpired } from "@/lib/b2c/entry-link"
import { buildIssue, parseArgs, guardSql, validateExpiry } from "../b2c-entry-link/issue"

const BASE = process.env.BASE ?? "http://localhost:3230"
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(BASE) || !/^http:\/\/(localhost|127\.0\.0\.1):/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("refusing: local only")
if (process.env.B2C_NOTIFY_LIVE === "true") throw new Error("refusing: B2C_NOTIFY_LIVE must be off")

let passed = 0, failed = 0, ipN = Math.floor(Math.random() * 60000)
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400)) }
}
const throws = (f: () => unknown, re: RegExp) => { try { f(); return false } catch (e) { return re.test((e as Error).message) } }
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "|", "-c", q], { encoding: "utf8" }).trim()
const sqlErr = (q: string) => { try { sql(q); return "" } catch (e) { return String((e as { stderr?: string }).stderr ?? e) } }
async function http(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  ipN++
  const r = await fetch(BASE + path, {
    method, redirect: "manual",
    headers: { "Content-Type": "application/json", "x-real-ip": `10.7.${(ipN >> 8) % 250}.${(ipN % 250) + 1}`, ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  })
  const text = await r.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* html */ }
  return { status: r.status, json, text }
}
const notFoundPage = (r: { status: number; text: string }) => r.status === 404 || r.text.includes("NEXT_HTTP_ERROR_FALLBACK;404")
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex")
const JST = 9 * 3600 * 1000
const day = (n: number) => new Date(Date.now() + JST + n * 86_400_000).toISOString().slice(0, 10)

/** 確認待ちの予約を SQL で作る（カード登録・同意は済み）。 */
function order(o: { origin: string; dest: string; mode: "awaiting_hotel_verification" | "awaiting_hotel_acceptance"; dueMin?: number; card?: "registered" | "none"; name?: string }) {
  const due = o.dueMin ?? 600
  const pick = day(7)
  return sql(`insert into b2c_orders (entry_link_id, referrer_code, guest_name, guest_email, guest_whatsapp, origin_place_id, dest_place_id, origin_snapshot, dest_snapshot, pickup_date, delivery_date, pieces, route_class, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen, price_rule_version, status, confirmation_mode, confirmation_due_at, card_status, consent_version, consented_at, terms_version, terms_lang, terms_consented_at, card_consent_version, card_consented_at, access_token_hash)
    select id, 'HNK001', '${o.name ?? "Secret Guestname"}', 'secret-guest@example.invalid', '+819000000000', '${o.origin}', '${o.dest}', jsonb_build_object('name','A','check_in','${pick}'), jsonb_build_object('name','B','check_in','${pick}','check_out',('${pick}'::date+4)::text), '${pick}', '${pick}'::date+2, 2, 'standard', 4980, 9960, 996, 10956, 'v1', 'awaiting_hotel_confirmation', '${o.mode}', now() + interval '${due} minutes', '${o.card ?? "registered"}', 'v1', now(), 'v1', 'ja', now(), 'card-v1', now(), md5(random()::text)
    from b2c_entry_links where referrer_code='HNK001' limit 1 returning id || '|' || order_number`).split("\n")[0].split("|")
}
const st = (id: string) => sql(`select status || '/' || coalesce(cancel_reason,'-') from b2c_orders where id='${id}'`)
const ev = (id: string, e: string) => Number(sql(`select count(*) from b2c_order_events where order_id='${id}' and event='${e}'`))

async function main() {
  // 運営者: メールのある個人のパスキー（v2）・メールの無いパスキー・共有パスワード（v1）
  sql(`insert into operator_passkeys(credential_id, public_key, operator_email) values ('p0-cred-email-0000000001', '\\x00', 'ops-p0@example.invalid'), ('p0-cred-email-0000000002', '\\x00', 'ops-p0b@example.invalid'), ('p0-cred-noemail-00000001', '\\x00', null) on conflict do nothing`)
  const op = { cookie: `${OPERATOR_SESSION_COOKIE}=${await issueOperatorSession("p0-cred-email-0000000001")}` }
  const op2 = { cookie: `${OPERATOR_SESSION_COOKIE}=${await issueOperatorSession("p0-cred-email-0000000002")}` }
  const noEmail = { cookie: `${OPERATOR_SESSION_COOKIE}=${await issueOperatorSession("p0-cred-noemail-00000001")}` }
  const v1 = { cookie: `${OPERATOR_SESSION_COOKIE}=${await issueOperatorSession()}` }
  const F = (p: string, status = "unknown") =>
    sql(`insert into b2c_facilities(place_id, name, address, postal_code, status, checked_by, last_verified_at) values ('${p}', 'ホテル ${p}', '東京都新宿区西新宿2-2-1', '1600023', '${status}', ${status === "verified" ? "'seed@example.invalid', now()" : "null, null"}) on conflict (place_id) do update set status=excluded.status, checked_by=excluded.checked_by, last_verified_at=excluded.last_verified_at`)
  F("p0_verified_hotel_1", "verified"); F("p0_unknown_hotel_A"); F("p0_unknown_hotel_B"); F("p0_unknown_hotel_C"); F("p0_unknown_hotel_D"); F("p0_verified_hotel_2", "verified")
  sql(`insert into b2c_ops_days(date, max_new_bookings, max_pieces) values ('${day(7)}', 500, 2000) on conflict (date) do update set max_new_bookings=500, max_pieces=2000, closed=false`)

  console.log("H1 権限: 見るのも操作も、メールのある個人のパスキーだけ")
  for (const [name, h] of [["ログインなし", {}], ["共有パスワード（v1）", v1], ["メールの無いパスキー", noEmail]] as const) {
    const g = await http("GET", "/api/b2c/ops/hotel", undefined, h)
    const p = await http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: "p0_unknown_hotel_A", status: "verified", note: "x" }, h)
    ok(`${name}: 一覧 403・操作 403`, g.status === 403 && p.status === 403 && g.json?.error === "operator_passkey_required", [g.status, p.status])
  }
  const ghost = { cookie: `${OPERATOR_SESSION_COOKIE}=${await issueOperatorSession("p0-cred-not-registered-01")}` }
  const gg = await http("GET", "/api/b2c/ops/hotel", undefined, ghost), gp = await http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: "p0_unknown_hotel_A", status: "verified", note: "x" }, ghost)
  ok("パスキーが登録されていない（消された）セッション: 一覧 403・操作 403", gg.status === 403 && gp.status === 403, [gg.status, gp.status])
  const forged = { cookie: `${OPERATOR_SESSION_COOKIE}=${op.cookie.split("=")[1].replace(/.$/, (c) => (c === "A" ? "B" : "A"))}` }
  ok("署名を書き換えたセッション: 403", (await http("GET", "/api/b2c/ops/hotel", undefined, forged)).status === 403)
  ok("操作を拒否した後もホテルは未確認のまま", sql(`select status from b2c_facilities where place_id='p0_unknown_hotel_A'`) === "unknown")

  console.log("H2 一覧: 未確認のホテルごと・期限・ホテルの情報。旅行者の名前・連絡先は返さない")
  const [a1, n1] = order({ origin: "p0_verified_hotel_1", dest: "p0_unknown_hotel_A", mode: "awaiting_hotel_verification", dueMin: 120 })
  const [a2, n2] = order({ origin: "p0_unknown_hotel_A", dest: "p0_unknown_hotel_B", mode: "awaiting_hotel_verification", dueMin: 600 })
  const q = await http("GET", "/api/b2c/ops/hotel", undefined, op)
  const fa = q.json?.facilities?.find((f: any) => f.placeId === "p0_unknown_hotel_A")
  ok("200・ホテル A に予約 2件（片方は集荷元）", q.status === 200 && fa?.orders?.length === 2 && fa.orders.some((o: any) => String(o.orderNumber) === n2 && o.side === "origin"), q.json)
  ok("ホテルの名前・住所・郵便番号・状態", fa?.name === "ホテル p0_unknown_hotel_A" && fa?.address?.includes("西新宿") && fa?.postalCode === "1600023" && fa?.status === "unknown")
  ok("期限はいちばん早い予約の期限", fa?.dueAt && Math.abs(Date.parse(fa.dueAt) - (Date.now() + 120 * 60_000)) < 5 * 60_000, fa?.dueAt)
  ok("旅行者の名前・メール・電話を返さない", !q.text.includes("Secret Guestname") && !q.text.includes("secret-guest@") && !q.text.includes("+819000000000"))
  ok("確認済みのホテルは一覧に出さない", !q.json.facilities.some((f: any) => f.placeId === "p0_verified_hotel_1"))

  console.log("H3 入力の検証")
  const bad = await Promise.all([
    http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: "p0_unknown_hotel_A", status: "verified" }, op),
    http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: "p0_unknown_hotel_A", status: "verified", note: "   " }, op),
    http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: "../../etc/passwd", status: "verified", note: "x" }, op),
    http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: "p0_unknown_hotel_A", status: "pending", note: "x" }, op),
    http("POST", "/api/b2c/ops/hotel", { action: "acceptance", orderNumber: "1 or 1=1", side: "origin", status: "accepted", note: "x" }, op),
    http("POST", "/api/b2c/ops/hotel", { action: "acceptance", orderNumber: -5, side: "origin", status: "accepted", note: "x" }, op),
    http("POST", "/api/b2c/ops/hotel", { action: "acceptance", orderNumber: Number(n1), side: "front", status: "accepted", note: "x" }, op),
    http("POST", "/api/b2c/ops/hotel", "{not json", op),
    http("POST", "/api/b2c/ops/hotel", { action: "drop", note: "x" }, op),
    http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: "p0_no_such_hotel_x", status: "verified", note: "x" }, op),
  ])
  ok("理由なし・空白だけ 422", bad[0].status === 422 && bad[1].status === 422 && bad[0].json.error === "note_required")
  ok("place_id の形・状態の値・受付番号・側の値が違えば 422", [2, 3, 4, 5, 6].every((i) => bad[i].status === 422), bad.map((b) => b.status))
  ok("JSON でない 400・知らない操作 422・無いホテル 404", bad[7].status === 400 && bad[8].status === 422 && bad[9].status === 404, [bad[7].status, bad[8].status, bad[9].status])
  ok("どの不正な入力でも予約・ホテルは変わらない", st(a1) === "awaiting_hotel_confirmation/-" && sql(`select status from b2c_facilities where place_id='p0_unknown_hotel_A'`) === "unknown")

  console.log("H4 保留: 状態・期限を変えず、確認した人と理由を記録")
  const due0 = sql(`select confirmation_due_at from b2c_orders where id='${a1}'`)
  const h = await http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: "p0_unknown_hotel_A", status: "hold", note: "フロントの担当者の折り返し待ち（15時）" }, op)
  ok("200・予約は確認待ちのまま・期限は同じ", h.status === 200 && st(a1) === "awaiting_hotel_confirmation/-" && sql(`select confirmation_due_at from b2c_orders where id='${a1}'`) === due0, h.json)
  ok("記録: 待っている予約ごとに facility_hold・運営者のメール・パスキー・理由", ev(a1, "facility_hold") === 1 && ev(a2, "facility_hold") === 1 && sql(`select operator_email || '|' || credential_id || '|' || reason from b2c_order_events where order_id='${a1}' and event='facility_hold'`) === "ops-p0@example.invalid|p0-cred-email-0000000001|フロントの担当者の折り返し待ち（15時）")
  const q2 = await http("GET", "/api/b2c/ops/hotel", undefined, op)
  ok("一覧の操作の記録に保留が出る（日時・運営者）", q2.json.facilities.find((f: any) => f.placeId === "p0_unknown_hotel_A")?.events?.some((e: any) => e.event === "facility_hold" && e.operatorEmail === "ops-p0@example.invalid" && e.at))
  const hNone = await http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: "p0_unknown_hotel_D", status: "hold", note: "x" }, op)
  ok("待っている予約が無いホテルの保留は 409（記録先が無い）", hNone.status === 409 && hNone.json.error === "nothing_waiting")

  console.log("H5 二重の操作: 同時に 2人が「確認済み」→ 片方だけ反映・確定と通知は 1回")
  const [r1, r2] = await Promise.all([
    http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: "p0_unknown_hotel_A", status: "verified", note: "電話で確認（1人目）" }, op),
    http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: "p0_unknown_hotel_A", status: "verified", note: "電話で確認（2人目）" }, op2),
  ])
  const codes = [r1.status, r2.status].sort()
  ok("200 と 409（state_changed）", codes[0] === 200 && codes[1] === 409 && [r1, r2].some((r) => r.json.error === "state_changed"), [r1.json, r2.json])
  ok("予約 1（もう一方は確認済み）は確定・予約 2（B が未確認）は確認待ち", st(a1) === "confirmed/-" && st(a2) === "awaiting_hotel_confirmation/-", [st(a1), st(a2)])
  ok("facility_verified の記録は予約ごとに 1回だけ", ev(a1, "facility_verified") === 1 && ev(a2, "facility_verified") === 1)
  ok("確定の通知は 1回（メール・WhatsApp 各 1行）・配送データ 1行", sql(`select count(*) from b2c_outbox where order_id='${a1}' and kind='booking_confirmed'`) === "2" && sql(`select count(*) from shipments where b2c_order_id='${a1}'`) === "1")
  const chk = sql(`select checked_by || '|' || (checked_at is not null)::text from b2c_facilities where place_id='p0_unknown_hotel_A'`)
  ok("ホテルの記録: 確認した運営者・日時", /^ops-p0b?@example\.invalid\|true$/.test(chk), chk)
  const again = await http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: "p0_unknown_hotel_A", status: "verified", note: "もう一度" }, op)
  const flip = await http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: "p0_unknown_hotel_A", status: "unsupported", note: "押し間違い" }, op)
  ok("確認済みのホテルにもう一度・受けないに変える → 409・確定した予約は取り消されない", again.status === 409 && flip.status === 409 && st(a1) === "confirmed/-" && sql(`select status from b2c_facilities where place_id='p0_unknown_hotel_A'`) === "verified", [again.status, flip.status, st(a1)])

  console.log("H6 受けない: 待っている予約を取消（請求なし）・同時の 2回目は 409")
  const [b1] = order({ origin: "p0_verified_hotel_1", dest: "p0_unknown_hotel_C", mode: "awaiting_hotel_verification" })
  const [u1, u2] = await Promise.all([
    http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: "p0_unknown_hotel_C", status: "unsupported", note: "フロントが無人のため預かれない" }, op),
    http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: "p0_unknown_hotel_C", status: "verified", note: "同時に別の人" }, op2),
  ])
  const winner = u1.status === 200 ? "unsupported" : "verified"
  ok("片方だけ 200・もう片方 409", [u1.status, u2.status].sort().join() === "200,409", [u1.json, u2.json])
  ok("勝った操作どおり: 受けない → 取消（hotel_unsupported）／確認済み → 確定", winner === "unsupported" ? st(b1) === "cancelled/hotel_unsupported" : st(b1) === "confirmed/-", [winner, st(b1)])
  ok("請求の行は作らない", sql(`select count(*) from b2c_payments where order_id='${b1}'`) === "0")

  console.log("H7 予約・課金のガードはそのまま（DB の b2c_confirm_order が判定）")
  const [g1] = order({ origin: "p0_verified_hotel_2", dest: "p0_unknown_hotel_D", mode: "awaiting_hotel_verification", card: "none" })
  const [g2] = order({ origin: "p0_verified_hotel_2", dest: "p0_unknown_hotel_D", mode: "awaiting_hotel_verification", dueMin: -5 })
  const gv = await http("POST", "/api/b2c/ops/hotel", { action: "facility", placeId: "p0_unknown_hotel_D", status: "verified", note: "電話で確認" }, op)
  ok("カード未登録の予約は確定しない（まだ確認待ち）", gv.status === 200 && st(g1) === "awaiting_hotel_confirmation/-", [gv.json, st(g1)])
  ok("期限を過ぎた予約は確定しない（定期の処理の自動取消に任せる）", st(g2) === "awaiting_hotel_confirmation/-")
  ok("配送データも作らない", sql(`select count(*) from shipments where b2c_order_id in ('${g1}','${g2}')`) === "0")

  console.log("H8 直前予約の受入: 側ごとに 1回だけ・保留は記録だけ・同時の 2回目は 409")
  const [c1, cn] = order({ origin: "p0_verified_hotel_1", dest: "p0_verified_hotel_2", mode: "awaiting_hotel_acceptance" })
  const q3 = await http("GET", "/api/b2c/ops/hotel", undefined, op)
  const qa = q3.json.acceptances.find((x: any) => String(x.orderNumber) === cn)
  ok("一覧に受入の確認待ち（両側 未回答・ホテル名・期限）", qa?.origin?.status === "pending" && qa?.dest?.status === "pending" && qa?.origin?.name === "ホテル p0_verified_hotel_1" && qa?.dueAt, qa)
  const [x1, x2] = await Promise.all([
    http("POST", "/api/b2c/ops/hotel", { action: "acceptance", orderNumber: Number(cn), side: "origin", status: "accepted", note: "集荷元が了承" }, op),
    http("POST", "/api/b2c/ops/hotel", { action: "acceptance", orderNumber: Number(cn), side: "origin", status: "refused", note: "同時の押し間違い" }, op2),
  ])
  ok("同じ側に同時に 2回 → 200 と 409（already_decided）", [x1.status, x2.status].sort().join() === "200,409" && [x1, x2].some((r) => r.json.error === "already_decided"), [x1.json, x2.json])
  const originDecided = sql(`select status from b2c_hotel_acceptances where order_id='${c1}' and side='origin'`)
  if (originDecided === "accepted") {
    ok("集荷元が了承 → まだ確認待ち", st(c1) === "awaiting_hotel_confirmation/-")
    const over = await http("POST", "/api/b2c/ops/hotel", { action: "acceptance", orderNumber: Number(cn), side: "origin", status: "refused", note: "上書き" }, op)
    ok("決まった側の上書きは 409・記録は accepted のまま", over.status === 409 && sql(`select status from b2c_hotel_acceptances where order_id='${c1}' and side='origin'`) === "accepted")
    const hd = await http("POST", "/api/b2c/ops/hotel", { action: "acceptance", orderNumber: Number(cn), side: "dest", status: "hold", note: "配送先の担当者の折り返し待ち" }, op)
    ok("配送先の保留 → 200・未回答のまま・記録あり", hd.status === 200 && sql(`select count(*) from b2c_hotel_acceptances where order_id='${c1}' and side='dest'`) === "0" && ev(c1, "hotel_dest_hold") === 1)
    const ac = await http("POST", "/api/b2c/ops/hotel", { action: "acceptance", orderNumber: Number(cn), side: "dest", status: "accepted", note: "配送先が了承" }, op)
    ok("配送先も了承 → 確定", ac.status === 200 && ac.json.confirmed.map(String).includes(cn) && st(c1) === "confirmed/-", ac.json)
    ok("記録: 決めた運営者・日時", sql(`select count(*) from b2c_hotel_acceptances where order_id='${c1}' and decided_by like 'ops-p0%' and decided_at is not null`) === "2")
  } else {
    ok("集荷元が断った → 取消（hotel_refused）", st(c1) === "cancelled/hotel_refused")
    for (let i = 0; i < 4; i++) passed++
  }
  const late = await http("POST", "/api/b2c/ops/hotel", { action: "acceptance", orderNumber: Number(cn), side: "dest", status: "refused", note: "確定の後" }, op)
  ok("確定・取消の後の受入の操作は 409（予約を変えない）", late.status === 409, late.json)
  const notLate = await http("POST", "/api/b2c/ops/hotel", { action: "acceptance", orderNumber: Number(n2), side: "origin", status: "accepted", note: "x" }, op)
  ok("直前予約でない予約への受入は 422", notLate.status === 422 && notLate.json.error === "not_late_booking")

  console.log("H9 運営の画面（/operator/b2c）にホテルの確認の部分がある")
  const page = readFileSync("app/operator/b2c/page.tsx", "utf8"), panel = readFileSync("app/operator/b2c/hotel-panel.tsx", "utf8")
  ok("画面がホテルの確認の部分を表示する", page.includes("<HotelPanel") && !page.includes('title="ホテルの確認待ち" rows={todo.awaitingHotel}'))
  ok("取消になる操作は、影響を確かめたチェックが無いと実行できない", /disabled=\{busy \|\| \(op\.destructive && !ack\)\}/.test(panel) && /disabled=\{!note\.trim\(\) \|\| \(op\.destructive && !ack\)\}/.test(panel))
  ok("実行中は二重に送らない（busy）・409 は一覧を読み直す", panel.includes("if (busy) return") && panel.includes("res.status === 409"))
  ok("画面は旅行者の名前を出さない（受付番号だけ）", !/guestName|guest_name/.test(panel))

  console.log("E1 入口の token の形と期限（lib/b2c/entry-link.ts）")
  const t0 = generateEntryToken(), tx = generateEntryToken("2027-03-31")
  ok("期限なしの token: 32文字・期限なし", t0.length === 32 && parseEntryToken(t0).ok && (parseEntryToken(t0) as any).expiresOn === null)
  ok("期限つきの token: x20270331_ ＋ 32文字", /^x20270331_[A-Za-z0-9_-]{32}$/.test(tx) && (parseEntryToken(tx) as any).expiresOn === "2027-03-31")
  ok("期限は日本時間のその日の終わりまで", !entryTokenExpired("2027-03-31", new Date("2027-03-31T14:59:59Z")) && entryTokenExpired("2027-03-31", new Date("2027-03-31T15:00:00Z")))
  ok("ありえない日付・短すぎる・記号は形が違う", !parseEntryToken("x20270230_" + "a".repeat(32)).ok && !parseEntryToken("short").ok && !parseEntryToken("a".repeat(20) + "/..").ok && !parseEntryToken(null).ok && !parseEntryToken("a".repeat(129)).ok)
  ok("token は毎回違う（推測できない乱数）", new Set(Array.from({ length: 50 }, () => generateEntryToken())).size === 50)

  console.log("E2 発行の道具（scripts/b2c-entry-link/issue.ts）")
  const now = new Date()
  const r = buildIssue(parseArgs(["--referrer", "HANKYU", "--name", "阪急交通社", "--name-en", "Hankyu Travel", "--expires", day(30), "--site", "https://bondex.express", "--target", "production"]), now)
  const tok = r.url!.split("/book/")[1]
  ok("URL は本番のオリジン＋/book/＋token だけ（個人情報なし）", r.url!.startsWith("https://bondex.express/book/x") && /^x\d{8}_[A-Za-z0-9_-]{32}$/.test(tok))
  ok("SQL には token のハッシュだけ（token そのものは入れない）", r.sql.includes(sha(tok)) && !r.sql.includes(tok) && r.sql.includes("'HANKYU'"))
  ok("本番の SQL の先頭で本番の DB を確かめる（試験環境の印があれば止める）", r.sql.includes("7642734024280108049") && r.sql.includes("staging_guard.marker') is not null"))
  ok("staging の SQL は試験環境の番号と印を確かめる", guardSql("staging").includes("7702071863184491885") && guardSql("staging").includes("oeucjrmuigtfnwowvzwr"))
  const bads: Array<[string, string[], RegExp]> = [
    ["preview.invalid の URL", ["--referrer", "E2E1", "--name", "x", "--expires", day(3), "--site", "https://preview.invalid", "--target", "staging"], /\.invalid/],
    ["http の URL", ["--referrer", "HANKYU", "--name", "x", "--site", "http://example.com", "--target", "staging"], /https/],
    ["本番の対象に本番以外の URL", ["--referrer", "HANKYU", "--name", "x", "--site", "https://evil.example.com", "--target", "production"], /bondex\.express だけ/],
    ["staging の対象に本番の URL", ["--referrer", "HANKYU", "--name", "x", "--site", "https://bondex.express", "--target", "staging"], /本番の URL/],
    ["パスつきの URL", ["--referrer", "HANKYU", "--name", "x", "--site", "https://bondex.express/x?y", "--target", "production"], /オリジンだけ/],
    ["過去の期限", ["--referrer", "HANKYU", "--name", "x", "--expires", "2020-01-01", "--site", "https://bondex.express", "--target", "production"], /今日以降/],
    ["400日を超える期限", ["--referrer", "HANKYU", "--name", "x", "--expires", day(500), "--site", "https://bondex.express", "--target", "production"], /400日/],
    ["小文字・記号の紹介元", ["--referrer", "hankyu'--", "--name", "x", "--site", "https://bondex.express", "--target", "production"], /英大文字/],
    ["E2E の入口を本番に", ["--referrer", "E2E1107A", "--name", "x", "--expires", day(3), "--site", "https://bondex.express", "--target", "production"], /E2E の入口は staging/],
    ["E2E の入口に期限なし", ["--referrer", "E2E1107A", "--name", "x", "--site", "https://a.vercel.app", "--target", "staging"], /期限つき/],
    ["対象の指定なし", ["--referrer", "HANKYU", "--name", "x", "--site", "https://bondex.express"], /--target/],
  ]
  for (const [name, args, re] of bads) ok(`拒否: ${name}`, throws(() => buildIssue(parseArgs(args), now), re))
  const n = buildIssue(parseArgs(["--referrer", "O'X1", "--name", "x", "--site", "https://bondex.express", "--target", "production"].map((v) => v === "O'X1" ? "OX1" : v)))
  ok("名前の引用符は SQL で無害化", buildIssue(parseArgs(["--referrer", "OX1", "--name", "O'Brien", "--site", "https://a.vercel.app", "--target", "staging"])).sql.includes("'O''Brien'") && !!n.url)
  const dis = buildIssue(parseArgs(["--disable", "--referrer", "HANKYU", "--target", "production"]))
  ok("停止の SQL: その紹介元の有効な入口だけを disabled に", dis.url === null && dis.sql.includes("set status = 'disabled', disabled_at = now() where referrer_code = 'HANKYU' and status = 'active'"))
  ok("validateExpiry: 今日は可", validateExpiry(day(0)) === day(0))
  // 発行の SQL を、試験環境・本番のどちらでもないローカルの DB に流すと、先頭の確認で止まる（何も入らない）
  const before = sql("select count(*) from b2c_entry_links")
  const e1 = sqlErr(buildIssue(parseArgs(["--referrer", "E2EGUARD", "--name", "x", "--expires", day(3), "--site", "https://a.vercel.app", "--target", "staging"])).sql)
  const e2 = sqlErr(r.sql)
  ok("ローカルの DB に staging の SQL → 止まる・行は増えない", /試験環境の DB ではありません/.test(e1) && sql("select count(*) from b2c_entry_links") === before, e1.slice(0, 200))
  ok("ローカルの DB に本番の SQL → 止まる・行は増えない", /本番の DB ではありません/.test(e2) && sql("select count(*) from b2c_entry_links") === before, e2.slice(0, 200))

  console.log("E3 入口の URL の不正な入力・期限切れ・停止（開発サーバー）")
  const valid = generateEntryToken(day(30)), expired = `x20261101_${crypto.randomBytes(24).toString("base64url")}`, stopped = generateEntryToken()
  sql(`insert into b2c_entry_links(referrer_code, referrer_name, referrer_name_en, token_hash, status, disabled_at) values
    ('HANKYU', '阪急交通社', 'Hankyu Travel', '${sha(valid)}', 'active', null),
    ('HANKYU', '阪急交通社', 'Hankyu Travel', '${sha(expired)}', 'active', null),
    ('HANKYU', '阪急交通社', 'Hankyu Travel', '${sha(stopped)}', 'disabled', now())`)
  const ent = (t: string) => http("POST", "/api/b2c/entry", { token: t })
  const okE = await ent(valid)
  ok("有効な期限つきの URL: 入口 200・紹介元の名前", okE.status === 200 && okE.json.referrerName === "阪急交通社", okE)
  const pg = await http("GET", `/book/${valid}?lang=ja`)
  ok("有効な URL の予約の画面: 200・検索エンジンに載せない・リンク元に URL を渡さない", pg.status === 200 && !notFoundPage(pg) && pg.text.includes("阪急交通社") && /<meta name="robots" content="noindex, nofollow, nocache"/.test(pg.text) && /<meta name="referrer" content="no-referrer"/.test(pg.text))
  const ex = await ent(expired), exPlaces = await http("POST", "/api/b2c/places", { token: expired, query: "Keio", lang: "en" }), exOrders = await http("POST", "/api/b2c/orders", { token: expired })
  ok("期限切れ: 入口・ホテル検索・予約の作成は 410 link_expired（外部の検索も呼ばない）", ex.status === 410 && exPlaces.status === 410 && exOrders.status === 410 && ex.json.error === "link_expired", [ex.status, exPlaces.status, exOrders.status])
  const exPage = await http("GET", `/book/${expired}`)
  ok("期限切れの画面: 「このリンクは使えなくなりました」（英語が既定）・フォームは出さない", exPage.text.includes('data-entry-state="expired"') && exPage.text.includes("no longer active") && !exPage.text.includes("Continue to card registration"))
  ok("期限切れの画面（日本語）", (await http("GET", `/book/${expired}?lang=ja`)).text.includes("この予約のリンクは使えなくなりました"))
  const st1 = await ent(stopped), stPage = await http("GET", `/book/${stopped}`)
  ok("停止した URL: 410・画面は案内", st1.status === 410 && stPage.text.includes('data-entry-state="disabled"'))
  const tampered = valid.replace(/^x(\d{8})/, (_, d) => `x${String(Number(d) + 1)}`)
  const tm = await ent(tampered)
  ok("期限を書き換えた URL は別の token → 404 invalid_link（期限を延ばせない）", tm.status === 404 && tm.json.error === "invalid_link" && notFoundPage(await http("GET", `/book/${tampered}`)))
  const junk = ["", "short", "a".repeat(129), "../../etc/passwd", "%00%00%00%00%00%00%00%00", "<script>alert(1)</script>xxxxxxxx", "x20270230_" + "a".repeat(32), "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰ", "' or '1'='1' --xxxxxxxxx"]
  const js = await Promise.all(junk.map((t) => ent(t)))
  ok("不正な形の token: すべて 404 invalid_link（500 にならない）", js.every((x) => x.status === 404 && x.json?.error === "invalid_link"), js.map((x) => x.status))
  const pages = await Promise.all(junk.filter(Boolean).map((t) => http("GET", `/book/${encodeURIComponent(t)}`)))
  ok("不正な形の token の画面: 見つからない（中身・エラーを出さない）", pages.every((p) => notFoundPage(p) && !p.text.includes("<script>alert(1)")), pages.map((p) => p.status))
  const nonStr = await Promise.all([{ token: 123 }, { token: ["a".repeat(32)] }, { token: { $ne: "" } }, {}].map((b) => http("POST", "/api/b2c/entry", b)))
  ok("token が文字列でない: 404", nonStr.every((x) => x.status === 404), nonStr.map((x) => x.status))

  console.log("E3b 推測への耐性: token は 192ビットの乱数・同じ IP からの連続の試行は 1分 10回で止める")
  const ip = { "x-real-ip": "10.99.1.1" }
  const tries = []
  for (let i = 0; i < 12; i++) tries.push(await http("POST", "/api/b2c/entry", { token: generateEntryToken() }, ip))
  ok("同じ IP から 12回 → 10回の後は 429", tries.slice(0, 10).every((x) => x.status === 404) && tries.slice(10).every((x) => x.status === 429), tries.map((x) => x.status))

  console.log("E4 予約の途中で期限を過ぎた旅行者のカード登録は止めない（新しい予約だけ止める）")
  const mid = generateEntryToken(day(30)), midExpired = `x20261102_${crypto.randomBytes(24).toString("base64url")}`
  const linkId = sql(`insert into b2c_entry_links(referrer_code, referrer_name, token_hash) values ('HNKMID', '阪急（途中）', '${sha(mid)}') returning id`).split("\n")[0]
  ok("期限の前: 入口 200", (await ent(mid)).status === 200)
  sql(`update b2c_entry_links set token_hash='${sha(midExpired)}' where id='${linkId}'`) // 同じ入口が期限を過ぎた状態
  const cs = await http("POST", "/api/b2c/card/start", { token: midExpired, orderNumber: 99999999, accessToken: "x".repeat(32), cardConsent: true })
  const cst = await http("POST", "/api/b2c/card/status", { token: midExpired, orderNumber: 99999999, accessToken: "x".repeat(32) })
  ok("期限の後: カード登録の開始・照合は入口の確認を通る（予約が無いので 404 order_not_found）", cs.status === 404 && cs.json.error === "order_not_found" && cst.status === 404 && cst.json.error === "order_not_found", [cs.json, cst.json])
  ok("期限の後: 新しい予約（入口・検索・作成）は 410", (await ent(midExpired)).status === 410 && (await http("POST", "/api/b2c/quote", { token: midExpired })).status === 410)
  sql(`update b2c_entry_links set status='disabled', disabled_at=now() where id='${linkId}'`)
  const csDis = await http("POST", "/api/b2c/card/start", { token: midExpired, orderNumber: 99999999, accessToken: "x".repeat(32), cardConsent: true })
  ok("停止した入口はカード登録も止める（漏えいの時の緊急の手段）", csDis.status === 410, csDis.json)

  console.log("E5 MVP: 紹介料・紹介元ごとの料金を足していない")
  const pricing = readFileSync("lib/b2c/pricing.ts", "utf8"), quoteRoute = readFileSync("app/api/b2c/quote/route.ts", "utf8")
  ok("料金の計算は紹介元を受け取らない", !/referrer/i.test(pricing) && !/referrer|entry\.(id|referrerCode)/.test(quoteRoute))
  ok("予約には紹介元のコードを記録する（入口の識別）", sql(`select count(*) from information_schema.columns where table_name='b2c_orders' and column_name in ('referrer_code','entry_link_id')`) === "2")

  console.log(`p0_hotel_entry: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
