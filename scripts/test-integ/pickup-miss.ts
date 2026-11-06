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
// 追跡の定時処理の最後の成功（cron_heartbeats の sync-tracking）。代理店に送るのは追跡が動いている時だけ（agencyNoticeGate）
const trackingOkAt = (d: Date) => sql(`insert into cron_heartbeats (name, last_started_at, last_ok_at, consecutive_failures, updated_at) values ('sync-tracking', '${d.toISOString()}', '${d.toISOString()}', 0, now())
  on conflict (name) do update set last_ok_at = excluded.last_ok_at, last_started_at = excluded.last_started_at, consecutive_failures = 0`)
const mark = (id: string) => sql(`select coalesce(pickup_alert_sent_at::text,'') from shipments where id='${id}'`)

async function main() {
  const { getSupabase } = await import("@/lib/supabase")
  const { alertPickupMisses: alertRaw, pickupMissDue } = await import("@/lib/pickup-request/pickup-miss")
  const sb = getSupabase()!
  // 1〜5・7 は追跡が動いている前提（直前の 10分前に追跡が成功）。追跡が止まっている時は 6・8 で見る
  const alertPickupMisses: typeof alertRaw = (s, send, now = new Date(), opts) => (trackingOkAt(new Date(now.getTime() - 10 * 60_000)), alertRaw(s, send, now, opts))
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
  const paysBefore = sql(`select count(*) from b2c_payments`) // 他の試験が先に作った行に左右されないよう、通知の前後の差で見る
  await alertPickupMisses(sb, okSend, at("09:00"))
  const b2c = sent.find((s) => s.subject.includes("B2C-PM1"))
  ok("B2C の区間も通知・代理店の宛先は無い（運営だけ）", !!b2c && !b2c.agencyEmail, b2c)
  ok("未集荷を理由に請求を作らない（B2C の請求の行 0）", sql(`select count(*) from b2c_payments`) === paysBefore && mark(E) !== "")

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
  const capTo = ((globalThis as unknown as { __capturedMails?: Array<{ subject: string; to?: unknown }> }).__capturedMails ?? []).filter((m) => m.subject.includes("PM-TRKOFF")).map((m) => JSON.stringify(m.to ?? ""))
  ok("追跡の一時停止中は代理店の主メールには送らない（運営だけ・誤った集荷漏れの通知を防ぐ）", capTo.length >= 1 && !capTo.some((t) => t.includes("pm-ja@example.invalid")), capTo)
  process.env.TRACKING_SYNC_PAUSED = "false"

  console.log("7. 定時処理が止まっていた後")
  const M = leg("PM-CRONSTOP", addDays(todayJst, -3), "issued", "PM Agency JA")
  ok("どの定時処理も動かなければ通知されない（未通知のまま残る＝運営の手順書で定時処理の停止を検知する）", mark(M) === "")
  await alertPickupMisses(sb, okSend, at("08:00"))
  ok("再開した最初の回で、過去の集荷日の区間をまとめて通知", subjectsFor("PM-CRONSTOP") === 1)

  console.log("8. 追跡が古い・記録が無い時は運営だけ（代理店に送らない）")
  sql(`delete from cron_heartbeats where name = 'sync-tracking'`)
  const N = leg("PM-NOHB", addDays(todayJst, -1), "issued", "PM Agency EN")
  await alertRaw(sb, okSend, at("14:00"))
  const nohb = sent.find((s) => s.subject.includes("PM-NOHB"))
  ok("追跡の成功の記録が無い → 運営だけ・理由を本文に書く", !!nohb && nohb.agencyEmail === null && !nohb.agencySubject && nohb.lines.some((l) => l.includes("代理店には送っていません")), nohb)
  const O = leg("PM-STALE", addDays(todayJst, -1), "issued", "PM Agency JA")
  trackingOkAt(at("12:29"))
  await alertRaw(sb, okSend, at("14:00"))
  const stale = sent.find((s) => s.subject.includes("PM-STALE"))
  ok("追跡の最後の成功が 91分前（基準 90分）→ 運営だけ", !!stale && stale.agencyEmail === null && stale.lines.some((l) => l.includes("91分")), stale)
  const P = leg("PM-FRESH", addDays(todayJst, -1), "issued", "PM Agency JA")
  trackingOkAt(at("12:31"))
  await alertRaw(sb, okSend, at("14:00"))
  const fresh = sent.find((s) => s.subject.includes("PM-FRESH"))
  ok("追跡の最後の成功が 89分前 → 代理店にも送る（従来どおり）", !!fresh && fresh.agencyEmail === "pm-ja@example.invalid" && !fresh.lines.some((l) => l.includes("代理店には送っていません")), fresh)
  const Q = leg("PM-PAUSEOPT", addDays(todayJst, -1), "issued", "PM Agency JA")
  await alertRaw(sb, okSend, at("14:00"), { trackingPaused: true })
  const po = sent.find((s) => s.subject.includes("PM-PAUSEOPT"))
  ok("追跡が新しくても一時停止中 → 運営だけ", !!po && po.agencyEmail === null, po)
  ok("運営だけにした区間も 1回だけ（印は付く・あとで代理店へ送り直さない）", mark(N) !== "" && mark(O) !== "" && mark(Q) !== "")
  void P
  const R = leg("PM-HBDENY", addDays(todayJst, -1), "issued", "PM Agency JA")
  sql("revoke select on public.cron_heartbeats from service_role")
  let rd: Awaited<ReturnType<typeof alertRaw>> | undefined
  try { rd = await alertRaw(sb, okSend, at("15:00")) } finally { sql("grant select on public.cron_heartbeats to service_role") }
  const deny = sent.find((s) => s.subject.includes("PM-HBDENY"))
  ok("追跡の記録を読めない（権限なし）→ 例外にせず運営だけに理由つきで送る", !!rd && rd.alerted >= 1 && !!deny && deny.agencyEmail === null && deny.lines.some((l) => l.includes("記録を読めません")), [rd, deny])
  ok("読めない区間も 1回だけ（印が付く）", mark(R) !== "")
  const { agencyNoticeGate } = await import("@/lib/pickup-request/pickup-miss")
  const throwing = { from: () => { throw new Error("socket hang up") } } as never
  const g = await agencyNoticeGate(throwing, at("15:00"), false)
  ok("追跡の記録の読み取りで例外 → 例外を外に出さず、代理店に送らない", g.ok === false && g.reason.includes("socket hang up"), g)

  console.log(`${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
