"use client"

// 運用担当の「今日のTODO」(2026-09-13 谷口さん・9/16 配送開始)。
// 中心はホテル連絡タスク (発送2営業日前が締切) を itemized に表示し、その場で
// 「連絡済み」にできる。送り状郵送/遅延/課金失敗などは件数チップで示し、
// クリックでダッシュボード既存の一覧フィルタ(view)へ誘導する。

import { useCallback, useEffect, useState } from "react"
import { Loader2, Phone, Mail, Check, RefreshCw } from "lucide-react"

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

interface TodoData {
  today: string
  total: number
  hotelTasks: HotelTask[]
  counts: Record<string, number>
}

const CATEGORY_LABEL: Record<string, string> = {
  "label-mail": "送り状 郵送",
  "delay-pickup": "集荷遅れ",
  "delay-delivery": "配送遅れ",
  "charge-failed": "課金失敗",
  failed: "発行失敗",
}

export default function TodayTodo({ onSelectView }: { onSelectView?: (view: string) => void }) {
  const [data, setData] = useState<TodoData | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")

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
      {(data.hotelTasks.length > 0 || categoryChips.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap px-5 py-2.5 border-b border-slate-100">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#FEF2F2] text-[#C8102E] border border-[#FECACA] px-3 py-1 text-[11px] font-semibold">
            <Phone className="w-3 h-3" strokeWidth={1.8} /> ホテル連絡 {data.hotelTasks.length}
          </span>
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

      {data.hotelTasks.length === 0 && categoryChips.length === 0 ? (
        <div className="px-5 py-6 text-center text-sm text-muted-foreground">今日のホテル連絡・対応タスクはありません 🎉</div>
      ) : (
        <div>
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
