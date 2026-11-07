"use client"

/**
 * 運営の B2C の画面のうち「ホテルの確認」（P0-1・2026-11-07）。API: /api/b2c/ops/hotel（lib/b2c/hotel-ops.ts）。
 * - 未確認の施設ごと: ホテルの情報・確認の期限・待っている予約・操作の記録。確認済み／保留／受けない。
 * - 直前予約の受入ごと: 集荷元・配送先のそれぞれ。受けた／保留／断られた／連絡がつかない。
 * 誤操作の防止: どの操作も理由が必須・実行の前に影響（確定・取消になる予約の数）を表示して確かめる。
 * 取消になる操作（受けない・断られた・連絡がつかない）は、影響を確かめたチェックが無いと実行できない。
 * 二重の操作の防止: 実行中はボタンを止め、サーバーは既に決まった施設・受入を 409 で断る（その時は一覧を読み直す）。
 * 旅行者の名前・連絡先は出さない（受付番号から予約の詳細を開く）。
 */
import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface QEvent { event: string; operatorEmail: string | null; reason: string | null; at: string; orderNumber: number }
interface QOrder { orderNumber: number; side: "origin" | "dest" | "both"; pickupDate: string; pieces: number; dueAt: string | null }
interface QFacility { placeId: string; name: string; address: string | null; postalCode: string | null; status: string; dueAt: string | null; orders: QOrder[]; events: QEvent[] }
interface QSide { placeId: string; name: string; address: string | null; status: string; decidedBy: string | null; decidedAt: string | null; note: string | null }
interface QAcceptance { orderNumber: number; pickupDate: string; pieces: number; dueAt: string | null; origin: QSide; dest: QSide; events: QEvent[] }

