"use client"

import { useState, type FormEvent, type ReactNode } from "react"
import Link from "next/link"
import { Loader2, Check, ArrowLeft } from "lucide-react"

export default function ContactPage() {
  const [company, setCompany] = useState("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState("")
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle")
  const [error, setError] = useState("")

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError("")
    setStatus("sending")
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, name, email, message }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "送信に失敗しました。時間をおいて再度お試しください。")
        setStatus("error")
        return
      }
      setStatus("done")
    } catch {
      setError("送信に失敗しました。ネットワークをご確認ください。")
      setStatus("error")
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-xl mx-auto px-6 py-14 md:py-20">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[13px] text-[#64748B] hover:text-[#0F172A] mb-8"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={2} />
          トップへ戻る
        </Link>

        <div className="mb-8">
          <p className="text-[11px] font-mono tracking-[0.2em] uppercase text-[#C8102E] mb-2">Contact</p>
          <h1 className="text-[26px] md:text-[30px] font-bold text-[#0F172A] leading-snug">
            BondEx 導入のご相談
          </h1>
          <p className="text-[14px] text-[#475569] mt-3 leading-[1.9]">
            訪日旅行代理店・ランドオペレーターさま向けの荷物配送手配サービスです。
            料金・運用・導入手順など、お気軽にお問い合わせください。通常 1 営業日以内にご返信します。
          </p>
        </div>

        {status === "done" ? (
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-8 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
              <Check className="w-6 h-6 text-emerald-700" strokeWidth={2.5} />
            </div>
            <h2 className="text-[18px] font-bold text-[#0F172A]">送信しました</h2>
            <p className="text-[14px] text-[#475569] mt-2 leading-[1.9]">
              お問い合わせありがとうございます。担当者より、通常 1 営業日以内に
              <br className="hidden sm:block" />
              ご入力のメールアドレス宛にご連絡いたします。
            </p>
            <Link
              href="/"
              className="inline-flex items-center justify-center mt-6 h-11 px-6 rounded-xl bg-[#0F172A] text-white text-[14px] font-bold hover:bg-[#1E293B]"
            >
              トップへ戻る
            </Link>
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            method="post"
            className="rounded-2xl border border-[#E5E7EB] bg-white p-6 md:p-8 space-y-5"
          >
            <Field label="貴社名" htmlFor="company">
              <input
                id="company"
                type="text"
                autoComplete="organization"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="例: ○○トラベル株式会社"
                className={inputCls}
              />
            </Field>

            <Field label="お名前" htmlFor="name">
              <input
                id="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: 山田 太郎"
                className={inputCls}
              />
            </Field>

            <Field label="メールアドレス" htmlFor="email" required>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className={inputCls}
              />
            </Field>

            <Field label="ご相談内容" htmlFor="message" required>
              <textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="ご質問・ご相談内容、想定される月間件数などをご記入ください。"
                required
                rows={6}
                className={`${inputCls} resize-y min-h-[120px] py-3`}
              />
            </Field>

            {error && (
              <p className="text-[13px] text-red-600" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={status === "sending" || !email || !message}
              className="w-full h-12 rounded-xl bg-[#C8102E] text-white text-[14px] font-bold flex items-center justify-center gap-2 hover:bg-[#A00D25] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {status === "sending" ? (
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
              ) : (
                "送信する"
              )}
            </button>

            <p className="text-[11px] text-[#94A3B8] leading-relaxed">
              送信により{" "}
              <Link href="/legal/privacy" className="underline">
                プライバシーポリシー
              </Link>{" "}
              に同意いただいたものとします。
            </p>
          </form>
        )}
      </div>
    </main>
  )
}

const inputCls =
  "w-full h-12 rounded-xl border border-[#CBD5E1] px-4 text-[15px] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#C8102E]/40 focus:border-[#C8102E]"

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string
  htmlFor: string
  required?: boolean
  children: ReactNode
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
