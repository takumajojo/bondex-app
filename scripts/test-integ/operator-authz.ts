/**
 * 運営の API のハンドラーの中の認可（lib/operator-authz.ts）の試験。ルートをこの処理の中で直接呼ぶ（middleware を通さない
 * ＝ middleware が外れた時でもハンドラーが止めることを確かめる）。ローカルの Supabase（docker）だけ・ダミーのデータだけ。
 *   実行: set -a; . ./.env.local; set +a; npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-integ/operator-authz.ts
 *   前提: scripts/test-integ/seed-integrated-dev.sh
 */
import { execFileSync } from "node:child_process"
import { NextRequest } from "next/server"

if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("refusing: local only")
process.env.OPERATOR_PASSWORD = "test-operator-password" // 本番と同じく、パスワードを設定した状態で確かめる
process.env.MAIL_TEST_CAPTURE = "1"

let passed = 0, failed = 0
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 300)) }
}
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "|", "-c", q], { encoding: "utf8" }).trim()
const JST = 9 * 3600 * 1000
const D = new Date(Date.now() + JST + 7 * 86_400_000).toISOString().slice(0, 10)

async function main() {
  const { issueOperatorSession, OPERATOR_SESSION_COOKIE } = await import("@/lib/operator-session")
  sql(`insert into operator_passkeys(credential_id, public_key, operator_email) values ('authz-cred-email-000000001', '\\x00', 'ops-authz@example.invalid'), ('authz-cred-noemail-0000001', '\\x00', null) on conflict do nothing`)
  sql(`insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('authz_p1','A','verified','t@example.invalid',now()), ('authz_p2','B','verified','t@example.invalid',now()) on conflict do nothing`)
  const b2b = sql(`insert into shipments (booking_id, leg_index, shipment_date, expected_arrival, from_hotel, to_hotel, status, suitcase_count, agency, representative, recipient) values ('BDX-AUTHZ1', 0, '${D}', '${D}'::date+1, 'A', 'B', 'issued', 2, 'Authz Agency', 'R', 'R') returning id`).split("\n")[0]
  const o = sql(`insert into b2c_orders (entry_link_id, referrer_code, guest_name, guest_email, guest_whatsapp, origin_place_id, dest_place_id, origin_snapshot, dest_snapshot, pickup_date, delivery_date, pieces, route_class, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen, price_rule_version, status, confirmation_mode, card_status, consent_version, consented_at, terms_version, terms_lang, terms_consented_at, card_consent_version, card_consented_at, access_token_hash)
    select id, 'HNK001', 'Authz Guest', 'authz@example.invalid', '+819000000000', 'authz_p1', 'authz_p2', jsonb_build_object('name','A','check_in','${D}'), jsonb_build_object('name','B','check_in','${D}','check_out',('${D}'::date+4)::text), '${D}', '${D}'::date+1, 2, 'standard', 4980, 9960, 996, 10956, 'v1', 'card_pending', 'instant', 'registered', 'v1', now(), 'v1', 'ja', now(), 'card-v1', now(), md5(random()::text) from b2c_entry_links limit 1 returning id`).split("\n")[0]
  sql(`select b2c_confirm_order('${o}')`)
  const b2c = sql(`select id from shipments where b2c_order_id='${o}'`)

  const v1 = await issueOperatorSession()
  const v2noemail = await issueOperatorSession("authz-cred-noemail-0000001")
  const v2 = await issueOperatorSession("authz-cred-email-000000001")
  const callers: Array<[string, Record<string, string>, boolean, boolean]> = [
    // [名前, ヘッダー, B2B の区間で通るか, B2C の区間で通るか]
    ["未認証", {}, false, false],
    ["代理店の JWT（のような Bearer）", { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.x" }, false, false],
    ["共有パスワード（v1 のセッション）", { cookie: `${OPERATOR_SESSION_COOKIE}=${v1}` }, true, false],
    ["Bearer OPERATOR_PASSWORD（CLI・サーバー内）", { authorization: "Bearer test-operator-password" }, true, false],
    ["パスキー（メールの登録なし）", { cookie: `${OPERATOR_SESSION_COOKIE}=${v2noemail}` }, true, false],
    ["個人のパスキー（メールで本人確認済み）", { cookie: `${OPERATOR_SESSION_COOKIE}=${v2}` }, true, true],
  ]
  const pickup = await import("../../app/api/operator/pickup-request/route")
  const ships = await import("../../app/api/shipments/route")
  const edit = await import("../../app/api/operator/shipment/[id]/edit/route")
  const pay = await import("../../app/api/b2c/ops/payments/route")
  let ip = 0
  const mk = (url: string, method: string, headers: Record<string, string>, body?: unknown) =>
    new NextRequest(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": `10.66.${Math.floor(++ip / 250)}.${ip % 250}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const passes = (status: number) => status !== 401 && status !== 403

  type Probe = [string, (h: Record<string, string>, leg: string) => Promise<Response>]
  const probes: Probe[] = [
    ["集荷依頼の画面の情報（GET /api/operator/pickup-request）", (h, leg) => pickup.GET(mk(`/api/operator/pickup-request?shipmentId=${leg}`, "GET", h))],
    ["集荷依頼の記録（POST manual_mark）", (h, leg) => pickup.POST(mk("/api/operator/pickup-request", "POST", h, { action: "manual_mark", shipmentId: leg, actor: "authz-test", note: "authz" }))],
    ["区間の状態の変更（PATCH /api/shipments）", (h, leg) => ships.PATCH(mk("/api/shipments", "PATCH", h, { id: leg, notes: "authz-test" }))],
    ["区間の編集・問い合わせ番号（POST /api/operator/shipment/[id]/edit）", (h, leg) => edit.POST(mk(`/api/operator/shipment/${leg}/edit`, "POST", h, { tracking: [] }), { params: Promise.resolve({ id: leg }) })],
  ]
  for (const [pname, fn] of probes) {
    console.log(pname)
    for (const [cname, h, b2bOk, b2cOk] of callers) {
      const rb = await fn(h, b2b)
      ok(`  B2B の区間 × ${cname} → ${b2bOk ? "通る" : "拒否"}`, passes(rb.status) === b2bOk, rb.status)
      const rc = await fn(h, b2c)
      ok(`  B2C の区間 × ${cname} → ${b2cOk ? "通る" : "拒否"}`, passes(rc.status) === b2cOk, rc.status)
    }
  }
  console.log("B2C の請求の一覧（GET /api/b2c/ops/payments・旅行者の名前と額）")
  for (const [cname, h, , b2cOk] of callers) {
    const r = await pay.GET(mk("/api/b2c/ops/payments", "GET", h))
    ok(`  ${cname} → ${b2cOk ? "通る" : "拒否"}`, passes(r.status) === b2cOk, r.status)
  }
  console.log("B2C の手作業（POST /api/b2c/ops/payments: 集荷の確認）")
  for (const [cname, h, , b2cOk] of callers) {
    const r = await pay.POST(mk("/api/b2c/ops/payments", "POST", h, { action: "confirm_pickup", orderNumber: 0, evidenceType: "sagawa_tracking", evidenceRef: "x", acceptedPieces: 1, note: "authz" }))
    ok(`  ${cname} → ${b2cOk ? "通る（認可の先へ進む）" : "拒否"}`, passes(r.status) === b2cOk, r.status)
  }
  ok("B2C の区間には、拒否された呼び出しで集荷依頼の記録が作られていない（個人のパスキーの 1回だけ）", sql(`select count(*) from pickup_requests where shipment_id='${b2c}' and channel='manual'`) === "1")
  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