const dt = (v: string | null) => (v ? new Date(v).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-")
/** 期限までの残り。過ぎた・3時間未満は赤 */
function Due({ at, now }: { at: string | null; now: number }) {
  if (!at) return <span>期限なし</span>
  const min = Math.round((Date.parse(at) - now) / 60_000)
  const left = min <= 0 ? "期限切れ（定期の処理で自動の取消になります）" : min < 60 ? `あと ${min}分` : `あと ${Math.floor(min / 60)}時間${min % 60 ? `${min % 60}分` : ""}`
  return <span className={min < 180 ? "font-semibold text-red-700" : ""} data-due-left={min}>期限 {dt(at)}（{left}）</span>
}
const SIDE: Record<string, string> = { origin: "集荷元", dest: "配送先", both: "集荷元と配送先" }
const EVENT: Record<string, string> = {
  facility_verified: "確認済みにした", facility_unsupported: "受けないにした", facility_hold: "保留",
  hotel_origin_accepted: "集荷元: 受けた", hotel_origin_refused: "集荷元: 断られた", hotel_origin_no_answer: "集荷元: 連絡がつかない", hotel_origin_hold: "集荷元: 保留",
  hotel_dest_accepted: "配送先: 受けた", hotel_dest_refused: "配送先: 断られた", hotel_dest_no_answer: "配送先: 連絡がつかない", hotel_dest_hold: "配送先: 保留",
}
const ACC: Record<string, string> = { pending: "未回答", accepted: "受けた", refused: "断られた", no_answer: "連絡がつかない" }
const ERR: Record<string, string> = {
  operator_passkey_required: "個人のパスキーでログインしてください（共有パスワードでは見られません・操作できません）",
  note_required: "確認の方法・相手・理由を入れてください",
  invalid_input: "入力が正しくありません",
  state_changed: "既に他の操作で状態が変わっています。一覧を読み直しました",
  already_decided: "この側は既に記録済みです（上書きしません）。一覧を読み直しました",
  nothing_waiting: "このホテルで確認を待っている予約はありません。一覧を読み直しました",
  facility_not_found: "ホテルが見つかりません",
  order_not_found: "予約が見つかりません",
  not_late_booking: "直前予約ではありません",
}
const mapsUrl = (name: string, placeId: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${encodeURIComponent(placeId)}`

interface Op {
  title: string
  body: Record<string, unknown>
  impact: string
  /** 取消・通知が起きる操作（影響を確かめたチェックが必須・赤いボタン） */
  destructive: boolean
}

function OpDialog({ op, onClose, onDone }: { op: Op; onClose: () => void; onDone: (msg: string, reload: boolean) => void }) {
  const [note, setNote] = useState("")
  const [step, setStep] = useState<"input" | "confirm">("input")
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const run = async () => {
    if (busy) return
    setBusy(true)
    setMsg("")
    try {
      const res = await fetch("/api/b2c/ops/hotel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...op.body, note }) })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; confirmed?: number[]; cancelled?: number[]; stillWaiting?: number[] }
      if (j.ok) {
        const parts = [j.confirmed?.length ? `確定 ${j.confirmed.join(", ")}` : "", j.cancelled?.length ? `取消 ${j.cancelled.join(", ")}` : "", j.stillWaiting?.length ? `まだ確認待ち ${j.stillWaiting.join(", ")}` : ""].filter(Boolean)
        onDone(`完了: ${op.title}${parts.length ? `（${parts.join(" / ")}）` : ""}`, true)
        return
      }
      const m = ERR[j.error ?? ""] ?? `できませんでした（${j.error ?? res.status}）`
      if (res.status === 409) { onDone(m, true); return }
      setMsg(m)
    } catch {
      setMsg("通信の問題。一覧を読み直してから、もう一度操作してください（決まった操作は二重には記録されません）")
    }
    setBusy(false)
    setStep("input")
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal aria-labelledby="hotel-op-title">
      <div className="w-full max-w-lg space-y-3 rounded-xl bg-background p-4 shadow-xl">
        <h3 id="hotel-op-title" className="text-lg font-semibold">{op.title}</h3>
        <p className="text-sm text-muted-foreground" data-op-impact>{op.impact}</p>
        <label className="block text-sm">
          確認の方法・相手・理由（必須・記録に残ります）
          <Input className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} disabled={step === "confirm" || busy} placeholder="例: 11/7 14:10 フロントの山本さんに電話で確認。荷物の預かり可" />
        </label>
        {op.destructive ? (
          <label className="flex items-start gap-2 rounded bg-red-50 p-2 text-sm text-red-900">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} className="mt-1" />
            <span>上の予約が取り消され、旅行者に取消の通知が送られることを確かめました（元に戻せません）</span>
          </label>
        ) : null}
        {step === "confirm" ? <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">この内容で実行します: {op.title} / 理由「{note.trim()}」</p> : null}
        {msg ? <p className="text-sm text-red-700" role="alert">{msg}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>閉じる</Button>
          {step === "input" ? (
            <Button onClick={() => setStep("confirm")} disabled={!note.trim() || (op.destructive && !ack)}>確認へ</Button>
          ) : (
            <Button variant={op.destructive ? "destructive" : "default"} onClick={run} disabled={busy || (op.destructive && !ack)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "実行"}</Button>
          )}
        </div>
      </div>
    </div>
  )
}

function History({ events }: { events: QEvent[] }) {
  if (!events.length) return null
  return (
    <details className="text-xs text-muted-foreground">
      <summary>操作の記録（{events.length}件）</summary>
      <ul className="mt-1 space-y-0.5">
        {events.map((e, i) => <li key={i}>{dt(e.at)} {EVENT[e.event] ?? e.event} / {e.operatorEmail ?? "-"} / 受付番号 {e.orderNumber}{e.reason ? ` / ${e.reason}` : ""}</li>)}
      </ul>
    </details>
  )
}

export function HotelPanel({ onOpenOrder, onChanged }: { onOpenOrder: (n: number) => void; onChanged: () => void }) {
  const [facilities, setFacilities] = useState<QFacility[] | null>(null)
  const [acceptances, setAcceptances] = useState<QAcceptance[]>([])
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [op, setOp] = useState<Op | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const load = useCallback(async () => {
    setError("")
    const res = await fetch("/api/b2c/ops/hotel").catch(() => null)
    if (!res) return setError("読み込めませんでした")
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; facilities?: QFacility[]; acceptances?: QAcceptance[] }
    if (!j.ok) return setError(ERR[j.error ?? ""] ?? "読み込めませんでした")
    setFacilities(j.facilities ?? [])
    setAcceptances(j.acceptances ?? [])
    setNow(Date.now())
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const done = (m: string, reload: boolean) => {
    setOp(null)
    setNotice(m)
    if (reload) { void load(); onChanged() }
  }
  const nums = (os: QOrder[]) => os.map((o) => o.orderNumber).join(", ")

  return (
    <section className="space-y-3 rounded-xl border p-4 lg:col-span-2" data-ops-hotel>
      <h2 className="font-semibold">
        ホテルの確認待ち <span className="text-sm text-muted-foreground">（施設 {facilities?.length ?? 0}件・直前予約の受入 {acceptances.length}件）</span>
      </h2>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="text-sm">{notice}</p> : null}
      {!facilities && !error ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {facilities && !facilities.length && !acceptances.length ? <p className="text-sm text-muted-foreground">ありません</p> : null}

      {(facilities ?? []).map((f) => (
        <article key={f.placeId} className="space-y-2 rounded-lg border p-3 text-sm" data-facility={f.placeId}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">{f.name}</h3>
            <Due at={f.dueAt} now={now} />
          </div>
          <p className="text-muted-foreground">
            {f.postalCode ? `〒${f.postalCode.slice(0, 3)}-${f.postalCode.slice(3)} ` : ""}{f.address ?? "住所なし"} /{" "}
            <a className="underline" href={mapsUrl(f.name, f.placeId)} target="_blank" rel="noopener noreferrer">地図</a> / 状態: 未確認
          </p>
          <p>確認すること: フロントに人がいて、集荷の日に荷物を預かれるか（預かりの時間・置き場所）</p>
          <ul className="space-y-0.5">
            {f.orders.map((o) => (
              <li key={o.orderNumber}>
                <button className="font-mono underline" onClick={() => onOpenOrder(o.orderNumber)}>{o.orderNumber}</button> {SIDE[o.side]} / 集荷 {o.pickupDate} / {o.pieces}個 / <Due at={o.dueAt} now={now} />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setOp({ title: `${f.name} を確認済みにする`, body: { action: "facility", placeId: f.placeId, status: "verified" }, destructive: false, impact: `このホテルを「荷物を預かれる」と記録し、待っている予約（受付番号 ${nums(f.orders)}）を確定します。もう一方のホテルが未確認の予約は確認待ちのままです。` })}>確認済みにする</Button>
            <Button size="sm" variant="outline" onClick={() => setOp({ title: `${f.name} を保留にする`, body: { action: "facility", placeId: f.placeId, status: "hold" }, destructive: false, impact: "状態は未確認のまま、確認の途中であること（折り返し待ちなど）を記録します。期限は延びません。期限を過ぎると自動で取消になります。" })}>保留</Button>
            <Button size="sm" variant="destructive" onClick={() => setOp({ title: `${f.name} を受けないにする`, body: { action: "facility", placeId: f.placeId, status: "unsupported" }, destructive: true, impact: `このホテルを「受けない」と記録し、待っている予約（受付番号 ${nums(f.orders)}・${f.orders.length}件）を取り消して旅行者に通知します（請求はありません）。今後このホテルでは予約できません。` })}>受けない</Button>
          </div>
          <History events={f.events} />
        </article>
      ))}

      {acceptances.map((a) => (
        <article key={a.orderNumber} className="space-y-2 rounded-lg border p-3 text-sm" data-acceptance={a.orderNumber}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">直前予約の受入 <button className="font-mono underline" onClick={() => onOpenOrder(a.orderNumber)}>{a.orderNumber}</button> / 集荷 {a.pickupDate} / {a.pieces}個</h3>
            <Due at={a.dueAt} now={now} />
          </div>
          {(["origin", "dest"] as const).map((s) => {
            const x = a[s]
            const pending = x.status === "pending"
            return (
              <div key={s} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2" data-side={s}>
                <span>
                  {SIDE[s]}: {x.name}（<a className="underline" href={mapsUrl(x.name, x.placeId)} target="_blank" rel="noopener noreferrer">地図</a>） / <b>{ACC[x.status] ?? x.status}</b>
                  {x.decidedBy ? ` / ${x.decidedBy} ${dt(x.decidedAt)}` : ""}{x.note ? ` / ${x.note}` : ""}
                </span>
                {pending ? (
                  <span className="flex flex-wrap gap-1">
                    <Button size="sm" onClick={() => setOp({ title: `受付番号 ${a.orderNumber} の${SIDE[s]}が受けた`, body: { action: "acceptance", orderNumber: a.orderNumber, side: s, status: "accepted" }, destructive: false, impact: `${SIDE[s]}（${x.name}）の受入を記録します。両方そろうと予約を確定します。` })}>受けた</Button>
                    <Button size="sm" variant="outline" onClick={() => setOp({ title: `受付番号 ${a.orderNumber} の${SIDE[s]}を保留`, body: { action: "acceptance", orderNumber: a.orderNumber, side: s, status: "hold" }, destructive: false, impact: "未回答のまま、確認の途中であることを記録します。期限は延びません。" })}>保留</Button>
                    <Button size="sm" variant="destructive" onClick={() => setOp({ title: `受付番号 ${a.orderNumber} の${SIDE[s]}に断られた`, body: { action: "acceptance", orderNumber: a.orderNumber, side: s, status: "refused" }, destructive: true, impact: `受付番号 ${a.orderNumber} を取り消して旅行者に通知します（請求はありません）。` })}>断られた</Button>
                    <Button size="sm" variant="destructive" onClick={() => setOp({ title: `受付番号 ${a.orderNumber} の${SIDE[s]}に連絡がつかない`, body: { action: "acceptance", orderNumber: a.orderNumber, side: s, status: "no_answer" }, destructive: true, impact: `受付番号 ${a.orderNumber} を取り消して旅行者に通知します（請求はありません）。` })}>連絡がつかない</Button>
                  </span>
                ) : null}
              </div>
            )
          })}
          <History events={a.events} />
        </article>
      ))}
      {op ? <OpDialog op={op} onClose={() => setOp(null)} onDone={done} /> : null}
    </section>
  )
}
