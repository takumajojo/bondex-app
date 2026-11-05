/**
 * B2C の請求の見張り（2026-11-05）。結果不明・保留・予定を過ぎても終わらない・処理中のまま止まった請求を、運営にメール・Slack で知らせる。
 *
 * - 読むだけ。請求・照合・Stripe には触れない（請求を作らない・再試行しない。照合は lib/b2c/charge-service.ts の既存の処理）。
 * - 重複の防止: 既存の運営への知らせの門（b2c_ops_alert_gate・sql/073）を「請求 × 状態」のキーで使う。
 *   送る前に門を取る（取れた時だけ送る）→ 同じ請求の同じ状態は 1日に 1回まで。状態が変わればキーが変わるので、すぐ知らせる。
 *   送れなかったことがはっきりしている時（メールも Slack も失敗）だけ門を戻し、次の回に送り直す。
 *   送ったか分からない時（例外）は門を戻さない（送り直さない・既存の通知の安全の設計と同じ）。
 * - 知らせる内容: 受付番号・状態・請求の額・いつから・概要・必要な対応・運営の画面のリンク。旅行者の名前・連絡先・予約の秘密のリンクは入れない。
 * - 失敗しても請求の処理は止めない（呼び出し側で例外を受け止める）。
 */
import { getSupabase } from "@/lib/supabase"
import { b2cOpsAlert, type B2cAlertFn } from "@/lib/b2c/notify"
import { b2cChargeLive } from "@/lib/b2c/flags"

/** 予定の時刻を過ぎても請求が終わらない、とみなすまでの分（定期の処理は数分おき） */
export const CHARGE_OVERDUE_MIN = 60
/** 処理中のまま止まった、とみなすまでの分（運営の画面 lib/b2c/payment-ops.ts と同じ 10分） */
export const CHARGE_PROCESSING_STALE_MIN = 10
/** 同じ請求の同じ状態を、もう一度知らせるまでの間隔 */
export const CHARGE_ALERT_REPEAT = "24 hours"

export type ChargeIssueKind = "unknown" | "on_hold" | "overdue" | "processing_stuck"

const OPS_URL = "https://bondex.express/operator/b2c"

const TEXT: Record<ChargeIssueKind, { title: string; action: string }> = {
  unknown: {
    title: "請求の結果が分かりません（Stripe への請求の途中で応答・記録が途切れました）",
    action: "再請求しないでください。照合（10分おき）を待ち、Stripe の画面で PaymentIntent の状態を確かめてください。手順書 docs/release/b2c_ops_runbook.md の 3。",
  },
  on_hold: {
    title: "請求を保留しています（条件の再確認で止まりました）",
    action: "運営の画面で保留の理由を確かめ、「保留の解除」か「保留の取消」を選んでください。",
  },
  overdue: {
    title: `集荷の確認の後、予定の時刻を ${CHARGE_OVERDUE_MIN}分過ぎても請求が終わっていません`,
    action: "定期の処理（/api/b2c/cron/tick）が動いているか、B2C_CHARGE_LIVE の設定を確かめてください。自動では新しい請求を作りません。",
  },
  processing_stuck: {
    title: `請求が処理中のまま ${CHARGE_PROCESSING_STALE_MIN}分以上止まっています`,
    action: "照合（10分おき）で結果を確かめます。続く時は Stripe の画面で PaymentIntent を確かめてください。再請求しないでください。",
  },
}

export interface ChargeIssue {
  paymentId: string
  orderNumber: number | null
  kind: ChargeIssueKind
  status: string
  amountYen: number
  since: string
}

export interface ChargeWatchResult {
  issues: number
  alerted: number
  suppressed: number
  retry: number
  unknown: number
  note?: string
}

