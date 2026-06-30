"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Loader2,
  Package,
  Filter,
  RotateCcw,
  ExternalLink,
  FileText,
  Download,
} from "lucide-react"

type ShipmentStatus =
  | "pending"
  | "issued"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "failed"
  | "cancelled"

interface Shipment {
  id: string
  booking_id: string
  leg_index: number
  agency: string
  representative: string
  traveler_count: number
  shipment_date: string
  expected_arrival: string | null
  from_hotel: string
  from_city: string | null
  to_hotel: string
  to_city: string | null
  recipient: string
  suitcase_count: number
  amount_yen: number
  yamato_tracking: string[] | null
  yamato_label_url: string | null
  status: ShipmentStatus
  error_message: string | null
  created_at: string
}

const STATUS_LABELS: Record<ShipmentStatus, { ja: string; cls: string }> = {
  pending: { ja: "保留 (発行待ち)", cls: "bg-slate-100 text-slate-700" },
  issued: { ja: "発行済", cls: "bg-blue-100 text-blue-800" },
  picked_up: { ja: "集荷済", cls: "bg-amber-100 text-amber-800" },
  in_transit: { ja: "配達中", cls: "bg-indigo-100 text-indigo-800" },
  delivered: { ja: "配達完了", cls: "bg-emerald-100 text-emerald-800" },
  failed: { ja: "失敗", cls: "bg-red-100 text-red-800" },
  cancelled: { ja: "キャンセル", cls: "bg-zinc-200 text-zinc-700" },
}

const STATUS_OPTIONS: ShipmentStatus[] = [
  "pending",
  "issued",
  "picked_up",
  "in_transit",
  "delivered",
  "failed",
  "cancelled",
]

