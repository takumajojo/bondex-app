"use client"

import { useState, type FormEvent, type ReactNode } from "react"
import Link from "next/link"
import { Loader2, Check, ArrowLeft } from "lucide-react"
import type { Locale } from "@/lib/landing-messages"
import type { ContactStrings } from "@/lib/contact-messages"

// フォーム本体（クライアント）。言語の解決はサーバー側で行い、辞書・戻り先を props で受ける。
export function ContactForm({
  t,
  home,
  locale,
}: {
  t: ContactStrings
  home: string
  locale: Locale
}) {
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
        body: JSON.stringify({ company, name, email, message, lang: locale }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || t.errorSend)
        setStatus("error")
        return
      }
      setStatus("done")
    } catch {
      setError(t.errorNetwork)
      setStatus("error")
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
          <Check className="w-6 h-6 text-emerald-700" strokeWidth={2.5} />
        </div>
        <h2 className="text-[18px] font-bold text-[#0F172A]">{t.doneTitle}</h2>
        <p className="text-[14px] text-[#475569] mt-2 leading-[1.9]">{t.doneBody}</p>
        <Link
          href={home}
          className="inline-flex items-center justify-center mt-6 h-11 px-6 rounded-xl bg-[#0F172A] text-white text-[14px] font-bold hover:bg-[#1E293B]"
        >
          {t.back}
        </Link>
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      method="post"
      className="rounded-2xl border border-[#E5E7EB] bg-white p-6 md:p-8 space-y-5"
    >
      <Field label={t.company} htmlFor="company">
        <input
          id="company"
          type="text"
          autoComplete="organization"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder={t.companyPh}
          className={inputCls}
        />
      </Field>

      <Field label={t.name} htmlFor="name">
        <input
          id="name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.namePh}
          className={inputCls}
        />
      </Field>

      <Field label={t.email} htmlFor="email" required>
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

      <Field label={t.message} htmlFor="message" required>
        <textarea
          id="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t.messagePh}
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
        {status === "sending" ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} /> : t.submit}
      </button>

      <p className="text-[11px] text-[#94A3B8] leading-relaxed">
        {t.privacyPre}
        <Link href="/legal/privacy" className="underline">
          {t.privacyLink}
        </Link>
        {t.privacyPost}
      </p>
    </form>
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
