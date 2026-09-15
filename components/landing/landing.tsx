"use client"

import { useState } from "react"
import { preload } from "react-dom"
import Link from "next/link"
import { ArrowRight, Menu, X, Plus, Minus } from "lucide-react"
import { messages, type Locale } from "@/lib/landing-messages"
import { PRICING, formatYen, fill } from "@/lib/pricing"
import { LangSwitcher } from "./lang-switcher"

// ─────────────────────────────────────────────────────────────
// BondEx ランディング (6言語共通)
//
// 2026-09-15 リニューアル: 営業資料「BondEx サービス概要」(docs/collateral/service-overview)
// と同じ構成・同じイラストで組み直した。方針:
//   - セクションごとに型を変える (画像+文章の2カラム / 実物スクリーンショット / 比較表)。
//     「小見出し + 2行見出し + 白カード3枚」の繰り返しはしない。
//   - アイコン (丸の中の線画) と装飾 SVG は使わない。イラストと実物だけ。
//   - 画像は public/lp/*.webp (scripts/build-lp-images.mjs で生成)。角丸・影は付けない。
//   - 英語の小見出し (THE CHALLENGE 等) は資料と共通のブランド要素なので全言語で英語固定。
// ─────────────────────────────────────────────────────────────

const NAV_HREFS = ["#function", "#difference", "#deliverables", "#trust", "#price", "#faq"] as const

// 導入相談の遷移先。BondEx 専用のオンサイトフォーム (/contact) に統一。
const CONTACT_FORM_URL = "/contact"

// Design tokens (white-based palette, red brand accent)
//   text-1 #0F172A / text-2 #334155 / text-3 #64748B / border #E5E7EB / red #C8102E / alt-bg #F7F8FA

// ── LP 画像の台帳 (幅・高さは CLS 防止のため必須。widths は srcset の候補) ──
type LpImage = { w: number; h: number; widths: number[] }
const LP_IMAGES = {
  "hero-desktop": { w: 1672, h: 941, widths: [1672, 1200, 900] },
  "hero-mobile": { w: 1122, h: 1402, widths: [1122, 750] },
  "pain-street": { w: 1536, h: 1024, widths: [1536, 900, 600] },
  "pain-station": { w: 1536, h: 1024, widths: [1536, 900, 600] },
  "concept-family": { w: 1122, h: 1402, widths: [1122, 750, 500] },
  "portal-new": { w: 1060, h: 1325, widths: [1060, 750, 500] },
  "flow-02-handover": { w: 1122, h: 1402, widths: [1122, 750, 500] },
  "flow-03-truck": { w: 1003, h: 1254, widths: [1003, 750, 500] },
  "flow-04-receive": { w: 1122, h: 1402, widths: [1122, 750, 500] },
  "flow-05-mail": { w: 1122, h: 1402, widths: [1122, 750, 500] },
  "fit-couple": { w: 1122, h: 1402, widths: [1122, 750, 500] },
  "group-lobby": { w: 1122, h: 1402, widths: [1122, 750, 500] },
  "portal-list": { w: 2000, h: 391, widths: [2000, 1200, 800] },
  "japan-map": { w: 1294, h: 918, widths: [1294, 800] },
  "support-operator": { w: 1122, h: 1402, widths: [1122, 750, 500] },
  "closing-handshake": { w: 1122, h: 1402, widths: [1122, 750, 500] },
} satisfies Record<string, LpImage>
type LpImageName = keyof typeof LP_IMAGES

function lpSrcSet(name: LpImageName) {
  return LP_IMAGES[name].widths.map((w, i) => `/lp/${name}${i === 0 ? "" : `-${w}`}.webp ${w}w`).join(", ")
}

function Pic({
  name,
  alt,
  sizes,
  className = "",
  priority = false,
}: {
  name: LpImageName
  alt: string
  /** srcset 用の sizes。省略時は「PC は半幅・スマホは全幅」 */
  sizes?: string
  className?: string
  priority?: boolean
}) {
  const img = LP_IMAGES[name]
  const srcSet = lpSrcSet(name)
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/lp/${name}.webp`}
      srcSet={srcSet}
      sizes={sizes ?? "(min-width: 768px) 50vw, 100vw"}
      width={img.w}
      height={img.h}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={`block w-full h-auto ${className}`}
    />
  )
}

// 英語の小見出し (資料と共通)。dark は赤背景セクション用。
function Eyebrow({ en, dark = false }: { en: string; label?: string; dark?: boolean }) {
  return (
    <p className={`text-[11px] font-semibold tracking-[0.24em] uppercase mb-5 ${dark ? "text-white/85" : "text-[#C8102E]"}`}>
      {en}
    </p>
  )
}

// 複数行の見出し。行ごとに改行する (資料の見出しと同じ)。
function H2({ lines, className = "" }: { lines: string[]; className?: string }) {
  return (
    <h2
      className={`text-[28px] sm:text-[34px] md:text-[40px] lg:text-[44px] font-bold tracking-normal leading-[1.35] text-[#0F172A] text-balance ${className}`}
    >
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {line}
        </span>
      ))}
    </h2>
  )
}

// 既存辞書の TwoLine 見出し用 (md 以上でのみ改行)。
function SectionH2({ first, second, className = "" }: { first: string; second?: string; className?: string }) {
  return (
    <h2
      className={`text-[28px] sm:text-[34px] md:text-[40px] lg:text-[44px] font-bold tracking-normal leading-[1.35] text-[#0F172A] ${className}`}
    >
      {first}
      {second && (
        <>
          <br className="hidden md:inline" />
          {second}
        </>
      )}
    </h2>
  )
}

