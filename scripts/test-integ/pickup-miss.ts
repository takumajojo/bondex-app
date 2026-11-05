/**
 * G19: 未集荷の通知（lib/pickup-request/pickup-miss.ts）の試験。ローカルの Supabase（docker）だけ・ダミーのデータだけ。
 * メールは送らない（送信の関数は試験用の偽物・route の試験は MAIL_TEST_CAPTURE=1）。
 *   実行: set -a; . ./.env.local; set +a; npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-integ/pickup-miss.ts
 *   前提: scripts/test-integ/seed-integrated-dev.sh
 */
import { execFileSync } from "node:child_process"
import { NextRequest } from "next/server"
import type { OpsAlertInput, OpsAlertResult } from "@/lib/ops-alert"

if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("refusing: local only")
process.env.MAIL_TEST_CAPTURE = "1"

let passed = 0, failed = 0
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400)) }
}
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "|", "-c", q], { encoding: "utf8" }).trim()
const JST = 9 * 3600 * 1000
const todayJst = new Date(Date.now() + JST).toISOString().slice(0, 10)
const addDays = (ymd: string, d: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10)
const at = (hhmm: string) => new Date(Date.parse(`${todayJst}T${hhmm}:00+09:00`))

function leg(bid: string, date: string, status: string, agency: string, extra = ""): string {
  return sql(`insert into shipments (booking_id, leg_index, shipment_date, expected_arrival, from_hotel, to_hotel, status, suitcase_count, agency, representative, recipient${extra ? ", channel, b2c_order_id" : ""})
    values ('${bid}', 0, '${date}', '${addDays(date, 1)}', 'Hotel A', 'Hotel B', '${status}', 2, '${agency}', 'Rep', 'Rcp'${extra}) returning id`).split("\n")[0]
}
const sent: OpsAlertInput[] = []
const okSend = async (i: OpsAlertInput): Promise<OpsAlertResult> => { sent.push(i); return { emailSent: true, slackSent: false, errors: [] } }
const subjectsFor = (bid: string) => sent.filter((s) => s.subject.includes(bid)).length
const mark = (id: string) => sql(`select coalesce(pickup_alert_sent_at::text,'') from shipments where id='${id}'`)

