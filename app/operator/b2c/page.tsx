"use client"

/**
 * 運営の B2C の画面（Stage 5）: 要対応の一覧・予約の詳細・集荷の確認・請求・返金・回収不能・通知の照合。
 * API: /api/b2c/ops/payments（lib/b2c/payment-ops.ts）、/api/b2c/ops/outbox（lib/b2c/outbox-ops.ts）。
 * 見るのは運営のログインで可。操作は個人のパスキーのログイン（v2）だけ（API が 403 を返す）。どの操作も理由が必須で、
 * 実行の前に内容を表示して確かめる。
 */
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Row = Record<string, unknown>
interface Todo {
  unknownCharges: Row[]
  heldCharges: Row[]
  unpaid: Row[]
  scheduled: Row[]
  pickupUnconfirmed: Row[]
  awaitingHotel: Row[]
  notifications: Row[]
}

const yen = (n: unknown) => `¥${Number(n ?? 0).toLocaleString("ja-JP")}`
const dt = (v: unknown) => (v ? new Date(String(v)).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-")

const HOLD: Record<string, string> = {
  pieces_mismatch: "予約と受託の個数が違う（根拠を確かめて確定）",
  tracking_piece_mismatch: "追跡番号の数が受託の個数と違う",
  pickup_revoked: "集荷の確認が取り消された",
  amount_mismatch: "金額が料金の控えと違う",
  no_card: "カードが無い",
  no_consent: "同意の記録が無い",
  other_charge_active: "同じ予約の別の請求が処理中",
  stripe_canceled: "Stripe で取り消された",
  stripe_mismatch: "Stripe の内容が DB と違う",
}
const ERRORS: Record<string, string> = {
  operator_passkey_required: "個人のパスキーでログインしてください（共有パスワードでは操作できません）",
  note_required: "理由を入れてください",
  invalid_input: "入力が正しくありません",
  too_late: "30分の猶予を過ぎたか、請求が始まっています（誤りは返金で直してください）",
  already_confirmed: "既に集荷を確認済みです",
  already_charged: "既に請求があります",
  order_not_confirmed: "予約が確定していません",
  shipment_not_pickable: "配送の状態が集荷前ではありません",
  not_overridable: "この理由は解除できません（請求をやめるか、原因を直してください）",
  not_on_hold: "止めた請求ではありません",
  exceeds_refundable: "返金できる額を超えています",
  not_refundable: "返金できる請求ではありません",
  too_early: "最初の失敗から 14日たっていません",
  not_unpaid: "未収の請求ではありません",
  not_retryable: "再試行できる状態ではありません",
  charge_not_live: "請求の実行が止まっています（B2C_CHARGE_LIVE）",
  expired: "期限を過ぎた通知は再送できません",
  invalid_state: "状態が変わっています。再読み込みしてください",
}

interface Action {
  title: string
  path: "/api/b2c/ops/payments" | "/api/b2c/ops/outbox"
  body: Record<string, unknown>
  fields?: Array<{ key: string; label: string; type?: "number" | "select"; options?: string[] }>
  summary: string
}

function ActionPanel({ action, onClose, onDone }: { action: Action; onClose: () => void; onDone: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({})
  const [note, setNote] = useState("")
  const [step, setStep] = useState<"input" | "confirm">("input")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const run = async () => {
    setBusy(true)
    setMsg("")
    const body = { ...action.body, ...Object.fromEntries((action.fields ?? []).map((f) => [f.key, f.type === "number" ? Number(vals[f.key]) : vals[f.key]])), note }
    try {
      const res = await fetch(action.path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; result?: string; data?: unknown }
      if (j.ok) {
        setMsg(`完了: ${j.result ?? "ok"}${j.data ? ` ${JSON.stringify(j.data)}` : ""}`)
        onDone()
      } else setMsg(`できませんでした: ${ERRORS[j.error ?? ""] ?? j.error ?? res.status}${j.data ? ` ${JSON.stringify(j.data)}` : ""}`)
    } catch {
      setMsg("通信の問題。もう一度押しても二重には処理されません")
    }
    setBusy(false)
    setStep("input")
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal>
      <div className="w-full max-w-lg space-y-3 rounded-xl bg-background p-4 shadow-xl">
        <h3 className="text-lg font-semibold">{action.title}</h3>
        <p className="text-sm text-muted-foreground">{action.summary}</p>
        {(action.fields ?? []).map((f) => (
          <label key={f.key} className="block text-sm">
            {f.label}
            {f.type === "select" ? (
              <select className="mt-1 w-full rounded border p-2" value={vals[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} disabled={step === "confirm"}>
                <option value="">選んでください</option>
                {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <Input className="mt-1" type={f.type === "number" ? "number" : "text"} value={vals[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} disabled={step === "confirm"} />
            )}
          </label>
        ))}
        <label className="block text-sm">
          理由（必須・記録に残ります）
          <Input className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} disabled={step === "confirm"} />
        </label>
        {step === "confirm" ? (
          <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">
            この内容で実行します: {Object.entries(vals).map(([k, v]) => `${k}=${v}`).join(" / ")} / 理由「{note}」
          </p>
        ) : null}
        {msg ? <p className="text-sm" role="status">{msg}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>閉じる</Button>
          {step === "input" ? (
            <Button onClick={() => setStep("confirm")} disabled={!note.trim() || (action.fields ?? []).some((f) => !vals[f.key])}>確認へ</Button>
          ) : (
            <Button onClick={run} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "実行"}</Button>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, rows, empty, render }: { title: string; rows: Row[]; empty: string; render: (r: Row) => React.ReactNode }) {
  return (
    <section className="rounded-xl border p-4">
      <h2 className="mb-2 font-semibold">
        {title} <span className="text-sm text-muted-foreground">（{rows.length}件）</span>
      </h2>
      {rows.length ? <ul className="divide-y text-sm">{rows.map((r, i) => <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">{render(r)}</li>)}</ul> : <p className="text-sm text-muted-foreground">{empty}</p>}
    </section>
  )
}

export default function OperatorB2cPage() {
  const [todo, setTodo] = useState<Todo | null>(null)
  const [error, setError] = useState("")
  const [orderNo, setOrderNo] = useState("")
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [action, setAction] = useState<Action | null>(null)

  const load = useCallback(async () => {
    setError("")
    const res = await fetch("/api/b2c/ops/payments").catch(() => null)
    if (!res || !res.ok) return setError(res?.status === 401 ? "運営のログインが必要です" : "読み込めませんでした")
    setTodo(((await res.json()) as { todo: Todo }).todo)
  }, [])
  const openOrder = useCallback(async (n: string | number) => {
    setOrderNo(String(n))
    const res = await fetch(`/api/b2c/ops/payments?orderNumber=${encodeURIComponent(String(n))}`).catch(() => null)
    setDetail(res && res.ok ? ((await res.json()) as { detail: Record<string, unknown> }).detail : null)
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const refresh = () => {
    void load()
    if (orderNo) void openOrder(orderNo)
  }

  const P = "/api/b2c/ops/payments" as const
  const ev = { key: "evidenceType", label: "根拠の種類", type: "select" as const, options: ["sagawa_tracking", "sagawa_driver", "hotel_report", "other"] }
  const evRef = { key: "evidenceRef", label: "根拠（追跡番号・連絡の相手と時刻など）" }
  const orderBtn = (r: Row) => <button className="font-mono underline" onClick={() => openOrder(String(r.orderNumber))}>{String(r.orderNumber)}</button>

  const o = detail?.order as Row | undefined
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <Link href="/operator" className="flex items-center gap-1 text-sm"><ArrowLeft className="h-4 w-4" />運営</Link>
        <h1 className="text-xl font-semibold">B2C（旅行者の直接の予約）</h1>
        <Button variant="outline" size="sm" onClick={refresh}><RotateCcw className="mr-1 h-4 w-4" />再読み込み</Button>
      </div>
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void openOrder(orderNo) }}>
        <Input placeholder="受付番号" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} className="max-w-xs" />
        <Button type="submit">予約を開く</Button>
      </form>

      {todo ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="結果が分からない請求（照合中）" rows={todo.unknownCharges} empty="ありません" render={(r) => (<>
            <span>{orderBtn(r)} {String(r.kind)} {yen(r.amountYen)} / {String(r.lastError ?? "")}</span>
            <span className="text-xs text-muted-foreground">自動で照合します。新しい請求は作りません</span>
          </>)} />
          <Section title="止めた請求（運営の確認待ち）" rows={todo.heldCharges} empty="ありません" render={(r) => (<>
            <span>{orderBtn(r)} {yen(r.amountYen)}（{String(r.pieces)}個）: {HOLD[String(r.holdReason)] ?? String(r.holdReason)}</span>
            <span className="flex gap-1">
              {["pieces_mismatch", "tracking_piece_mismatch"].includes(String(r.holdReason)) ? (
                <Button size="sm" onClick={() => setAction({ title: "この内容で請求する", path: P, body: { action: "release_hold", paymentId: r.paymentId }, summary: `受付番号 ${r.orderNumber}: ${yen(r.amountYen)}（${r.pieces}個）を請求します。理由: ${HOLD[String(r.holdReason)] ?? r.holdReason}` })}>請求する</Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => setAction({ title: "請求をやめる", path: P, body: { action: "cancel_hold", paymentId: r.paymentId }, summary: `受付番号 ${r.orderNumber}: この請求（${yen(r.amountYen)}）をやめます` })}>やめる</Button>
            </span>
          </>)} />
          <Section title="未収（支払が必要）" rows={todo.unpaid} empty="ありません" render={(r) => (<>
            <span>{orderBtn(r)} {yen(r.amountYen)} / {String(r.status)} / {String(r.lastError ?? "")} / {String(r.daysUnpaid ?? 0)}日</span>
            <span className="flex gap-1">
              {r.status === "failed" ? <Button size="sm" variant="outline" onClick={() => setAction({ title: "登録済みのカードで再試行", path: P, body: { action: "retry_charge", paymentId: r.paymentId }, summary: `受付番号 ${r.orderNumber}: 同じ請求（同じ PaymentIntent）をもう一度確定します。二重には請求されません` })}>再試行</Button> : null}
              {r.canMarkUncollectible ? <Button size="sm" variant="destructive" onClick={() => setAction({ title: "回収不能にする", path: P, body: { action: "mark_uncollectible", paymentId: r.paymentId }, summary: `受付番号 ${r.orderNumber}: ${yen(r.amountYen)} を回収不能にします（案内は止まります。後で支払われれば成功に戻ります）` })}>回収不能</Button> : null}
            </span>
          </>)} />
          <Section title="請求の予定（30分の猶予）" rows={todo.scheduled} empty="ありません" render={(r) => (<>
            <span>{orderBtn(r)} {yen(r.amountYen)} / あと {String(r.minutesToCharge)}分</span>
            {Number(r.minutesToCharge) > 0 ? <Button size="sm" variant="outline" onClick={() => setAction({ title: "集荷の確認を取り消す", path: P, body: { action: "revoke_pickup", orderNumber: r.orderNumber }, summary: `受付番号 ${r.orderNumber}: 集荷の確認を取り消し、請求をやめます` })}>集荷の確認を取消</Button> : null}
          </>)} />
          <Section title="集荷の未確認（集荷日を過ぎた・当日）" rows={todo.pickupUnconfirmed} empty="ありません" render={(r) => (<>
            <span>{orderBtn(r)} 集荷 {String(r.pickupDate)} / 予約 {String(r.pieces)}個</span>
            <Button size="sm" onClick={() => setAction({ title: "集荷を確認する", path: P, body: { action: "confirm_pickup", orderNumber: r.orderNumber }, fields: [ev, evRef, { key: "acceptedPieces", label: `佐川が受託した個数（予約 ${r.pieces}個）`, type: "number" }], summary: `受付番号 ${r.orderNumber}: 集荷済みにし、30分後に受託の個数で請求します（個数が予約と違えば請求を止めて確認に回します）` })}>集荷を確認</Button>
          </>)} />
          <Section title="ホテルの確認待ち" rows={todo.awaitingHotel} empty="ありません" render={(r) => <span>{orderBtn(r)} 期限 {dt(r.dueAt)}（{String(r.mode)}）</span>} />
          <Section title="通知の要確認（届いたか不明・失敗・期限切れ）" rows={todo.notifications} empty="ありません" render={(r) => (<>
            <span>{r.orderNumber ? orderBtn(r) : "-"} {String(r.kind)} / {String(r.channel)} / {String(r.status)} / {String(r.lastError ?? "").slice(0, 60)}</span>
            <span className="flex gap-1">
              {r.status === "unknown" ? <Button size="sm" variant="outline" onClick={() => setAction({ title: "届いていた", path: "/api/b2c/ops/outbox", body: { id: r.id, resolution: "delivered" }, summary: `outbox#${r.id}: 送信サービスの記録で届いたことを確かめた` })}>届いていた</Button> : null}
              {r.status !== "expired" ? <Button size="sm" variant="outline" onClick={() => setAction({ title: "再送する", path: "/api/b2c/ops/outbox", body: { id: r.id, resolution: "resend" }, summary: `outbox#${r.id}: 同じ文面で送り直します（メールは同じ冪等キー）` })}>再送</Button> : null}
              <Button size="sm" variant="outline" onClick={() => setAction({ title: "送らない", path: "/api/b2c/ops/outbox", body: { id: r.id, resolution: "dismiss" }, summary: `outbox#${r.id}: 送らないことにします（別の手段で連絡した時など）` })}>送らない</Button>
            </span>
          </>)} />
        </div>
      ) : !error ? <Loader2 className="h-5 w-5 animate-spin" /> : null}

      {o ? (
        <section className="space-y-3 rounded-xl border p-4 text-sm" data-ops-order={String(o.order_number)}>
          <h2 className="text-lg font-semibold">受付番号 {String(o.order_number)}（{String(o.status)}）</h2>
          <p>{String(o.guest_name)} / {String(o.origin)} → {String(o.dest)} / 集荷 {String(o.pickup_date)} / 予約 {String(o.pieces)}個 / {yen(o.total_gross_yen)} / カード {String(o.card_status)}</p>
          <p>配送: {String((detail!.shipment as Row | null)?.status ?? "-")} / 追跡番号 {JSON.stringify((detail!.shipment as Row | null)?.tracking_numbers ?? [])}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setAction({ title: "集荷を確認する", path: P, body: { action: "confirm_pickup", orderNumber: o.order_number }, fields: [ev, evRef, { key: "acceptedPieces", label: `佐川が受託した個数（予約 ${o.pieces}個）`, type: "number" }], summary: "集荷済みにし、30分後に受託の個数で請求します" })}>集荷を確認</Button>
            <Button size="sm" variant="outline" onClick={() => setAction({ title: "集荷の確認を取り消す（30分以内）", path: P, body: { action: "revoke_pickup", orderNumber: o.order_number }, summary: "集荷の確認を取り消し、請求をやめます" })}>集荷の確認を取消</Button>
            <Button size="sm" variant="outline" onClick={() => setAction({ title: "請求の後に分かった個数の違い", path: P, body: { action: "correct_pieces", orderNumber: o.order_number }, fields: [{ key: "actualPieces", label: "実際の個数", type: "number" }, ev, evRef], summary: "増えた → 同じ 1個あたりの料金で追加の請求（30分後）。減った → 返金すべき額を表示（返金は別に実行）" })}>個数の訂正</Button>
          </div>
          <h3 className="font-semibold">集荷の確認</h3>
          <ul>{(detail!.pickupConfirmations as Row[]).map((c, i) => <li key={i}>{dt(c.confirmed_at)} {String(c.operator_email)} / {String(c.evidence_type)} {String(c.evidence_ref)} / 受託 {String(c.accepted_pieces)}個（予約 {String(c.booked_pieces)}個）/ {String(c.reason)}{c.revoked_at ? ` / 取消 ${dt(c.revoked_at)} ${String(c.revoked_by)}: ${String(c.revoke_reason)}` : ""}</li>)}</ul>
          <h3 className="font-semibold">請求</h3>
          <ul>{(detail!.payments as Row[]).map((p, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 border-t py-1">
              <span>{String(p.kind)} {yen(p.amount_yen)}（{String(p.pieces)}個）/ {String(p.status)}{p.hold_reason ? ` / ${HOLD[String(p.hold_reason)] ?? p.hold_reason}` : ""} / 返金済み {yen(p.refunded_yen)} / {String(p.stripe_payment_intent_id ?? "")}</span>
              {["succeeded", "partially_refunded"].includes(String(p.status)) ? <Button size="sm" variant="outline" onClick={() => setAction({ title: "返金する", path: P, body: { action: "refund", paymentId: p.id }, fields: [{ key: "amountYen", label: `返金の額（返金できる額: ${yen(Number(p.amount_yen) - Number(p.refunded_yen))}・受付中の返金を除く）`, type: "number" }], summary: `この請求（${yen(p.amount_yen)}）から返金します。合計は請求額を超えられません` })}>返金</Button> : null}
            </li>
          ))}</ul>
          <h3 className="font-semibold">返金</h3>
          <ul>{(detail!.refunds as Row[]).map((r, i) => <li key={i}>{dt(r.created_at)} {yen(r.amount_yen)} / {String(r.status)} / {String(r.requested_by)}: {String(r.reason)}</li>)}</ul>
          <h3 className="font-semibold">通知</h3>
          <ul>{(detail!.notifications as Row[]).map((n, i) => <li key={i}>{String(n.kind)} / {String(n.channel)} / {String(n.status)} {n.sent_at ? dt(n.sent_at) : ""} {n.last_error ? `/ ${String(n.last_error).slice(0, 60)}` : ""}</li>)}</ul>
          <h3 className="font-semibold">操作の履歴</h3>
          <ul>{(detail!.events as Row[]).map((e, i) => <li key={i}>{dt(e.created_at)} {String(e.event)} / {String(e.actor_type)} {String(e.operator_email ?? "")} {e.reason ? `/ ${String(e.reason)}` : ""}</li>)}</ul>
        </section>
      ) : null}

      {action ? <ActionPanel action={action} onClose={() => setAction(null)} onDone={refresh} /> : null}
    </main>
  )
}
