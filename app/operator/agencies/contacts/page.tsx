"use client"

// 運営: 代理店を選び、通知メール(複数)とログインユーザー(複数)を管理する。
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2 } from "lucide-react"
import { AgencyContactsPanel } from "@/components/agency-contacts-panel"

interface AgencyLite { id: string; name: string; status?: string | null }

export default function OperatorAgencyContactsPage() {
  const [agencies, setAgencies] = useState<AgencyLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState("")

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/agencies")
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
        const list: AgencyLite[] = (json.agencies || []).map((a: AgencyLite) => ({ id: a.id, name: a.name, status: a.status }))
        list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ja"))
        setAgencies(list)
      } catch (e) {
        setError(e instanceof Error ? e.message : "代理店一覧の取得に失敗しました")
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const selectedName = useMemo(() => agencies.find((a) => a.id === selected)?.name ?? "", [agencies, selected])

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/operator/agencies" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft className="h-4 w-4" /> 代理店一覧へ戻る
      </Link>
      <h1 className="text-xl font-bold text-gray-900">代理店の連絡先・ユーザー管理</h1>
      <p className="mt-1 text-sm text-gray-500">通知メールの追加宛先と、ポータルにログインできるユーザーを管理します。</p>

      {error && <div className="mt-4 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}

      <div className="mt-6">
        <label className="block text-xs font-medium text-gray-500 mb-1">代理店を選択</label>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-3"><Loader2 className="h-4 w-4 animate-spin" /> 読み込み中…</div>
        ) : (
          <select value={selected} onChange={(e) => setSelected(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="">— 選択してください —</option>
            {agencies.map((a) => (
              <option key={a.id} value={a.id}>{a.name}{a.status && a.status !== "active" ? `（${a.status}）` : ""}</option>
            ))}
          </select>
        )}
      </div>

      {selected && (
        <div className="mt-8 rounded-lg border border-gray-200 p-5">
          <div className="text-sm font-semibold text-gray-900 mb-4">{selectedName}</div>
          <AgencyContactsPanel key={selected} apiBase={`/api/operator/agencies/${selected}/contacts`} />
        </div>
      )}
    </div>
  )
}
