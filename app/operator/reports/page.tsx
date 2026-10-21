"use client"

// 集荷実績レポート (2026-09-16 谷口さん): どの代理店が いつ(集荷日) どこに 何個 送ったかを
// 絞り込み → 一覧・合計 → CSV。軸=集荷日(picked_up_at)。

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Download, Loader2, RefreshCw } from "lucide-react"
import { cleanResidence, endpointLabel } from "@/lib/residence"

interface Row {
  booking_id: string
  leg_index: number
  agency: string | null
  representative: string | null
  tour_number: string | null
  picked_up_at: string | null
  shipment_date: string | null
  from_hotel: string | null
  from_residence: unknown
  from_prefecture: string | null
  to_hotel: string | null
  to_residence: unknown
  to_prefecture: string | null
  to_city: string | null
  suitcase_count: number | null
  amount_yen: number | null
  sagawa_cost_yen: number | null
  margin_yen: number | null
  cost_is_actual: boolean | null
  status: string | null
}
interface Summary {
  count: number
  pieces: number
  amount: number
  cost: number
  margin: number
}

const STATUS_LABEL: Record<string, string> = {
  requested: "依頼中",
  pending: "保留",
  issued: "手配済",
  picked_up: "集荷済",
  in_transit: "配送中",
  delivered: "配達完了",
  failed: "失敗",
  cancelled: "キャンセル",
}

// 当月(JST)の初日・末日を YYYY-MM-DD で。既定の絞り込み期間に使う(2026-10-21 谷口さん)。
function currentMonthRange(): { from: string; to: string } {
  const now = new Date(Date.now() + 9 * 3600 * 1000)
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() // 0-based
  const pad = (n: number) => String(n).padStart(2, "0")
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(lastDay)}` }
}

export default function ReportsPage() {
  const [agencies, setAgencies] = useState<string[]>([])
  const [agency, setAgency] = useState("")
  const [from, setFrom] = useState(() => currentMonthRange().from)
  const [to, setTo] = useState(() => currentMonthRange().to)
  const [prefecture, setPrefecture] = useState("")
  const [status, setStatus] = useState("")

  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<Summary>({ count: 0, pieces: 0, amount: 0, cost: 0, margin: 0 })
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
      setSummary(d.summary ?? { count: 0, pieces: 0, amount: 0, cost: 0, margin: 0 })
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

  // 佐川の運賃照会CSVを取り込んで実原価を保存する (実原価があればレポートの原価はそちらを使う)。
  const [importBusy, setImportBusy] = useState(false)
  const onImportCsv = async (file: File | null) => {
    if (!file) return
    setImportBusy(true)
    try {
      const text = await file.text()
      const res = await fetch("/api/operator/import-sagawa-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text }),
      })
      const d = (await res.json().catch(() => null)) as
        | { ok?: boolean; rowsParsed?: number; updated?: number; notFound?: string[]; error?: string }
        | null
      if (!res.ok || !d?.ok) throw new Error(d?.error || `失敗 (${res.status})`)
      alert(
        `取込完了：${d.updated}区間に実原価を反映（CSV ${d.rowsParsed}行）。` +
          (d.notFound && d.notFound.length ? `\n突合できなかった管理番号: ${d.notFound.join(", ")}` : ""),
      )
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : "取込に失敗しました")
    } finally {
      setImportBusy(false)
    }
  }

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
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-foreground hover:bg-muted cursor-pointer">
              {importBusy ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.8} /> : <Download className="w-4 h-4 rotate-180" strokeWidth={1.8} />}
              佐川 実原価CSV取込
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                disabled={importBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  e.target.value = ""
                  void onImportCsv(f)
                }}
              />
            </label>
            <a
              href={csvHref}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#C8102E] px-3 py-2 text-sm font-semibold text-white hover:bg-[#a60d26]"
            >
              <Download className="w-4 h-4" strokeWidth={1.8} /> CSVダウンロード
            </a>
          </div>
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
              発送予定日（から）
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2 text-sm" />
            </label>
            <label className="text-xs text-muted-foreground">
              発送予定日（まで）
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
            <p className="text-[11px] text-muted-foreground">発送予定日で絞り込み。配送予定（未集荷）も「全て集荷された前提」で原価・粗利を表示します（状態で進捗を確認）。</p>
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
            <p className="text-[11px] text-muted-foreground">売上 合計（税抜）</p>
            <p className="text-2xl font-bold tabular-nums">¥{summary.amount.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-4">
            <p className="text-[11px] text-muted-foreground">佐川原価 合計（税抜）</p>
            <p className="text-2xl font-bold tabular-nums">¥{(summary.cost ?? 0).toLocaleString()}</p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-4">
            <p className="text-[11px] text-muted-foreground">粗利（売上−佐川原価）</p>
            <p className="text-2xl font-bold tabular-nums text-emerald-700">¥{(summary.margin ?? 0).toLocaleString()}</p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-4">
            <p className="text-[11px] text-muted-foreground">粗利率</p>
            <p className="text-2xl font-bold tabular-nums">
              {summary.amount > 0 ? Math.round(((summary.margin ?? 0) / summary.amount) * 100) : 0}%
            </p>
          </div>
        </section>
        <p className="text-[10px] text-muted-foreground -mt-1 px-1">
          佐川原価は<b>実原価（運賃照会CSV取込＝「実」）があればそれ、無ければ運賃表の概算（2026-10-21運賃ベース・「概算」）</b>。概算は 届け先地帯×サイズ140（スーツケース基準）×個数。Ship&co・Stripe・固定費は未控除。取消/失敗は原価0。
        </p>

        {/* 一覧 */}
        <section className="rounded-2xl border border-border bg-white overflow-hidden">
          {error && <div className="p-4 text-sm text-red-700">{error}</div>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">予約番号</th>
                  <th className="text-left font-medium px-3 py-2">代理店</th>
                  <th className="text-left font-medium px-3 py-2 whitespace-nowrap">発送予定日</th>
                  <th className="text-left font-medium px-3 py-2">発送元</th>
                  <th className="text-left font-medium px-3 py-2">お届け先</th>
                  <th className="text-right font-medium px-3 py-2">個数</th>
                  <th className="text-right font-medium px-3 py-2">売上</th>
                  <th className="text-right font-medium px-3 py-2">佐川原価</th>
                  <th className="text-right font-medium px-3 py-2">粗利</th>
                  <th className="text-left font-medium px-3 py-2 whitespace-nowrap">状態</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline" /> 読み込み中</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">該当する実績はありません</td></tr>
                ) : (
                  rows.map((r) => (
                    <tr key={`${r.booking_id}-${r.leg_index}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{r.booking_id}-L{r.leg_index + 1}</td>
                      <td className="px-3 py-2">{r.agency}</td>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">{r.shipment_date ?? ""}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className="text-muted-foreground">{r.from_prefecture || cleanResidence(r.from_residence)?.prefecture || ""} </span>{endpointLabel(r.from_hotel, r.from_residence)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className="text-muted-foreground">{r.to_prefecture || cleanResidence(r.to_residence)?.prefecture || ""} </span>{endpointLabel(r.to_hotel, r.to_residence)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.suitcase_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">¥{(r.amount_yen ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                        ¥{(r.sagawa_cost_yen ?? 0).toLocaleString()}
                        <span className={`ml-1 text-[9px] px-1 rounded ${r.cost_is_actual ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          {r.cost_is_actual ? "実" : "概算"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">¥{(r.margin_yen ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">{STATUS_LABEL[r.status ?? ""] ?? r.status}</td>
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
