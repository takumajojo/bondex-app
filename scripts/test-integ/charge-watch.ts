/**
 * B2C の請求の見張り（lib/b2c/charge-watch.ts）と、定期の処理の見張り（lib/cron-heartbeat.ts・/api/cron/heartbeat-check）の試験。
 * ローカルの Supabase（docker）だけ・ダミーのデータだけ。運営への知らせは偽物の関数で受ける（外へ送らない）。Stripe には触れない。
 *   実行: set -a; . ./.env.local; set +a; npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-integ/charge-watch.ts
 *   前提: scripts/test-integ/seed-integrated-dev.sh（sql/080 を含む）
 */
import { execFileSync } from "node:child_process"
import { NextRequest } from "next/server"

if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("refusing: local only")
process.env.MAIL_TEST_CAPTURE = "1"
process.env.CRON_SECRET = "test-cron-secret"

let passed = 0, failed = 0
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400)) }
}
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "|", "-c", q], { encoding: "utf8" }).trim()
const JST = 9 * 3600 * 1000
const D = new Date(Date.now() + JST + 7 * 86_400_000).toISOString().slice(0, 10)
const GUEST = "Watchguest Kappasample"
const EMAIL = "watchguest-kappa@example.invalid"
const WA = "+819000000077"

type Sent = { subject: string; lines: string[] }
function fakeAlert(mode: "ok" | "fail" | "throw" = "ok") {
  const sent: Sent[] = []
  const fn = async (i: { subject: string; lines: string[] }) => {
    if (mode === "throw") throw new Error("timeout after send")
    sent.push({ subject: i.subject, lines: i.lines })
    return mode === "ok" ? { emailSent: true, slackSent: false, errors: [] } : { emailSent: false, slackSent: false, errors: ["smtp down"] }
  }
  return { sent, fn: fn as never }
}