async function main() {
  const { getSupabase } = await import("@/lib/supabase")
  const { alertPickupMisses, pickupMissDue } = await import("@/lib/pickup-request/pickup-miss")
  const sb = getSupabase()!
  sql(`insert into agencies (name, contact_email, locale) values ('PM Agency JA', 'pm-ja@example.invalid', 'ja'), ('PM Agency EN', 'pm-en@example.invalid', 'en') on conflict (name) do nothing`)

  console.log("1. 時刻と対象（条件は従来どおり）")
  ok("集荷日が今日: 17:59 は対象外・18:00 から対象（日本時間）", !pickupMissDue(todayJst, at("17:59")) && pickupMissDue(todayJst, at("18:00")))
  ok("集荷日が昨日: 朝でも対象・明日は対象外", pickupMissDue(addDays(todayJst, -1), at("08:00")) && !pickupMissDue(addDays(todayJst, 1), at("23:59")))
  const A = leg("PM-TODAY", todayJst, "issued", "PM Agency JA")
  const B = leg("PM-PAST", addDays(todayJst, -1), "issued", "PM Agency EN")
  const C = leg("PM-CANCEL", addDays(todayJst, -1), "cancelled", "PM Agency JA")
  const D = leg("PM-PICKED", addDays(todayJst, -1), "picked_up", "PM Agency JA")
  const F = leg("PM-FUTURE", addDays(todayJst, 1), "issued", "PM Agency JA")
  const r1 = await alertPickupMisses(sb, okSend, at("17:59"))
  ok("17:59: 過去の集荷日の区間だけ通知（今日の区間はまだ）", subjectsFor("PM-PAST") === 1 && subjectsFor("PM-TODAY") === 0, [r1, sent.map((s) => s.subject)])
  ok("取消・集荷済み・明日の区間は通知しない", subjectsFor("PM-CANCEL") + subjectsFor("PM-PICKED") + subjectsFor("PM-FUTURE") === 0 && mark(C) === "" && mark(D) === "" && mark(F) === "")
  await alertPickupMisses(sb, okSend, at("18:00"))
  ok("18:00: 今日の区間を通知", subjectsFor("PM-TODAY") === 1 && mark(A) !== "")
  const r3 = await alertPickupMisses(sb, okSend, at("18:30"))
  ok("もう一度動かしても同じ区間は通知しない（1回だけ）", r3.alerted === 0 && subjectsFor("PM-TODAY") === 1 && subjectsFor("PM-PAST") === 1, r3)
  const en = sent.find((s) => s.subject.includes("PM-PAST"))!
  ok("英語の代理店には代理店の主メールへ英語の文（従来どおり）", en.agencyEmail === "pm-en@example.invalid" && (en.agencySubject ?? "").startsWith("[BondEx] Possible missed pickup"), en)
  const ja = sent.find((s) => s.subject.includes("PM-TODAY"))!
  ok("日本語の代理店は主メールへ同じ文（agencySubject なし）", ja.agencyEmail === "pm-ja@example.invalid" && !ja.agencySubject, ja)

  console.log("2. 旅行者の予約（B2C）の区間")
  const E = leg("B2C-PM1", addDays(todayJst, -1), "issued", "BondEx Direct")
  await alertPickupMisses(sb, okSend, at("09:00"))
  const b2c = sent.find((s) => s.subject.includes("B2C-PM1"))
  ok("B2C の区間も通知・代理店の宛先は無い（運営だけ）", !!b2c && !b2c.agencyEmail, b2c)
  ok("未集荷を理由に請求を作らない（B2C の請求の行 0）", sql(`select count(*) from b2c_payments`) === "0" && mark(E) !== "")

  console.log("3. 同時に動く（pickup-watch と追跡の定時処理が重なる）")
  const G = leg("PM-CONC1", addDays(todayJst, -2), "issued", "PM Agency JA"), H = leg("PM-CONC2", addDays(todayJst, -2), "requested", "PM Agency JA")
  const before = sent.length
  await Promise.all([alertPickupMisses(sb, okSend, at("10:00")), alertPickupMisses(sb, okSend, at("10:00")), alertPickupMisses(sb, okSend, at("10:00"))])
  ok("3つ同時に動かしても各区間 1回だけ", subjectsFor("PM-CONC1") === 1 && subjectsFor("PM-CONC2") === 1 && sent.length - before === 2, [subjectsFor("PM-CONC1"), subjectsFor("PM-CONC2")])
  void G; void H

  console.log("4. 送信の失敗・結果不明")
  const I = leg("PM-FAIL", addDays(todayJst, -1), "issued", "PM Agency JA")
  const r4 = await alertPickupMisses(sb, async () => ({ emailSent: false, slackSent: false, errors: ["smtp down"] }), at("11:00"))
  ok("確かに送れなかった（メールも Slack も届かない）→ 印を戻す", r4.retry === 1 && mark(I) === "", r4)
  await alertPickupMisses(sb, okSend, at("11:10"))
  ok("次の回に送り直す（1回）", subjectsFor("PM-FAIL") === 1)
  const J = leg("PM-UNKNOWN", addDays(todayJst, -1), "issued", "PM Agency JA")
  const r5 = await alertPickupMisses(sb, async () => { throw new Error("timeout after request was sent") }, at("12:00"))
  ok("送ったか分からない（例外）→ 印を残す", r5.unknown === 1 && mark(J) !== "", r5)
  await alertPickupMisses(sb, okSend, at("12:10"))
  ok("結果不明の区間は送り直さない（重複させない）", subjectsFor("PM-UNKNOWN") === 0)

  console.log("5. DB の障害")
  const K = leg("PM-DBDOWN", addDays(todayJst, -1), "issued", "PM Agency JA")
  sql("revoke update on public.shipments from service_role")
  let r6: unknown
  try { r6 = await alertPickupMisses(sb, okSend, at("13:00")) } finally { sql("grant update on public.shipments to service_role") }
  ok("印を付けられない時は送らない（送ってから記録に失敗して二重になる形を作らない）", subjectsFor("PM-DBDOWN") === 0 && mark(K) === "", r6)
  await alertPickupMisses(sb, okSend, at("13:10"))
  ok("DB が戻った後の回で通知（1回）", subjectsFor("PM-DBDOWN") === 1)
  sql("revoke select on public.shipments from service_role")
  let threw = false
  try { await alertPickupMisses(sb, okSend, at("13:20")) } catch { threw = true } finally { sql("grant select on public.shipments to service_role") }
  ok("対象を読めない時は例外（監視ジョブが 500 を返し、失敗として見える）", threw)

  console.log("6. 追跡が止まっている時（Ship&co の鍵なし・一時停止）")
  const L = leg("PM-TRKOFF", addDays(todayJst, -1), "issued", "PM Agency JA")
  Object.assign(process.env, { CRON_SECRET: "test-cron-secret", TRACKING_SYNC_PAUSED: "true", SHIPANDCO_API_KEY: "" })
  const sync = await import("../../app/api/cron/sync-tracking/route")
  const watch = await import("../../app/api/cron/pickup-watch/route")
  const req = (path: string) => new NextRequest(`http://localhost${path}`, { headers: { authorization: "Bearer test-cron-secret" } })
  const sres = await (await sync.GET(req("/api/cron/sync-tracking"))).json()
  ok("追跡の定時処理は止まっている（paused）・この時点では未通知", sres.paused === true && mark(L) === "", sres)
  const wres = await (await watch.GET(req("/api/cron/pickup-watch"))).json()
  ok("集荷依頼の監視ジョブは追跡が止まっていても未集荷を通知（G19）", (wres.pickupMiss?.alerted ?? 0) >= 1 && mark(L) !== "", wres.pickupMiss)
  const wres2 = await (await watch.GET(req("/api/cron/pickup-watch"))).json()
  ok("監視ジョブを続けて動かしても同じ区間は 0件（送れず再送・結果不明も 0）", (wres2.pickupMiss?.alerted ?? -1) === 0 && wres2.pickupMiss?.retry === 0 && wres2.pickupMiss?.unknown === 0, wres2.pickupMiss)
  const cap = ((globalThis as unknown as { __capturedMails?: Array<{ subject: string }> }).__capturedMails ?? []).filter((m) => m.subject.includes("PM-TRKOFF"))
  ok("記録だけの形（MAIL_TEST_CAPTURE=1）で運営への通知が記録される（実際には送らない）", cap.length >= 1, cap.length)

  console.log("7. 定時処理が止まっていた後")
  const M = leg("PM-CRONSTOP", addDays(todayJst, -3), "issued", "PM Agency JA")
  ok("どの定時処理も動かなければ通知されない（未通知のまま残る＝運営の手順書で定時処理の停止を検知する）", mark(M) === "")
  await alertPickupMisses(sb, okSend, at("08:00"))
  ok("再開した最初の回で、過去の集荷日の区間をまとめて通知", subjectsFor("PM-CRONSTOP") === 1)

  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