export default function DashboardPage() {
  const [items, setItems] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [configured, setConfigured] = useState(true)
  const [error, setError] = useState("")
  const [filterAgency, setFilterAgency] = useState("")
  const [filterStatus, setFilterStatus] = useState<"" | ShipmentStatus>("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const sp = new URLSearchParams()
      if (filterAgency) sp.set("agency", filterAgency)
      if (filterStatus) sp.set("status", filterStatus)
      const res = await fetch(`/api/shipments?${sp.toString()}`)
      const text = await res.text()
      if (!res.ok) {
        // API 側でエラー — 本文 (HTML or JSON) を出してデバッグしやすく
        throw new Error(`API ${res.status}: ${text.slice(0, 200)}`)
      }
      let data: { configured?: boolean; shipments?: Shipment[] }
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`)
      }
      setConfigured(Boolean(data.configured))
      setItems(Array.isArray(data.shipments) ? data.shipments : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [filterAgency, filterStatus])

  useEffect(() => {
    void load()
  }, [load])

  const handleStatusChange = async (id: string, status: ShipmentStatus) => {
    const before = items
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status } : it)))
    try {
      const res = await fetch("/api/shipments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      })
      if (!res.ok) throw new Error("Update failed")
    } catch (err) {
      setItems(before)
      setError(err instanceof Error ? err.message : "Update failed")
    }
  }

  // 代理店一覧は agencies マスタから直接取得 (shipments の有無に依らない)
  const [agencies, setAgencies] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    fetch("/api/agencies")
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !Array.isArray(d.agencies)) return
        setAgencies(d.agencies.map((a: { name: string }) => a.name).filter(Boolean))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // 請求書発行 — 当月デフォルト
  const [invoiceMonth, setInvoiceMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  })
  const [invoiceAgency, setInvoiceAgency] = useState("")
  const [invoiceBusy, setInvoiceBusy] = useState(false)
  const [invoiceError, setInvoiceError] = useState("")

  const onGenerateInvoice = async () => {
    if (!invoiceAgency || !invoiceMonth) return
    setInvoiceBusy(true)
    setInvoiceError("")
    try {
      const res = await fetch(
        `/api/invoices/generate?agency=${encodeURIComponent(invoiceAgency)}&month=${invoiceMonth}`,
      )
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `bondex-invoice-${invoiceAgency}-${invoiceMonth}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setInvoiceError(e instanceof Error ? e.message : "請求書発行失敗")
    } finally {
      setInvoiceBusy(false)
    }
  }

  const counts = useMemo(() => {
    const c: Record<ShipmentStatus, number> = {
      pending: 0,
      issued: 0,
      picked_up: 0,
      in_transit: 0,
      delivered: 0,
      failed: 0,
      cancelled: 0,
    }
    items.forEach((it) => {
      c[it.status]++
    })
    return c
  }, [items])

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bondex-logo.png" alt="BondEx" className="h-10 w-auto object-contain" />
            <div className="border-l border-border pl-4">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
                BondEx Operator
              </p>
              <h1 className="text-xl font-semibold text-foreground mt-0.5">案件ダッシュボード</h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/operator"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
              発行に戻る
            </Link>
            <button
              onClick={() => void load()}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw className="w-4 h-4" strokeWidth={1.5} />
              更新
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {!configured ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <p className="text-sm font-medium text-amber-900 mb-2">
              Supabase が未設定です
            </p>
            <p className="text-xs text-amber-800">
              <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> と{" "}
              <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> を Vercel に設定し、
              <code className="font-mono">sql/001_shipments.sql</code> を実行してください。
            </p>
          </div>
        ) : null}

        {/* Status summary */}
        <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {STATUS_OPTIONS.map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(filterStatus === st ? "" : st)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                filterStatus === st
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-white hover:border-foreground/40"
              }`}
            >
              <p className="text-[10px] uppercase tracking-widest opacity-70 mb-1">
                {STATUS_LABELS[st].ja}
              </p>
              <p className="text-xl font-semibold tabular-nums">{counts[st]}</p>
            </button>
          ))}
        </section>

        {/* Invoice generator */}
        <section className="rounded-2xl border border-border bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-foreground" strokeWidth={1.5} />
            <h3 className="text-sm font-medium text-foreground">月次請求書発行</h3>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={invoiceAgency}
              onChange={(e) => setInvoiceAgency(e.target.value)}
              className="h-9 px-3 rounded-lg border border-border bg-white text-sm"
            >
              <option value="">代理店を選択</option>
              {agencies.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <input
              type="month"
              value={invoiceMonth}
              onChange={(e) => setInvoiceMonth(e.target.value)}
              className="h-9 px-3 rounded-lg border border-border bg-white text-sm"
            />
            <button
              onClick={onGenerateInvoice}
              disabled={!invoiceAgency || !invoiceMonth || invoiceBusy}
              className="h-9 px-4 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {invoiceBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
              ) : (
                <Download className="w-3.5 h-3.5" strokeWidth={1.5} />
              )}
              請求書 PDF
            </button>
            {invoiceError && (
              <span className="text-xs text-red-700">{invoiceError}</span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            該当月の成功した発行 (issued / 集荷済 / 配達中 / 完了) を集計します
          </p>
        </section>

        {/* Filters */}
        <section className="rounded-2xl border border-border bg-white p-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="w-4 h-4" strokeWidth={1.5} />
            フィルタ
          </div>
          <select
            value={filterAgency}
            onChange={(e) => setFilterAgency(e.target.value)}
            className="h-9 px-3 rounded-lg border border-border bg-white text-sm"
          >
            <option value="">すべての代理店</option>
            {agencies.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          {(filterAgency || filterStatus) && (
            <button
              onClick={() => {
                setFilterAgency("")
                setFilterStatus("")
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              クリア
            </button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            表示 {items.length} 件
          </span>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            {error}
          </div>
        )}

        {/* Table */}
        <section className="rounded-2xl border border-border bg-white overflow-hidden">
          {loading ? (
            <div className="p-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" strokeWidth={1.5} />
              <span className="text-sm">読み込み中</span>
            </div>
          ) : items.length === 0 ? (
            <div className="p-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Package className="w-8 h-8" strokeWidth={1.5} />
              <span className="text-sm">該当する案件がありません</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="text-left p-3 font-medium">発行日</th>
                    <th className="text-left p-3 font-medium">代理店</th>
                    <th className="text-left p-3 font-medium">予約番号</th>
                    <th className="text-left p-3 font-medium">代表者</th>
                    <th className="text-left p-3 font-medium">区間</th>
                    <th className="text-right p-3 font-medium">点数</th>
                    <th className="text-left p-3 font-medium">追跡番号</th>
                    <th className="text-left p-3 font-medium">ステータス</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-t border-border hover:bg-muted/20">
                      <td className="p-3 align-top">
                        <p className="text-xs text-foreground">
                          {new Date(it.created_at).toLocaleDateString("ja-JP", {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                          })}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          発送: {it.shipment_date}
                        </p>
                      </td>
                      <td className="p-3 align-top">
                        <p className="text-foreground font-medium">{it.agency || "—"}</p>
                      </td>
                      <td className="p-3 align-top">
                        <p className="text-xs font-mono text-foreground/80">
                          {it.booking_id}
                          <span className="text-muted-foreground">
                            -L{it.leg_index + 1}
                          </span>
                        </p>
                      </td>
                      <td className="p-3 align-top">
                        <p className="text-foreground">{it.representative}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {it.recipient} · {it.traveler_count}名
                        </p>
                      </td>
                      <td className="p-3 align-top max-w-[280px]">
                        <p className="text-foreground text-xs">{it.from_hotel}</p>
                        <p className="text-[10px] text-muted-foreground">↓</p>
                        <p className="text-foreground text-xs">{it.to_hotel}</p>
                      </td>
                      <td className="p-3 align-top text-right">
                        <p className="font-medium text-foreground tabular-nums">
                          {it.suitcase_count}
                        </p>
                        <p className="text-[10px] text-muted-foreground tabular-nums">
                          ¥{it.amount_yen.toLocaleString()}
                        </p>
                      </td>
                      <td className="p-3 align-top">
                        {it.yamato_tracking && it.yamato_tracking.length > 0 ? (
                          <div className="space-y-0.5">
                            {it.yamato_tracking.map((t) => (
                              <p key={t} className="text-[11px] font-mono text-foreground/80">
                                {t}
                              </p>
                            ))}
                          </div>
                        ) : it.yamato_label_url ? (
                          <a
                            href={it.yamato_label_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-foreground underline underline-offset-2 inline-flex items-center gap-1"
                          >
                            送り状
                            <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3 align-top">
                        <select
                          value={it.status}
                          onChange={(e) =>
                            void handleStatusChange(it.id, e.target.value as ShipmentStatus)
                          }
                          className={`h-7 px-2 rounded-md text-xs font-medium border-0 ${STATUS_LABELS[it.status].cls}`}
                        >
                          {STATUS_OPTIONS.map((st) => (
                            <option key={st} value={st}>
                              {STATUS_LABELS[st].ja}
                            </option>
                          ))}
                        </select>
                        {it.error_message && (
                          <p className="text-[10px] text-red-700 mt-1 max-w-[180px] line-clamp-2">
                            {it.error_message}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
