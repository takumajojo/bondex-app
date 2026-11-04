"use client"

// 運用担当の「今日のTODO」(2026-09-13 谷口さん・9/16 配送開始)。
// 中心はホテル連絡タスク (発送2営業日前が締切) を itemized に表示し、その場で
// 「連絡済み」にできる。送り状郵送/遅延/課金失敗などは件数チップで示し、
// クリックでダッシュボード既存の一覧フィルタ(view)へ誘導する。

import { useCallback, useEffect, useState } from "react"
import { Loader2, Phone, Mail, Check, RefreshCw } from "lucide-react"
import PickupRequestPanel, { OperatorNameInput, useOperatorName } from "./PickupRequestPanel"

interface HotelTask {
  shipmentId: string
  bookingId: string
  legIndex: number
  representative: string
  tourNumber: string | null
  route: "pickup" | "guest"
  routeLabel: string
  hotel: string
  hotelJa: string | null
  deadline: string | null
  urgency: string
  method: string
  value: string
  memo: string
  firstTime: boolean
}

interface SagawaPickupTask {
  shipmentId: string
  bookingId: string
  legIndex: number
  representative: string
  tourNumber: string | null
  fromHotel: string
  fromHotelJa: string | null
  shipmentDate: string
  suitcaseCount?: number
  /** Biz-Logi で送れない理由 (20個以上・団体)。手動 (Excel) で手配する */
  manualOnlyReason?: string | null
  lastFailure?: { error: string | null; at: string } | null
  /** overdue=当日以前 / due=明日発送 (今日20時締め) / upcoming=2日後以降 */
  urgency: string
  cutoffAt?: string | null
}

interface PickupAttentionTask extends SagawaPickupTask {
  kind: string
  requestId: string
  channel: string
  state: string
  changes?: string[]
  shippingNumber?: string | null
}

const ATTENTION_LABEL: Record<string, string> = {
  unknown: "結果不明・再送禁止",
  stale_sending: "送信中のまま止まっている",
  cancel_needed: "取消した区間に依頼が残っている",
  needs_review: "依頼済みか不明",
  change_pending: "変更・取消の返信待ち",
  changed_after_request: "依頼後に内容が変わった・世田谷へ変更連絡",
  record_missing: "問合番号はあるが依頼の記録なし（Excel で重ねて依頼しない）",
  hotel_change_requested: "受付後の変更を登録済み・世田谷へ未連絡",
  hotel_change_approved: "佐川が変更を承認・BondEx へ未反映",
}

interface TodoData {
  today: string
  total: number
  hotelTasks: HotelTask[]
  sagawaPickupTasks?: SagawaPickupTask[]
  pickupAttention?: PickupAttentionTask[]
  pickupLegacyMode?: boolean
  pickupError?: string | null
  counts: Record<string, number>
}

const CATEGORY_LABEL: Record<string, string> = {
  "label-mail": "送り状 郵送",
  "delay-pickup": "集荷遅れ",
  "delay-delivery": "配送遅れ",
  "charge-failed": "課金失敗",
  failed: "手配失敗",
}