// 箇条書き (資料と同じ「・」始まりの静かなリスト)
function Dots({ items, className = "" }: { items: string[]; className?: string }) {
  return (
    <ul className={`space-y-2 ${className}`}>
      {items.map((it) => (
        <li key={it} className="flex gap-2 text-[14px] leading-[1.8] text-[#334155]">
          <span className="text-[#94A3B8] select-none" aria-hidden>
            ·
          </span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  )
}


// 中間 CTA 帯。導入相談 (主) と代理店登録 (副) を、流れ・サポートの各セクション末尾に置く。
function CtaBand({ heading, note, consult, signup, contactHref }: { heading: string; note: string; consult: string; signup: string; contactHref: string }) {
  return (
    <div className="mt-16 md:mt-20 border-t border-[#0F172A]/15 pt-10 md:pt-12 flex flex-col md:flex-row md:items-center md:justify-between gap-6 md:gap-10">
      <div>
        <p className="text-[20px] md:text-[24px] font-bold text-[#0F172A] leading-[1.5]">{heading}</p>
        <p className="mt-1.5 text-[13px] text-[#64748B]">{note}</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 shrink-0">
        <a
          href={contactHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 px-7 h-[50px] rounded-md bg-[#C8102E] text-white text-[15px] font-bold hover:bg-[#A00D25]"
        >
          {consult}
          <ArrowRight className="w-4 h-4" strokeWidth={2} />
        </a>
        <Link
          href="/agency/signup"
          className="inline-flex items-center justify-center px-7 h-[50px] rounded-md border-2 border-[#0F172A] bg-white text-[15px] font-bold text-[#0F172A] hover:bg-[#0F172A] hover:text-white"
        >
          {signup}
        </Link>
      </div>
    </div>
  )
}

export function Landing({ lang }: { lang: Locale }) {
  const t = messages[lang]
  // 導入ご相談は選択中の言語を引き継ぐ（/contact 側で ?lang を読んで出し分け）
  const contactHref = lang === "ja" ? CONTACT_FORM_URL : `${CONTACT_FORM_URL}?lang=${lang}`
  const navItems = [
    { href: NAV_HREFS[0], label: t.nav.flow },
    { href: NAV_HREFS[1], label: t.nav.difference },
    { href: NAV_HREFS[2], label: t.nav.deliverables },
    { href: NAV_HREFS[4], label: t.nav.price },
    { href: NAV_HREFS[5], label: t.nav.faq },
  ]
  const mobileExtraNav = [
    { href: NAV_HREFS[3], label: t.nav.trust },
    { href: "/demo", label: t.nav.tryDemo },
  ]
  const [menuOpen, setMenuOpen] = useState(false)

  // LCP 画像 (ヒーロー) を先読み。media で画面幅に合う片方だけ。
  preload("/lp/hero-mobile-750.webp", { as: "image", fetchPriority: "high", imageSrcSet: lpSrcSet("hero-mobile"), imageSizes: "100vw", media: "(max-width: 1023px)" })
  preload("/lp/hero-desktop.webp", { as: "image", fetchPriority: "high", imageSrcSet: lpSrcSet("hero-desktop"), imageSizes: "100vw", media: "(min-width: 1024px)" })

  const storyImages: LpImageName[] = ["portal-new", "flow-02-handover", "flow-03-truck", "flow-04-receive", "flow-05-mail"]

  return (
    <main className="min-h-screen bg-white text-[#0F172A]">
      {/* ═══════════════ Header ═══════════════ */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-[#E5E7EB]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href={lang === "en" ? "/en" : "/"} aria-label="BondEx home" className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/lp/bondex-logo.webp" alt="BondEx" className="h-10 w-auto object-contain" />
          </Link>
          <nav className="hidden lg:flex items-center gap-6">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="whitespace-nowrap text-[14px] font-medium tracking-wide text-[#1F2937] hover:text-[#C8102E]"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2.5 lg:gap-3">
            <Link
              href="/agency/login"
              className="hidden lg:inline text-[13px] font-medium text-[#64748B] hover:text-[#0F172A] whitespace-nowrap"
            >
              {t.nav.agencyLogin}
            </Link>
            <LangSwitcher current={lang} align="right" className="hidden lg:block" />
            <span className="hidden lg:block h-5 w-px bg-[#E5E7EB]" aria-hidden="true" />
            <Link
              href="/agency/signup"
              className="hidden lg:inline-flex items-center whitespace-nowrap text-[13px] font-semibold px-4 py-2 rounded-md border border-[#0F172A]/30 text-[#0F172A] hover:border-[#0F172A]"
            >
              {t.nav.signup}
            </Link>
            <a
              href={contactHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium px-4 py-2 rounded-md bg-[#C8102E] text-white hover:bg-[#A00D25]"
            >
              {t.nav.consult}
            </a>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? t.nav.menuClose : t.nav.menuOpen}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              className="lg:hidden inline-flex items-center justify-center w-9 h-9 -mr-1 rounded-md text-[#334155] hover:bg-[#F1F5F9]"
            >
              {menuOpen ? <X className="w-5 h-5" strokeWidth={2} /> : <Menu className="w-5 h-5" strokeWidth={2} />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav id="mobile-menu" className="lg:hidden border-t border-[#E5E7EB] bg-white px-6 py-4">
            <ul className="flex flex-col divide-y divide-[#F1F5F9]">
              {[...navItems, ...mobileExtraNav].map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className="block py-3 text-[15px] font-medium text-[#1F2937] hover:text-[#C8102E]"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
              <li>
                <Link
                  href="/agency/signup"
                  onClick={() => setMenuOpen(false)}
                  className="block py-3 text-[15px] font-bold text-[#C8102E]"
                >
                  {t.nav.signup}
                </Link>
              </li>
              <li>
                <Link
                  href="/agency/login"
                  onClick={() => setMenuOpen(false)}
                  className="block py-3 text-[15px] font-medium text-[#64748B] hover:text-[#0F172A]"
                >
                  {t.nav.agencyLogin}
                </Link>
              </li>
              <li className="pt-3">
                <LangSwitcher current={lang} align="left" />
              </li>
            </ul>
          </nav>
        )}
      </header>

      {/* ═══════════════ Hero ═══════════════
          資料の表紙と同じ「空の上に見出し」。PC は横長イラストに左からの白フェード、
          スマホは縦長イラストに上からの白フェードを重ねて、文字は常に白地の上に載せる。
          文字色は本文も #0F172A (濃紺) に固定し、グレーは使わない。 */}
      <section className="relative overflow-hidden border-b border-[#E5E7EB] bg-[#EAF2FB]">
        {/* 背景イラスト: <picture> で PC(lg以上)は横長・それ未満は縦長の片方だけを読み込む (LCP対策)。
            PC は左からの白フェード、スマホは白72%を重ねて薄くし、その上に文字を載せる。 */}
        <div className="absolute inset-0" aria-hidden="true">
          <picture>
            <source media="(min-width: 1024px)" srcSet={lpSrcSet("hero-desktop")} sizes="100vw" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/lp/hero-mobile-750.webp"
              srcSet={lpSrcSet("hero-mobile")}
              sizes="100vw"
              width={LP_IMAGES["hero-mobile"].w}
              height={LP_IMAGES["hero-mobile"].h}
              alt=""
              fetchPriority="high"
              decoding="async"
              className="block h-full w-full object-cover object-[50%_35%] lg:object-[72%_100%]"
            />
          </picture>
          <div className="absolute inset-0 bg-white/72 lg:hidden" />
          <div className="hidden lg:block absolute inset-y-0 left-0 w-[68%] bg-gradient-to-r from-white from-30% via-white/80 via-70% to-transparent" />
        </div>

        <div className="relative max-w-6xl mx-auto px-5 sm:px-6 pt-12 pb-14 md:pt-20 md:pb-20 lg:pt-28 lg:pb-36">
          <div className="max-w-xl md:max-w-2xl">
            <p className="text-[11px] md:text-[12px] font-bold tracking-[0.18em] text-[#C8102E] mb-5">
              {t.hero.badgeDesktop}
            </p>
            <h1 className="text-[30px] sm:text-[36px] md:text-[42px] lg:text-[50px] font-bold leading-[1.28] tracking-normal text-[#0F172A] mb-6">
              <span className="md:hidden">
                {t.hero.titleMobile.map((line, i) => (
                  <span key={i}>
                    {i > 0 && <br />}
                    {line}
                  </span>
                ))}
              </span>
              <span className="hidden md:inline">
                {t.hero.titleDesktop.first}
                <br />
                {t.hero.titleDesktop.second}
              </span>
            </h1>
            <p className="text-[15px] md:text-[17px] font-medium text-[#0F172A] leading-[1.9] mb-8 max-w-[34em]">
              <span className="md:hidden">{t.hero.subtitleMobile}</span>
              <span className="hidden md:inline">
                {t.hero.subtitleDesktop.first}
                {t.hero.subtitleDesktop.second}
              </span>
            </p>
            {/* CTA: 導入相談 (主) / 代理店登録 (副) / サンプル PDF (テキストリンク) */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
              <a
                href={contactHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-7 h-[52px] rounded-md bg-[#C8102E] text-white text-[15px] font-bold hover:bg-[#A00D25]"
              >
                {t.hero.ctaConsult}
                <ArrowRight className="w-4 h-4" strokeWidth={2} />
              </a>
              <Link
                href="/agency/signup"
                className="inline-flex items-center justify-center gap-2 px-7 h-[52px] rounded-md border-2 border-[#0F172A] bg-white text-[15px] font-bold text-[#0F172A] hover:bg-[#0F172A] hover:text-white"
              >
                {t.nav.signup}
              </Link>
              <a
                href="/samples/bondex-sample-voucher.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 h-[52px] sm:px-2 text-[14px] font-bold text-[#0F172A] underline underline-offset-4 decoration-[#0F172A]/40 hover:decoration-[#C8102E] hover:text-[#C8102E]"
              >
                {t.hero.ctaSample}
                <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
              </a>
            </div>
            <p className="mt-3 text-[12.5px] font-medium text-[#0F172A]/80">{t.hero.replyNote}</p>

            {/* 数字で即判断できる材料 — PC はヒーロー内、スマホは下の白帯 */}
            <dl className="hidden lg:grid mt-10 grid-cols-4 gap-x-6 gap-y-4 border-t border-[#0F172A]/20 pt-5">
              {t.hero.stats.map((stat) => (
                <div key={stat.k}>
                  <dt className="text-[11px] font-medium text-[#0F172A]/70">{stat.k}</dt>
                  <dd className="text-[16px] font-bold text-[#0F172A] mt-0.5">{stat.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>
      <div className="lg:hidden border-b border-[#E5E7EB] bg-white">
        <dl className="max-w-6xl mx-auto px-5 sm:px-6 py-5 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
          {t.hero.stats.map((stat) => (
            <div key={stat.k}>
              <dt className="text-[11px] font-medium text-[#64748B]">{stat.k}</dt>
              <dd className="text-[16px] font-bold text-[#0F172A] mt-0.5">{stat.v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* ═══════════════ THE CHALLENGE ═══════════════ */}
      <section className="border-b border-[#E5E7EB]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16 md:py-28">
          <div className="max-w-3xl">
            <Eyebrow en="The Challenge" />
            <H2 lines={t.challenge.heading} />
            <p className="mt-7 text-[15px] md:text-[16px] text-[#334155] leading-[1.9] max-w-2xl">{t.challenge.lead}</p>
          </div>

          <div className="mt-12 md:mt-16 grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-12">
            <figure>
              <Pic name="pain-street" alt={t.challenge.street.alt} />
              <Dots items={t.challenge.street.items} className="mt-6" />
            </figure>
            <figure>
              <Pic name="pain-station" alt={t.challenge.station.alt} />
              <Dots items={t.challenge.station.items} className="mt-6" />
            </figure>
          </div>

          {/* 3者(代理店/ホテル/旅行者)の困りごと — 日本語のみ。罫線だけの3カラム */}
          {t.pains && (
            <div className="mt-16 md:mt-24 border-t border-[#0F172A]/15 pt-10 md:pt-14">
              <h3 className="text-[22px] md:text-[28px] font-bold leading-[1.45] text-[#0F172A] text-balance">
                {t.pains.title.pre}
                <span className="text-[#C8102E]">{t.pains.title.hl}</span>
                {t.pains.title.post}
              </h3>
              <p className="mt-4 text-[15px] text-[#334155] max-w-3xl leading-[1.9]">{t.pains.lead}</p>
              <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-8">
                {t.pains.personas.map((p) => (
                  <div key={p.name} className="flex flex-col md:border-l md:border-[#E5E7EB] md:pl-6 first:md:border-0 first:md:pl-0">
                    <p className="text-[11px] tracking-[0.18em] uppercase text-[#94A3B8]">{p.role}</p>
                    <h4 className="mt-1 text-[17px] font-bold text-[#0F172A]">{p.name}</h4>
                    <Dots items={p.items} className="mt-4 [&_li]:text-[13.5px] [&_li]:leading-[1.7]" />
                    <div className="mt-auto pt-5">
                      <div className="border-t border-[#C8102E]/30 pt-4">
                      <p className="text-[11px] font-semibold tracking-[0.18em] text-[#C8102E]">BondEx</p>
                      <p className="mt-1.5 text-[14px] leading-[1.8] text-[#0F172A]">{p.solve}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-12 text-[17px] md:text-[21px] font-bold leading-[1.7] text-[#0F172A]">
                {t.pains.closer.pre}
                <span className="text-[#C8102E]">{t.pains.closer.hl}</span>
                {t.pains.closer.post}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ═══════════════ OUR CONCEPT ═══════════════ */}
      <section className="border-b border-[#E5E7EB] bg-[#F7F8FA]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16 md:py-28 grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-12 items-center">
          <div className="md:col-span-7">
            <Eyebrow en="Our Concept" />
            <H2 lines={t.concept.heading} />
            <p className="mt-7 text-[16px] md:text-[18px] text-[#0F172A] leading-[1.9]">
              {t.concept.body.map((line, i) => (
                <span key={i}>
                  {i > 0 && <br />}
                  {line}
                </span>
              ))}
            </p>

            {/* 資料 p3 の「旅行者 / 荷物」の2本線ダイアグラム */}
            <div className="mt-10 grid grid-cols-2 gap-8 max-w-md text-center">
              {[
                { label: t.concept.travelerLabel, mid: <span className="font-serif italic text-[18px] text-[#0F172A]">{t.concept.enjoy}</span> },
                {
                  label: t.concept.luggageLabel,
                  // eslint-disable-next-line @next/next/no-img-element
                  mid: <img src="/lp/bondex-logo.webp" alt="BondEx" className="h-6 w-auto mx-auto" />,
                },
              ].map((col) => (
                <div key={col.label} className="flex flex-col items-center">
                  <p className="text-[11px] tracking-[0.18em] uppercase text-[#94A3B8]">{col.label}</p>
                  <p className="mt-2 text-[15px] text-[#334155]">Hotel A</p>
                  <span className="my-2 h-10 w-px bg-[#CBD5E1]" aria-hidden />
                  <div className="h-8 flex items-center">{col.mid}</div>
                  <span className="my-2 h-10 w-px bg-[#CBD5E1]" aria-hidden />
                  <p className="text-[15px] text-[#334155]">Hotel B</p>
                </div>
              ))}
            </div>
          </div>
          <div className="md:col-span-5">
            <Pic name="concept-family" alt={t.concept.alt} className="max-w-[420px] mx-auto md:ml-auto" sizes="(min-width: 768px) 420px, 100vw" />
          </div>
        </div>
      </section>

      {/* ═══════════════ HOW IT WORKS ═══════════════ (資料 p5 と同じ 3 + 2 の並び) */}
      <section id="function" className="border-b border-[#E5E7EB]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16 md:py-28">
          <div className="max-w-3xl">
            <Eyebrow en="How It Works" />
            <H2 lines={t.story.heading} />
          </div>

          {(() => {
            const steps = t.story.steps.map((s, i) => ({ ...s, n: String(i + 1).padStart(2, "0"), img: storyImages[i] }))
            const Step = ({ s, sizes }: { s: (typeof steps)[number]; sizes: string }) => (
              <div className="flex gap-5 md:block">
                <div className="w-[38%] shrink-0 md:w-auto">
                  <Pic name={s.img} alt={s.alt} sizes={sizes} className="border border-[#E5E7EB]" />
                </div>
                <div className="min-w-0 md:mt-5">
                  <p className="text-[11px] font-semibold tracking-[0.2em] text-[#C8102E]">STEP {s.n}</p>
                  <h3 className="mt-1.5 text-[16px] md:text-[18px] font-bold text-[#0F172A] leading-snug">{s.title}</h3>
                  <p className="mt-2 text-[13.5px] md:text-[14px] text-[#334155] leading-[1.8]">{s.body}</p>
                </div>
              </div>
            )
            return (
              <>
                <div className="mt-12 md:mt-16 grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
                  {steps.slice(0, 3).map((s) => (
                    <Step key={s.n} s={s} sizes="(min-width: 768px) 33vw, 38vw" />
                  ))}
                </div>
                {/* 4/5 段目は資料と同じく中央寄せ (6分割グリッドで 2 列ずつ・2 列目から開始) */}
                <div className="mt-10 md:mt-14 grid grid-cols-1 gap-10 md:grid-cols-6 md:gap-8">
                  {steps.slice(3).map((s, i) => (
                    <div key={s.n} className={`md:col-span-2 ${i === 0 ? "md:col-start-2" : ""}`}>
                      <Step s={s} sizes="(min-width: 768px) 33vw, 38vw" />
                    </div>
                  ))}
                </div>
              </>
            )
          })()}
          <CtaBand heading={t.contact.heading} note={t.hero.replyNote} consult={t.hero.ctaConsult} signup={t.nav.signup} contactHref={contactHref} />
        </div>
      </section>

      {/* ═══════════════ FOR EVERY TRIP ═══════════════ */}
      <section className="border-b border-[#E5E7EB]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16 md:py-28">
          <div className="max-w-3xl">
            <Eyebrow en="For Every Trip" />
            <H2 lines={t.segments.heading} />
          </div>
          <div className="mt-12 md:mt-16 grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-16">
            {[t.segments.fit, t.segments.group].map((seg, i) => (
              <div key={seg.label} className="flex gap-5 md:block">
                <div className="w-[38%] shrink-0 md:w-auto md:max-w-[360px]">
                  <Pic
                    name={i === 0 ? "fit-couple" : "group-lobby"}
                    alt={seg.alt}
                    sizes="(min-width: 768px) 360px, 38vw"
                    className="border border-[#E5E7EB]"
                  />
                </div>
                <div className="min-w-0 md:mt-6">
                  <p className="text-[11px] font-semibold tracking-[0.2em] text-[#C8102E]">{seg.label}</p>
                  <h3 className="mt-1.5 text-[18px] md:text-[21px] font-bold text-[#0F172A]">{seg.title}</h3>
                  <Dots items={seg.items} className="mt-4" />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-14 md:mt-20 border-t border-[#0F172A]/15 pt-10 grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10">
            <h3 className="md:col-span-5 text-[20px] md:text-[24px] font-bold leading-[1.5] text-[#0F172A]">
              {t.segments.privacy.title}
            </h3>
            <p className="md:col-span-7 text-[14.5px] md:text-[15px] text-[#334155] leading-[1.9]">{t.segments.privacy.body}</p>
          </div>
        </div>
      </section>

      {/* ═══════════════ FOR TRAVEL COMPANIES (従来手配との違い) ═══════════════ */}
      <section id="difference" className="border-b border-[#E5E7EB] bg-[#F7F8FA]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16 md:py-28">
          <div className="max-w-3xl">
            <Eyebrow en="For Travel Companies" />
            <SectionH2 first={t.difference.heading.first} second={t.difference.heading.second} />
            <p className="mt-7 text-[15px] md:text-[16px] text-[#334155] leading-[1.9] max-w-2xl">{t.difference.intro}</p>
          </div>

          <div className="mt-12 md:mt-16 grid grid-cols-1 md:grid-cols-2 border-t border-[#0F172A]/15 divide-y md:divide-y-0 md:divide-x divide-[#0F172A]/10">
            <div className="py-8 md:py-10 md:pr-12">
              <p className="text-[11px] tracking-[0.2em] uppercase text-[#94A3B8] mb-3">Conventional</p>
              <h3 className="text-[16px] font-bold text-[#64748B] mb-4">{t.difference.conventionalHeading}</h3>
              <p className="text-[14px] text-[#64748B] leading-[1.95]">{t.difference.conventionalBody}</p>
            </div>
            <div className="py-8 md:py-10 md:pl-12">
              <p className="text-[11px] tracking-[0.2em] text-[#C8102E] mb-3">BondEx</p>
              <h3 className="text-[16px] font-bold text-[#0F172A] mb-4">{t.difference.bondexHeading}</h3>
              <p className="text-[14px] text-[#334155] leading-[1.95]">{t.difference.bondexBody}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 border-t border-b border-[#0F172A]/15 divide-y md:divide-y-0 md:divide-x divide-[#0F172A]/10">
            {t.difference.cards.map((c, i) => (
              <div key={c.title} className="py-7 md:py-8 md:px-8 first:md:pl-0 last:md:pr-0">
                <p className="text-[11px] tracking-[0.2em] text-[#94A3B8] mb-3">{String(i + 1).padStart(2, "0")}</p>
                <h3 className="text-[17px] font-bold text-[#0F172A] leading-[1.5] mb-2">{c.title}</h3>
                <p className="text-[14px] text-[#334155] leading-[1.9]">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ DELIVERABLES (実物) ═══════════════ */}
      <section id="deliverables" className="border-b border-[#E5E7EB]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16 md:py-28">
          <div className="max-w-3xl">
            <Eyebrow en="Deliverables" />
            <SectionH2 first={t.deliverables.heading.first} second={t.deliverables.heading.second} />
          </div>
          <div className="mt-12 md:mt-16 grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-12 items-start">
            <div className="md:col-span-7">
              <div className="grid grid-cols-2 gap-4 md:gap-6">
                {[{ src: "/samples/voucher-page-1.png" }, { src: "/samples/voucher-page-2.jpg" }].map((pg, i) => {
                  const label = t.sample.pageLabels[i]
                  return (
                    <figure key={pg.src}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={pg.src}
                        alt={`${t.sample.altPrefix}${label}`}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-auto border border-[#E5E7EB] bg-white"
                      />
                      <figcaption className="mt-2 text-[11px] md:text-[12px] text-[#64748B]">{label}</figcaption>
                    </figure>
                  )
                })}
              </div>
              <p className="mt-3 text-[11px] text-[#94A3B8]">{t.sample.caption}</p>
            </div>
            <div className="md:col-span-5 divide-y divide-[#0F172A]/10 border-t border-[#0F172A]/15">
              <div className="py-6">
                <p className="text-[11px] tracking-[0.2em] uppercase text-[#94A3B8] mb-2">Voucher</p>
                <h3 className="text-[19px] font-bold text-[#0F172A] mb-3">{t.deliverables.voucherHeading}</h3>
                <p className="text-[14px] text-[#334155] leading-[1.9]">
                  {t.deliverables.voucherBody.a}
                  <strong className="text-[#0F172A]">{t.deliverables.voucherBody.strong}</strong>
                  {t.deliverables.voucherBody.b}
                </p>
              </div>
              <div className="py-6">
                <p className="text-[11px] tracking-[0.2em] uppercase text-[#94A3B8] mb-2">Shipping Label</p>
                <h3 className="text-[19px] font-bold text-[#0F172A] mb-3">{t.deliverables.waybillHeading}</h3>
                <p className="text-[14px] text-[#334155] leading-[1.9]">
                  {t.deliverables.waybillBody.a}
                  <strong className="text-[#0F172A]">{t.deliverables.waybillBody.strong}</strong>
                  {t.deliverables.waybillBody.b}
                </p>
              </div>
              <div className="py-6">
                <a
                  href="/samples/bondex-sample-voucher.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#C8102E] hover:text-[#A00D25] underline underline-offset-4"
                >
                  {t.sample.openPdf}
                  <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════ MANAGE EFFORTLESSLY (代理店ポータル実画面) ═══════════════ */}
      <section className="border-b border-[#E5E7EB] bg-[#F7F8FA]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16 md:py-28">
          <div className="max-w-3xl">
            <Eyebrow en="Manage Effortlessly" />
            <H2 lines={t.manage.heading} />
            <p className="mt-7 text-[15px] md:text-[16px] text-[#334155] leading-[1.9] max-w-2xl">{t.manage.body}</p>
          </div>
          <div className="mt-10 md:mt-14 overflow-x-auto">
            <Pic name="portal-list" alt={t.manage.alt} sizes="(min-width: 1152px) 1104px, 100vw" className="min-w-[720px] border border-[#E5E7EB] bg-white" />
          </div>
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-[#334155]">
            {t.manage.features.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span className="w-1 h-1 bg-[#C8102E]" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ═══════════════ CARRIERS (配送ネットワーク) ═══════════════ */}
      <section className="border-b border-[#E5E7EB]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16 md:py-28 grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-12 items-center">
          <div className="md:col-span-6">
            <Eyebrow en="Carriers" />
            <SectionH2 first={t.carriers.heading.first} second={t.carriers.heading.second} />
            <p className="mt-7 text-[15px] md:text-[16px] text-[#334155] leading-[1.9]">{t.carriers.body}</p>
            {t.carriers.footnote && <p className="mt-6 text-[12px] text-[#94A3B8] leading-[1.8]">{t.carriers.footnote}</p>}
          </div>
          <div className="md:col-span-6">
            <Pic name="japan-map" alt="" sizes="(min-width: 768px) 50vw, 100vw" className="max-w-[520px] mx-auto" />
          </div>
        </div>
      </section>

      {/* ═══════════════ SUPPORT WHEN IT MATTERS ═══════════════ */}
      <section id="trust" className="border-b border-[#E5E7EB] bg-[#F7F8FA]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16 md:py-28">
          <div className="max-w-3xl">
            <Eyebrow en="Support When It Matters" />
            <H2 lines={t.support.heading} />
          </div>
          <div className="mt-12 md:mt-16 grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-14 items-start">
            <div className="md:col-span-5">
              <Pic name="support-operator" alt={t.support.alt} sizes="(min-width: 768px) 40vw, 100vw" className="max-w-[440px] border border-[#E5E7EB]" />
            </div>
            <div className="md:col-span-7">
              <div className="divide-y divide-[#0F172A]/10 border-t border-[#0F172A]/15">
                {t.support.items.map((it) => (
                  <div key={it.label} className="py-5">
                    <p className="text-[11px] font-semibold tracking-[0.2em] text-[#C8102E]">{it.label}</p>
                    <h3 className="mt-1 text-[17px] md:text-[18px] font-bold text-[#0F172A]">{it.title}</h3>
                    <p className="mt-1.5 text-[14px] text-[#334155] leading-[1.8]">{it.body}</p>
                  </div>
                ))}
              </div>
              <div className="mt-8 border-l-2 border-[#C8102E] pl-5 md:pl-6">
                <p className="text-[11px] font-semibold tracking-[0.2em] text-[#C8102E]">{t.support.monitoring.label}</p>
                <h3 className="mt-1 text-[17px] md:text-[19px] font-bold text-[#0F172A]">{t.support.monitoring.title}</h3>
                <p className="mt-2 text-[14px] text-[#334155] leading-[1.85]">{t.support.monitoring.body}</p>
              </div>
              <p className="mt-6 text-[12.5px] text-[#64748B] leading-[1.8]">{t.support.note}</p>
            </div>
          </div>

          {/* 補償 / 取次 / 個人情報 / 精算 — 罫線のみの4カラム */}
          <div className="mt-16 md:mt-20 border-t border-[#0F172A]/15 pt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8">
            {t.trust.cards.map((card) => (
              <a key={card.title} href="#faq" className="block py-6 group">
                <p className="text-[11px] tracking-[0.2em] uppercase text-[#94A3B8] mb-2">{card.title}</p>
                <h3 className="text-[15.5px] font-bold text-[#0F172A] leading-snug mb-2 group-hover:text-[#C8102E]">{card.head}</h3>
                <p className="text-[13px] text-[#334155] leading-[1.8]">{card.body}</p>
              </a>
            ))}
          </div>
          <CtaBand heading={t.contact.heading} note={t.hero.replyNote} consult={t.hero.ctaConsult} signup={t.nav.signup} contactHref={contactHref} />
        </div>
      </section>

      {/* ═══════════════ PRICE — 料金 + 直接手配との比較 + フロー + CTA ═══════════════
          数値はすべて lib/pricing.ts の PRICING から生成する。 */}
      <section id="price" className="border-b border-[#E5E7EB]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16 md:py-28">
          <div className="max-w-2xl mb-10 md:mb-12">
            <Eyebrow en="Simple Pricing" />
            <SectionH2 first={t.price.heading.first} second={t.price.heading.second} />
            <p className="mt-6 text-[15px] md:text-[16px] text-[#334155] leading-[1.9]">{t.price.sub}</p>
          </div>

          <div className="border border-[#E5E7EB] bg-white p-6 md:p-8">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_1.4fr_1fr] md:gap-8 md:items-center">
              <div className="flex gap-8 md:block md:space-y-4">
                <div>
                  <p className="text-[12px] text-[#64748B]">{t.price.setup}</p>
                  <p className="text-[22px] font-bold text-[#0F172A]">{t.price.free}</p>
                </div>
                <div>
                  <p className="text-[12px] text-[#64748B]">{t.price.monthly}</p>
                  <p className="text-[22px] font-bold text-[#0F172A]">{t.price.free}</p>
                </div>
              </div>
              <div className="border-2 border-[#C8102E]/20 bg-[#C8102E]/[0.03] p-5">
                <p className="text-[12px] font-semibold tracking-wide text-[#C8102E]">{t.price.regular}</p>
                <p className="mt-1 flex items-baseline gap-1 flex-wrap">
                  <span className="text-[44px] md:text-[52px] font-bold leading-none text-[#0F172A] tabular-nums">
                    {formatYen(PRICING.regularPrice)}
                  </span>
                  <span className="text-[15px] font-medium text-[#334155]">{t.price.perItem}</span>
                  <span className="ml-1 text-[12px] text-[#64748B]">（{t.price.tax}）</span>
                </p>
                <div className="mt-4 bg-white border border-[#E5E7EB] px-4 py-3">
                  <p className="text-[12px] font-semibold text-[#0F172A]">{t.price.trial}</p>
                  <p className="mt-0.5 flex items-baseline gap-1 flex-wrap">
                    <span className="text-[22px] font-bold text-[#0F172A] tabular-nums">{formatYen(PRICING.trialPrice)}</span>
                    <span className="text-[13px] text-[#334155]">{t.price.perItem}</span>
                    <span className="ml-1 text-[11px] text-[#64748B]">（{t.price.tax}）</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#64748B]">{fill(t.price.trialNote, { limit: PRICING.trialLimit })}</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="bg-[#F7F8FA] border border-[#E5E7EB] px-4 py-3">
                  <p className="text-[13px] font-semibold text-[#0F172A]">
                    {fill(t.price.volume, { n: PRICING.volumeThreshold, d: PRICING.volumeDiscount })}
                  </p>
                </div>
                <div>
                  <p className="text-[12px] text-[#64748B]">{t.price.group}</p>
                  <p className="text-[15px] font-semibold text-[#0F172A]">{t.price.groupValue}</p>
                </div>
              </div>
            </div>
            <div className="mt-6 border-t border-[#F1F5F9] pt-4 space-y-1">
              {t.price.notes.map((n) => (
                <p key={n} className="text-[11px] text-[#94A3B8] leading-relaxed">
                  {n}
                </p>
              ))}
            </div>
          </div>

          {/* 比較 — 違うのは送料だけではない */}
          <div className="mt-14 md:mt-16">
            <h3 className="text-[20px] md:text-[26px] font-bold text-[#0F172A] leading-snug">{t.price.compareLead}</h3>
            <p className="mt-3 max-w-2xl text-[14px] md:text-[15px] text-[#334155] leading-[1.9]">{t.price.compareSub}</p>

            {/* モバイル: 各項目を縦積み */}
            <div className="mt-6 divide-y divide-[#E5E7EB] border-t border-b border-[#E5E7EB] md:hidden">
              {[{ item: t.price.costLabel, direct: t.price.costDirect, bondex: `${formatYen(PRICING.regularPrice)}${t.price.perItem}` }, ...t.price.rows].map((row) => (
                <div key={row.item} className="py-3">
                  <p className="text-[13px] font-semibold text-[#0F172A] mb-2">{row.item}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-[#94A3B8]">{t.price.colDirect}</p>
                      <p className="text-[13px] text-[#64748B]">{row.direct}</p>
                    </div>
                    <div>
                      <p className="text-[10px] tracking-wide text-[#C8102E]">{t.price.colBondex}</p>
                      <p className="text-[13px] font-medium text-[#C8102E]">{row.bondex}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* デスクトップ: 表形式 */}
            <div className="mt-6 hidden md:block overflow-x-auto">
              <table className="w-full min-w-[440px] text-sm border-collapse">
                <thead>
                  <tr className="border-b border-[#0F172A]/15">
                    <th className="text-left py-3 pr-3 font-medium text-[12px] text-[#64748B]" />
                    <th className="text-left py-3 px-3 font-medium text-[12px] text-[#64748B]">{t.price.colDirect}</th>
                    <th className="text-left py-3 pl-3 font-semibold text-[12px] text-[#C8102E]">{t.price.colBondex}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[#0F172A]/10">
                    <td className="py-3 pr-3 text-[13px] text-[#0F172A]">{t.price.costLabel}</td>
                    <td className="py-3 px-3 text-[13px] text-[#334155]">{t.price.costDirect}</td>
                    <td className="py-3 pl-3 text-[13px] font-semibold text-[#0F172A] tabular-nums whitespace-nowrap">
                      {formatYen(PRICING.regularPrice)}
                      {t.price.perItem}
                    </td>
                  </tr>
                  {t.price.rows.map((row) => (
                    <tr key={row.item} className="border-b border-[#0F172A]/10 last:border-0">
                      <td className="py-3 pr-3 text-[13px] text-[#0F172A]">{row.item}</td>
                      <td className="py-3 px-3 text-[13px] text-[#64748B]">{row.direct}</td>
                      <td className="py-3 pl-3 text-[13px] font-medium text-[#C8102E]">{row.bondex}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 業務フロー比較 */}
          <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="border border-[#E5E7EB] bg-white p-5">
              <p className="text-[11px] tracking-[0.2em] uppercase text-[#94A3B8] mb-3">{t.price.flowDirect}</p>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
                {t.price.flowDirectSteps.map((s, i) => (
                  <span key={s} className="inline-flex items-center gap-1.5">
                    {i > 0 && <ArrowRight className="w-3 h-3 text-[#CBD5E1]" strokeWidth={2} />}
                    <span className="bg-[#F1F5F9] px-2 py-1 text-[11px] text-[#334155]">{s}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="border-2 border-[#C8102E]/20 bg-[#C8102E]/[0.03] p-5">
              <p className="text-[11px] tracking-[0.2em] text-[#C8102E] mb-3">{t.price.flowBondex}</p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                {t.price.flowBondexSteps.map((s, i) => (
                  <span key={s} className="inline-flex items-center gap-2">
                    {i > 0 && <ArrowRight className="w-3.5 h-3.5 text-[#C8102E]/60" strokeWidth={2} />}
                    <span className="bg-white border border-[#C8102E]/20 px-3 py-1.5 text-[13px] font-semibold text-[#0F172A]">{s}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <p className="mt-12 text-center text-[19px] md:text-[24px] font-bold text-[#0F172A] leading-[1.6]">{t.price.closer}</p>
          <div className="mt-8 flex flex-col sm:flex-row sm:flex-wrap items-center justify-center gap-3">
            <a
              href={contactHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-md bg-[#C8102E] text-white text-[15px] font-semibold hover:bg-[#A00D25]"
            >
              {fill(t.price.ctaMain, { limit: PRICING.trialLimit })}
              <ArrowRight className="w-4 h-4" strokeWidth={1.8} />
            </a>
            <Link
              href="/agency/signup"
              className="inline-flex items-center justify-center px-8 py-4 rounded-md border-2 border-[#0F172A] bg-white text-[15px] font-bold text-[#0F172A] hover:bg-[#0F172A] hover:text-white"
            >
              {t.nav.signup}
            </Link>
            <p className="w-full text-[12px] text-[#64748B] text-center">
              {t.price.ctaSubFree} ・ {fill(t.price.ctaSubTrial, { limit: PRICING.trialLimit, price: formatYen(PRICING.trialPrice) })}
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════ FAQ ═══════════════ */}
      <section id="faq" className="border-b border-[#E5E7EB]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16 md:py-28">
          <div className="max-w-2xl">
            <Eyebrow en="FAQ" />
            <SectionH2 first={t.faq.heading.first} second={t.faq.heading.second} />
          </div>

          <div className="mt-10 md:mt-12 max-w-4xl grid grid-cols-1 md:grid-cols-3 border-t border-b border-[#0F172A]/15 divide-y md:divide-y-0 md:divide-x divide-[#0F172A]/10">
            {t.faq.callouts.map((c) => (
              <div key={c.label} className="py-5 md:py-6 md:px-6 first:md:pl-0 last:md:pr-0">
                <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-[#C8102E] mb-1.5">{c.label}</p>
                <p className="text-[14px] text-[#0F172A] leading-[1.75]">{c.text}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 max-w-4xl divide-y divide-[#E5E7EB] border-b border-[#E5E7EB]">
            {t.faq.items.map((f, i) => (
              <details key={i} className="group py-5">
                <summary className="cursor-pointer text-[16px] md:text-[17px] font-semibold flex items-center justify-between gap-4 list-none leading-[1.55] text-[#0F172A] [&::-webkit-details-marker]:hidden">
                  <span>{f.q}</span>
                  <span className="w-7 h-7 shrink-0 border border-[#E5E7EB] flex items-center justify-center group-open:bg-[#C8102E] group-open:border-[#C8102E]">
                    <Plus className="w-3.5 h-3.5 text-[#64748B] group-open:hidden" strokeWidth={2} />
                    <Minus className="w-3.5 h-3.5 text-white hidden group-open:inline-block" strokeWidth={2} />
                  </span>
                </summary>
                <p className="mt-4 text-[15px] text-[#334155] leading-[1.9] max-w-3xl">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ A LIGHTER JOURNEY (Contact) ═══════════════ */}
      <section id="contact" className="bg-[#C8102E] text-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16 md:py-28 grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-12 items-center">
          <div className="md:col-span-7">
            <Eyebrow en="A Lighter Journey" dark />
            <h2 className="text-[30px] sm:text-[36px] md:text-[44px] lg:text-[52px] font-bold tracking-normal leading-[1.3] mb-8">
              {t.contact.heading}
            </h2>
            <p className="text-[15px] md:text-[16px] text-white/95 leading-[1.9] mb-10 max-w-xl">
              {t.contact.body.first}
              <br className="hidden md:inline" />
              {t.contact.body.second}
            </p>
            <div className="flex flex-col items-start gap-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href={contactHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-3 px-8 py-4 rounded-md bg-white text-[#C8102E] text-[15px] font-bold hover:bg-white/95"
                >
                  {t.contact.cta}
                  <ArrowRight className="w-4 h-4" strokeWidth={2} />
                </a>
                <Link
                  href="/agency/signup"
                  className="inline-flex items-center justify-center px-8 py-4 rounded-md border-2 border-white text-white text-[15px] font-bold hover:bg-white/10"
                >
                  {t.nav.signup}
                </Link>
              </div>
              <p className="text-[12px] text-white/85">{t.contact.replyNote}</p>
            </div>
          </div>
          <div className="md:col-span-5">
            <Pic name="closing-handshake" alt={t.closingAlt} sizes="(min-width: 768px) 40vw, 100vw" className="max-w-[420px] md:ml-auto" />
          </div>
        </div>
      </section>

      {/* ═══════════════ Footer ═══════════════ */}
      <footer className="bg-white border-t border-[#E5E7EB]">
        <div className="max-w-6xl mx-auto px-6 py-14 flex flex-col md:flex-row items-start md:items-center justify-between gap-8 text-sm">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/lp/bondex-logo.webp" alt="BondEx" className="h-8 w-auto object-contain" />
            <p className="text-[13px] font-medium text-[#64748B] leading-loose">
              {t.footer.operatorPrefix}
              <a
                href="https://www.jojotokyo.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#334155] underline underline-offset-2 hover:text-[#C8102E]"
              >
                {t.footer.operatorName}
              </a>
              {t.footer.operatorAddress}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-7 gap-y-3 text-[13px] font-medium text-[#334155]">
            <a href="mailto:support@bondex.express" className="hover:text-[#C8102E]">support@bondex.express</a>
            <Link href="/agency/login" className="hover:text-[#C8102E]">{t.nav.agencyLogin}</Link>
            <Link href="/track" className="hover:text-[#C8102E]">{t.footer.tracking}</Link>
            <Link href="/legal/terms" className="hover:text-[#C8102E]">{t.footer.terms}</Link>
            <Link href="/legal/privacy" className="hover:text-[#C8102E]">{t.footer.privacy}</Link>
            <Link href="/legal/commercial-transactions" className="hover:text-[#C8102E]">{t.footer.commercial}</Link>
          </div>
        </div>
        <div className="border-t border-[#E5E7EB]">
          <div className="max-w-6xl mx-auto px-6 py-6 text-[12px] text-[#64748B] leading-[1.9]">
            {t.footer.disclaimer}
            <br />
            © {new Date().getFullYear()}{" "}
            <a href="https://www.jojotokyo.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[#C8102E]">
              {t.footer.operatorName}
            </a>
            {t.footer.copyrightSuffix}
          </div>
        </div>
      </footer>
    </main>
  )
}
