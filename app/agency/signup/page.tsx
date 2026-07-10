"use client"

import { useState, type FormEvent, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, Check } from "lucide-react"
import { getBrowserSupabase } from "@/lib/supabase-browser"
import { useAgencyLocale, AgencyLocaleToggle } from "@/lib/agency-i18n"

type Region = "domestic" | "overseas"
type Payment = "invoice" | "card"

const messages = {
  en: {
    badge: "Agency Sign-up",
    title: "Create your agency account",
    lead: "A luggage-forwarding coordination service for inbound-travel agencies and land operators.",
    agencyName: "Company name",
    agencyNamePlaceholder: "e.g. ABC Travel Co. / ○○ Travel Inc.",
    contactPerson: "Contact person",
    contactPersonPlaceholder: "e.g. John Smith / 山田 太郎",
    location: "Location",
    domestic: "Japan (domestic)",
    domesticSub: "Domestic (Japan)",
    overseas: "Overseas",
    overseasSub: "Overseas",
    country: "Country / Region",
    countryPlaceholder: "e.g. United States / France",
    payment: "Payment method",
    invoice: "Monthly invoice",
    invoiceSub: "Billed once a month",
    invoiceDomesticOnly: "Domestic only",
    card: "Card payment",
    cardSub: "Charged per shipment",
    overseasCardNote: "Overseas customers can use card payment only.",
    email: "Email",
    password: "Password",
    passwordPlaceholder: "8 characters or more",
    phone: "Phone (optional)",
    submit: "Sign up",
    agreePrefix: "By signing up you agree to our ",
    terms: "Terms of Service",
    and: " and ",
    privacy: "Privacy Policy",
    agreeSuffix: ".",
    haveAccount: "Already have an account?",
    logIn: "Log in",
    doneTitle: "Registration received",
    doneBody: "You can issue vouchers once BondEx approves your account.",
    doneCardExtra: " We'll guide you through card registration next.",
    doneRedirect: "Redirecting to your dashboard…",
    errGeneric: "Registration failed. Please try again later.",
    errNetwork: "Registration failed. Please check your network.",
  },
  ja: {
    badge: "Agency Sign-up",
    title: "代理店アカウント登録",
    lead: "訪日旅行代理店・ランドオペレーターさま向けの荷物配送手配サービスです。",
    agencyName: "貴社名",
    agencyNamePlaceholder: "例: ○○トラベル株式会社 / ABC Travel Co.",
    contactPerson: "ご担当者名",
    contactPersonPlaceholder: "例: 山田 太郎 / John Smith",
    location: "所在地",
    domestic: "日本国内",
    domesticSub: "Domestic (Japan)",
    overseas: "海外",
    overseasSub: "Overseas",
    country: "国 / 地域",
    countryPlaceholder: "例: United States / France",
    payment: "お支払い方法",
    invoice: "月次請求書払い",
    invoiceSub: "毎月まとめてご請求",
    invoiceDomesticOnly: "国内のみ",
    card: "カード払い",
    cardSub: "1 件ごとに決済",
    overseasCardNote: "海外のお客様はカード払いのみご利用いただけます。",
    email: "メールアドレス",
    password: "パスワード",
    passwordPlaceholder: "8 文字以上",
    phone: "電話番号（任意）",
    submit: "登録する",
    agreePrefix: "登録により",
    terms: "利用規約",
    and: "・",
    privacy: "プライバシーポリシー",
    agreeSuffix: " に同意いただいたものとします。",
    haveAccount: "すでにアカウントをお持ちですか?",
    logIn: "ログイン",
    doneTitle: "登録を受け付けました",
    doneBody: "BondEx による承認後、バウチャー発行がご利用いただけます。",
    doneCardExtra: "続いて、カード登録のご案内をいたします。",
    doneRedirect: "ダッシュボードへ移動します…",
    errGeneric: "登録に失敗しました。時間をおいて再度お試しください。",
    errNetwork: "登録に失敗しました。ネットワークをご確認ください。",
  },
} as const