/** 今、知らせるべき請求の一覧（読むだけ）。 */
export async function findChargeIssues(now: Date = new Date()): Promise<ChargeIssue[]> {
  const sb = getSupabase()
  if (!sb) throw new Error("db_unavailable")
  const { data, error } = await sb
    .from("b2c_payments")
    .select("id, order_id, status, amount_yen, scheduled_at, updated_at")
    .in("status", ["unknown", "on_hold", "processing", "scheduled", "ready"])
    .limit(500)
  if (error) throw new Error(`charge_watch_read: ${error.message}`)
  const t = now.getTime()
  const issues: Array<Omit<ChargeIssue, "orderNumber"> & { orderId: string }> = []
  for (const p of data ?? []) {
    const status = p.status as string
    const updated = new Date(p.updated_at as string).getTime()
    const scheduled = new Date(p.scheduled_at as string).getTime()
    let kind: ChargeIssueKind | null = null
    let since = p.updated_at as string
    if (status === "unknown") kind = "unknown"
    else if (status === "on_hold") kind = "on_hold"
    else if (status === "processing" && t - updated > CHARGE_PROCESSING_STALE_MIN * 60_000) kind = "processing_stuck"
    else if ((status === "scheduled" || status === "ready") && t - scheduled > CHARGE_OVERDUE_MIN * 60_000) {
      kind = "overdue"
      since = p.scheduled_at as string
    }
    if (kind) issues.push({ paymentId: p.id as string, orderId: p.order_id as string, kind, status, amountYen: p.amount_yen as number, since })
  }
  if (!issues.length) return []
  const ids = [...new Set(issues.map((i) => i.orderId))]
  const { data: ords } = await sb.from("b2c_orders").select("id, order_number").in("id", ids)
  const num = new Map((ords ?? []).map((o) => [o.id as string, o.order_number as number]))
  return issues.map(({ orderId, ...i }) => ({ ...i, orderNumber: num.get(orderId) ?? null }))
}

const gateKey = (i: ChargeIssue) => `b2c_charge:${i.paymentId}:${i.kind}`

const fmtJst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ") + " JST"

/** 見張りの 1回。新しく知らせるべき請求があれば、まとめて 1通にして送る。 */
export async function watchB2cCharges(now: Date = new Date(), alert: B2cAlertFn = b2cOpsAlert()): Promise<ChargeWatchResult> {
  const out: ChargeWatchResult = { issues: 0, alerted: 0, suppressed: 0, retry: 0, unknown: 0 }
  const sb = getSupabase()
  if (!sb) return { ...out, note: "db_unavailable" }
  const issues = await findChargeIssues(now)
  out.issues = issues.length
  const claimed: ChargeIssue[] = []
  for (const i of issues) {
    const { data: gate, error } = await sb.rpc("b2c_ops_alert_gate_try", { p_key: gateKey(i), p_now: now.toISOString(), p_every: CHARGE_ALERT_REPEAT })
    if (error) throw new Error(`charge_watch_gate: ${error.message}`)
    if (gate === true) claimed.push(i)
    else out.suppressed++
  }
  if (!claimed.length) return out

  const order: ChargeIssueKind[] = ["unknown", "processing_stuck", "overdue", "on_hold"]
  const lines: string[] = [`検知の時刻: ${fmtJst(now.toISOString())}`]
  if (!b2cChargeLive()) lines.push("※ 今は請求を止めています（B2C_CHARGE_LIVE が true ではありません）。")
  for (const k of order) {
    const ks = claimed.filter((i) => i.kind === k)
    if (!ks.length) continue
    lines.push("", `■ ${TEXT[k].title}（${ks.length}件）`, `  → 対応: ${TEXT[k].action}`)
    for (const i of ks) lines.push(`  受付番号 ${i.orderNumber ?? "?"} / 状態 ${i.status} / 請求予定額 ${i.amountYen.toLocaleString("ja-JP")}円 / ${fmtJst(i.since)} から`)
  }
  lines.push("", `運営の画面: ${OPS_URL}`)
  const top = order.find((k) => claimed.some((i) => i.kind === k))!
  const subject = `【B2C 請求】要確認 ${claimed.length}件（${TEXT[top].title.split("（")[0]}${claimed.length > 1 ? " ほか" : ""}）`

  let r: Awaited<ReturnType<B2cAlertFn>>
  try {
    r = await alert({ subject, lines, agencyEmail: null })
  } catch (e) {
    // 送ったか分からない: 門は戻さない（送り直さない）
    console.error("[b2c-charge-watch] alert result unknown", e)
    out.unknown = claimed.length
    return out
  }
  const delivered = r.emailSent || r.slackSent || (r as { sandbox?: boolean }).sandbox === true
  if (delivered) {
    out.alerted = claimed.length
    return out
  }
  // 送れなかったことがはっきりしている: 自分が取った門だけを戻す（次の回に送り直す）
  for (const i of claimed) {
    await sb.from("b2c_ops_alert_gate").update({ last_sent_at: "1970-01-01T00:00:00Z" }).eq("alert_key", gateKey(i)).eq("last_sent_at", now.toISOString())
  }
  out.retry = claimed.length
  return out
}