async function main() {
  sql(`delete from b2c_ops_alert_gate where alert_key like 'b2c_charge:%' or alert_key like 'cron:%'; delete from cron_heartbeats`)
  sql(`insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('cw_p1','CW A','verified','t@example.invalid',now()), ('cw_p2','CW B','verified','t@example.invalid',now()) on conflict do nothing`)
  let seq = 0
  const mkOrder = () => {
    // 1日の受付の上限に当たらないよう、予約ごとに日を変える（見張りは日付に関係しない）
    const D = new Date(Date.now() + JST + (7 + seq++) * 86_400_000).toISOString().slice(0, 10)
    const id = sql(`insert into b2c_orders (entry_link_id, referrer_code, guest_name, guest_email, guest_whatsapp, origin_place_id, dest_place_id, origin_snapshot, dest_snapshot, pickup_date, delivery_date, pieces, route_class, unit_net_yen, subtotal_net_yen, tax_yen, total_gross_yen, price_rule_version, status, confirmation_mode, card_status, consent_version, consented_at, terms_version, terms_lang, terms_consented_at, card_consent_version, card_consented_at, access_token_hash)
      select id, 'HNK001', '${GUEST}', '${EMAIL}', '${WA}', 'cw_p1', 'cw_p2', jsonb_build_object('name','CW A','check_in','${D}'), jsonb_build_object('name','CW B','check_in','${D}','check_out',('${D}'::date+4)::text), '${D}', '${D}'::date+1, 2, 'standard', 4980, 9960, 996, 10956, 'v1', 'card_pending', 'instant', 'registered', 'v1', now(), 'v1', 'ja', now(), 'card-v1', now(), md5(random()::text) from b2c_entry_links limit 1 returning id`).split("\n")[0]
    sql(`select b2c_confirm_order('${id}')`)
    return { id, num: sql(`select order_number from b2c_orders where id='${id}'`) }
  }
  const mkPay = (status: string, scheduledAgoMin: number, updatedAgoMin: number, amount: number) => {
    const o = mkOrder()
    const pid = sql(`insert into b2c_payments (order_id, kind, charge_key, amount_yen, status, scheduled_at, created_by) values ('${o.id}', 'base', 'base:${o.id}', ${amount}, '${status}', now() - interval '${scheduledAgoMin} minutes', 'test') returning id`).split("\n")[0]
    sql(`alter table b2c_payments disable trigger user; update b2c_payments set updated_at = now() - interval '${updatedAgoMin} minutes' where id='${pid}'; alter table b2c_payments enable trigger user`)
    return { pid, num: o.num, oid: o.id }
  }
  const pUnknown = mkPay("unknown", 120, 5, 10956)
  const pHold = mkPay("on_hold", 120, 5, 21912)
  const pStuck = mkPay("processing", 120, 25, 5478)
  const pOver = mkPay("scheduled", 90, 90, 32868)
  const pFresh = mkPay("scheduled", 10, 10, 1111) // 予定を過ぎて 10分 → まだ知らせない
  const pProcFresh = mkPay("processing", 30, 3, 2222) // 処理中 3分 → まだ
  const pDone = mkPay("scheduled", 120, 60, 3333)
  sql(`alter table b2c_payments disable trigger user; update b2c_payments set status='succeeded', succeeded_at = now() where id='${pDone.pid}'; alter table b2c_payments enable trigger user`)
  const snapshot = () => sql(`select string_agg(id || ':' || status || ':' || attempts || ':' || coalesce(stripe_payment_intent_id,'-') || ':' || updated_at, ',' order by id) from b2c_payments`)

  const { watchB2cCharges, findChargeIssues } = await import("@/lib/b2c/charge-watch")
  const before = snapshot()

  console.log("1. 見張りの対象")
  const issues = await findChargeIssues(new Date())
  const kinds = new Map(issues.map((i) => [i.paymentId, i.kind]))
  ok("結果不明 → unknown", kinds.get(pUnknown.pid) === "unknown")
  ok("保留 → on_hold", kinds.get(pHold.pid) === "on_hold")
  ok("処理中のまま 25分 → processing_stuck", kinds.get(pStuck.pid) === "processing_stuck")
  ok("予定を 90分過ぎた → overdue", kinds.get(pOver.pid) === "overdue")
  ok("予定を 10分過ぎただけ・処理中 3分・成功は対象外", !kinds.has(pFresh.pid) && !kinds.has(pProcFresh.pid) && !kinds.has(pDone.pid))

  console.log("2. 知らせる内容（個人情報を入れない）")
  const a1 = fakeAlert()
  const now1 = new Date()
  const r1 = await watchB2cCharges(now1, a1.fn)
  ok("1通にまとめて送る・4件", a1.sent.length === 1 && r1.alerted === 4, r1)
  const body = a1.sent[0] ? a1.sent[0].subject + "\n" + a1.sent[0].lines.join("\n") : ""
  ok("受付番号・状態・請求予定額・時刻・対応・運営の画面のリンクが入る",
    [pUnknown.num, pHold.num, pStuck.num, pOver.num].every((n) => body.includes(`受付番号 ${n}`)) && body.includes("状態 unknown") && body.includes("10,956円") && body.includes("JST") && body.includes("対応:") && body.includes("https://bondex.express/operator/b2c"), body.slice(0, 600))
  ok("旅行者の名前・メール・WhatsApp・秘密のリンクが入らない", !body.includes(GUEST) && !body.includes(EMAIL) && !body.includes(WA) && !/\/my\/|\/book\/|\/pay\//.test(body), body)
  ok("結果不明には「再請求しない」の案内", body.includes("再請求しないでください"))

  console.log("3. 同じ問題は繰り返さない・状態が変われば知らせる・1日たてば再び")
  const a2 = fakeAlert()
  const r2 = await watchB2cCharges(new Date(now1.getTime() + 10 * 60_000), a2.fn)
  const body2 = a2.sent.map((x) => x.lines.join("\n")).join("\n")
  ok("10分後の次の回: 前の 4件は送らない（抑止）", r2.suppressed === 4 && ![pUnknown, pHold, pStuck, pOver].some((q) => body2.includes(`受付番号 ${q.num} `)), r2)
  ok("10分後: 処理中が 13分になった請求だけを新しく知らせる", r2.alerted === 1 && body2.includes(`受付番号 ${pProcFresh.num} `), body2)
  const mid = snapshot() // 見張りを 2回動かした後（請求の行は変わっていないはず）
  sql(`update b2c_payments set status='unknown' where id='${pHold.pid}'`)
  const before2 = snapshot() // ここから先は請求の行を変えない
  const a3 = fakeAlert()
  const r3 = await watchB2cCharges(new Date(now1.getTime() + 20 * 60_000), a3.fn)
  ok("保留 → 結果不明に変わった請求だけを知らせる", a3.sent.length === 1 && r3.alerted === 1 && a3.sent[0].lines.join("\n").includes(`受付番号 ${pHold.num}`), r3)
  const a4 = fakeAlert()
  const r4 = await watchB2cCharges(new Date(now1.getTime() + 25 * 3600_000), a4.fn)
  ok("25時間後: 解決していない請求をもう一度知らせる（1日 1回・予定を過ぎた 1件を含む 6件を 1通で）", a4.sent.length === 1 && r4.alerted === 6 && r4.issues === 6, r4)

  console.log("4. 同時に 2つ動いても 1回だけ")
  sql(`delete from b2c_ops_alert_gate where alert_key like 'b2c_charge:%'`)
  const c1 = fakeAlert(), c2 = fakeAlert()
  const tC = new Date(now1.getTime() + 30 * 3600_000)
  const [x, y] = await Promise.all([watchB2cCharges(tC, c1.fn), watchB2cCharges(tC, c2.fn)])
  ok("2つの見張りの合計で、各請求 1回ずつ", x.issues > 0 && x.alerted + y.alerted === x.issues && x.suppressed + y.suppressed === x.issues, { x, y })

  console.log("5. 送れなかった時・送ったか分からない時")
  sql(`delete from b2c_ops_alert_gate where alert_key like 'b2c_charge:%'`)
  const f1 = fakeAlert("fail")
  const tF = new Date(now1.getTime() + 40 * 3600_000)
  const rf = await watchB2cCharges(tF, f1.fn)
  ok("メールも Slack も失敗 → 門を戻す（retry）", rf.retry === rf.issues && rf.issues > 0 && rf.alerted === 0, rf)
  const f2 = fakeAlert()
  const rf2 = await watchB2cCharges(new Date(tF.getTime() + 10 * 60_000), f2.fn)
  ok("次の回に送り直す", rf2.alerted === rf.issues && f2.sent.length === 1, rf2)
  sql(`delete from b2c_ops_alert_gate where alert_key like 'b2c_charge:%'`)
  const u1 = fakeAlert("throw")
  const tU = new Date(now1.getTime() + 50 * 3600_000)
  const ru = await watchB2cCharges(tU, u1.fn)
  ok("送信の途中で例外（送ったか分からない）→ unknown・門は戻さない", ru.unknown === ru.issues && ru.issues > 0, ru)
  const u2 = fakeAlert()
  const ru2 = await watchB2cCharges(new Date(tU.getTime() + 10 * 60_000), u2.fn)
  ok("次の回は送り直さない（二重の知らせを防ぐ）", u2.sent.length === 0 && ru2.suppressed === ru.issues, ru2)

  console.log("6. 請求には触れない")
  ok("見張りの前後で、請求の行（状態・試行回数・PaymentIntent・更新時刻）が変わらない（最初の 2回）", mid === before)
  ok("見張りを 10回以上動かしても、請求の行が変わらない", snapshot() === before2)
  ok("請求の行は増えていない（新しい請求を作らない）", sql(`select count(*) from b2c_payments where order_id in ('${pUnknown.oid}','${pHold.oid}','${pStuck.oid}','${pOver.oid}')`) === "4")

  console.log("7. 定期の処理の記録（sql/080・lib/cron-heartbeat.ts）")
  const { recordHeartbeat, findHeartbeatProblems, checkHeartbeats } = await import("@/lib/cron-heartbeat")
  const jobs = [
    { name: "t-tick", label: "T tick", staleMin: 30, maxFailures: 3 },
    { name: "t-watch", label: "T watch", staleMin: 40, maxFailures: 3, activeAt: (d: Date) => d.getUTCHours() !== 99 },
    { name: "t-off", label: "T off", staleMin: 1, maxFailures: 1, enabled: () => false },
  ]
  const t0 = new Date()
  let p = await findHeartbeatProblems(t0, jobs)
  ok("記録が無い → never_ran（スイッチ OFF の処理は見ない）", p.length === 2 && p.every((x) => x.kind === "never_ran") && !p.some((x) => x.name === "t-off"), p)
  await recordHeartbeat("t-tick", true, undefined, t0)
  await recordHeartbeat("t-watch", true, undefined, t0)
  p = await findHeartbeatProblems(new Date(t0.getTime() + 10 * 60_000), jobs)
  ok("10分後: 問題なし", p.length === 0, p)
  p = await findHeartbeatProblems(new Date(t0.getTime() + 35 * 60_000), jobs)
  ok("35分後: t-tick だけ stale（30分の基準）", p.length === 1 && p[0].name === "t-tick" && p[0].kind === "stale", p)
  for (let i = 1; i <= 3; i++) await recordHeartbeat("t-watch", false, `boom ${i}`, new Date(t0.getTime() + i * 60_000))
  ok("失敗が 3回続く → 数が 3", sql(`select consecutive_failures from cron_heartbeats where name='t-watch'`) === "3")
  p = await findHeartbeatProblems(new Date(t0.getTime() + 5 * 60_000), jobs)
  ok("→ failing（最後の失敗の理由つき）", p.some((x) => x.name === "t-watch" && x.kind === "failing" && x.detail.includes("boom 3")), p)
  await recordHeartbeat("t-watch", true, undefined, new Date(t0.getTime() + 6 * 60_000))
  ok("成功すれば数は 0 に戻る", sql(`select consecutive_failures from cron_heartbeats where name='t-watch'`) === "0")

  console.log("8. 止まった処理の知らせ（1時間に 1回・送れなければ戻す）")
  const tS = new Date(t0.getTime() + 60 * 60_000) // t-tick・t-watch とも stale
  const h1 = fakeAlert()
  const k1 = await checkHeartbeats(h1.fn, tS, jobs)
  ok("2つの処理を 1通で知らせる", h1.sent.length === 1 && k1.alerted === 2 && h1.sent[0].subject.includes("t-tick") && h1.sent[0].lines.join("\n").includes("cron.job"), k1)
  const h2 = fakeAlert()
  const k2 = await checkHeartbeats(h2.fn, new Date(tS.getTime() + 20 * 60_000), jobs)
  ok("20分後: 送らない（抑止）", h2.sent.length === 0 && k2.suppressed === 2, k2)
  const h3 = fakeAlert("fail")
  const k3 = await checkHeartbeats(h3.fn, new Date(tS.getTime() + 61 * 60_000), jobs)
  ok("61分後に送れなかった → undeliverable・門を戻す", k3.undeliverable === true, k3)
  const h4 = fakeAlert()
  const k4 = await checkHeartbeats(h4.fn, new Date(tS.getTime() + 62 * 60_000), jobs)
  ok("次の回に送り直す", h4.sent.length === 1 && k4.alerted === 2, k4)

  console.log("9. 記録の失敗で本来の処理を止めない")
  sql(`alter function cron_heartbeat_record(text, boolean, text, timestamptz) rename to cron_heartbeat_record_off`)
  let threw = false
  try { await recordHeartbeat("t-tick", true) } catch { threw = true }
  sql(`alter function cron_heartbeat_record_off(text, boolean, text, timestamptz) rename to cron_heartbeat_record; notify pgrst, 'reload schema'`)
  await new Promise((r) => setTimeout(r, 1500))
  ok("関数が無くても例外を出さない（sql/080 の前にアプリを出しても動く）", !threw)

  console.log("10. 見張りの入口 /api/cron/heartbeat-check")
  const route = await import("../../app/api/cron/heartbeat-check/route")
  const call = (h: Record<string, string>) => route.GET(new NextRequest("http://localhost/api/cron/heartbeat-check", { headers: h }))
  ok("CRON_SECRET なし → 401", (await call({})).status === 401)
  ok("運営のパスワードの Bearer → 401", (await call({ authorization: "Bearer test-operator-password" })).status === 401)
  delete process.env.B2C_SCHEDULER_ENABLED
  delete process.env.B2C_CHARGE_LIVE
  sql(`delete from cron_heartbeats; delete from b2c_ops_alert_gate where alert_key like 'cron:%'`)
  // pickup-watch は 9〜22時 JST だけ見る。今がその時間かで期待が変わる
  const hourJst = new Date(Date.now() + JST).getUTCHours()
  const watchActive = hourJst >= 9 && hourJst <= 22
  const r = await call({ authorization: "Bearer test-cron-secret" })
  const j = (await r.json()) as { ok: boolean; heartbeats: { problems: Array<{ name: string; kind: string }> }; charges: unknown }
  ok(`記録が無い（集荷の監視が${watchActive ? "見張りの時間" : "見張りの時間外"}）→ ${watchActive ? 503 : 200}`, r.status === (watchActive ? 503 : 200) && (!watchActive || j.heartbeats.problems.some((x) => x.name === "pickup-watch")), j)
  ok("B2C の定期の処理（スイッチ OFF）は見ない・請求の見張りもしない", !j.heartbeats.problems.some((x) => x.name === "b2c-tick") && JSON.stringify(j.charges).includes("b2c_off"), j)
  await recordHeartbeat("pickup-watch", true)
  const r2b = await call({ authorization: "Bearer test-cron-secret" })
  ok("集荷の監視の記録が新しい → 200", r2b.status === 200, await r2b.text())

  console.log("11. 見張りの見張り（GitHub Actions の見張りが止まった時に、pg_cron の側が気づく）")
  const { watcherJob } = await import("@/lib/cron-heartbeat")
  sql(`delete from cron_heartbeats; delete from b2c_ops_alert_gate where alert_key like 'cron:%'`)
  const tw = new Date()
  ok("見張りの記録が一度も無い → 知らせない（公開の直後の誤報を防ぐ）", (await findHeartbeatProblems(tw, [watcherJob()])).length === 0)
  const rr = await call({ authorization: "Bearer test-cron-secret" })
  await rr.text()
  ok("見張りの入口を呼ぶと、見張り自身の記録が残る", sql(`select count(*) from cron_heartbeats where name='heartbeat-check' and last_ok_at is not null`) === "1")
  ok("7時間後: まだ知らせない（GitHub の間引き 2〜6時間を見込む）", (await findHeartbeatProblems(new Date(tw.getTime() + 7 * 3600_000), [watcherJob()])).length === 0)
  const w9 = await findHeartbeatProblems(new Date(tw.getTime() + 9 * 3600_000), [watcherJob()])
  ok("9時間後: 見張りが止まっている（stale）", w9.length === 1 && w9[0].name === "heartbeat-check" && w9[0].kind === "stale", w9)
  const wa = fakeAlert()
  const wk = await checkHeartbeats(wa.fn, new Date(tw.getTime() + 9 * 3600_000), [watcherJob()])
  ok("運営に 1回知らせる（GitHub Actions を確かめる案内つき）", wk.alerted === 1 && wa.sent[0].lines.join("\n").includes("GitHub Actions"), wa.sent)
  const pw = await import("../../app/api/cron/pickup-watch/route")
  const pwSrc = (await import("node:fs")).readFileSync("app/api/cron/pickup-watch/route.ts", "utf8")
  const tickSrc = (await import("node:fs")).readFileSync("app/api/b2c/cron/tick/route.ts", "utf8")
  ok("集荷の監視（pg_cron）と B2C の定期の処理（pg_cron）の両方が、見張りの見張りを行う", typeof pw.GET === "function" && pwSrc.includes("watcherJob()") && tickSrc.includes("watcherJob()"))

  console.log("12. 見張りが止まっても請求は誤らない（見張りは請求に触れない）")
  const fs = await import("node:fs")
  const watchSrc = ["lib/b2c/charge-watch.ts", "lib/cron-heartbeat.ts", "app/api/cron/heartbeat-check/route.ts"].map((f) => fs.readFileSync(f, "utf8")).join("\n")
  ok("見張りのコードは Stripe を読み込まない", !/from ["'](stripe|@\/lib\/b2c\/stripe|@\/lib\/b2c\/charge-service|@\/lib\/charge)["']/.test(watchSrc))
  ok("見張りのコードは請求の表に書かない（書くのは知らせの門と実行の記録だけ）", !/from\("b2c_payments"\)\s*\.(update|insert|upsert|delete)/.test(watchSrc) && !/rpc\("b2c_claim/.test(watchSrc))
  ok("請求の二重を防ぐのは DB の一意の制約（1予約 1つの基本の請求）と Stripe の重複防止キー（見張りに依らない）", sql(`select count(*) from pg_indexes where indexname='b2c_payments_one_base_per_order'`) === "1")

  sql(`delete from b2c_ops_alert_gate where alert_key like 'b2c_charge:%' or alert_key like 'cron:%'; delete from cron_heartbeats`)
  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
