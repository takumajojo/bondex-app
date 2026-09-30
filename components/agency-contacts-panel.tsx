"use client"

// 代理店の「通知メール(複数)」「ログインユーザー(複数)」を管理する共通パネル。
// 運営(/api/operator/agencies/[id]/contacts, cookie認証)と
// 代理店セルフ(/api/agency/contacts, Bearer認証)の両方から使う。
//
// props:
//   apiBase    … 叩くエンドポイント
//   authHeader … 代理店セルフのみ: Authorization ヘッダを返す非同期関数(運営は省略)

import { useCallback, useEffect, useState } from "react"
import { Loader2, Trash2, Mail, UserPlus, Plus } from "lucide-react"

interface EmailRow { id: string; email: string; label: string | null }
interface UserRow { userId: string; email: string | null; createdAt: string | null; lastSignInAt: string | null }
interface ContactsData { emails: { primary: string | null; additional: EmailRow[] }; users: UserRow[] }

export function AgencyContactsPanel({
  apiBase,
  authHeader,
  selfUserId,
}: {
  apiBase: string
  authHeader?: () => Promise<Record<string, string>>
  selfUserId?: string
}) {
  const [data, setData] = useState<ContactsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [newEmail, setNewEmail] = useState("")
  const [newUser, setNewUser] = useState("")

  const call = useCallback(
    async (method: "GET" | "POST" | "DELETE", body?: unknown) => {
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (authHeader) Object.assign(headers, await authHeader())
      const res = await fetch(apiBase, { method, headers, body: body ? JSON.stringify(body) : undefined })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      return json as ContactsData & { note?: string | null }
    },
    [apiBase, authHeader],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const json = await call("GET")
      setData({ emails: json.emails, users: json.users })
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました")
    } finally {
      setLoading(false)
    }
  }, [call])

  useEffect(() => { void load() }, [load])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("")
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : "操作に失敗しました") } finally { setBusy(false) }
  }

  const addEmail = () => run(async () => {
    const email = newEmail.trim()
    if (!email) return
    const json = await call("POST", { action: "add_email", email })
    setData((d) => (d ? { ...d, emails: json.emails } : d))
    setNewEmail("")
  })
  const removeEmail = (emailId: string) => run(async () => {
    const json = await call("DELETE", { action: "remove_email", emailId })
    setData((d) => (d ? { ...d, emails: json.emails } : d))
  })
  const inviteUser = () => run(async () => {
    const email = newUser.trim()
    if (!email) return
    const json = await call("POST", { action: "invite_user", email })
    setData((d) => (d ? { ...d, users: json.users } : d))
    setNewUser("")
    setNotice(json.note ? String(json.note) : "招待メールを送信しました。")
  })
  const removeUser = (userId: string) => run(async () => {
    const json = await call("DELETE", { action: "remove_user", userId })
    setData((d) => (d ? { ...d, users: json.users } : d))
  })

  if (loading) return <div className="flex items-center gap-2 text-sm text-gray-500 py-6"><Loader2 className="h-4 w-4 animate-spin" /> 読み込み中…</div>

  return (
    <div className="space-y-8">
      {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
      {notice && <div className="rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-2">{notice}</div>}

      {/* 通知メール */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Mail className="h-4 w-4" /> 通知メール（集荷・配達完了などの宛先）</div>
        <p className="text-xs text-gray-500">主メールに加え、複数の宛先へ同じ通知を送ります。</p>
        <ul className="space-y-2">
          <li className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2">
            <span className="text-sm text-gray-900">{data?.emails.primary || "（主メール未設定）"}</span>
            <span className="text-[11px] text-gray-400">主メール</span>
          </li>
          {data?.emails.additional.map((e) => (
            <li key={e.id} className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2">
              <span className="text-sm text-gray-900">{e.email}</span>
              <button disabled={busy} onClick={() => removeEmail(e.id)} className="text-gray-400 hover:text-red-600 disabled:opacity-50" aria-label="削除"><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} type="email" placeholder="reservation@dmc.co.jp"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm" onKeyDown={(e) => { if (e.key === "Enter") addEmail() }} />
          <button disabled={busy || !newEmail.trim()} onClick={addEmail}
            className="inline-flex items-center gap-1 rounded-md bg-gray-900 text-white text-sm px-3 py-2 disabled:opacity-50">
            <Plus className="h-4 w-4" /> 追加
          </button>
        </div>
      </section>

      {/* ログインユーザー */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900"><UserPlus className="h-4 w-4" /> ログインユーザー（ポータルにログインできる人）</div>
        <p className="text-xs text-gray-500">追加すると招待メールが届き、本人がパスワードを設定してログインできます。</p>
        <ul className="space-y-2">
          {data?.users.map((u) => (
            <li key={u.userId} className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2">
              <span className="text-sm text-gray-900">
                {u.email || "（メール不明）"}
                {u.userId === selfUserId && <span className="ml-2 text-[11px] text-gray-400">あなた</span>}
                <span className="ml-2 text-[11px] text-gray-400">{u.lastSignInAt ? "ログイン実績あり" : "招待中/未ログイン"}</span>
              </span>
              {u.userId !== selfUserId && (
                <button disabled={busy} onClick={() => removeUser(u.userId)} className="text-gray-400 hover:text-red-600 disabled:opacity-50" aria-label="削除"><Trash2 className="h-4 w-4" /></button>
              )}
            </li>
          ))}
          {(!data || data.users.length === 0) && <li className="text-sm text-gray-400">ユーザーがいません</li>}
        </ul>
        <div className="flex gap-2">
          <input value={newUser} onChange={(e) => setNewUser(e.target.value)} type="email" placeholder="colleague@dmc.co.jp"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm" onKeyDown={(e) => { if (e.key === "Enter") inviteUser() }} />
          <button disabled={busy || !newUser.trim()} onClick={inviteUser}
            className="inline-flex items-center gap-1 rounded-md bg-gray-900 text-white text-sm px-3 py-2 disabled:opacity-50">
            <UserPlus className="h-4 w-4" /> 招待
          </button>
        </div>
      </section>
    </div>
  )
}
