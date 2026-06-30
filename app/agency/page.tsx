"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Loader2,
  Package,
  LogOut,
  ExternalLink,
} from "lucide-react"
import { getBrowserSupabase } from "@/lib/supabase-browser"

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
  to_hotel: string
  recipient: string
  suitcase_count: number
  amount_yen: number
  yamato_tracking: string[] | null
  yamato_label_url: string | null
  status: string
  created_at: string
}

const STATUS_JA: Record<string, { label: string; cls: string }> = {
  pending:    { label: "保留",     cls: "bg-slate-100 text-slate-700" },
  issued:     { label: "発行済",   cls: "bg-blue-100 text-blue-800" },
  picked_up:  { label: "集荷済",   cls: "bg-amber-100 text-amber-800" },
  in_transit: { label: "配達中",   cls: "bg-indigo-100 text-indigo-800" },
  delivered:  { label: "配達完了", cls: "bg-emerald-100 text-emerald-800" },
  failed:     { label: "失敗",     cls: "bg-red-100 text-red-800" },
  cancelled:  { label: "キャンセル", cls: "bg-zinc-200 text-zinc-700" },
}

export default function AgencyDashboard() {
  const router = useRouter()
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [agencyName, setAgencyName] = useState("")
  const [userEmail, setUserEmail] = useState("")
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    const sb = getBrowserSupabase()
    if (!sb) {
      setError("Supabase not configured")
      setLoading(false)
      return
    }
    // 1. セッション確認
    const { data: session } = await sb.auth.getSession()
    if (!session.session) {
      router.replace("/agency/login?next=/agency")
      return
    }
    setUserEmail(session.session.user.email || "")

    // 2. 自分の agency を取得
    const { data: agency, error: aErr } = await sb
      .from("agencies")
      .select("name")
      .maybeSingle()
    if (aErr) {
      setError(`アカウントに代理店が紐付いていません。BondEx 管理者にご連絡ください (${aErr.message})`)
      setLoading(false)
      return
    }
    if (!agency) {
      setError("アカウントに代理店が紐付いていません。BondEx 管理者にご連絡ください")
      setLoading(false)
      return
    }
    setAgencyName(agency.name)

    // 3. shipments を取得 (RLS で自社のみフィルタ済み)
    const { data, error: sErr } = await sb
      .from("shipments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200)
    if (sErr) {
      setError(sErr.message)
      setLoading(false)
      return
    }
    setShipments((data as Shipment[]) || [])
    setLoading(false)
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  const onLogout = async () => {
    const sb = getBrowserSupabase()
    if (sb) await sb.auth.signOut()
    router.replace("/agency/login")
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      issued: 0, picked_up: 0, in_transit: 0, delivered: 0,
    }
    shipments.forEach((it) => { c[it.status] = (c[it.status] || 0) + 1 })
    return c
  }, [shipments])

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bondex-logo.png" alt="BondEx" className="h-10 w-auto object-contain" />
            <div className="border-l border-border pl-4">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
                Agency Portal
              </p>
              <h1 className="text-xl font-semibold text-foreground mt-0.5">
                {agencyName || "案件状況"}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {userEmail && (
              <span className="text-xs text-muted-foreground">{userEmail}</span>
            )}
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.5} />
              サインアウト
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {error}
          </div>
        )}

        {/* Status summary */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(["issued","picked_up","in_transit","delivered"] as const).map((st) => (
            <div key={st} className="rounded-xl border border-border bg-white p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                {STATUS_JA[st].label}
              </p>
              <p className="text-2xl font-semibold tabular-nums">{counts[st]}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-border bg-white overflow-hidden">
          {loading ? (
            <div className="p-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" strokeWidth={1.5} />
            </div>
          ) : shipments.length === 0 ? (
            <div className="p-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Package className="w-8 h-8" strokeWidth={1.5} />
              <span className="text-sm">案件がまだありません</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="text-left p-3 font-medium">発行日</th>
                    <th className="text-left p-3 font-medium">予約番号</th>
                    <th className="text-left p-3 font-medium">代表者</th>
                    <th className="text-left p-3 font-medium">区間</th>
                    <th className="text-right p-3 font-medium">点数</th>
                    <th className="text-left p-3 font-medium">追跡</th>
                    <th className="text-left p-3 font-medium">状況</th>
                  </tr>
                </thead>
                <tbody>
                  {shipments.map((it) => (
                    <tr key={it.id} className="border-t border-border hover:bg-muted/20">
                      <td className="p-3">
                        {new Date(it.created_at).toLocaleDateString("ja-JP")}
                      </td>
                      <td className="p-3 font-mono text-xs">
                        {it.booking_id}-L{it.leg_index + 1}
                      </td>
                      <td className="p-3">{it.representative}</td>
                      <td className="p-3 text-xs">
                        {it.from_hotel}
                        <br />
                        <span className="text-muted-foreground">↓</span>
                        <br />
                        {it.to_hotel}
                      </td>
                      <td className="p-3 text-right tabular-nums">{it.suitcase_count}</td>
                      <td className="p-3">
                        {it.yamato_tracking && it.yamato_tracking.length > 0 ? (
                          <span className="text-[11px] font-mono">{it.yamato_tracking[0]}</span>
                        ) : it.yamato_label_url ? (
                          <a
                            href={it.yamato_label_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs underline inline-flex items-center gap-1"
                          >
                            送り状 <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_JA[it.status]?.cls || "bg-zinc-100"}`}>
                          {STATUS_JA[it.status]?.label || it.status}
                        </span>
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
