"use client"

// パスワード再設定 (2026-08-31 監査対応)。
// 従来は再設定導線が存在せず、パスワードを忘れた代理店はサポート経由でしか復旧できなかった。
// ログイン画面の「パスワードをお忘れですか?」→ Supabase がメールのリンクでここへ誘導し、
// recovery セッションが張られた状態で新パスワードを設定する。
import { Suspense, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getBrowserSupabase } from "@/lib/supabase-browser"
import { useAgencyLocale, AgencyLocaleToggle } from "@/lib/agency-i18n"

const messages = {
  en: {
    title: "Set a new password",
    lead: "Enter a new password for your agency account.",
    password: "New password (8+ characters)",
    confirm: "Confirm new password",
    submit: "Update password",
    mismatch: "Passwords do not match.",
    tooShort: "Password must be at least 8 characters.",
    noSession:
      "This reset link is invalid or has expired. Please request a new one from the sign-in page.",
    done: "Password updated. Redirecting to the portal…",
    failed: "Could not update the password. Please request a new reset email.",
    backToLogin: "Back to sign in",
  },
  ja: {
    title: "新しいパスワードを設定",
    lead: "代理店アカウントの新しいパスワードを入力してください。",
    password: "新しいパスワード（8文字以上）",
    confirm: "新しいパスワード（確認）",
    submit: "パスワードを更新",
    mismatch: "パスワードが一致しません。",
    tooShort: "パスワードは8文字以上にしてください。",
    noSession:
      "この再設定リンクは無効か期限切れです。サインイン画面からもう一度お手続きください。",
    done: "パスワードを更新しました。ポータルへ移動します…",
    failed: "パスワードを更新できませんでした。再設定メールをもう一度お送りください。",
    backToLogin: "サインインへ戻る",
  },
} as const

function ResetForm() {
  const router = useRouter()
  const { locale, setLocale } = useAgencyLocale()
  const t = messages[locale]
  const [ready, setReady] = useState<"checking" | "ok" | "no-session">("checking")
  const [pw, setPw] = useState("")
  const [pw2, setPw2] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)

  // メールのリンク経由なら Supabase が recovery セッションを張っている。
  // 直接開いた/期限切れの場合は案内を出す (白画面にしない)。
  useEffect(() => {
    const sb = getBrowserSupabase()
    if (!sb) {
      setReady("no-session")
      return
    }
    void sb.auth.getSession().then(({ data }) => {
      setReady(data.session ? "ok" : "no-session")
    })
  }, [])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (pw.length < 8) return setError(t.tooShort)
    if (pw !== pw2) return setError(t.mismatch)
    setSubmitting(true)
    try {
      const sb = getBrowserSupabase()
      if (!sb) throw new Error("not configured")
      const { error: err } = await sb.auth.updateUser({ password: pw })
      if (err) throw err
      setDone(true)
      setTimeout(() => router.replace("/agency"), 1500)
    } catch {
      setError(t.failed)
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-3">
        <div className="flex justify-end">
          <AgencyLocaleToggle locale={locale} onChange={setLocale} />
        </div>
        <div className="w-full bg-white rounded-2xl border border-border p-8 space-y-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bondex-logo.png" alt="BondEx" className="mx-auto h-14 w-auto object-contain" />
          <h1 className="text-center text-base font-semibold text-foreground">{t.title}</h1>

          {ready === "checking" && (
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.6} />
            </p>
          )}

          {ready === "no-session" && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground leading-relaxed">{t.noSession}</p>
              <a
                href="/agency/login"
                className="inline-block text-sm font-medium text-[#C8102E] underline underline-offset-2"
              >
                {t.backToLogin}
              </a>
            </div>
          )}

          {ready === "ok" && !done && (
            <form onSubmit={onSubmit} className="space-y-4">
              <p className="text-sm text-muted-foreground">{t.lead}</p>
              <Input
                type="password"
                autoComplete="new-password"
                placeholder={t.password}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                required
              />
              <Input
                type="password"
                autoComplete="new-password"
                placeholder={t.confirm}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                required
              />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} /> : t.submit}
              </Button>
            </form>
          )}

          {done && <p className="text-center text-sm text-emerald-700">{t.done}</p>}
        </div>
      </div>
    </main>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  )
}