export default function TodayTodo({ onSelectView }: { onSelectView?: (view: string) => void }) {
  const [data, setData] = useState<TodoData | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const [actor, setActor] = useOperatorName()

  const load = useCallback(async () => {
    setError("")
    try {
      const res = await fetch("/api/operator/today-todo")
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "読み込みに失敗しました")
      setData(d as TodoData)
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const markContacted = async (t: HotelTask) => {
    setBusy(t.shipmentId + t.route)
    try {
      const res = await fetch("/api/shipments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          t.route === "pickup"
            ? { id: t.shipmentId, pickupHotelNotified: true }
            : { id: t.shipmentId, guestHotelNotified: true },
        ),
      })
      if (!res.ok) throw new Error("更新に失敗しました")
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました")
    }
    setBusy("")
  }

  const markPickupRequested = async (t: SagawaPickupTask) => {
    if (!actor.trim()) {
      setError("担当者名を入力してください (集荷依頼の記録に残します)")
      return
    }
    setBusy("pk-" + t.shipmentId)
    try {
      const res = await fetch("/api/operator/sagawa-pickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipmentId: t.shipmentId, actor }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "更新に失敗しました")
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました")
    }
    setBusy("")
  }

  if (error && !data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
    )
  }
  if (!data) {
    return (
      <div className="rounded-2xl border border-border bg-white p-4">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.6} /> 今日のTODOを読み込み中…
        </p>
      </div>
    )
  }

  const dateLabel = (() => {
    const d = new Date(`${data.today}T00:00:00+09:00`)
    const w = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()]
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${w}）`
  })()

  const overdue = data.hotelTasks.filter((t) => t.urgency === "overdue" || t.urgency === "urgent")
  const dueToday = data.hotelTasks.filter((t) => t.urgency === "due")

  const sagawaPickups = data.sagawaPickupTasks ?? []
  const pkOverdue = sagawaPickups.filter((t) => t.urgency === "overdue")
  const pkDue = sagawaPickups.filter((t) => t.urgency === "due")
  const pkUpcoming = sagawaPickups.filter((t) => t.urgency === "upcoming")
  const attention = data.pickupAttention ?? []
  const hasPickup = sagawaPickups.length > 0 || attention.length > 0 || !!data.pickupError

  const categoryChips = Object.entries(CATEGORY_LABEL)
    .map(([view, label]) => ({ view, label, count: data.counts[view] ?? 0 }))
    .filter((c) => c.count > 0)

  return (
    <div className="rounded-2xl border border-border bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
        <div>
          <p className="text-base font-bold text-foreground">今日のTODO</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{dateLabel}・運用担当が今日やること</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => void load()} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.6} /> 更新
          </button>
          <div className="text-right">
            <p className="text-xl font-bold text-[#C8102E] leading-none tabular-nums">{data.total}</p>
            <p className="text-[10px] text-muted-foreground">未完</p>
          </div>
        </div>
      </div>

      {/* カテゴリチップ (件数・クリックで一覧フィルタへ) */}
      {(data.hotelTasks.length > 0 || hasPickup || categoryChips.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap px-5 py-2.5 border-b border-slate-100">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#FEF2F2] text-[#C8102E] border border-[#FECACA] px-3 py-1 text-[11px] font-semibold">
            <Phone className="w-3 h-3" strokeWidth={1.8} /> ホテル連絡 {data.hotelTasks.length}
          </span>
          {sagawaPickups.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1 text-[11px] font-semibold">
              🚚 佐川集荷依頼 {sagawaPickups.length}
            </span>
          )}
          {attention.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 text-red-700 border border-red-200 px-3 py-1 text-[11px] font-semibold">
              集荷依頼の要確認 {attention.length}
            </span>
          )}
          {categoryChips.map((c) => (
            <button
              key={c.view}
              onClick={() => onSelectView?.(c.view)}
              className="rounded-full bg-slate-50 text-slate-700 border border-border px-3 py-1 text-[11px] hover:bg-slate-100"
            >
              {c.label} {c.count}
            </button>
          ))}
        </div>
      )}

      {data.hotelTasks.length === 0 && !hasPickup && categoryChips.length === 0 ? (
        <div className="px-5 py-6 text-center text-sm text-muted-foreground">今日のホテル連絡・対応タスクはありません 🎉</div>
      ) : (
        <div>
          {hasPickup && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-3 pb-1">
              <span className="text-[11px] font-bold text-blue-700">🚚 佐川へ集荷依頼（集荷前日 20:00 締め）</span>
              <OperatorNameInput value={actor} onChange={setActor} />
            </div>
          )}
          {data.pickupError && <div className="px-5 py-2 text-[12px] text-red-700">集荷依頼の一覧を読み込めません: {data.pickupError}</div>}
          {data.pickupLegacyMode && (
            <div className="px-5 py-1 text-[11px] text-amber-700">集荷依頼の記録 (sql/067) が未適用のため、従来の「依頼済み」印で判定しています。</div>
          )}
          {attention.length > 0 && (
            <>
              <div className="px-5 pt-2 pb-1 text-[11px] font-bold text-red-700">要確認（再送せず、佐川に確認してから記録）</div>
              {attention.map((t) => (
                <div key={`${t.shipmentId}-${t.kind}`} className="px-5 py-2 border-t border-slate-100">
                  <p className="mb-1 text-[11px]">
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">{ATTENTION_LABEL[t.kind] ?? t.kind}</span>{" "}
                    <span className="font-mono">{t.bookingId}-L{t.legIndex + 1}</span>　発送 {t.shipmentDate}　{t.fromHotelJa || t.fromHotel}
                  </p>
                  {t.changes && t.changes.length > 0 && (
                    <p className="mb-1 text-[11px] text-red-700">
                      変わった項目: {t.changes.join("・")}。佐川の依頼は古い内容のままです。世田谷営業所へ連絡し、返信を受けたら「変更が反映された」を記録してください。
                    </p>
                  )}
                  {t.kind === "record_missing" && (
                    <p className="mb-1 text-[11px] text-red-700">佐川の問合番号 {t.shippingNumber} が入力済みです。下の「佐川指定 Excel で依頼済みにする」で記録してください（Biz-Logi からは送れません）。</p>
                  )}
                  <PickupRequestPanel shipmentId={t.shipmentId} legLabel={`${t.bookingId}-L${t.legIndex + 1}`} actor={actor} onChanged={() => void load()} />
                </div>
              ))}
            </>
          )}
          {pkOverdue.map((t) => (
            <SagawaPickupRow key={t.shipmentId} t={t} overdue busy={busy} actor={actor} onDone={markPickupRequested} onChanged={() => void load()} />
          ))}
          {pkDue.map((t) => (
            <SagawaPickupRow key={t.shipmentId} t={t} busy={busy} actor={actor} onDone={markPickupRequested} onChanged={() => void load()} />
          ))}
          {pkUpcoming.length > 0 && (
            <>
              <div className="px-5 pt-3 pb-1 text-[11px] font-bold text-slate-600">今後7日以内の未依頼（早めの依頼も可）</div>
              {pkUpcoming.map((t) => (
                <SagawaPickupRow key={t.shipmentId} t={t} busy={busy} actor={actor} onDone={markPickupRequested} onChanged={() => void load()} />
              ))}
            </>
          )}
          {overdue.length > 0 && (
            <>
              <div className="px-5 pt-3 pb-1 text-[11px] font-bold text-red-700">🔴 期限超過（今すぐ）</div>
              {overdue.map((t) => (
                <HotelTaskRow key={t.shipmentId + t.route} t={t} busy={busy} onContacted={markContacted} />
              ))}
            </>
          )}
          {dueToday.length > 0 && (
            <>
              <div className="px-5 pt-3 pb-1 text-[11px] font-bold text-amber-700 border-t border-slate-100">🟠 本日締切</div>
              {dueToday.map((t) => (
                <HotelTaskRow key={t.shipmentId + t.route} t={t} busy={busy} onContacted={markContacted} />
              ))}
            </>
          )}
          {data.hotelTasks.length === 0 && categoryChips.length > 0 && (
            <div className="px-5 py-4 text-[12px] text-muted-foreground">
              ホテル連絡タスクはありません。上のチップから他の対応（{categoryChips.map((c) => c.label).join("・")}）を確認してください。
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function HotelTaskRow({
  t,
  busy,
  onContacted,
}: {
  t: HotelTask
  busy: string
  onContacted: (t: HotelTask) => void
}) {
  const hotelName = t.hotelJa || t.hotel
  const deadlineText = t.urgency === "overdue" ? `${t.deadline} 締切・超過` : t.urgency === "due" ? `本日 ${t.deadline} 締切` : `${t.deadline} 締切`
  const methodIcon = t.method === "email" ? <Mail className="w-3 h-3" strokeWidth={1.8} /> : <Phone className="w-3 h-3" strokeWidth={1.8} />
  const contactText = t.value ? `${t.method === "email" ? "✉" : "📞"} ${t.value}` : "連絡先 未登録"
  const isBusy = busy === t.shipmentId + t.route

  return (
    <div className="flex items-start gap-3 px-5 py-3 border-t border-slate-100">
      <div className="flex-1 min-w-0">
        <div className="flex items-center flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded bg-[#FEF2F2] text-[#C8102E] px-2 py-0.5 text-[10px] font-bold">
            {methodIcon} ホテルへ{t.method === "email" ? "メール" : "連絡"}
          </span>
          {t.firstTime && (
            <span className="rounded bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-bold">初めてのホテル</span>
          )}
          <span className={`text-[10px] font-semibold ${t.urgency === "due" ? "text-amber-700" : "text-red-700"}`}>{deadlineText}</span>
        </div>
        <p className="mt-1 text-sm font-semibold text-foreground truncate">
          {hotelName} <span className="text-[11px] font-normal text-muted-foreground">（{t.routeLabel}）</span>
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
          {t.bookingId} · {t.representative} 様{t.tourNumber ? ` · ${t.tourNumber}` : ""} ·{" "}
          <span className={t.value ? "text-foreground font-medium" : "text-red-600 font-medium"}>{contactText}</span>
        </p>
        {t.memo && (
          <p className="mt-1 inline-block rounded bg-amber-50 border-l-2 border-amber-400 px-2 py-0.5 text-[10px] text-amber-800">メモ：{t.memo}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <button
          onClick={() => onContacted(t)}
          disabled={isBusy}
          className="inline-flex items-center gap-1 rounded-lg bg-[#C8102E] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#a60d26] disabled:opacity-50"
        >
          {isBusy ? <Loader2 className="w-3 h-3 animate-spin" strokeWidth={1.8} /> : <Check className="w-3 h-3" strokeWidth={2} />}
          連絡済みにする
        </button>
        <a href={`/operator/bookings/${encodeURIComponent(t.bookingId)}`} className="text-[11px] text-blue-600 hover:underline">
          詳細 →
        </a>
      </div>
    </div>
  )
}

// 佐川への集荷依頼タスク1行 (未依頼の区間)。
// 「Excel で依頼済みにする」で手動依頼として記録 (pickup_requests・sql/067)。「詳細・Biz-Logi」で依頼パネルを開く。
function SagawaPickupRow({
  t,
  overdue,
  busy,
  actor,
  onDone,
  onChanged,
}: {
  t: SagawaPickupTask
  overdue?: boolean
  busy: string
  actor: string
  onDone: (t: SagawaPickupTask) => void
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const isBusy = busy === "pk-" + t.shipmentId
  const md = (() => {
    const d = new Date(`${t.shipmentDate}T00:00:00+09:00`)
    return `${d.getMonth() + 1}/${d.getDate()}`
  })()
  const badge =
    t.urgency === "overdue" || overdue ? (
      <span className="rounded bg-red-100 text-red-700 px-1.5 py-0.5 text-[10px] font-bold">本日発送・締め超過（世田谷へ相談）</span>
    ) : t.urgency === "due" ? (
      <span className="rounded bg-blue-100 text-blue-700 px-1.5 py-0.5 text-[10px] font-bold">明日発送・今日20:00締め</span>
    ) : (
      <span className="rounded bg-slate-100 text-slate-700 px-1.5 py-0.5 text-[10px] font-bold">未依頼</span>
    )
  return (
    <div className="px-5 py-3 border-t border-slate-100">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="font-mono text-[12px] font-medium text-foreground">
              {t.bookingId}-L{t.legIndex + 1}
            </span>
            {badge}
            <span className="text-[11px] text-muted-foreground">発送 {md}</span>
            {t.suitcaseCount ? <span className="text-[11px] text-muted-foreground">・{t.suitcaseCount}個</span> : null}
            {t.manualOnlyReason ? (
              <span title={t.manualOnlyReason} className="rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] font-bold">手動手配のみ（佐川へ事前連絡）</span>
            ) : null}
            {t.lastFailure ? (
              <span title={t.lastFailure.error ?? ""} className="rounded bg-red-100 text-red-800 px-1.5 py-0.5 text-[10px] font-bold">前回の依頼は佐川が受付せず（未依頼）</span>
            ) : null}
            {t.tourNumber && <span className="text-[11px] text-muted-foreground">・ツアー {t.tourNumber}</span>}
          </div>
          <p className="mt-0.5 text-[12px] text-foreground">
            集荷場所：{t.fromHotelJa || t.fromHotel}
            {t.representative ? <span className="text-muted-foreground">（{t.representative} 様）</span> : null}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <button
            onClick={() => onDone(t)}
            disabled={isBusy}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isBusy ? <Loader2 className="w-3 h-3 animate-spin" strokeWidth={1.8} /> : <Check className="w-3 h-3" strokeWidth={2} />}
            Excelで依頼済みにする
          </button>
          <button onClick={() => setOpen((v) => !v)} className="text-[11px] text-blue-600 hover:underline">
            {open ? "閉じる" : "詳細・Biz-Logi →"}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-2">
          <PickupRequestPanel shipmentId={t.shipmentId} legLabel={`${t.bookingId}-L${t.legIndex + 1}`} actor={actor} onChanged={onChanged} />
          <a href={`/operator/bookings/${encodeURIComponent(t.bookingId)}`} className="mt-1 inline-block text-[11px] text-blue-600 hover:underline">
            予約の詳細 →
          </a>
        </div>
      )}
    </div>
  )
}
