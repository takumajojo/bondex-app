/**
 * B2C の旅行者の個人情報が、個人のパスキーの運営者にだけ返ることの試験（lib/b2c/pii-guard.ts）。
 * ルートをこの処理の中で直接呼ぶ（middleware を通さない＝ハンドラーの中で止まることを確かめる）。応答の本文そのものを調べる（画面ではない）。
 * ローカルの Supabase（docker）だけ・ダミーのデータだけ。外への送信なし。
 *   実行: set -a; . ./.env.local; set +a; npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-integ/b2c-pii.ts
 *   前提: scripts/test-integ/seed-integrated-dev.sh
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { NextRequest } from "next/server"

if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("refusing: local only")
process.env.OPERATOR_PASSWORD = "test-operator-password"
process.env.MAIL_TEST_CAPTURE = "1"

let passed = 0, failed = 0
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 300)) }
}
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "|", "-c", q], { encoding: "utf8" }).trim()
const JST = 9 * 3600 * 1000
const D = new Date(Date.now() + JST + 2 * 86_400_000).toISOString().slice(0, 10) // 2日後（今日の TODO の 7日の範囲。明日だと 18:30 以降は確定できず、時刻で結果が変わる）
const TODAY = new Date(Date.now() + JST).toISOString().slice(0, 10)

// 一意の名前（応答の本文にこの文字があるかで判定する）
const GUEST = "Piiguest Zetasample"
const GUEST_EMAIL = "piiguest-zeta@example.invalid"
const B2B_REP = "Bizrep Omegasample"
// B2C だけに付ける、特定の手がかりになりうる値（ホテル名・問い合わせ番号）
const B2C_HOTEL_FROM = "Piiprivate Inn East"
const B2C_HOTEL_TO = "Piiprivate Inn West"
const B2C_TRACKING = "999900001111"

async function main() {
  const { issueOperatorSession, OPERATOR_SESSION_COOKIE } = await import("@/lib/operator-session")
  sql(`insert into operator_passkeys(credential_id, public_key, operator_email) values ('pii-cred-email-0000000001', '\\x00', 'ops-pii@example.invalid'), ('pii-cred-noemail-00000001', '\\x00', null) on conflict do nothing`)
  sql(`insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('pii_p1','Pii Hotel A','verified','t@example.invalid',now()), ('pii_p2','Pii Hotel B','verified','t@example.invalid',now()) on conflict do nothing`)
  const b2bId = sql(`insert into shipments (booking_id, leg_index, shipment_date, expected_arrival, from_hotel, to_hotel, status, suitcase_count, agency, representative, recipient, notes) values ('BDX-PII001', 0, '${D}', '${D}'::date+1, 'Pii Hotel A', 'Pii Hotel B', 'issued', 2, 'Pii Agency', '${B2B_REP}', '${B2B_REP}', 'b2b-note') returning id`).split("\n")[0]
  const o = sql(`insert into b2c_orders (entry_link_id, referrer_code, guest_name, guest_email, guest_whatsapp, origin_place_id, dest_place_id, origin_snapshot, dest_snapshot, pickup_date, delivery_date, pieces, route_class, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen, price_rule_version, status, confirmation_mode, card_status, consent_version, consented_at, terms_version, terms_lang, terms_consented_at, card_consent_version, card_consented_at, access_token_hash)
    select id, 'HNK001', '${GUEST}', '${GUEST_EMAIL}', '+819000000099', 'pii_p1', 'pii_p2', jsonb_build_object('name','${B2C_HOTEL_FROM}','check_in','${D}'), jsonb_build_object('name','${B2C_HOTEL_TO}','check_in','${D}','check_out',('${D}'::date+4)::text), '${D}', '${D}'::date+1, 2, 'standard', 4980, 9960, 996, 10956, 'v1', 'card_pending', 'instant', 'registered', 'v1', now(), 'v1', 'ja', now(), 'card-v1', now(), md5(random()::text) from b2c_entry_links limit 1 returning id`).split("\n")[0]
  sql(`select b2c_confirm_order('${o}')`)
  const b2c = sql(`select id || '|' || booking_id from shipments where b2c_order_id='${o}'`).split("|")
  const [b2cId, b2cBooking] = b2c
  // 送り状・メモ・事故の記録・変更の申請（名前・連絡先が入る所）を B2C の区間にも作る
  sql(`update shipments set notes='b2c-note ${GUEST}', label_url='https://storage.googleapis.com/x/pii-b2c.pdf', pickup_alert_sent_at=null, tracking_numbers='["${B2C_TRACKING}"]'::jsonb where id='${b2cId}'`)
  if (sql(`select count(*) from information_schema.tables where table_schema='public' and table_name='claim_cases'`) === "0") {
    // ローカルの試験の DB は古い SQL を流していない。本番と同じ sql/005 を流して表を作る（ローカルだけ）
    execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { input: `create extension if not exists "uuid-ossp";\n` + readFileSync("sql/005_claim_cases.sql", "utf8") })
  }
  sql(`insert into claim_cases (booking_id, category, reporter_name, reporter_contact, description, status) values ('${b2cBooking}', 'damage', '${GUEST}', '${GUEST_EMAIL}', 'bag of ${GUEST} damaged', 'open'), ('BDX-PII001', 'damage', '${B2B_REP}', 'b2b@example.invalid', 'b2b claim', 'open')`)
  sql(`insert into shipment_change_requests (shipment_id, booking_id, leg_index, requested_by, fields, status) values ('${b2cId}', '${b2cBooking}', 0, 'agency', '{"representative":"${GUEST}"}', 'pending'), ('${b2bId}', 'BDX-PII001', 0, 'agency', '{"representative":"${B2B_REP} 2"}', 'pending')`)

  const v1 = await issueOperatorSession()
  const v2noemail = await issueOperatorSession("pii-cred-noemail-00000001")
  const v2 = await issueOperatorSession("pii-cred-email-0000000001")
  type Caller = { name: string; h: Record<string, string>; operator: boolean; pii: boolean }
  const callers: Caller[] = [
    { name: "未認証", h: {}, operator: false, pii: false },
    { name: "代理店の JWT（のような Bearer）", h: { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.x" }, operator: false, pii: false },
    { name: "共有パスワード（v1）", h: { cookie: `${OPERATOR_SESSION_COOKIE}=${v1}` }, operator: true, pii: false },
    { name: "Bearer OPERATOR_PASSWORD", h: { authorization: "Bearer test-operator-password" }, operator: true, pii: false },
    { name: "パスキー（メールなし）", h: { cookie: `${OPERATOR_SESSION_COOKIE}=${v2noemail}` }, operator: true, pii: false },
    { name: "個人のパスキー（本人確認済み）", h: { cookie: `${OPERATOR_SESSION_COOKIE}=${v2}` }, operator: true, pii: true },
  ]
  let ip = 0
  const mk = (url: string, method: string, headers: Record<string, string>, body?: unknown) =>
    new NextRequest(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": `10.77.${Math.floor(++ip / 250)}.${ip % 250}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })

  const ships = await import("../../app/api/shipments/route")
  const report = await import("../../app/api/operator/report/route")
  const todo = await import("../../app/api/operator/today-todo/route")
  const alerts = await import("../../app/api/operator/pickup-alerts/route")
  const dup = await import("../../app/api/shipments/duplicate-check/route")
  const label = await import("../../app/api/voucher/label/route")
  const inv = await import("../../app/api/invoices/generate/route")
  const invSend = await import("../../app/api/operator/invoice-send/route")
  const chg = await import("../../app/api/operator/change-requests/route")
  const claims = await import("../../app/api/claims/route")

  type Probe = { name: string; call: (h: Record<string, string>) => Promise<Response>; b2bNameExpected: boolean; b2cRowExpected?: boolean }
  const probes: Probe[] = [
    { name: "区間の一覧 GET /api/shipments", call: (h) => ships.GET(mk(`/api/shipments?fromDate=${TODAY}&limit=500`, "GET", h)), b2bNameExpected: true, b2cRowExpected: true },
    { name: "区間の検索 GET /api/shipments?search=（名前で）", call: (h) => ships.GET(mk(`/api/shipments?search=${encodeURIComponent("Piiguest")}`, "GET", h)), b2bNameExpected: false },
    { name: "区間の検索 GET /api/shipments?search=B2C-", call: (h) => ships.GET(mk(`/api/shipments?search=${encodeURIComponent(b2cBooking)}`, "GET", h)), b2bNameExpected: false },
    { name: "実績のレポート GET /api/operator/report", call: (h) => report.GET(mk(`/api/operator/report?from=${TODAY}`, "GET", h)), b2bNameExpected: true, b2cRowExpected: true },
    { name: "実績のレポート CSV", call: (h) => report.GET(mk(`/api/operator/report?from=${TODAY}&format=csv`, "GET", h)), b2bNameExpected: true, b2cRowExpected: true },
    { name: "代理店名 BondEx Direct のレポート", call: (h) => report.GET(mk(`/api/operator/report?agency=${encodeURIComponent("BondEx Direct")}`, "GET", h)), b2bNameExpected: false, b2cRowExpected: true },
    { name: "今日の TODO GET /api/operator/today-todo", call: (h) => todo.GET(mk("/api/operator/today-todo", "GET", h)), b2bNameExpected: true },
    { name: "未集荷の一覧 GET /api/operator/pickup-alerts", call: (h) => alerts.GET(mk("/api/operator/pickup-alerts", "GET", h)), b2bNameExpected: false },
    { name: "重複の確認 POST /api/shipments/duplicate-check（名前で）", call: (h) => dup.POST(mk("/api/shipments/duplicate-check", "POST", h, { names: ["Piiguest", "Bizrep"], dates: [D] })), b2bNameExpected: true },
    { name: "請求書 GET /api/invoices/generate?agency=BondEx Direct", call: (h) => inv.GET(mk(`/api/invoices/generate?agency=${encodeURIComponent("BondEx Direct")}&month=${D.slice(0, 7)}`, "GET", h)), b2bNameExpected: false },
    { name: "請求書の送付の確認 GET /api/operator/invoice-send?agency=BondEx Direct", call: (h) => invSend.GET(mk(`/api/operator/invoice-send?agency=${encodeURIComponent("BondEx Direct")}&month=${D.slice(0, 7)}`, "GET", h)), b2bNameExpected: false },
    { name: "変更の申請 GET /api/operator/change-requests", call: (h) => chg.GET(mk("/api/operator/change-requests?status=all", "GET", h)), b2bNameExpected: true, b2cRowExpected: true },
    { name: "事故の記録 GET /api/claims", call: (h) => claims.GET(mk("/api/claims", "GET", h)), b2bNameExpected: true, b2cRowExpected: true },
  ]

  for (const p of probes) {
    console.log(p.name)
    for (const c of callers) {
      const r = await p.call(c.h)
      const text = await r.text()
      if (!c.operator) {
        ok(`  ${c.name} → 401（ハンドラーの中で止まる）`, r.status === 401, r.status)
        continue
      }
      const hasGuest = text.includes(GUEST) || text.includes(GUEST_EMAIL)
      const hasClue = text.includes(B2C_HOTEL_FROM) || text.includes(B2C_HOTEL_TO) || text.includes(B2C_TRACKING)
      if (c.pii) {
        // 個人のパスキー: 名前が要る所（一覧・レポート等）では見える。請求書は B2C は対象外なのでどちらでもよい
        if (p.b2cRowExpected) ok(`  ${c.name} → B2C の旅行者の名前が見える`, hasGuest, { status: r.status, text: text.slice(0, 200) })
        if (p.b2cRowExpected && p.name.startsWith("区間の一覧")) ok(`  ${c.name} → ホテル名・問い合わせ番号も見える`, text.includes(B2C_HOTEL_FROM) && text.includes(B2C_TRACKING), text.slice(0, 200))
        else ok(`  ${c.name} → 通る（${r.status}）`, r.status !== 401 && r.status !== 403 && r.status < 500, r.status)
      } else {
        ok(`  ${c.name} → 応答に B2C の旅行者の名前・連絡先が無い`, !hasGuest, text.slice(text.indexOf("Piiguest") - 80, text.indexOf("Piiguest") + 40))
        ok(`  ${c.name} → 応答に B2C のホテル名・問い合わせ番号が無い（組み合わせでの特定の防止）`, !hasClue, text.slice(Math.max(0, text.indexOf("Piiprivate") - 80), text.indexOf("Piiprivate") + 60))
        if (p.b2cRowExpected) ok(`  ${c.name} → B2C の区間そのものは配送の運用のために見える（名前は伏せ字）`, text.includes(b2cBooking) && (text.includes("個人パスキーで表示") || text.includes("b2c_pii_hidden") || text.includes("b2cPiiHidden")), text.slice(0, 160))
      }
      if (p.b2bNameExpected) ok(`  ${c.name} → B2B の名前はこれまでどおり見える`, text.includes(B2B_REP), text.slice(0, 160))
    }
  }

  console.log("B2C の送り状 GET /api/voucher/label（外へは取りに行かない: 許されない URL で、認可の先へ進んだかだけを見る）")
  for (const c of callers) {
    const rc = await label.GET(mk(`/api/voucher/label?bookingId=${b2cBooking}&leg=L1&url=${encodeURIComponent("https://example.invalid/x.pdf")}`, "GET", c.h))
    const want = !c.operator ? 401 : c.pii ? 400 : 403
    ok(`  B2C × ${c.name} → ${want}`, rc.status === want, rc.status)
    const rb = await label.GET(mk(`/api/voucher/label?bookingId=BDX-PII001&leg=L1&url=${encodeURIComponent("https://example.invalid/x.pdf")}`, "GET", c.h))
    ok(`  B2B × ${c.name} → ${c.operator ? "400（認可を通って URL の確認へ）" : 401}`, rb.status === (c.operator ? 400 : 401), rb.status)
  }

  console.log("一覧の B2C の区間で、名前以外に外す項目（メモ・送り状の URL）")
  {
    const r = await ships.GET(mk(`/api/shipments?fromDate=${TODAY}&limit=500`, "GET", callers[2].h))
    const j = (await r.json()) as { shipments: Array<Record<string, unknown>>; b2cPiiVisible: boolean }
    const row = j.shipments.find((s) => s.id === b2cId)!
    ok("共有パスワード: B2C の区間のメモ・送り状の URL は null", !!row && row.notes === null && row.label_url === null, row)
    ok("共有パスワード: 件数と状態を把握する項目（予約番号・集荷日・個数・状態）は残る", !!row && row.booking_id === b2cBooking && row.shipment_date === D && row.suitcase_count === 2 && row.status === "issued", row)
    ok("共有パスワード: ホテル名は伏せ字", !!row && row.from_hotel === "（B2C・個人パスキーで表示）" && row.to_hotel === "（B2C・個人パスキーで表示）", row)
    ok("共有パスワード: 宿泊日・問い合わせ番号・言語・場所の ID・B2C の予約の ID・ホテルの連絡先は空", !!row && row.from_check_in == null && row.to_check_out == null && row.origin_check_in == null && Array.isArray(row.tracking_numbers) && (row.tracking_numbers as unknown[]).length === 0 && row.guest_language == null && row.from_place_id == null && row.b2c_order_id == null && JSON.stringify(row.hotel_contact_info) === "{}", row)
    ok("共有パスワード: DB で必ず値のある列は型を保つ（画面が崩れない: 額は数・変更の記録は配列）", !!row && typeof row.amount_yen === "number" && Array.isArray(row.count_change_log) && typeof row.expected_arrival === "string", row)
    ok("応答に b2cPiiVisible=false", j.b2cPiiVisible === false)
    const b = j.shipments.find((s) => s.id === b2bId)!
    ok("共有パスワード: B2B の区間はメモまでそのまま", !!b && b.notes === "b2b-note" && b.representative === B2B_REP, b)
  }

  console.log("判定ができない時は見せない（lib/b2c/pii-guard.ts canSeeB2cPii）")
  {
    const { canSeeB2cPii, redactB2cShipment } = await import("@/lib/b2c/pii-guard")
    const broken = { cookies: { get: () => { throw new Error("cookie store broken") } } } as unknown as NextRequest
    ok("cookie を読めない → false", (await canSeeB2cPii(broken)) === false)
    const r = redactB2cShipment({ booking_id: "B2C-999", representative: "X Y", agency: "unknown" }, false) as Record<string, unknown>
    ok("列が足りない行でも、予約番号が B2C- なら名前を外す", r.representative !== "X Y")
  }

  sql(`delete from claim_cases where booking_id in ('${b2cBooking}','BDX-PII001'); delete from shipment_change_requests where booking_id in ('${b2cBooking}','BDX-PII001')`)
  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
