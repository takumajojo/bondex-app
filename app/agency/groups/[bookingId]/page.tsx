"use client"

// 代理店用 団体ダッシュボード (Supabase JWT・自社予約のみ)。日英対応。
import { use, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"
import { getBrowserSupabase } from "@/lib/supabase-browser"
import { useAgencyLocale, AgencyLocaleToggle } from "@/lib/agency-i18n"
import { GroupDashboard } from "@/components/group-dashboard"
import type { GroupViewPayload } from "@/lib/group-view"

const M = {
  ja: { title: "団体ダッシュボード", back: "ポータルへ", loading: "読み込み中…", loadFailed: "取得に失敗しました" },
  en: { title: "Group dashboard", back: "Back to portal", loading: "Loading…", loadFailed: "Failed to load" },
} as const

export default function AgencyGroupPage({
  params,
}: {
  params: Promise<{ bookingId: string }>
}) {
  const { bookingId } = use(params)
  const router = useRouter()
  const { locale, setLocale } = useAgencyLocale()
  const t = M[locale]
  const [token, setToken] = useState<string | null>(null)
  const [data, setData] = useState<GroupViewPayload | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const sb = getBrowserSupabase()
      const tk = sb ? (await sb.auth.getSession()).data.session?.access_token ?? null : null
      if (!tk) {
        router.replace("/agency/login")
        return
      }
      setToken(tk)
    })()
  }, [router])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/agency/group/${encodeURIComponent(bookingId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || `${t.loadFailed} (${res.status})`)
      setData(d as GroupViewPayload)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [bookingId, token, t.loadFailed])

  useEffect(() => {
    void load()
  }, [load])

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      if (!token) return { ok: false, error: "no session" }
      try {
        const res = await fetch(`/api/agency/group/${encodeURIComponent(bookingId)}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...body }),
        })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) return { ok: false, error: d.error || `${res.status}` }
        return { ok: true }
      } catch {
        return { ok: false, error: "network error" }
      }
    },
    [bookingId, token],
  )

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              BondEx Agency ・ Group
            </p>
            <h1 className="text-lg font-semibold text-foreground mt-0.5">{t.title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <AgencyLocaleToggle locale={locale} onChange={setLocale} />
            <Link
              href="/agency"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
              {t.back}
            </Link>
          </div>
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground py-20">
            <Loader2 className="w-5 h-5 animate-spin" /> {t.loading}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
        ) : data ? (
          <GroupDashboard
            data={data}
            locale={locale}
            canOperate={false}
            onPatch={patch}
            onReload={load}
            onCreateShare={async (days) => {
              if (!token) return { ok: false, error: "no session" }
              try {
                const res = await fetch(`/api/agency/group/${encodeURIComponent(bookingId)}/share`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ days }),
                })
                const d = await res.json().catch(() => ({}))
                if (!res.ok) return { ok: false, error: d.error }
                return { ok: true, url: d.url, expiresAt: d.expiresAt }
              } catch {
                return { ok: false, error: "network error" }
              }
            }}
          />
        ) : null}
      </div>
    </main>
  )
}
