"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Lock, Loader2 } from "lucide-react"
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
        <div className="space-y-2 text-center">
          <div className="inline-flex w-10 h-10 rounded-full bg-foreground/5 items-center justify-center">
            <Lock className="w-5 h-5 text-foreground" strokeWidth={1.5} />
          </div>
          <h1 className="text-xl font-semibold text-foreground">BondEx Operator</h1>
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
