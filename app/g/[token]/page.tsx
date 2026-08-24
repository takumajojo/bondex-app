"use client"

// 添乗員向けの公開・読み取り専用 団体ビュー (/g/<token>)。
// アカウント不要 — 期限付きトークンで該当団体だけが見える。料金/請求は含まれない。
import { use, useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { GroupDashboard } from "@/components/group-dashboard"
import type { GroupViewPayload } from "@/lib/group-view"

const M = {
  ja: {
    brand: "BondEx ・ 団体荷物ステータス",
    loading: "読み込み中…",
    invalid: "このリンクは無効か、有効期限が切れています。ツアー担当者にお問い合わせください。",
  },
  en: {
    brand: "BondEx ・ Group luggage status",
    loading: "Loading…",
    invalid: "This link is invalid or has expired. Please contact your tour coordinator.",
  },
} as const

export default function GroupSharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = use(params)
  const [locale, setLocale] = useState<"ja" | "en">("en")
  const t = M[locale]
  const [data, setData] = useState<GroupViewPayload | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(`/api/g/${encodeURIComponent(token)}`, { cache: "no-store" })
      if (!res.ok) throw new Error()
      setData((await res.json()) as GroupViewPayload)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bondex-logo.png" alt="BondEx" className="h-7 w-auto object-contain" />
            <p className="text-xs text-muted-foreground">{t.brand}</p>
          </div>
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            {(["en", "ja"] as const).map((lc) => (
              <button
                key={lc}
                onClick={() => setLocale(lc)}
                className={`px-2.5 py-1 text-xs font-medium ${
                  locale === lc ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted/40"
                }`}
              >
                {lc.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground py-20">
            <Loader2 className="w-5 h-5 animate-spin" /> {t.loading}
          </div>
        ) : error || !data ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            {t.invalid}
          </div>
        ) : (
          <GroupDashboard data={data} locale={locale} canOperate={false} readOnly onReload={load} />
        )}
      </div>
    </main>
  )
}
