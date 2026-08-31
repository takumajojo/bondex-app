"use client"

// 運営ログイン (2026-08-31 パスキー化)。
// パスキー (Touch ID / Face ID) が1台でも登録されると、ブラウザからの入場は生体認証必須。
// パスワードは「新しい端末を登録するときの本人確認」専用になる (谷口さん決定)。
// 未登録の初期状態だけは従来どおりパスワードで入場できる (ブートストラップ)。
import { Suspense, useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Fingerprint, Loader2, ShieldCheck } from "lucide-react"
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

  // registered: null=確認中 / false=パスキー未登録 (パスワードで入場+登録導線) / true=生体認証必須
  const [registered, setRegistered] = useState<boolean | null>(null)
  const [mode, setMode] = useState<"signin" | "enroll">("signin")
  const [password, setPassword] = useState("")
  const [deviceLabel, setDeviceLabel] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  // パスキーでサインイン (登録済みのとき)
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
      // ユーザーがダイアログを閉じた場合 (NotAllowedError) は静かに戻す
      const msg = e instanceof Error ? e.message : "認証に失敗しました"
      if (!/NotAllowedError|timed out|abort/i.test(msg)) setError(msg)
    }
    setBusy(false)
  }, [next, router])

  // 初期表示: 登録有無を確認し、登録済みなら即 Touch ID を出す (1タップで入場)
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

  // この端末を登録 (パスワードで本人確認 → Touch ID / Face ID を作成)
  const enroll = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      const optRes = await fetch("/api/operator/passkey/register-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const opt = await optRes.json()
      if (!optRes.ok) throw new Error(opt.error || "登録を開始できませんでした")
      const attestation = await startRegistration({ optionsJSON: opt.options })
      const verRes = await fetch("/api/operator/passkey/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, attestation, label: deviceLabel || null }),
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

  // パスキー未登録のときだけのパスワード入場 (ブートストラップ)
  const signInWithPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      const res = await fetch("/api/operator/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(
          data?.error === "PASSKEY_REQUIRED"
            ? data.message
            : data?.error || "サインインに失敗しました",
        )
        setBusy(false)
        return
      }
      router.replace(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : "サインインに失敗しました")
      setBusy(false)
    }
  }

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

        {/* 登録済み: 生体認証が正面玄関 */}
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
            <p className="text-center text-[11px] text-muted-foreground leading-relaxed">
              この管理画面は生体認証必須です。
              <br />
              パスワード単独では入場できません。
            </p>
            <button
              type="button"
              onClick={() => {
                setMode("enroll")
                setError("")
              }}
              className="w-full text-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              新しい端末を登録する（パスワードが必要）
            </button>
          </div>
        )}

        {/* 端末登録 (登録済み環境で新デバイスを足す / 未登録環境の初回) */}
        {(mode === "enroll" || registered === false) && registered !== null && (
          <form onSubmit={enroll} className="space-y-4">
            <div className="flex items-start gap-2 rounded-xl bg-slate-50 border border-border p-3">
              <ShieldCheck className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" strokeWidth={1.8} />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {registered === false
                  ? "この端末の Touch ID / Face ID を登録すると、次回から生体認証だけでサインインできます（登録後はパスワード単独で入場できなくなります）。"
                  : "パスワードで本人確認のうえ、この端末の生体認証を登録します。"}
              </p>
            </div>
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="運営パスワード"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Input
              type="text"
              placeholder="端末名（例: MacBook / iPhone）"
              value={deviceLabel}
              onChange={(e) => setDeviceLabel(e.target.value)}
              maxLength={60}
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <Button type="submit" className="w-full gap-2" disabled={busy || !password}>
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
              ) : (
                <Fingerprint className="w-4 h-4" strokeWidth={1.8} />
              )}
              この端末の生体認証を登録
            </Button>
            {registered === false && (
              <button
                type="button"
                onClick={(e) => void signInWithPassword(e as unknown as React.FormEvent)}
                disabled={busy || !password}
                className="w-full text-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
              >
                登録せずパスワードで入場（パスキー未登録の間のみ）
              </button>
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
          </form>
        )}

        {registered === true && mode === "signin" && error && (
          <p className="text-center text-xs text-red-600">{error}</p>
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
