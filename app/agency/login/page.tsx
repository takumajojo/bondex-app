"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getBrowserSupabase } from "@/lib/supabase-browser"

/**
 * ログイン後の遷移先を検証する。オープンリダイレクト防止のため、
 * 自サイト内の /agency 配下パスのみ許可し、それ以外は /agency に丸める。
 * ("//evil.com" のようなプロトコル相対 URL や外部 URL を弾く)
 */
function safeNext(raw: string | null): string {
  if (!raw) return "/agency"
  // 単一スラッシュ始まり かつ "//" ("/\") でない = 自サイト内の絶対パス
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/agency"
  return raw.startsWith("/agency") ? raw : "/agency"
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = safeNext(searchParams.get("next"))
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSubmitting(true)
    try {
      const sb = getBrowserSupabase()
      if (!sb) {
        setError("Supabase not configured. Contact BondEx support.")
        setSubmitting(false)
        return
      }
      const { error: authErr } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (authErr) {
        setError(authErr.message || "Sign-in failed")
        setSubmitting(false)
        return
      }
      router.replace(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed")
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        method="post"
        className="w-full max-w-sm bg-white rounded-2xl border border-border p-8 space-y-6"
      >
        <div className="space-y-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bondex-logo.png"
            alt="BondEx"
            className="mx-auto h-20 w-auto object-contain"
          />
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            Agency Portal
          </p>
          <p className="text-sm text-muted-foreground">
            代理店アカウントでサインイン
          </p>
        </div>

        <div className="space-y-2">
          <Input
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12"
            required
          />
          <Input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12"
            required
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <Button
          type="submit"
          disabled={submitting || !email || !password}
          className="w-full h-12 rounded-2xl"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} /> : "Continue"}
        </Button>

        <p className="text-[11px] text-muted-foreground text-center">
          アカウント発行は BondEx 担当者にご連絡ください
        </p>
      </form>
    </main>
  )
}

export default function AgencyLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50 text-muted-foreground text-sm">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