export default function AgencySignupPage() {
  const router = useRouter()
  const { locale, setLocale } = useAgencyLocale()
  const t = messages[locale]
  const [agencyName, setAgencyName] = useState("")
  const [contactPerson, setContactPerson] = useState("")
  const [region, setRegion] = useState<Region>("domestic")
  const [country, setCountry] = useState("")
  const [payment, setPayment] = useState<Payment>("invoice")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [phone, setPhone] = useState("")
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle")
  const [error, setError] = useState("")

  // 海外を選んだら請求書払いは不可 → card に強制
  const onRegionChange = (r: Region) => {
    setRegion(r)
    if (r === "overseas") setPayment("card")
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError("")
    setStatus("submitting")
    const isDomestic = region === "domestic"
    try {
      const res = await fetch("/api/agency/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          agencyName,
          contactPerson,
          country: isDomestic ? "JP" : country,
          isDomestic,
          paymentMethod: payment,
          phone,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || t.errGeneric)
        setStatus("error")
        return
      }
      // 登録成功 → 自動ログインを試みる (承認待ちでもログインはできる)
      const sb = getBrowserSupabase()
      if (sb) {
        await sb.auth.signInWithPassword({ email: email.trim(), password }).catch(() => {})
      }
      setStatus("done")
      // カード払いなら、ログイン後の /agency でカード登録バナーが出る
      setTimeout(() => router.replace("/agency"), 1800)
    } catch {
      setError(t.errNetwork)
      setStatus("error")
    }
  }

  if (status === "done") {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
        <div className="w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-white p-8 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
            <Check className="w-6 h-6 text-emerald-700" strokeWidth={2.5} />
          </div>
          <h1 className="text-[18px] font-bold text-[#0F172A]">{t.doneTitle}</h1>
          <p className="text-[13px] text-[#475569] mt-2 leading-[1.9]">
            {t.doneBody}
            {payment === "card" && t.doneCardExtra}
            <br />
            {t.doneRedirect}
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="flex justify-end mb-4">
          <AgencyLocaleToggle locale={locale} onChange={setLocale} />
        </div>
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bondex-logo.png" alt="BondEx" className="mx-auto h-12 w-auto object-contain mb-5" />
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">{t.badge}</p>
          <h1 className="text-[22px] font-bold text-[#0F172A] mt-1">{t.title}</h1>
          <p className="text-[13px] text-[#64748B] mt-2 leading-relaxed">{t.lead}</p>
        </div>

        <form
          onSubmit={onSubmit}
          method="post"
          className="rounded-2xl border border-[#E5E7EB] bg-white p-6 md:p-7 space-y-5"
        >
          <Field label={t.agencyName} htmlFor="agencyName" required>
            <input id="agencyName" type="text" autoComplete="organization" value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)} required className={inputCls}
              placeholder={t.agencyNamePlaceholder} />
          </Field>

          <Field label={t.contactPerson} htmlFor="contactPerson">
            <input id="contactPerson" type="text" autoComplete="name" value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)} className={inputCls}
              placeholder={t.contactPersonPlaceholder} />
          </Field>

          {/* 地域 */}
          <div className="space-y-1.5">
            <span className="text-[12px] font-medium text-[#334155]">
              {t.location} <span className="text-[#C8102E]">*</span>
            </span>
            <div className="grid grid-cols-2 gap-2">
              <RadioCard active={region === "domestic"} onClick={() => onRegionChange("domestic")}
                title={t.domestic} sub={t.domesticSub} />
              <RadioCard active={region === "overseas"} onClick={() => onRegionChange("overseas")}
                title={t.overseas} sub={t.overseasSub} />
            </div>
          </div>

          {region === "overseas" && (
            <Field label={t.country} htmlFor="country">
              <input id="country" type="text" autoComplete="country-name" value={country}
                onChange={(e) => setCountry(e.target.value)} className={inputCls}
                placeholder={t.countryPlaceholder} />
            </Field>
          )}

          {/* 決済方法 (地域ゲート) */}
          <div className="space-y-1.5">
            <span className="text-[12px] font-medium text-[#334155]">
              {t.payment} <span className="text-[#C8102E]">*</span>
            </span>
            <div className="grid grid-cols-2 gap-2">
              <RadioCard
                active={payment === "invoice"}
                disabled={region === "overseas"}
                onClick={() => region === "domestic" && setPayment("invoice")}
                title={t.invoice}
                sub={region === "overseas" ? t.invoiceDomesticOnly : t.invoiceSub}
              />
              <RadioCard
                active={payment === "card"}
                onClick={() => setPayment("card")}
                title={t.card}
                sub={t.cardSub}
              />
            </div>
            {region === "overseas" && (
              <p className="text-[11px] text-[#94A3B8]">{t.overseasCardNote}</p>
            )}
          </div>

          <div className="border-t border-[#F1F5F9] pt-5 space-y-5">
            <Field label={t.email} htmlFor="email" required>
              <input id="email" type="email" autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)} required className={inputCls}
                placeholder="you@example.com" />
            </Field>
            <Field label={t.password} htmlFor="password" required>
              <input id="password" type="password" autoComplete="new-password" value={password}
                onChange={(e) => setPassword(e.target.value)} required minLength={8} className={inputCls}
                placeholder={t.passwordPlaceholder} />
            </Field>
            <Field label={t.phone} htmlFor="phone">
              <input id="phone" type="tel" autoComplete="tel" value={phone}
                onChange={(e) => setPhone(e.target.value)} className={inputCls}
                placeholder="+81-90-XXXX-XXXX" />
            </Field>
          </div>

          {error && (
            <p className="text-[13px] text-red-600" role="alert">{error}</p>
          )}

          <button
            type="submit"
            disabled={status === "submitting" || !agencyName || !email || password.length < 8}
            className="w-full h-12 rounded-xl bg-[#C8102E] text-white text-[14px] font-bold flex items-center justify-center gap-2 hover:bg-[#A00D25] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {status === "submitting" ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} /> : t.submit}
          </button>

          <p className="text-[11px] text-[#94A3B8] leading-relaxed text-center">
            {t.agreePrefix}
            <Link href="/legal/terms" className="underline">{t.terms}</Link>
            {t.and}
            <Link href="/legal/privacy" className="underline">{t.privacy}</Link>
            {t.agreeSuffix}
          </p>
        </form>

        <p className="text-center mt-5 text-[13px] text-[#64748B]">
          {t.haveAccount}{" "}
          <Link href="/agency/login" className="text-[#C8102E] font-medium underline underline-offset-2">
            {t.logIn}
          </Link>
        </p>
      </div>
    </main>
  )
}

const inputCls =
  "w-full h-12 rounded-xl border border-[#CBD5E1] px-4 text-[15px] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#C8102E]/40 focus:border-[#C8102E]"

function Field({ label, htmlFor, required, children }: {
  label: string; htmlFor: string; required?: boolean; children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-[#334155]">
        {label}
        {required && <span className="text-[#C8102E] ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}

function RadioCard({ active, disabled, onClick, title, sub }: {
  active: boolean; disabled?: boolean; onClick: () => void; title: string; sub: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`text-left rounded-xl border px-4 py-3 transition-colors ${
        disabled
          ? "border-[#E5E7EB] bg-[#F8FAFC] opacity-60 cursor-not-allowed"
          : active
            ? "border-[#C8102E] bg-[#C8102E]/5"
            : "border-[#CBD5E1] hover:border-[#94A3B8]"
      }`}
    >
      <span className={`block text-[14px] font-bold ${active ? "text-[#C8102E]" : "text-[#0F172A]"}`}>
        {title}
      </span>
      <span className="block text-[11px] text-[#64748B] mt-0.5">{sub}</span>
    </button>
  )
}
