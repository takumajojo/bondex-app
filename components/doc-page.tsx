import Link from "next/link"
import type { ReactNode } from "react"

// ─────────────────────────────────────────────────────────────
// 文書ページ (運営会社 / ガイド) の共通枠。LP と同じトークン (白地・濃紺・赤) で、
// ヘッダー = ロゴ + トップへ戻る、本文 = 読み物幅、末尾 = 導入相談 CTA + 簡易フッター。
// サーバーコンポーネント (JSON-LD は各ページが <script> で渡す)。
// ─────────────────────────────────────────────────────────────

export type DocLang = "ja" | "en"

const UI = {
  ja: { home: "BondEx トップ", consult: "導入相談へ", signup: "代理店登録（無料）", operator: "運営: 株式会社JOJO", about: "運営会社", terms: "利用規約", privacy: "プライバシー", commercial: "特定商取引法に基づく表記" },
  en: { home: "BondEx home", consult: "Contact us", signup: "Create agency account", operator: "Operated by JOJO Co., Ltd.", about: "About", terms: "Terms", privacy: "Privacy", commercial: "Commercial disclosure" },
} as const

export function DocPage({
  lang,
  eyebrow,
  title,
  lead,
  updated,
  children,
  jsonLd,
}: {
  lang: DocLang
  eyebrow: string
  title: string
  lead?: string
  /** 最終更新 (YYYY-MM-DD)。AI/検索に鮮度を示すため本文にも表示する */
  updated?: string
  children: ReactNode
  jsonLd?: object | object[]
}) {
  const u = UI[lang]
  const home = lang === "ja" ? "/" : "/en"
  const contact = lang === "ja" ? "/contact" : "/contact?lang=en"
  return (
    <main className="min-h-screen bg-white text-[#0F172A]">
      {jsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      )}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-[#E5E7EB]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 h-16 flex items-center justify-between">
          <Link href={home} aria-label="BondEx home" className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/lp/bondex-logo.webp" alt="BondEx" className="h-9 w-auto object-contain" />
          </Link>
          <nav className="flex items-center gap-4 text-[13px] font-medium">
            <Link href={home} className="hidden sm:inline text-[#64748B] hover:text-[#0F172A]">
              {u.home}
            </Link>
            <Link
              href={contact}
              className="inline-flex items-center whitespace-nowrap px-4 py-2 rounded-md bg-[#C8102E] text-white hover:bg-[#A00D25]"
            >
              {u.consult}
            </Link>
          </nav>
        </div>
      </header>

      <article className="max-w-3xl mx-auto px-5 sm:px-6 py-14 md:py-20">
        <p className="text-[11px] font-semibold tracking-[0.24em] uppercase text-[#C8102E] mb-5">{eyebrow}</p>
        <h1 className="text-[28px] sm:text-[34px] md:text-[40px] font-bold leading-[1.35] text-balance">{title}</h1>
        {lead && <p className="mt-6 text-[15px] md:text-[16px] text-[#334155] leading-[1.9]">{lead}</p>}
        {updated && (
          <p className="mt-4 text-[12px] text-[#94A3B8]">
            {lang === "ja" ? "最終更新: " : "Last updated: "}
            <time dateTime={updated}>{updated}</time>
          </p>
        )}
        <div className="doc-prose mt-10 md:mt-12">{children}</div>

        <div className="mt-16 border-t border-[#0F172A]/15 pt-10 flex flex-col sm:flex-row gap-3">
          <Link
            href={contact}
            className="inline-flex items-center justify-center px-7 h-[50px] rounded-md bg-[#C8102E] text-white text-[15px] font-bold hover:bg-[#A00D25]"
          >
            {u.consult}
          </Link>
          <Link
            href="/agency/signup"
            className="inline-flex items-center justify-center px-7 h-[50px] rounded-md border-2 border-[#0F172A] bg-white text-[15px] font-bold text-[#0F172A] hover:bg-[#0F172A] hover:text-white"
          >
            {u.signup}
          </Link>
        </div>
      </article>

      <footer className="border-t border-[#E5E7EB]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-8 flex flex-col md:flex-row md:items-center justify-between gap-4 text-[12.5px] text-[#64748B]">
          <p>
            {u.operator} · © {new Date().getFullYear()} JOJO Co., Ltd.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href={lang === "ja" ? "/about" : "/en/about"} className="hover:text-[#C8102E]">{u.about}</Link>
            <Link href="/legal/terms" className="hover:text-[#C8102E]">{u.terms}</Link>
            <Link href="/legal/privacy" className="hover:text-[#C8102E]">{u.privacy}</Link>
            <Link href="/legal/commercial-transactions" className="hover:text-[#C8102E]">{u.commercial}</Link>
          </div>
        </div>
      </footer>

      {/* 読み物の最小スタイル (Tailwind の typography プラグインは未導入のため直書き) */}
      <style>{`
        .doc-prose h2 { font-size: 22px; font-weight: 700; line-height: 1.45; margin: 2.4em 0 0.8em; color: #0F172A; }
        .doc-prose h3 { font-size: 17px; font-weight: 700; line-height: 1.5; margin: 1.8em 0 0.6em; color: #0F172A; }
        .doc-prose p, .doc-prose li { font-size: 15px; line-height: 1.9; color: #334155; }
        .doc-prose p + p { margin-top: 1em; }
        .doc-prose ul { list-style: none; padding: 0; margin: 0.8em 0; }
        .doc-prose ul li { position: relative; padding-left: 1.1em; }
        .doc-prose ul li::before { content: "·"; position: absolute; left: 0; color: #94A3B8; }
        .doc-prose ol { list-style: decimal; padding-left: 1.6em; margin: 0.8em 0; }
        .doc-prose ol li::marker { color: #C8102E; font-weight: 700; }
        .doc-prose ol li { margin: 0.35em 0; }
        .doc-prose table { width: 100%; border-collapse: collapse; margin: 1em 0 1.5em; font-size: 14px; }
        .doc-prose th, .doc-prose td { text-align: left; padding: 10px 12px 10px 0; border-bottom: 1px solid rgba(15,23,42,0.1); vertical-align: top; line-height: 1.7; }
        .doc-prose th { font-weight: 600; color: #64748B; font-size: 12px; letter-spacing: 0.04em; border-bottom-color: rgba(15,23,42,0.2); }
        .doc-prose dl { margin: 0.6em 0 1.6em; }
        .doc-prose dl > div { display: grid; grid-template-columns: 9em 1fr; gap: 8px 16px; padding: 10px 0; border-bottom: 1px solid rgba(15,23,42,0.1); }
        .doc-prose dt { font-size: 13px; color: #64748B; }
        .doc-prose dd { font-size: 15px; color: #0F172A; line-height: 1.7; }
        .doc-prose a { color: #C8102E; text-decoration: underline; text-underline-offset: 4px; }
        .doc-prose strong { color: #0F172A; }
        .doc-prose .note { font-size: 13px; color: #64748B; }
        @media (max-width: 480px) { .doc-prose dl > div { grid-template-columns: 1fr; gap: 2px; } }
      `}</style>
    </main>
  )
}
