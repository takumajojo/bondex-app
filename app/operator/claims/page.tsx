"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  RotateCcw,
  Plus,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type ClaimCategory = "damage" | "loss" | "delay" | "wrong_delivery" | "other"
type ClaimStatus = "open" | "investigating" | "resolved" | "closed" | "rejected"
type ReportedBy = "agency" | "traveler" | "hotel" | "bondex" | "yamato"

interface Claim {
  id: string
  shipment_id: string | null
  booking_id: string | null
  leg_index: number | null
  category: ClaimCategory
  reported_by: ReportedBy | null
  reporter_name: string | null
  reporter_contact: string | null
  description: string
  resolution: string | null
  claim_amount_yen: number | null
  yamato_case_number: string | null
  status: ClaimStatus
  occurred_at: string | null
  reported_at: string
  resolved_at: string | null
  created_at: string
}

const CATEGORY_LABEL: Record<ClaimCategory, string> = {
  damage: "毀損",
  loss: "紛失",
  delay: "遅配",
  wrong_delivery: "誤配",
  other: "その他",
}

const STATUS_META: Record<ClaimStatus, { label: string; cls: string }> = {
  open:          { label: "受付済",   cls: "bg-amber-100 text-amber-800" },
  investigating: { label: "調査中",   cls: "bg-indigo-100 text-indigo-800" },
  resolved:      { label: "解決済",   cls: "bg-emerald-100 text-emerald-800" },
  closed:        { label: "クローズ", cls: "bg-zinc-200 text-zinc-700" },
  rejected:      { label: "却下",     cls: "bg-red-100 text-red-800" },
}

const REPORTER_LABEL: Record<ReportedBy, string> = {
  agency: "代理店",
  traveler: "旅行者",
  hotel: "ホテル",
  bondex: "BondEx",
  yamato: "ヤマト",
}

