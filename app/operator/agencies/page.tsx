"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2, Check, Ban, RotateCcw } from "lucide-react"

interface Agency {
  id: string
  name: string
  contact_email: string | null
  contact_person: string | null
  contact_phone: string | null
  country: string | null
  is_domestic: boolean | null
  payment_method: string | null
  status: string | null
  card_on_file: boolean | null
  created_via: string | null
  created_at: string
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "承認待ち", cls: "bg-amber-100 text-amber-800" },
  active: { label: "有効", cls: "bg-emerald-100 text-emerald-800" },
  suspended: { label: "停止", cls: "bg-red-100 text-red-800" },
}

const PAYMENT_LABEL: Record<string, string> = {
  invoice: "請求書払い",
  card: "カード払い",
}

export default function OperatorAgenciesPage() {
  const [agencies, setAgencies] = useState<Agency[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/agencies")
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "取得に失敗しました")
      } else if (!data.configured) {
        setError("Supabase が未設定です")
      } else {
        setAgencies(data.agencies || [])
        setError("")
      }
    } catch {
      setError("取得に失敗しました")
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const setStatus = async (id: string, status: string) => {
    setBusyId(id)
    try {
      const res = await fetch("/api/agencies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      })
      if (res.ok) {
        setAgencies((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)))
      } else {
        const d = await res.json().catch(() => ({}))
        alert(d.error || "更新に失敗しました")
      }
    } catch {
      alert("更新に失敗しました")
    }
    setBusyId(null)
  }

  const pendingCount = useMemo(
    () => agencies.filter((a) => a.status === "pending").length,
    [agencies],
  )

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bondex-logo.png" alt="BondEx" className="h-8 w-auto object-contain" />
            <div className="border-l border-border pl-3">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground">BondEx Operator</p>
              <h1 className="text-lg font-semibold text-foreground">代理店管理</h1>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/operator/dashboard" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
              <ArrowLeft className="w-4 h-4" strokeWidth={1.5} /> ダッシュボード
            </Link>
            <button onClick={() => void load()} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
              <RotateCcw className="w-4 h-4" strokeWidth={1.5} /> 更新
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-5">
        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</div>
        )}

        {pendingCount > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            承認待ちの代理店が <strong>{pendingCount}</strong> 件あります。
          </div>
        )}

        <section className="rounded-2xl border border-border bg-white overflow-hidden">
          {loading ? (
            <div className="p-16 flex justify-center text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" strokeWidth={1.5} />
            </div>
          ) : agencies.length === 0 ? (
            <div className="p-16 text-center text-sm text-muted-foreground">代理店がまだありません</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="text-left p-3 font-medium">代理店</th>
                    <th className="text-left p-3 font-medium">地域</th>
                    <th className="text-left p-3 font-medium">決済</th>
                    <th className="text-left p-3 font-medium">状態</th>
                    <th className="text-right p-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {agencies.map((a) => {
                    const st = STATUS_META[a.status || "active"] || STATUS_META.active
                    const busy = busyId === a.id
                    return (
                      <tr key={a.id} className="border-t border-border hover:bg-muted/20">
                        <td className="p-3 align-top">
                          <p className="font-medium text-foreground">{a.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {a.contact_person ? `${a.contact_person} · ` : ""}{a.contact_email || "—"}
                          </p>
                          {a.created_via === "self_signup" && (
                            <span className="text-[10px] text-muted-foreground">セルフ登録</span>
                          )}
                        </td>
                        <td className="p-3 align-top text-xs">
                          {a.is_domestic === false ? `海外${a.country ? ` (${a.country})` : ""}` : "国内"}
                        </td>
                        <td className="p-3 align-top text-xs">
                          {PAYMENT_LABEL[a.payment_method || "invoice"] || a.payment_method}
                          {a.payment_method === "card" && (
                            <span className={`block text-[10px] mt-0.5 ${a.card_on_file ? "text-emerald-700" : "text-amber-700"}`}>
                              {a.card_on_file ? "カード登録済み" : "カード未登録"}
                            </span>
                          )}
                        </td>
                        <td className="p-3 align-top">
                          <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${st.cls}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="p-3 align-top">
                          <div className="flex justify-end gap-2">
                            {a.status === "pending" && (
                              <>
                                <button
                                  onClick={() => void setStatus(a.id, "active")}
                                  disabled={busy}
                                  className="inline-flex items-center gap-1 rounded-md bg-emerald-600 text-white text-xs font-medium px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" strokeWidth={2} />}
                                  承認
                                </button>
                                <button
                                  onClick={() => void setStatus(a.id, "suspended")}
                                  disabled={busy}
                                  className="inline-flex items-center gap-1 rounded-md border border-border text-muted-foreground text-xs font-medium px-3 py-1.5 hover:bg-muted disabled:opacity-50"
                                >
                                  却下
                                </button>
                              </>
                            )}
                            {a.status === "active" && (
                              <button
                                onClick={() => void setStatus(a.id, "suspended")}
                                disabled={busy}
                                className="inline-flex items-center gap-1 rounded-md border border-red-300 text-red-700 text-xs font-medium px-3 py-1.5 hover:bg-red-50 disabled:opacity-50"
                              >
                                <Ban className="w-3 h-3" strokeWidth={2} /> 停止
                              </button>
                            )}
                            {a.status === "suspended" && (
                              <button
                                onClick={() => void setStatus(a.id, "active")}
                                disabled={busy}
                                className="inline-flex items-center gap-1 rounded-md border border-border text-xs font-medium px-3 py-1.5 hover:bg-muted disabled:opacity-50"
                              >
                                有効化
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
