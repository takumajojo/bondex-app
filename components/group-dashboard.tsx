"use client"

// 団体ダッシュボード "Tour Luggage Control Center"。
// 運営 (/operator/groups/[id]) と代理店 (/agency/groups/[id]) の共有ビュー。
//
// 設計原則 (仕様):
//  - Issue First: 問題のある荷物を最上部に固定表示。正常の緑を大量に見せない。
//  - まず全体 (何個中何個届いたか) → 次に個別。追跡番号は主役にしない。
//  - 30〜45個を1画面で。モバイルはテーブルでなくカード表示に切替。

import { useMemo, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Pencil,
  Phone,
  RefreshCw,
  Search,
  Truck,
  X,
} from "lucide-react"
import type { GroupViewPayload, LuggageView } from "@/lib/group-view"
import type { LuggageStatus } from "@/lib/group-luggage-db"

type Locale = "ja" | "en"

const T = {
  ja: {
    guests: "名",
    bags: "個",
    pickup: "集荷",
    delivery: "到着予定",
    leader: "添乗員",
    total: "全荷物",
    delivered: "配達完了",
    inTransit: "輸送中",
    pending: "未集荷",
    issue: "要対応",
    cancelled: "キャンセル",
    progress: "配達進捗",
    deliveredOf: (d: number, t: number) => `${d} / ${t} 配達完了`,
    issueBanner: (n: number) => `${n} 個の荷物に確認が必要です`,
    all: "すべて",
    searchPh: "ゲスト名・荷物番号・追跡番号で検索",
    colNo: "No.",
    colGuest: "ゲスト",
    colLeg: "区間",
    colTracking: "追跡番号",
    colStatus: "状態",
    colUpdated: "最終更新",
    noLuggage: "荷物リストが未登録です。",
    noMatch: "該当する荷物がありません。",
    edit: "編集",
    unnamed: "（名前未登録）",
    updated: "更新",
    st: {
      pending: "未集荷",
      issued: "発行済",
      picked_up: "集荷済",
      in_transit: "輸送中",
      delivered: "配達完了",
      issue: "要対応",
      cancelled: "キャンセル",
    } as Record<string, string>,
    groupSt: {
      preparing: "準備中",
      in_transit: "輸送中",
      partially_delivered: "一部配達済",
      delivered: "全件配達完了",
      issue: "要対応あり",
      cancelled: "キャンセル",
    } as Record<string, string>,
    // 編集モーダル
    editTitle: "荷物を編集",
    guestName: "ゲスト名",
    trackingNumber: "追跡番号（貼り替えた場合のみ上書き）",
    trackingAuto: "空欄 = 発行時の連番どおり自動対応",
    manualStatus: "状態の手動上書き",
    manualAuto: "自動（追跡に従う）",
    issueNote: "要対応メモ",
    notes: "メモ",
    save: "保存",
    cancel: "キャンセル",
    saveFailed: "保存に失敗しました",
  },
  en: {
    guests: "guests",
    bags: "bags",
    pickup: "Pickup",
    delivery: "Expected delivery",
    leader: "Tour leader",
    total: "Total",
    delivered: "Delivered",
    inTransit: "In transit",
    pending: "Pending",
    issue: "Issue",
    cancelled: "Cancelled",
    progress: "Delivery progress",
    deliveredOf: (d: number, t: number) => `${d} / ${t} delivered`,
    issueBanner: (n: number) => `${n} luggage item${n > 1 ? "s" : ""} require${n > 1 ? "" : "s"} attention`,
    all: "All",
    searchPh: "Search guest, bag no., or tracking number",
    colNo: "No.",
    colGuest: "Guest",
    colLeg: "Leg",
    colTracking: "Tracking",
    colStatus: "Status",
    colUpdated: "Updated",
    noLuggage: "No luggage list registered yet.",
    noMatch: "No luggage matches.",
    edit: "Edit",
    unnamed: "(unnamed)",
    updated: "Updated",
    st: {
      pending: "Pending",
      issued: "Issued",
      picked_up: "Picked up",
      in_transit: "In transit",
      delivered: "Delivered",
      issue: "Issue",
      cancelled: "Cancelled",
    } as Record<string, string>,
    groupSt: {
      preparing: "Preparing",
      in_transit: "In transit",
      partially_delivered: "Partially delivered",
      delivered: "Delivered",
      issue: "Needs attention",
      cancelled: "Cancelled",
    } as Record<string, string>,
    editTitle: "Edit luggage",
    guestName: "Guest name",
    trackingNumber: "Tracking number (override only if relabeled)",
    trackingAuto: "Blank = auto-mapped to label sequence",
    manualStatus: "Manual status override",
    manualAuto: "Auto (follow tracking)",
    issueNote: "Issue note",
    notes: "Notes",
    save: "Save",
    cancel: "Cancel",
    saveFailed: "Failed to save",
  },
} as const

