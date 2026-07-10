"use client"

import { useState, type FormEvent, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, Check } from "lucide-react"
import { getBrowserSupabase } from "@/lib/supabase-browser"

type Region = "domestic" | "overseas"
type Payment = "invoice" | "card"

export default function AgencySignupPage() {
  const router = useRouter()
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
        setError(data.error || "登録に失敗しました。時間をおいて再度お試しください。")
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
      setError("登録に失敗しました。ネットワークをご確認ください。")
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
          <h1 className="text-[18px] font-bold text-[#0F172A]">登録を受け付けました</h1>
          <p className="text-[13px] text-[#475569] mt-2 leading-[1.9]">
            BondEx による承認後、バウチャー発行がご利用いただけます。
            {payment === "card" && "続いて、カード登録のご案内をいたします。"}
            <br />
            ダッシュボードへ移動します…
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bondex-logo.png" alt="BondEx" className="mx-auto h-12 w-auto object-contain mb-5" />
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Agency Sign-up</p>
          <h1 className="text-[22px] font-bold text-[#0F172A] mt-1">代理店アカウント登録</h1>
          <p className="text-[13px] text-[#64748B] mt-2 leading-relaxed">
            訪日旅行代理店・ランドオペレーターさま向けの荷物配送手配サービスです。
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          method="post"
          className="rounded-2xl border border-[#E5E7EB] bg-white p-6 md:p-7 space-y-5"
        >
          <Field label="貴社名" htmlFor="agencyName" required>
            <input id="agencyName" type="text" autoComplete="organization" value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)} required className={inputCls}
              placeholder="例: ○○トラベル株式会社 / ABC Travel Co." />
          </Field>

          <Field label="ご担当者名" htmlFor="contactPerson">
            <input id="contactPerson" type="text" autoComplete="name" value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)} className={inputCls}
              placeholder="例: 山田 太郎 / John Smith" />
          </Field>

          {/* 地域 */}
          <div className="space-y-1.5">
            <span className="text-[12px] font-medium text-[#334155]">
              所在地 <span className="text-[#C8102E]">*</span>
            </span>
            <div className="grid grid-cols-2 gap-2">
              <RadioCard active={region === "domestic"} onClick={() => onRegionChange("domestic")}
                title="日本国内" sub="Domestic (Japan)" />
              <RadioCard active={region === "overseas"} onClick={() => onRegionChange("overseas")}
                title="海外" sub="Overseas" />
            </div>
          </div>

          {region === "overseas" && (
            <Field label="国 / 地域" htmlFor="country">
              <input id="country" type="text" autoComplete="country-name" value={country}
                onChange={(e) => setCountry(e.target.value)} className={inputCls}
                placeholder="例: United States / France" />
            </Field>
          )}

          {/* 決済方法 (地域ゲート) */}
          <div className="space-y-1.5">
            <span className="text-[12px] font-medium text-[#334155]">
              お支払い方法 <span className="text-[#C8102E]">*</span>
            </span>
            <div className="grid grid-cols-2 gap-2">
              <RadioCard
                active={payment === "invoice"}
                disabled={region === "overseas"}
                onClick={() => region === "domestic" && setPayment("invoice")}
                title="月次請求書払い"
                sub={region === "overseas" ? "国内のみ" : "毎月まとめてご請求"}
              />
              <RadioCard
                active={payment === "card"}
                onClick={() => setPayment("card")}
                title="カード払い"
                sub="1 件ごとに決済"
              />
            </div>
            {region === "overseas" && (
              <p className="text-[11px] text-[#94A3B8]">
                海外のお客様はカード払いのみご利用いただけます。
              </p>
            )}
          </div>

          <div className="border-t border-[#F1F5F9] pt-5 space-y-5">
            <Field label="メールアドレス" htmlFor="email" required>
              <input id="email" type="email" autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)} required className={inputCls}
                placeholder="you@example.com" />
            </Field>
            <Field label="パスワード" htmlFor="password" required>
              <input id="password" type="password" autoComplete="new-password" value={password}
                onChange={(e) => setPassword(e.target.value)} required minLength={8} className={inputCls}
                placeholder="8 文字以上" />
            </Field>
            <Field label="電話番号（任意）" htmlFor="phone">
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
            {status === "submitting" ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} /> : "登録する"}
          </button>

          <p className="text-[11px] text-[#94A3B8] leading-relaxed text-center">
            登録により{" "}
            <Link href="/legal/terms" className="underline">利用規約</Link>・
            <Link href="/legal/privacy" className="underline">プライバシーポリシー</Link>
            {" "}に同意いただいたものとします。
          </p>
        </form>

        <p className="text-center mt-5 text-[13px] text-[#64748B]">
          すでにアカウントをお持ちですか?{" "}
          <Link href="/agency/login" className="text-[#C8102E] font-medium underline underline-offset-2">
            ログイン
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
