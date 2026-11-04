/**
 * 運営画面の集荷依頼の実動作確認 (動いているローカルの開発サーバーに、運営画面と同じ HTTP の呼び出しを送る)。
 * 通し試験 (scripts/test-pickup-e2e) はルートの関数を直接呼ぶが、ここでは Next の開発サーバー・middleware・
 * 運営のセッションの検証・ローカルの Supabase (PostgREST) を通して確かめる。
 *
 * 本番には接続しない: BASE・Supabase は localhost だけ。Biz-Logi と Google Places は開発サーバーに読み込ませた
 * 模擬 (EXT_MOCK_DIR の ext-mock-preload.mjs) が答え、それ以外の外部通信は拒否される。運営のセッションは
 * この台本の中だけで作り、表示も保存もしない。
 * 前提: seed-dev.sh → 統合の SQL (067〜073) → 区間 BDX-UI-A〜E を入れ、開発サーバーを EXT_MOCK_DIR 付きで起動。
 * 実行: set -a; . ./.env.local; set +a; BASE=http://localhost:3212 EXT_MOCK_DIR=… npx tsx --tsconfig scripts/test-b2c/tsconfig.localdb.json scripts/test-integ/operator-live.ts
 */
import { writeFileSync } from "node:fs"
import { getSupabase } from "@/lib/supabase"
import { issueOperatorSession, OPERATOR_SESSION_COOKIE } from "@/lib/operator-session"
import { alertEveningPickupGaps } from "@/lib/pickup-request/watch"
import type { OpsAlertInput } from "@/lib/ops-alert"

const BASE = process.env.BASE ?? "http://localhost:3212"
const MOCK = process.env.EXT_MOCK_DIR ?? ""
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(BASE) || !/^http:\/\/(localhost|127\.0\.0\.1):/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("refusing: local only")
if (!MOCK) throw new Error("EXT_MOCK_DIR is required (Biz-Logi mock)")
const sb = getSupabase()!
let passed = 0
let failed = 0
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`  ok  ${name}`) } else { failed++; console.log(`  NG  ${name}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400)) }
}
const mode = (m: string) => writeFileSync(`${MOCK}/ext-mock-mode.txt`, m)
let cookie = ""
let ipN = 0
async function api(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  ipN++
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie, "x-forwarded-for": `10.77.${Math.floor(ipN / 200)}.${ipN % 200}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 200) } }
  return { status: res.status, body: json }
}
const legId = async (b: string) => (await sb.from("shipments").select("id").eq("booking_id", b).single()).data!.id as string
const reqsOf = async (id: string) => (await sb.from("pickup_requests").select("state, channel, shipping_number, error").eq("shipment_id", id).order("created_at")).data ?? []
async function send(id: string) {
  const pv = await api("/api/operator/pickup-request", { action: "bizlogi_preview", shipmentId: id })
  if (pv.status !== 200 || !pv.body.ok) return { pv, send: null as null | Awaited<ReturnType<typeof api>> }
  const s = await api("/api/operator/pickup-request", { action: "bizlogi_send", shipmentId: id, fingerprint: pv.body.fingerprint, actor: "検証担当", confirmNoManual: true })
  return { pv, send: s }
}
const jstDate = (offsetDays: number) => new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10)
const atJst = (hhmm: string) => new Date(`${jstDate(0)}T${hhmm}:00+09:00`)