const STATUS_CLS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  issued: "bg-blue-100 text-blue-800",
  picked_up: "bg-amber-100 text-amber-800",
  in_transit: "bg-indigo-100 text-indigo-800",
  delivered: "bg-emerald-100 text-emerald-800",
  issue: "bg-red-100 text-red-800",
  cancelled: "bg-zinc-200 text-zinc-600",
}
const GROUP_STATUS_CLS: Record<string, string> = {
  preparing: "bg-slate-100 text-slate-700",
  in_transit: "bg-indigo-100 text-indigo-800",
  partially_delivered: "bg-amber-100 text-amber-800",
  delivered: "bg-emerald-100 text-emerald-800",
  issue: "bg-red-100 text-red-800",
  cancelled: "bg-zinc-200 text-zinc-600",
}

type Filter = "all" | "delivered" | "in_transit" | "pending" | "issue"

function fmtTime(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

export function GroupDashboard({
  data,
  locale,
  canOperate,
  onPatch,
  onReload,
}: {
  data: GroupViewPayload
  locale: Locale
  /** true=運営 (追跡番号の付け替え・状態の手動上書きが可能)。代理店はゲスト名/メモのみ。 */
  canOperate: boolean
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>
  onReload: () => void
}) {
  const t = T[locale]
  const [filter, setFilter] = useState<Filter>("all")
  const [q, setQ] = useState("")
  const [editTarget, setEditTarget] = useState<LuggageView | null>(null)

  const issues = data.luggage.filter((l) => l.status === "issue")

  const filtered = useMemo(() => {
    let rows = data.luggage
    if (filter === "delivered") rows = rows.filter((l) => l.status === "delivered")
    else if (filter === "in_transit") rows = rows.filter((l) => l.status === "in_transit" || l.status === "picked_up")
    else if (filter === "pending") rows = rows.filter((l) => l.status === "pending")
    else if (filter === "issue") rows = rows.filter((l) => l.status === "issue")
    const query = q.trim().toLowerCase()
    if (query) {
      rows = rows.filter(
        (l) =>
          l.guestName.toLowerCase().includes(query) ||
          String(l.luggageNo).includes(query) ||
          `bg-${String(l.luggageNo).padStart(3, "0")}`.includes(query) ||
          (l.trackingNumber ?? "").toLowerCase().includes(query),
      )
    }
    // Issue First: 要対応を常に先頭へ
    return [...rows].sort((a, b) => (a.status === "issue" ? -1 : 0) - (b.status === "issue" ? -1 : 0) || a.legIndex - b.legIndex || a.luggageNo - b.luggageNo)
  }, [data.luggage, filter, q])

  const s = data.summary
  const legRoute =
    data.legs.length > 0
      ? `${data.legs[0].fromHotel} → ${data.legs[data.legs.length - 1].toHotel}`
      : ""

  const tiles: { key: Filter; label: string; count: number; cls: string; active: string }[] = [
    { key: "all", label: t.total, count: s.total, cls: "bg-white border-border", active: "ring-foreground" },
    { key: "delivered", label: t.delivered, count: s.delivered, cls: "bg-emerald-50 border-emerald-200 text-emerald-900", active: "ring-emerald-500" },
    { key: "in_transit", label: t.inTransit, count: s.inTransit, cls: "bg-indigo-50 border-indigo-200 text-indigo-900", active: "ring-indigo-500" },
    { key: "pending", label: t.pending, count: s.pending, cls: "bg-slate-50 border-slate-200 text-slate-700", active: "ring-slate-500" },
    { key: "issue", label: t.issue, count: s.issue, cls: s.issue > 0 ? "bg-red-50 border-red-300 text-red-900" : "bg-white border-border text-muted-foreground", active: "ring-red-500" },
  ]

  return (
    <div className="space-y-5">
      {/* ===== ヘッダー: 団体情報 ===== */}
      <section className="rounded-2xl border border-border bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">{data.groupName || data.bookingId}</h2>
              <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${GROUP_STATUS_CLS[data.groupStatus] ?? ""}`}>
                {t.groupSt[data.groupStatus] ?? data.groupStatus}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {data.agency}
              {data.tourNumber ? ` ・ ${data.tourNumber}` : ""} ・ <span className="font-mono text-xs">{data.bookingId}</span>
            </p>
            <p className="text-sm text-foreground mt-1">{legRoute}</p>
          </div>
          <div className="text-right text-sm">
            <p className="text-foreground font-medium tabular-nums">
              {data.travelerCount} {t.guests} ・ {s.total} {t.bags}
            </p>
            {data.legs[0] && (
              <p className="text-muted-foreground text-xs mt-1">
                {t.pickup} {data.legs[0].shipmentDate} ・ {t.delivery} {data.legs[data.legs.length - 1].expectedArrival ?? "—"}
              </p>
            )}
            {data.leaderName && (
              <p className="text-muted-foreground text-xs mt-1 flex items-center justify-end gap-1.5">
                {t.leader}: {data.leaderName}
                {data.leaderPhone && (
                  <a href={`tel:${data.leaderPhone}`} className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-2">
                    <Phone className="w-3 h-3" strokeWidth={1.5} />
                    {data.leaderPhone}
                  </a>
                )}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ===== Issue First: 要対応バナー (最優先・最上部) ===== */}
      {issues.length > 0 && (
        <section className="rounded-2xl border-2 border-red-300 bg-red-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-red-600" strokeWidth={2} />
            <p className="text-sm font-semibold text-red-900">{t.issueBanner(issues.length)}</p>
          </div>
          <div className="space-y-1.5">
            {issues.map((l) => (
              <button
                key={l.id}
                onClick={() => setEditTarget(l)}
                className="w-full text-left rounded-lg bg-white border border-red-200 px-3 py-2 hover:border-red-400 transition-colors"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">BG-{String(l.luggageNo).padStart(3, "0")}</span>
                  <span className="font-medium text-foreground">{l.guestName || t.unnamed}</span>
                  <span className="text-red-700 font-medium">{l.exception || l.issueNote || t.st.issue}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{fmtTime(l.lastUpdate)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ===== サマリタイル (クリックでフィルタ) ===== */}
      <section className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {tiles.map((tile) => (
          <button
            key={tile.key}
            onClick={() => setFilter(filter === tile.key ? "all" : tile.key)}
            className={`rounded-xl border p-3 text-left transition-all ${tile.cls} ${
              filter === tile.key ? `ring-2 ${tile.active}` : "hover:opacity-80"
            }`}
          >
            <p className="text-2xl font-semibold tabular-nums">{tile.count}</p>
            <p className="text-[11px] font-medium mt-0.5">{tile.label}</p>
          </button>
        ))}
      </section>

      {/* ===== 進捗 ===== */}
      <section className="rounded-2xl border border-border bg-white p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-muted-foreground">{t.progress}</p>
          <p className="text-sm font-semibold text-foreground tabular-nums">
            {t.deliveredOf(s.delivered, s.total - s.cancelled)} ・ {s.progressPct}%
          </p>
        </div>
        <div className="h-2.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${s.issue > 0 ? "bg-amber-500" : "bg-emerald-500"}`}
            style={{ width: `${s.progressPct}%` }}
          />
        </div>
      </section>

      {/* ===== 検索 + 更新 ===== */}
      <section className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" strokeWidth={1.5} />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.searchPh}
            className="h-10 w-full pl-9 pr-3 rounded-xl border border-border bg-white text-sm"
          />
        </div>
        <button
          onClick={onReload}
          className="h-10 px-3 rounded-xl border border-border bg-white text-muted-foreground hover:text-foreground"
          title="Reload"
        >
          <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
        </button>
      </section>

      {/* ===== 一覧: md以上=テーブル / モバイル=カード ===== */}
      <section className="rounded-2xl border border-border bg-white overflow-hidden">
        {data.luggage.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">{t.noLuggage}</p>
        ) : filtered.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">{t.noMatch}</p>
        ) : (
          <>
            {/* テーブル (md+) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="text-left p-3 font-medium">{t.colNo}</th>
                    <th className="text-left p-3 font-medium">{t.colGuest}</th>
                    <th className="text-left p-3 font-medium">{t.colLeg}</th>
                    <th className="text-left p-3 font-medium">{t.colStatus}</th>
                    <th className="text-left p-3 font-medium">{t.colUpdated}</th>
                    <th className="text-left p-3 font-medium">{t.colTracking}</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => (
                    <tr
                      key={l.id}
                      className={`border-t border-border ${l.status === "issue" ? "bg-red-50/60" : "hover:bg-muted/20"}`}
                    >
                      <td className="p-3 font-mono text-xs text-muted-foreground">
                        BG-{String(l.luggageNo).padStart(3, "0")}
                      </td>
                      <td className="p-3 font-medium text-foreground">{l.guestName || <span className="text-muted-foreground font-normal">{t.unnamed}</span>}</td>
                      <td className="p-3 text-xs text-muted-foreground">L{l.legIndex + 1}</td>
                      <td className="p-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_CLS[l.status] ?? ""}`}>
                          {l.status === "delivered" && <CheckCircle2 className="w-3 h-3" strokeWidth={2} />}
                          {(l.status === "in_transit" || l.status === "picked_up") && <Truck className="w-3 h-3" strokeWidth={2} />}
                          {l.status === "issue" && <AlertTriangle className="w-3 h-3" strokeWidth={2} />}
                          {t.st[l.status] ?? l.status}
                        </span>
                        {l.exception && <p className="text-[10px] text-red-700 mt-0.5">{l.exception}</p>}
                        {l.manualStatus && <p className="text-[10px] text-muted-foreground mt-0.5">manual</p>}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground tabular-nums">{fmtTime(l.lastUpdate)}</td>
                      <td className="p-3 font-mono text-[11px] text-muted-foreground">{l.trackingNumber ?? "—"}</td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => setEditTarget(l)}
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                        >
                          <Pencil className="w-3 h-3" strokeWidth={1.5} />
                          {t.edit}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* カード (mobile) */}
            <div className="md:hidden divide-y divide-border">
              {filtered.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setEditTarget(l)}
                  className={`w-full text-left p-3.5 ${l.status === "issue" ? "bg-red-50/60" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-foreground text-sm">{l.guestName || t.unnamed}</p>
                    <span className={`shrink-0 px-2 py-0.5 rounded-md text-[11px] font-medium ${STATUS_CLS[l.status] ?? ""}`}>
                      {t.st[l.status] ?? l.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                    BG-{String(l.luggageNo).padStart(3, "0")} ・ L{l.legIndex + 1}
                    {l.trackingNumber ? ` ・ ${l.trackingNumber}` : ""}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {l.exception ? <span className="text-red-700">{l.exception}</span> : `${t.updated} ${fmtTime(l.lastUpdate)}`}
                  </p>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {editTarget && (
        <LuggageEditModal
          luggage={editTarget}
          t={t}
          canOperate={canOperate}
          onClose={() => setEditTarget(null)}
          onSave={async (patch) => {
            const r = await onPatch(editTarget.id, patch)
            if (r.ok) {
              setEditTarget(null)
              onReload()
            }
            return r
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 荷物編集モーダル: 運営=全項目 / 代理店=ゲスト名・メモのみ
// ---------------------------------------------------------------------------
function LuggageEditModal({
  luggage,
  t,
  canOperate,
  onClose,
  onSave,
}: {
  luggage: LuggageView
  t: (typeof T)["ja"] | (typeof T)["en"]
  canOperate: boolean
  onClose: () => void
  onSave: (patch: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>
}) {
  const [guestName, setGuestName] = useState(luggage.guestName)
  const [tracking, setTracking] = useState(luggage.trackingNumber ?? "")
  const [manualStatus, setManualStatus] = useState<string>(luggage.manualStatus ?? "")
  const [issueNote, setIssueNote] = useState(luggage.issueNote ?? "")
  const [notes, setNotes] = useState(luggage.notes ?? "")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  const MANUAL_OPTS: { v: string; label: string }[] = [
    { v: "", label: t.manualAuto },
    ...(["pending", "picked_up", "in_transit", "delivered", "issue"] as LuggageStatus[]).map((v) => ({
      v,
      label: t.st[v] ?? v,
    })),
  ]

  const submit = async () => {
    setBusy(true)
    setErr("")
    const patch: Record<string, unknown> = { guestName: guestName.trim(), notes }
    if (canOperate) {
      patch.trackingNumber = tracking.trim()
      patch.manualStatus = manualStatus
      patch.issueNote = issueNote
    }
    const r = await onSave(patch)
    if (!r.ok) setErr(r.error || t.saveFailed)
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t.editTitle}</h2>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              BG-{String(luggage.luggageNo).padStart(3, "0")} ・ L{luggage.legIndex + 1}
            </p>
          </div>
          <button onClick={onClose} className="p-1 -m-1 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">{t.guestName}</label>
          <input
            value={guestName}
            maxLength={80}
            onChange={(e) => setGuestName(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
          />
        </div>

        {canOperate && (
          <>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">{t.trackingNumber}</label>
              <input
                value={tracking}
                maxLength={40}
                onChange={(e) => setTracking(e.target.value)}
                className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm font-mono"
              />
              <p className="text-[10px] text-muted-foreground">{t.trackingAuto}</p>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">{t.manualStatus}</label>
              <select
                value={manualStatus}
                onChange={(e) => setManualStatus(e.target.value)}
                className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
              >
                {MANUAL_OPTS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {manualStatus === "issue" && (
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">{t.issueNote}</label>
                <input
                  value={issueNote}
                  maxLength={500}
                  onChange={(e) => setIssueNote(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
                />
              </div>
            )}
          </>
        )}

        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">{t.notes}</label>
          <input
            value={notes}
            maxLength={500}
            onChange={(e) => setNotes(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
          />
        </div>

        {err && <p className="text-xs text-red-700">{err}</p>}

        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-border bg-white text-sm hover:bg-muted/40">
            {t.cancel}
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="h-10 px-4 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />}
            {t.save}
          </button>
        </div>
      </div>
    </div>
  )
}