export default function ClaimsPage() {
  const [items, setItems] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [filterStatus, setFilterStatus] = useState<"" | ClaimStatus>("")
  const [creating, setCreating] = useState(false)

  // 新規作成フォーム
  const emptyForm = {
    booking_id: "",
    leg_index: 0,
    category: "damage" as ClaimCategory,
    reported_by: "agency" as ReportedBy,
    reporter_name: "",
    reporter_contact: "",
    description: "",
    claim_amount_yen: 0,
    yamato_case_number: "",
  }
  const [form, setForm] = useState(emptyForm)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const sp = new URLSearchParams()
      if (filterStatus) sp.set("status", filterStatus)
      const res = await fetch(`/api/claims?${sp.toString()}`)
      const text = await res.text()
      if (!res.ok) throw new Error(`API ${res.status}: ${text.slice(0, 200)}`)
      const data = JSON.parse(text)
      setItems(Array.isArray(data.claims) ? data.claims : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [filterStatus])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => {
    const c: Record<ClaimStatus, number> = {
      open: 0, investigating: 0, resolved: 0, closed: 0, rejected: 0,
    }
    items.forEach((it) => { c[it.status]++ })
    return c
  }, [items])

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    try {
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          claim_amount_yen: form.claim_amount_yen || null,
          booking_id: form.booking_id || null,
          leg_index: form.leg_index ?? null,
          yamato_case_number: form.yamato_case_number || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.error || "Create failed")
      }
      setForm(emptyForm)
      setCreating(false)
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed")
    }
  }

  const onStatusChange = async (id: string, status: ClaimStatus) => {
    const before = items
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)))
    try {
      const res = await fetch("/api/claims", {
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

  const onResolutionUpdate = async (id: string, resolution: string) => {
    try {
      const res = await fetch("/api/claims", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, resolution }),
      })
      if (!res.ok) throw new Error("Update failed")
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed")
    }
  }

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
              <h1 className="text-xl font-semibold text-foreground mt-0.5">クレーム管理</h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/operator/dashboard" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5">
              <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
              ダッシュボード
            </Link>
            <button onClick={() => void load()} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5">
              <RotateCcw className="w-4 h-4" strokeWidth={1.5} />
              更新
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Status summary */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {(Object.keys(STATUS_META) as ClaimStatus[]).map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(filterStatus === st ? "" : st)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                filterStatus === st
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-white hover:border-foreground/40"
              }`}
            >
              <p className="text-[10px] uppercase tracking-widest opacity-70 mb-1">{STATUS_META[st].label}</p>
              <p className="text-xl font-semibold tabular-nums">{counts[st]}</p>
            </button>
          ))}
        </section>

        {/* New claim button / form */}
        {!creating ? (
          <button onClick={() => setCreating(true)} className="w-full rounded-2xl border border-dashed border-border bg-white hover:bg-muted/40 py-4 text-sm text-foreground flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" strokeWidth={1.5} />
            新規クレーム作成
          </button>
        ) : (
          <form onSubmit={onCreate} className="rounded-2xl border border-border bg-white p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">新規クレーム作成</h2>
              <button type="button" onClick={() => setCreating(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">予約番号 (任意)</span>
                <Input value={form.booking_id} onChange={(e) => setForm({ ...form, booking_id: e.target.value })} placeholder="BDX-260630-XXX" />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">区間 (0始まり、任意)</span>
                <Input type="number" min={0} value={form.leg_index} onChange={(e) => setForm({ ...form, leg_index: Number(e.target.value) })} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">区分</span>
                <select className="w-full h-10 px-3 rounded-lg border border-border bg-white text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ClaimCategory })}>
                  {(Object.keys(CATEGORY_LABEL) as ClaimCategory[]).map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">報告者</span>
                <select className="w-full h-10 px-3 rounded-lg border border-border bg-white text-sm" value={form.reported_by} onChange={(e) => setForm({ ...form, reported_by: e.target.value as ReportedBy })}>
                  {(Object.keys(REPORTER_LABEL) as ReportedBy[]).map((r) => (
                    <option key={r} value={r}>{REPORTER_LABEL[r]}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">報告者名</span>
                <Input value={form.reporter_name} onChange={(e) => setForm({ ...form, reporter_name: e.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">報告者連絡先</span>
                <Input value={form.reporter_contact} onChange={(e) => setForm({ ...form, reporter_contact: e.target.value })} placeholder="電話 or email" />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">申請額 (円、任意)</span>
                <Input type="number" min={0} value={form.claim_amount_yen} onChange={(e) => setForm({ ...form, claim_amount_yen: Number(e.target.value) })} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">配送業者クレーム番号 (任意)</span>
                <Input value={form.yamato_case_number} onChange={(e) => setForm({ ...form, yamato_case_number: e.target.value })} />
              </label>
            </div>

            <label className="space-y-1 block">
              <span className="text-xs text-muted-foreground">詳細 *</span>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
                rows={4}
                className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm"
                placeholder="何が起きたか具体的に..."
              />
            </label>

            <Button type="submit" disabled={!form.description.trim()} className="w-full h-12 rounded-2xl">
              登録
            </Button>
          </form>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            {error}
          </div>
        )}

        {/* List */}
        <section className="space-y-3">
          {loading ? (
            <div className="rounded-2xl bg-white p-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" strokeWidth={1.5} />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-border bg-white p-16 flex flex-col items-center gap-3 text-muted-foreground">
              <AlertTriangle className="w-8 h-8" strokeWidth={1.5} />
              <span className="text-sm">クレームはまだありません</span>
            </div>
          ) : (
            items.map((c) => (
              <article key={c.id} className="rounded-2xl border border-border bg-white p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs uppercase tracking-widest text-muted-foreground">
                        {CATEGORY_LABEL[c.category]}
                      </span>
                      <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_META[c.status].cls}`}>
                        {STATUS_META[c.status].label}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">
                      {c.booking_id || "(予約番号未指定)"}
                      {c.leg_index !== null ? ` -L${c.leg_index + 1}` : ""}
                      {c.yamato_case_number ? ` · 伝票# ${c.yamato_case_number}` : ""}
                    </p>
                  </div>
                  <select
                    value={c.status}
                    onChange={(e) => void onStatusChange(c.id, e.target.value as ClaimStatus)}
                    className={`h-8 px-2 rounded-md text-xs font-medium border-0 ${STATUS_META[c.status].cls}`}
                  >
                    {(Object.keys(STATUS_META) as ClaimStatus[]).map((st) => (
                      <option key={st} value={st}>{STATUS_META[st].label}</option>
                    ))}
                  </select>
                </div>

                <div className="text-xs text-muted-foreground">
                  {c.reported_by ? `${REPORTER_LABEL[c.reported_by]} (${c.reporter_name || "—"}): ${c.reporter_contact || "連絡先なし"}` : ""}
                  {" · "}
                  受付: {new Date(c.reported_at).toLocaleDateString("ja-JP")}
                  {c.claim_amount_yen ? ` · 申請額 ¥${c.claim_amount_yen.toLocaleString()}` : ""}
                </div>

                <p className="text-sm text-foreground whitespace-pre-wrap">{c.description}</p>

                <div className="pt-3 border-t border-border space-y-1">
                  <label className="text-xs text-muted-foreground">対応内容</label>
                  <textarea
                    defaultValue={c.resolution || ""}
                    onBlur={(e) => {
                      if (e.target.value !== (c.resolution || "")) {
                        void onResolutionUpdate(c.id, e.target.value)
                      }
                    }}
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm"
                    placeholder="対応内容を記録 (フォーカス外すと保存)"
                  />
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </main>
  )
}
