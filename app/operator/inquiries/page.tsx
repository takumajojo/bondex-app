"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2, RotateCcw, Mail, Check, Inbox } from "lucide-react"

interface Inquiry {
  id: string
  company: string | null
  name: string | null
  email: string
  message: string
  source: string | null
  handled: boolean
  created_at: string
}

function fmt(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return ts
  }
}

export default function InquiriesPage() {
  const [items, setItems] = useState<Inquiry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showHandled, setShowHandled] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/operator/inquiries", { cache: "no-store" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "取得に失敗しました")
      setItems(Array.isArray(json.inquiries) ? json.inquiries : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const setHandled = useCallback(async (id: string, handled: boolean) => {
    setBusy(id)
    try {
      const res = await fetch("/api/operator/inquiries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, handled }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || "更新に失敗しました")
      }
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, handled } : it)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました")
    } finally {
      setBusy(null)
    }
  }, [])

  const visible = useMemo(
    () => (showHandled ? items : items.filter((it) => !it.handled)),
    [items, showHandled],
  )
  const unhandledCount = useMemo(() => items.filter((it) => !it.handled).length, [items])

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">BondEx 運営</p>
            <h1 className="text-xl font-semibold text-foreground mt-0.5 flex items-center gap-2">
              問い合わせ
              {unhandledCount > 0 && (
                <span className="text-xs font-medium bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">
                  未対応 {unhandledCount}
                </span>
              )}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/operator/dashboard"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
              ダッシュボード
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

      <main className="max-w-4xl mx-auto px-6 py-8">
        <label className="flex items-center gap-2 text-sm text-muted-foreground mb-5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showHandled}
            onChange={(e) => setShowHandled(e.target.checked)}
            className="rounded border-border"
          />
          対応済みも表示
        </label>

        {error && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-16 justify-center">
            <Loader2 className="w-5 h-5 animate-spin" />
            読み込み中…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground py-16">
            <Inbox className="w-8 h-8" strokeWidth={1.25} />
            <p className="text-sm">
              {items.length === 0 ? "問い合わせはまだありません。" : "未対応の問い合わせはありません。"}
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {visible.map((it) => (
              <li
                key={it.id}
                className={`rounded-xl border px-5 py-4 transition-colors ${
                  it.handled ? "border-border bg-muted/40" : "border-border bg-card"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {it.company || it.name || "（会社名なし）"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {it.name && it.company ? `${it.name}・` : ""}
                      <a href={`mailto:${it.email}`} className="underline hover:text-foreground">
                        {it.email}
                      </a>
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">{fmt(it.created_at)}</span>
                    {it.handled ? (
                      <button
                        onClick={() => void setHandled(it.id, false)}
                        disabled={busy === it.id}
                        className="text-xs text-muted-foreground hover:text-foreground underline"
                      >
                        未対応に戻す
                      </button>
                    ) : (
                      <button
                        onClick={() => void setHandled(it.id, true)}
                        disabled={busy === it.id}
                        className="flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900"
                      >
                        {busy === it.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        対応済みにする
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-3 text-sm text-foreground whitespace-pre-wrap break-words">
                  {it.message}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <a
                    href={`mailto:${it.email}?subject=${encodeURIComponent(
                      "Re: BondEx 導入相談",
                    )}`}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground hover:opacity-70"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    メールで返信
                  </a>
                  {it.handled && (
                    <span className="text-xs text-emerald-700 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> 対応済み
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
