"use client"

// 代理店セルフ: 自社の通知メール(複数)とログインユーザー(複数)を管理する。
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"
import { getBrowserSupabase } from "@/lib/supabase-browser"
import { AgencyContactsPanel } from "@/components/agency-contacts-panel"

export default function AgencySettingsPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [selfUserId, setSelfUserId] = useState<string | undefined>(undefined)

  useEffect(() => {
    void (async () => {
      const sb = getBrowserSupabase()
      const session = sb ? (await sb.auth.getSession()).data.session : null
      if (!session) { router.replace("/agency/login?next=/agency/settings"); return }
      setSelfUserId(session.user.id)
      setReady(true)
    })()
  }, [router])

  const authHeader = useCallback(async (): Promise<Record<string, string>> => {
    const sb = getBrowserSupabase()
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
    return token ? { Authorization: `Bearer ${token}` } : {}
  }, [])

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/agency" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft className="h-4 w-4" /> ポータルへ戻る
      </Link>
      <h1 className="text-xl font-bold text-gray-900">連絡先・ユーザー設定</h1>
      <p className="mt-1 text-sm text-gray-500">通知メールの宛先と、ポータルにログインできるメンバーを管理します。</p>

      <div className="mt-8 rounded-lg border border-gray-200 p-5">
        {ready ? (
          <AgencyContactsPanel apiBase="/api/agency/contacts" authHeader={authHeader} selfUserId={selfUserId} />
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-6"><Loader2 className="h-4 w-4 animate-spin" /> 読み込み中…</div>
        )}
      </div>
    </div>
  )
}
