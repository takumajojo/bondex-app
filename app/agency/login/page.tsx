"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getBrowserSupabase } from "@/lib/supabase-browser"
import { useAgencyLocale, AgencyLocaleToggle } from "@/lib/agency-i18n"

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

const messages = {
  en: {
    subtitle: "Sign in to your agency account",
    email: "Email",
    password: "Password",
    continue: "Continue",
    noAccount: "Don't have an account?",
    signUp: "Sign up",
    notConfigured: "Supabase not configured. Contact BondEx support.",
    signInFailed: "Sign-in failed",
    badCredentials: "Email or password is incorrect.",
    emailNotConfirmed: "Please confirm your email first (check your inbox).",
    forgot: "Forgot your password?",
    resetSent: "Password reset email sent. Check your inbox.",
    resetEnterEmail: "Enter your email above first, then tap this link.",
  },
  ja: {
    subtitle: "代理店アカウントでサインイン",
    email: "メールアドレス",
    password: "パスワード",
    continue: "続ける",
    noAccount: "アカウントをお持ちでない方は",
    signUp: "新規登録",
    notConfigured: "Supabase が未設定です。BondEx サポートにご連絡ください。",
    signInFailed: "サインインに失敗しました",
    badCredentials: "メールアドレスまたはパスワードが正しくありません。",
    emailNotConfirmed: "先にメールアドレスの確認を完了してください（受信箱をご確認ください）。",
    forgot: "パスワードをお忘れですか？",
    resetSent: "パスワード再設定メールを送信しました。受信箱をご確認ください。",
    resetEnterEmail: "先に上のメールアドレス欄に入力してから、このリンクを押してください。",
  },
} as const

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = safeNext(searchParams.get("next"))
  const { locale, setLocale } = useAgencyLocale()
  const t = messages[locale]
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const onForgot = async () => {
    setError("")
    setNotice("")
    const addr = email.trim()
    if (!addr) {
      setError(t.resetEnterEmail)
      return
    }
    const sb = getBrowserSupabase()
    if (!sb) {
      setError(t.notConfigured)
      return
    }
    // 存在しないメールでも成功と同じ応答にする (アカウント列挙の防止・Supabase 既定挙動)
    await sb.auth.resetPasswordForEmail(addr, {
      redirectTo: `${window.location.origin}/agency/reset-password`,
    })
    setNotice(t.resetSent)
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSubmitting(true)
    try {
      const sb = getBrowserSupabase()
      if (!sb) {
        setError(t.notConfigured)
        setSubmitting(false)
        return
      }
      const { error: authErr } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (authErr) {
        const m = (authErr.message || "").toLowerCase()
        setError(
          m.includes("invalid login credentials")
            ? t.badCredentials
            : m.includes("email not confirmed")
              ? t.emailNotConfirmed
              : `${t.signInFailed}${authErr.message ? ` (${authErr.message})` : ""}`,
        )
        setSubmitting(false)
        return
      }
      router.replace(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.signInFailed)
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-3">
        <div className="flex justify-end">
          <AgencyLocaleToggle locale={locale} onChange={setLocale} />
        </div>
        <form
          onSubmit={onSubmit}
          method="post"
          className="w-full bg-white rounded-2xl border border-border p-8 space-y-6"
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
            <p className="text-sm text-muted-foreground">{t.subtitle}</p>
          </div>

          <div className="space-y-2">
            <Input
              type="email"
              autoComplete="email"
              placeholder={t.email}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12"
              required
            />
            <Input
              type="password"
              autoComplete="current-password"
              placeholder={t.password}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12"
              required
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            {notice && <p className="text-xs text-emerald-700">{notice}</p>}
            <button
              type="button"
              onClick={() => void onForgot()}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {t.forgot}
            </button>
          </div>

          <Button
            type="submit"
            disabled={submitting || !email || !password}
            className="w-full h-12 rounded-2xl"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} /> : t.continue}
          </Button>

          <p className="text-[12px] text-muted-foreground text-center">
            {t.noAccount}{" "}
            <a href="/agency/signup" className="text-[#C8102E] font-medium underline underline-offset-2">
              {t.signUp}
            </a>
          </p>
        </form>
      </div>
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