async function main() {
  const tok = await issueOperatorSession()
  if (!tok) throw new Error("operator session could not be issued")
  cookie = `${OPERATOR_SESSION_COOKIE}=${tok}`
  mode("ok")
  const [A, B, Cc, D, E] = await Promise.all(["BDX-UI-A", "BDX-UI-B", "BDX-UI-C", "BDX-UI-D", "BDX-UI-E"].map(legId))

  // 認証: 開発サーバーは OPERATOR_PASSWORD 未設定だと運営ゲートを素通しする (middleware.ts・本番は fail closed)。
  // 本番の未ログイン拒否は curl で別に確かめる (報告書)。ここではセッション付きで呼ぶ。

  console.log("1. 集荷依頼 TODO (運営画面の「佐川へ集荷依頼」)")
  {
    const r = await api("/api/operator/today-todo")
    const tasks = (r.body.sagawaPickupTasks ?? []) as Array<{ bookingId: string; urgency: string; manualOnlyReason?: string | null }>
    const by = (b: string) => tasks.find((t) => t.bookingId === b)
    ok("明日の3区間は「明日発送」(due)、3日後は upcoming", by("BDX-UI-A")?.urgency === "due" && by("BDX-UI-B")?.urgency === "due" && by("BDX-UI-C")?.urgency === "due" && by("BDX-UI-D")?.urgency === "upcoming", tasks)
    ok("25個の区間は「手動手配のみ」の印", !!by("BDX-UI-E")?.manualOnlyReason, by("BDX-UI-E"))
  }

  console.log("2. Biz-Logi で集荷依頼 (模擬) と二重依頼の防止")
  {
    const { pv, send: s } = await send(A)
    ok("送信内容の確認 (preview) ができる", pv.status === 200 && pv.body.ok === true, pv.body)
    ok("送信 → 受付済み (200・accepted)", s?.status === 200 && s.body.outcome === "accepted", s?.body)
    const rq = await reqsOf(A)
    ok("記録は accepted・問合番号あり", rq.length === 1 && rq[0].state === "accepted" && /^\d{12}$/.test(String(rq[0].shipping_number)), rq)
    const again = await send(A)
    ok("同じ区間をもう一度送ると止まる (確認の段階で 409)", again.pv.status === 409, again.pv.body)
    const mm = await api("/api/operator/pickup-request", { action: "manual_mark", shipmentId: A, actor: "検証担当" })
    ok("Biz-Logi で依頼済みの区間に「Excel で依頼済み」は付けられない (409)", mm.status === 409, mm.body)
    const ed = await api(`/api/operator/shipment/${A}/edit`, { tracking: "512345678901" })
    ok("依頼済みの区間の問い合わせ番号は運営画面から書き換えられない (409)", ed.status === 409, ed.body)
    const rep = await api(`/api/operator/shipment/${A}/edit`, { representative: "SMITH JANE" })
    ok("依頼済みの区間の代表者名は直接変えられず、変更申請へ案内 (409)", rep.status === 409 && String(rep.body.error ?? "").length > 0, rep.body)
  }

  console.log("3. Excel で依頼済み (手動) と Biz-Logi の相互排他")
  {
    const mm = await api("/api/operator/pickup-request", { action: "manual_mark", shipmentId: B, actor: "検証担当", note: "世田谷へ Excel 送付" })
    ok("「Excel で依頼済み」を記録できる", mm.status === 200, mm.body)
    const s = await send(B)
    ok("Excel で依頼済みの区間は Biz-Logi で送れない (409)", s.pv.status === 409, s.pv.body)
    ok("記録は手動の1件だけ", (await reqsOf(B)).length === 1)
  }

  console.log("4. 結果不明 (通信断) と送信失敗 (佐川のエラー)")
  {
    mode("issue-network-error")
    const s = await send(Cc)
    ok("通信断 → 結果不明 (202・unknown)", s.send?.status === 202 && (await reqsOf(Cc))[0]?.state === "unknown", s.send?.body)
    mode("ok")
    const again = await send(Cc)
    ok("結果不明の区間は再送できない (409)", again.pv.status === 409, again.pv.body)
    mode("issue-error-code")
    const f = await send(D)
    ok("佐川のエラーコード → 送信失敗 (422・failed・佐川に登録なし)", f.send?.status === 422 && (await reqsOf(D))[0]?.state === "failed", f.send?.body)
    mode("ok")
    const r = await api("/api/operator/today-todo")
    const att = (r.body.pickupAttention ?? []) as Array<{ bookingId: string; kind: string }>
    const tasks = (r.body.sagawaPickupTasks ?? []) as Array<{ bookingId: string; lastFailure?: { error: string | null } | null }>
    ok("結果不明は「要対応」の先頭に出る", att[0]?.bookingId === "BDX-UI-C" && att[0]?.kind === "unknown", att)
    const d = tasks.find((t) => t.bookingId === "BDX-UI-D")
    ok("送信失敗の区間は「依頼が必要」に残り、前回失敗の印が付く", !!d?.lastFailure, d)
    ok("依頼済み (A・B) は「依頼が必要」に出ない", !tasks.some((t) => t.bookingId === "BDX-UI-A" || t.bookingId === "BDX-UI-B"))
  }

  console.log("5. 夕方の依頼漏れの通知 (19:00〜21:59・明日集荷)")
  {
    const sent: OpsAlertInput[] = []
    const cap = async (i: OpsAlertInput) => { sent.push(i) }
    const r1859 = await alertEveningPickupGaps(sb, cap, atJst("18:59"))
    ok("18:59 は通知しない (対象時間外)", !r1859.alerted && sent.length === 0, r1859)
    const r1900 = await alertEveningPickupGaps(sb, cap, atJst("19:00"))
    const body = sent[0]?.lines.join("\n") ?? ""
    ok("19:00 に通知する (要対応)", r1900.alerted && /【要対応】/.test(sent[0]?.subject ?? ""), sent[0]?.subject)
    ok("結果不明の C が要確認に入る", /【結果不明】BDX-UI-C/.test(body), body)
    ok("依頼済みの A・B と 3日後の D は入らない", !/BDX-UI-A|BDX-UI-B|BDX-UI-D/.test(body), body)
    const r2005 = await alertEveningPickupGaps(sb, cap, atJst("20:05"))
    ok("20:00 以降は「締め超過」と SOP の案内", r2005.alerted && /【締め超過】/.test(sent[1]?.subject ?? "") && /再依頼しないで/.test(sent[1]?.lines.join("") ?? ""), sent[1])
    const r2200 = await alertEveningPickupGaps(sb, cap, atJst("22:00"))
    ok("22:00 は通知しない (追跡の定時処理も止まる時間)", !r2200.alerted, r2200)
  }

  console.log("6. 依頼後の変更 (日程): 申請 → 世田谷へ連絡 → 佐川の承認 → 反映")
  {
    const newArrival = jstDate(3)
    const c = await api("/api/operator/pickup-request", { action: "change_create", shipmentId: A, kind: "dates", fields: { expected_arrival: newArrival }, reason: "旅行者の日程変更", actor: "検証担当" })
    const changeId = String((c.body as { changeId?: string }).changeId ?? "")
    ok("変更申請を登録できる (佐川の確認が要る)", c.status === 200 && !!changeId, c.body)
    const early = await api("/api/operator/pickup-request", { action: "change_apply", changeId, actor: "検証担当" })
    ok("佐川の承認前は反映できない (409)", early.status === 409, early.body)
    const ct = await api("/api/operator/pickup-request", { action: "change_step", changeId, step: "contact", actor: "検証担当", note: "世田谷へ電話" })
    const ap = await api("/api/operator/pickup-request", { action: "change_step", changeId, step: "approve", actor: "検証担当", note: "佐川: 了承", numberPolicy: "kept" })
    ok("連絡・佐川の承認を記録できる", ct.status === 200 && ap.status === 200, { ct: ct.body, ap: ap.body })
    const apply = await api("/api/operator/pickup-request", { action: "change_apply", changeId, actor: "検証担当" })
    const s = (await sb.from("shipments").select("expected_arrival").eq("id", A).single()).data
    ok("反映すると区間の到着日が変わり、集荷依頼は受付済みのまま", apply.status === 200 && s?.expected_arrival === newArrival && (await reqsOf(A))[0]?.state === "accepted", { apply: apply.body, s })
    const r = await api("/api/operator/today-todo")
    ok("反映後は「依頼後に内容が変わった」に出ない (依頼内容も更新)", !((r.body.pickupAttention ?? []) as Array<{ bookingId: string }>).some((t) => t.bookingId === "BDX-UI-A"), r.body.pickupAttention)
  }

  console.log("7. 依頼後の取消: 佐川が認めない → 却下 / 認める → 取消確定")
  {
    const c1 = await api("/api/operator/pickup-request", { action: "change_create", shipmentId: B, kind: "cancel", fields: {}, reason: "代理店から取消", actor: "検証担当" })
    const id1 = String((c1.body as { changeId?: string }).changeId ?? "")
    await api("/api/operator/pickup-request", { action: "change_step", changeId: id1, step: "contact", actor: "検証担当", note: "世田谷へ連絡" })
    const rj = await api("/api/operator/pickup-request", { action: "change_step", changeId: id1, step: "reject", actor: "検証担当", note: "佐川: 既に集荷手配済みで不可" })
    const s1 = (await sb.from("shipments").select("status").eq("id", B).single()).data
    ok("却下すると区間・集荷依頼は元のまま", rj.status === 200 && s1?.status !== "cancelled" && (await reqsOf(B))[0]?.state === "accepted", { rj: rj.body, s1 })
    const c2 = await api("/api/operator/pickup-request", { action: "change_create", shipmentId: B, kind: "cancel", fields: {}, reason: "代理店から取消 (再)", actor: "検証担当" })
    const id2 = String((c2.body as { changeId?: string }).changeId ?? "")
    await api("/api/operator/pickup-request", { action: "change_step", changeId: id2, step: "contact", actor: "検証担当", note: "世田谷へ連絡" })
    await api("/api/operator/pickup-request", { action: "change_step", changeId: id2, step: "approve", actor: "検証担当", note: "佐川: 取消を確認", numberPolicy: "kept" })
    const apply = await api("/api/operator/pickup-request", { action: "change_apply", changeId: id2, actor: "検証担当" })
    const s2 = (await sb.from("shipments").select("status").eq("id", B).single()).data
    ok("佐川の取消確認の後に確定すると、区間と集荷依頼が同時に取消", apply.status === 200 && s2?.status === "cancelled" && (await reqsOf(B))[0]?.state === "cancelled", { apply: apply.body, s2, r: await reqsOf(B) })
  }

  console.log("8. 25個の区間は Biz-Logi で送れない (手動のみ)")
  {
    const s = await send(E)
    const blocked = s.pv.status !== 200 || s.pv.body.ok !== true || (s.send && s.send.status === 409)
    ok("確認または送信の段階で止まる", !!blocked && (await reqsOf(E)).length === 0, { pv: s.pv.body, send: s.send?.body })
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
