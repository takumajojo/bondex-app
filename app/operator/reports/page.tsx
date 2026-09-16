"use client"

// 集荷実績レポート (2026-09-16 谷口さん): どの代理店が いつ(集荷日) どこに 何個 送ったかを
// 絞り込み → 一覧・合計 → CSV。軸=集荷日(picked_up_at)。

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Download, Loader2, RefreshCw } from "lucide-react"

interface Row {
  booking_id: string
  leg_index: number
  agency: string | null
  representative: string | null
  tour_number: string | null
  picked_up_at: string | null
  shipment_date: string | null
  from_hotel: string | null
  from_prefecture: string | null
  to_hotel: string | null
  to_prefecture: string | null
  to_city: string | null
  suitcase_count: number | null
  status: string | null
}
interface Summary {
  count: number
  pieces: number
  amount: number
}

const STATUS_LABEL: Record<string, string> = {
  requested: "依頼中",
  pending: "保留",
  issued: "発行済",
  picked_up: "集荷済",
  in_transit: "配送中",
  delivered: "配達完了",
  failed: "失敗",
  cancelled: "キャンセル",
}

export default function ReportsPage() {
  const [agencies, setAgencies] = useState<string[]>([])
  const [agency, setAgency] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [prefecture, setPrefecture] = useState("")
  const [status, setStatus] = useState("")

  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<Summary>({ count: 0, pieces: 0, amount: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const params = useMemo(() => {
    const sp = new URLSearchParams()
    if (agency) sp.set("agency", agency)
    if (from) sp.set("from", from)
    if (to) sp.set("to", to)
    if (prefecture) sp.set("prefecture", prefecture)
    if (status) sp.set("status", status)
    return sp
  }, [agency, from, to, prefecture, status])

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/operator/report?${params.toString()}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "読み込みに失敗しました")
      setRows(Array.isArray(d.rows) ? d.rows : [])
      setSummary(d.summary ?? { count: 0, pieces: 0, amount: 0 })
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました")
    } finally {
      setLoading(false)
    }
  }, [params])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    fetch("/api/agencies")
      .then((r) => r.json())
      .then((d) => setAgencies(Array.isArray(d.agencies) ? d.agencies.map((a: { name: string }) => a.name) : []))
      .catch(() => {})
  }, [])

  const csvHref = `/api/operator/report?${new URLSearchParams(params).toString()}&format=csv`
  const jstDate = (ts: string | null) =>
    ts ? new Date(ts).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—"

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/operator/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" strokeWidth={1.6} /> ダッシュボード
            </Link>
            <h1 className="text-base font-bold text-foreground">集荷実績レポート</h1>
          </div>
          <a
            href={csvHref}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#C8102E] px-3 py-2 text-sm font-semibold text-white hover:bg-[#a60d26]"
          >
            <Download className="w-4 h-4" strokeWidth={1.8} /> CSVダウンロード
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-5 space-y-4">
        {/* 絞り込み */}
        <section className="rounded-2xl border border-border bg-white p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <label className="text-xs text-muted-foreground">
              代理店
              <select value={agency} onChange={(e) => setAgency(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2 text-sm">
                <option value="">すべて</option>
                {agencies.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              集荷日（から）
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2 text-sm" />
            </label>
            <label className="text-xs text-muted-foreground">
              集荷日（まで）
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2 text-sm" />
            </label>
            <label className="text-xs text-muted-foreground">
              お届け先 都道府県
              <input type="text" value={prefecture} onChange={(e) => setPrefecture(e.target.value)} placeholder="例: 東京都" className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2 text-sm" />
            </label>
            <label className="text-xs text-muted-foreground">
              ステータス
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2 text-sm">
                <option value="">すべて</option>
                {Object.entries(STATUS_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">「集荷日」は佐川で実際に集荷された日（picked_up_at）で絞り込みます。</p>
            <button onClick={() => void load()} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.6} /> 更新
            </button>
          </div>
        </section>

        {/* サマリ */}
        <section className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-border bg-white p-4">
            <p className="text-[11px] text-muted-foreground">件数（区間）</p>
            <p className="text-2xl font-bold tabular-nums">{summary.count}</p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-4">
            <p className="text-[11px] text-muted-foreground">個数 合計</p>
            <p className="text-2xl font-bold tabular-nums">{summary.pieces}</p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-4">
            <p className="text-[11px] text-muted-foreground">金額 合計（税抜ベース）</p>
            <p className="text-2xl font-bold tabular-nums">¥{summary.amount.toLocaleString()}</p>
          </div>
        </section>

        {/* 一覧 */}
        <section className="rounded-2xl border border-border bg-white overflow-hidden">
          {error && <div className="p-4 text-sm text-red-700">{error}</div>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">予約番号</th>
                  <th className="text-left font-medium px-3 py-2">代理店</th>
                  <th className="text-left font-medium px-3 py-2">集荷日</th>
                  <th className="text-left font-medium px-3 py-2">発送元</th>
                  <th className="text-left font-medium px-3 py-2">お届け先</th>
                  <th className="text-right font-medium px-3 py-2">個数</th>
                  <th className="text-left font-medium px-3 py-2">状態</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline" /> 読み込み中</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">該当する実績はありません</td></tr>
                ) : (
                  rows.map((r) => (
                    <tr key={`${r.booking_id}-${r.leg_index}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{r.booking_id}-L{r.leg_index + 1}</td>
                      <td className="px-3 py-2">{r.agency}</td>
                      <td className="px-3 py-2 tabular-nums">{jstDate(r.picked_up_at)}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className="text-muted-foreground">{r.from_prefecture} </span>{r.from_hotel}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className="text-muted-foreground">{r.to_prefecture} </span>{r.to_hotel}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.suitcase_count}</td>
                      <td className="px-3 py-2 text-xs">{STATUS_LABEL[r.status ?? ""] ?? r.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}
