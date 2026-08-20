import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { contactMessages, resolveContactLocale, HOME_PATH } from "@/lib/contact-messages"
import { ContactForm } from "./contact-form"

// サーバーコンポーネント: ?lang をサーバーで解決し、見出し等をSSRで各言語描画する
// （client の useSearchParams だとSSRが空になりSEO/初期表示が劣化するため）。
// フォームの操作性は client の ContactForm が担う。
export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>
}) {
  const { lang } = await searchParams
  const locale = resolveContactLocale(lang)
  const t = contactMessages[locale]
  const home = HOME_PATH[locale]

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-xl mx-auto px-6 py-14 md:py-20">
        <Link
          href={home}
          className="inline-flex items-center gap-1.5 text-[13px] text-[#64748B] hover:text-[#0F172A] mb-8"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={2} />
          {t.back}
        </Link>

        <div className="mb-8">
          <p className="text-[11px] font-mono tracking-[0.2em] uppercase text-[#C8102E] mb-2">{t.eyebrow}</p>
          <h1 className="text-[26px] md:text-[30px] font-bold text-[#0F172A] leading-snug">{t.title}</h1>
          <p className="text-[14px] text-[#475569] mt-3 leading-[1.9]">{t.lead}</p>
        </div>

        <ContactForm t={t} home={home} locale={locale} />
      </div>
    </main>
  )
}
