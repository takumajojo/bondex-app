"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get("next") || "/operator"

  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSubmitting(true)
    try {
      const res = await fetch("/api/operator/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error || "Sign-in failed")
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
            Operator Console
          </p>
          <p className="text-sm text-muted-foreground">Enter the shared access password.</p>
        </div>

        <div className="space-y-2">
          <Input
            type="password"
            autoComplete="off"
            autoFocus
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <Button
          type="submit"
          disabled={submitting || !password}
          className="w-full h-12 rounded-2xl"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} /> : "Continue"}
        </Button>
      </form>
    </main>
  )
}

export default function LoginPage() {
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
