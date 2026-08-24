"use client"

// 運営用 団体ダッシュボード。middleware の operator ゲート配下 (cookie 認証)。
import { use, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2 } from "lucide-react"
import { GroupDashboard } from "@/components/group-dashboard"
import type { GroupViewPayload } from "@/lib/group-view"

export default function OperatorGroupPage({
  params,
}: {
  params: Promise<{ bookingId: string }>
}) {
  const { bookingId } = use(params)
  const [data, setData] = useState<GroupViewPayload | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(bookingId)}`, { cache: "no-store" })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || `取得に失敗しました (${res.status})`)
      setData(d as GroupViewPayload)
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [bookingId])

  useEffect(() => {
    void load()
  }, [load])

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      try {
        const res = await fetch(`/api/groups/${encodeURIComponent(bookingId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...body }),
        })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) return { ok: false, error: d.error || `保存失敗 (${res.status})` }
        return { ok: true }
      } catch {
        return { ok: false, error: "network error" }
      }
    },
    [bookingId],
  )

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              BondEx Operator ・ Group
            </p>
            <h1 className="text-lg font-semibold text-foreground mt-0.5">団体ダッシュボード</h1>
          </div>
          <Link
            href="/operator/dashboard"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
            案件一覧へ
          </Link>
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground py-20">
            <Loader2 className="w-5 h-5 animate-spin" /> 読み込み中…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
        ) : data ? (
          <GroupDashboard data={data} locale="ja" canOperate onPatch={patch} onReload={load} />
        ) : null}
      </div>
    </main>
  )
}
