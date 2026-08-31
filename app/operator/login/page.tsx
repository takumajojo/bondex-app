"use client"

// 運営ログイン (2026-08-31 パスキー化 → 同日「メアドと指紋で」に簡素化・谷口さん指示)。
//
// サインイン: 登録済み端末なら Touch ID / Face ID ワンタップ。
// 端末登録  : メールアドレス → 6桁コードがメールで届く → 指紋登録。パスワード入力は廃止
//             (運営パスワードは Vercel 環境変数で人間は覚えていないため、機械専用に格下げ)。
// パスキーが1台でも登録されると、ブラウザからの入場は生体認証必須。
import { Suspense, useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Fingerprint, Loader2, Mail, ShieldCheck } from "lucide-react"
import { startAuthentication, startRegistration } from "@simplewebauthn/browser"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/** next はオープンリダイレクト防止のため /operator 配下のみ許可。 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/operator") || raw.startsWith("//")) return "/operator"
  return raw
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = safeNext(searchParams.get("next"))

  // registered: null=確認中 / false=パスキー未登録 (登録フローへ) / true=生体認証で入場
  const [registered, setRegistered] = useState<boolean | null>(null)
  const [mode, setMode] = useState<"signin" | "enroll">("signin")
  // 登録フロー: email 入力 → コード送信済み (codeSent) → コード入力 → 指紋登録
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const signInWithPasskey = useCallback(async () => {
    setError("")
    setBusy(true)
    try {
      const optRes = await fetch("/api/operator/passkey/login-options", { method: "POST" })
      const opt = await optRes.json()
      if (!optRes.ok) throw new Error(opt.error || "認証を開始できませんでした")
      if (!opt.registered) {
        setRegistered(false)
        setBusy(false)
        return
      }
      const assertion = await startAuthentication({ optionsJSON: opt.options })
      const verRes = await fetch("/api/operator/passkey/login-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assertion }),
      })
      const ver = await verRes.json().catch(() => ({}))
      if (!verRes.ok) throw new Error(ver.error || "認証に失敗しました")
      router.replace(next)
      return
    } catch (e) {
      const msg = e instanceof Error ? e.message : "認証に失敗しました"
      if (!/NotAllowedError|timed out|abort/i.test(msg)) setError(msg)
    }
    setBusy(false)
  }, [next, router])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/operator/passkey/login-options", { method: "POST" })
        const d = await res.json()
        if (cancelled) return
        setRegistered(Boolean(d.registered))
      } catch {
        if (!cancelled) setRegistered(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 手順1: メールへ6桁コードを送る
  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      const res = await fetch("/api/operator/passkey/email-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || "コードを送信できませんでした")
      setCodeSent(true)
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "コードを送信できませんでした")
    }
    setBusy(false)
  }

  // 手順2: コード確認 → 指紋 (Touch ID / Face ID) を登録してそのまま入場
  const enroll = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      const optRes = await fetch("/api/operator/passkey/register-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      })
      const opt = await optRes.json()
      if (!optRes.ok) throw new Error(opt.error || "登録を開始できませんでした")
      const attestation = await startRegistration({ optionsJSON: opt.options })
      const verRes = await fetch("/api/operator/passkey/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, attestation }),
      })
      const ver = await verRes.json().catch(() => ({}))
      if (!verRes.ok) throw new Error(ver.error || "登録に失敗しました")
      router.replace(next)
      return
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : "登録に失敗しました"
      if (!/NotAllowedError|timed out|abort/i.test(msg)) setError(msg)
    }
    setBusy(false)
  }

  const showEnroll = (mode === "enroll" || registered === false) && registered !== null

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-border p-8 space-y-6">
        <div className="space-y-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bondex-logo.png" alt="BondEx" className="mx-auto h-16 w-auto object-contain" />
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            Operator Console
          </p>
        </div>

        {registered === null && (
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.6} />
          </p>
        )}

        {/* 登録済み: 指紋が正面玄関 */}
        {registered === true && mode === "signin" && (
          <div className="space-y-4">
            <Button
              type="button"
              onClick={() => void signInWithPasskey()}
              disabled={busy}
              className="w-full h-12 text-[15px] gap-2"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
              ) : (
                <Fingerprint className="w-5 h-5" strokeWidth={1.8} />
              )}
              Touch ID / Face ID でサインイン
            </Button>
            {error && <p className="text-center text-xs text-red-600">{error}</p>}
            <button
              type="button"
              onClick={() => {
                setMode("enroll")
                setError("")
              }}
              className="w-full text-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              新しい端末を登録する（メール認証）
            </button>
          </div>
        )}

        {/* 端末登録: メール → コード → 指紋 */}
        {showEnroll && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-xl bg-slate-50 border border-border p-3">
              <ShieldCheck className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" strokeWidth={1.8} />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                運営のメールアドレスに届く認証コードで本人確認し、この端末の
                Touch ID / Face ID を登録します。次回からは指紋だけでサインインできます。
              </p>
            </div>

            {!codeSent ? (
              <form onSubmit={sendCode} className="space-y-3">
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="メールアドレス"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                {error && <p className="text-xs text-red-600">{error}</p>}
                <Button type="submit" className="w-full gap-2" disabled={busy || !email}>
                  {busy ? (
                    <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
                  ) : (
                    <Mail className="w-4 h-4" strokeWidth={1.8} />
                  )}
                  認証コードを送信
                </Button>
              </form>
            ) : (
              <form onSubmit={enroll} className="space-y-3">
                <p className="text-[12px] text-muted-foreground">
                  {email} 宛にコードを送信しました（有効期限10分）。
                </p>
                <Input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6桁の認証コード"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                />
                {error && <p className="text-xs text-red-600">{error}</p>}
                <Button type="submit" className="w-full gap-2" disabled={busy || code.length !== 6}>
                  {busy ? (
                    <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
                  ) : (
                    <Fingerprint className="w-4 h-4" strokeWidth={1.8} />
                  )}
                  指紋を登録してサインイン
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setCodeSent(false)
                    setCode("")
                    setError("")
                  }}
                  className="w-full text-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  ← コードを再送信する
                </button>
              </form>
            )}

            {registered === true && (
              <button
                type="button"
                onClick={() => {
                  setMode("signin")
                  setError("")
                }}
                className="w-full text-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                ← サインインに戻る
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

export default function OperatorLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
