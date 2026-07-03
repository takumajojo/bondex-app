"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  ArrowRight,
  ChevronRight,
  FileText,
  Send,
  Sparkles,
  BadgeCheck,
  CalendarClock,
  BellRing,
  CreditCard,
  Building2,
  Clock,
  Shield,
  Handshake,
  Lock,
  Plus,
  Minus,
  Ban,
} from "lucide-react"

const CONTACT_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfztfArRTfT4lgAdcNHeZFCDE23gwWivcjgzOUOkUSH9ah_Ew/viewform?usp=header"

// ─────────────────────────────────────────────────────────────
// Design tokens (white-based palette, red brand accent)
//   bg-base   #FFFFFF (white)
//   bg-alt    #F7F8FA (cool off-white for alternating sections)
//   text-1    #0F172A (slate-900, headings)
//   text-2    #334155 (slate-700, body)
//   text-3    #64748B (slate-500, muted)
//   border    #E5E7EB (subtle)
//   red       #C8102E (brand)
//   red-hover #A00D25
// ─────────────────────────────────────────────────────────────

// Bilingual eyebrow (Latin tracked, Japanese natural)
function Eyebrow({ en, jp, dark = false }: { en: string; jp: string; dark?: boolean }) {
  return (
    <p
      className={`text-[12px] font-medium mb-5 ${dark ? "text-white/90" : "text-[#64748B]"}`}
    >
      <span className="tracking-[0.2em] uppercase">{en}</span>
      <span className={dark ? "mx-2 text-white/40" : "mx-2 text-[#CBD5E1]"}>/</span>
      <span className="tracking-normal">{jp}</span>
    </p>
  )
}

// H2 heading — mobile-safe: natural JP wrap, no forced atomic spans
function SectionH2({
  first,
  second,
  className = "",
}: {
  first: string
  second?: string
  className?: string
}) {
  return (
    <h2
      className={`text-3xl sm:text-[34px] md:text-[40px] lg:text-[44px] font-bold tracking-normal leading-[1.4] text-[#0F172A] ${className}`}
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


// ─────────────────────────────────────────────────────────────
// HeroDemo — 「15秒でわかる BondEx」自動再生ループ
// 動画ファイルの代わりにコードで描く軽量プロダクトデモ (4シーン × 約3.8秒)。
// 通信量ゼロ・自動再生・ループ。シーンの絵は LP のラインアート言語に揃える。
// ─────────────────────────────────────────────────────────────
const DEMO_SCENES = [
  {
    step: "STEP 1",
    title: "旅程表を送るだけ",
    body: "お客様の旅程 (PDF・Excel・画像) をそのまま送付",
    art: (
      <svg viewBox="0 0 320 168" className="w-full h-full" aria-hidden="true">
        <rect x="52" y="24" width="88" height="120" rx="6" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2.5" />
        <line x1="68" y1="52" x2="124" y2="52" stroke="#0F172A" strokeWidth="2.5" opacity="0.3" strokeLinecap="round" />
        <line x1="68" y1="70" x2="112" y2="70" stroke="#0F172A" strokeWidth="2.5" opacity="0.3" strokeLinecap="round" />
        <line x1="68" y1="88" x2="124" y2="88" stroke="#0F172A" strokeWidth="2.5" opacity="0.3" strokeLinecap="round" />
        <line x1="68" y1="106" x2="100" y2="106" stroke="#0F172A" strokeWidth="2.5" opacity="0.3" strokeLinecap="round" />
        <g className="bdx-slide">
          <path d="M 156 84 L 216 84 M 202 70 L 216 84 L 202 98" stroke="#C8102E" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <rect x="232" y="56" width="56" height="56" rx="10" fill="#C8102E" />
        <text x="260" y="94" textAnchor="middle" fontSize="30" fontWeight="bold" fill="#FFFFFF" fontStyle="italic">
          B
        </text>
      </svg>
    ),
  },
  {
    step: "STEP 2",
    title: "BondEx が配送を手配",
    body: "バウチャーと送り状を発行してお渡し",
    art: (
      <svg viewBox="0 0 320 168" className="w-full h-full" aria-hidden="true">
        <g className="bdx-rise">
          <rect x="64" y="34" width="86" height="112" rx="6" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2.5" />
          <rect x="64" y="34" width="86" height="20" rx="6" fill="#C8102E" />
          <text x="107" y="48" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#FFFFFF">VOUCHER</text>
          <line x1="78" y1="72" x2="136" y2="72" stroke="#0F172A" strokeWidth="2.5" opacity="0.3" strokeLinecap="round" />
          <line x1="78" y1="88" x2="124" y2="88" stroke="#0F172A" strokeWidth="2.5" opacity="0.3" strokeLinecap="round" />
          <rect x="78" y="104" width="26" height="26" fill="none" stroke="#0F172A" strokeWidth="2" opacity="0.5" />
          <rect x="84" y="110" width="6" height="6" fill="#0F172A" opacity="0.5" />
          <rect x="94" y="120" width="6" height="6" fill="#0F172A" opacity="0.5" />
        </g>
        <g className="bdx-rise-delay">
          <rect x="176" y="46" width="86" height="100" rx="6" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2.5" />
          <text x="219" y="66" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#0F172A">送り状</text>
          <line x1="190" y1="82" x2="248" y2="82" stroke="#0F172A" strokeWidth="2.5" opacity="0.3" strokeLinecap="round" />
          <line x1="190" y1="98" x2="236" y2="98" stroke="#0F172A" strokeWidth="2.5" opacity="0.3" strokeLinecap="round" />
          <g>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => (
              <rect key={k} x={190 + k * 8} y={112} width={k % 3 === 0 ? 4 : 2.5} height="22" fill="#0F172A" opacity="0.7" />
            ))}
          </g>
          <circle cx="256" cy="52" r="12" fill="#C8102E" />
          <path d="M 250 52 L 254.5 56.5 L 262 48" stroke="#FFFFFF" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    ),
  },
  {
    step: "STEP 3",
    title: "ゲストは手ぶらで移動",
    body: "荷物はホテルからホテルへ、提携の物流会社が配送",
    art: (
      <svg viewBox="0 0 320 168" className="w-full h-full" aria-hidden="true">
        <rect x="24" y="52" width="56" height="76" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2.5" />
        <rect x="38" y="66" width="10" height="10" fill="#0F172A" opacity="0.25" />
        <rect x="56" y="66" width="10" height="10" fill="#0F172A" opacity="0.25" />
        <rect x="38" y="84" width="10" height="10" fill="#0F172A" opacity="0.25" />
        <rect x="56" y="84" width="10" height="10" fill="#0F172A" opacity="0.25" />
        <rect x="44" y="106" width="16" height="22" fill="#0F172A" opacity="0.45" />
        <text x="52" y="46" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#64748B">HOTEL A</text>
        <rect x="240" y="52" width="56" height="76" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2.5" />
        <rect x="254" y="66" width="10" height="10" fill="#0F172A" opacity="0.25" />
        <rect x="272" y="66" width="10" height="10" fill="#0F172A" opacity="0.25" />
        <rect x="254" y="84" width="10" height="10" fill="#0F172A" opacity="0.25" />
        <rect x="272" y="84" width="10" height="10" fill="#0F172A" opacity="0.25" />
        <rect x="260" y="106" width="16" height="22" fill="#0F172A" opacity="0.45" />
        <text x="268" y="46" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#64748B">HOTEL B</text>
        <line x1="88" y1="128" x2="232" y2="128" stroke="#CBD5E1" strokeWidth="2" strokeDasharray="2 8" strokeLinecap="round" />
        <g className="bdx-truck">
          <rect x="0" y="96" width="34" height="22" rx="3" fill="#FFFFFF" stroke="#C8102E" strokeWidth="2.5" />
          <path d="M 34 104 h 10 l 7 8 v 6 h -17 z" fill="#FFFFFF" stroke="#C8102E" strokeWidth="2.5" strokeLinejoin="round" />
          <circle cx="10" cy="120" r="5" fill="#FFFFFF" stroke="#C8102E" strokeWidth="2.5" />
          <circle cx="42" cy="120" r="5" fill="#FFFFFF" stroke="#C8102E" strokeWidth="2.5" />
          <rect x="8" y="102" width="12" height="10" rx="1.5" fill="#C8102E" />
        </g>
      </svg>
    ),
  },
  {
    step: "STEP 4",
    title: "追跡も請求もおまかせ",
    body: "QR で配送状況を確認、料金は月次まとめ請求",
    art: (
      <svg viewBox="0 0 320 168" className="w-full h-full" aria-hidden="true">
        <rect x="70" y="20" width="76" height="132" rx="12" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2.5" />
        <rect x="84" y="40" width="48" height="48" fill="none" stroke="#0F172A" strokeWidth="2" opacity="0.6" />
        <rect x="92" y="48" width="10" height="10" fill="#0F172A" opacity="0.6" />
        <rect x="114" y="48" width="10" height="10" fill="#0F172A" opacity="0.6" />
        <rect x="92" y="70" width="10" height="10" fill="#0F172A" opacity="0.6" />
        <rect x="110" y="66" width="6" height="6" fill="#0F172A" opacity="0.6" />
        <g className="bdx-pulse">
          <circle cx="108" cy="112" r="7" fill="#C8102E" />
        </g>
        <line x1="90" y1="112" x2="126" y2="112" stroke="#CBD5E1" strokeWidth="3" strokeLinecap="round" />
        <text x="108" y="136" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#64748B">配送中</text>
        <rect x="180" y="36" width="86" height="100" rx="6" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2.5" />
        <text x="223" y="58" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#0F172A">月次請求書</text>
        <line x1="194" y1="74" x2="252" y2="74" stroke="#0F172A" strokeWidth="2.5" opacity="0.3" strokeLinecap="round" />
        <line x1="194" y1="90" x2="240" y2="90" stroke="#0F172A" strokeWidth="2.5" opacity="0.3" strokeLinecap="round" />
        <line x1="194" y1="106" x2="252" y2="106" stroke="#0F172A" strokeWidth="2.5" opacity="0.3" strokeLinecap="round" />
        <circle cx="252" cy="120" r="11" fill="#C8102E" />
        <text x="252" y="124.5" textAnchor="middle" fontSize="12" fontWeight="bold" fill="#FFFFFF">¥</text>
      </svg>
    ),
  },
]

const DEMO_INTERVAL_MS = 3800 // 4シーン × 3.8秒 ≒ 15秒ループ

function HeroDemo() {
  const [scene, setScene] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => {
      setScene((v) => (v + 1) % DEMO_SCENES.length)
    }, DEMO_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [])
  const s = DEMO_SCENES[scene]

  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white shadow-sm overflow-hidden">
      <style>{`
        /* 注: すべて transform のみで動かす (opacity を 0 から始めない)。
           CSS アニメーションが無効・凍結された環境でも内容が読めるようにするため。 */
        @keyframes bdx-truck { 0% { transform: translateX(78px); } 100% { transform: translateX(196px); } }
        .bdx-truck { animation: bdx-truck ${DEMO_INTERVAL_MS}ms linear infinite; }
        @keyframes bdx-slide { 0% { transform: translateX(-14px); } 30% { transform: translateX(0); } 100% { transform: translateX(0); } }
        .bdx-slide { animation: bdx-slide 1.4s ease-out both; }
        @keyframes bdx-rise { 0% { transform: translateY(8px); } 100% { transform: translateY(0); } }
        .bdx-rise { animation: bdx-rise 0.6s ease-out both; }
        .bdx-rise-delay { animation: bdx-rise 0.6s ease-out 0.3s both; }
        @keyframes bdx-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        .bdx-pulse { animation: bdx-pulse 1.2s ease-in-out infinite; }
        @keyframes bdx-progress { from { width: 0%; } to { width: 100%; } }
        .bdx-progress { animation: bdx-progress ${DEMO_INTERVAL_MS}ms linear both; }
        @media (prefers-reduced-motion: reduce) {
          .bdx-truck, .bdx-slide, .bdx-rise, .bdx-rise-delay, .bdx-pulse, .bdx-progress { animation: none; }
        }
      `}</style>

      <div className="flex items-center justify-between px-5 pt-4">
        <p className="text-[12px] font-bold tracking-[0.12em] text-[#0F172A]">
          15秒でわかる <span className="text-[#C8102E]">BondEx</span>
        </p>
        <div className="flex items-center gap-1.5">
          {DEMO_SCENES.map((_, i) => (
            <button
              key={i}
              aria-label={`シーン ${i + 1}`}
              onClick={() => setScene(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === scene ? "w-6 bg-[#C8102E]" : "w-1.5 bg-[#E5E7EB]"
              }`}
            />
          ))}
        </div>
      </div>

      {/* シーン描画エリア */}
      <div key={scene} className="relative h-48 sm:h-56 mx-5 mt-3 rounded-xl bg-[#F7F8FA]">
        {s.art}
      </div>

      {/* キャプション */}
      <div key={`cap-${scene}`} className="px-5 pt-4 pb-3 bdx-rise">
        <p className="text-[11px] font-mono tracking-widest text-[#C8102E] font-bold">
          {s.step}
          <span className="text-[#CBD5E1] mx-2">/</span>
          <span className="text-[#64748B] font-sans tracking-normal">4シーン自動再生</span>
        </p>
        <p className="text-[16px] font-bold text-[#0F172A] mt-1">{s.title}</p>
        <p className="text-[13px] text-[#334155] mt-0.5 leading-relaxed">{s.body}</p>
      </div>

      {/* 進行バー */}
      <div className="h-1 bg-[#F1F5F9]">
        <div key={`bar-${scene}`} className="bdx-progress h-full bg-[#C8102E]/70" />
      </div>
    </div>
  )
}

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-white text-[#0F172A]">
      {/* ═══════════════ Header ═══════════════ */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-[#E5E7EB]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" aria-label="BondEx home" className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bondex-logo.png" alt="BondEx" className="h-10 w-auto object-contain" />
          </Link>
          <nav className="hidden md:flex items-center gap-8">
            {[
              { href: "#function", label: "流れ" },
              { href: "#difference", label: "違い" },
              { href: "#deliverables", label: "発行物" },
              { href: "#trust", label: "安心の理由" },
              { href: "#price", label: "料金" },
              { href: "#faq", label: "FAQ" },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-[14px] font-medium tracking-wide text-[#1F2937] hover:text-[#C8102E] underline-offset-8 decoration-transparent hover:decoration-[#C8102E]/60"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-4">
            <a
              href={CONTACT_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium px-4 py-2 rounded-md bg-[#C8102E] text-white hover:bg-[#A00D25]"
            >
              導入相談
            </a>
            <Link
              href="/agency/login"
              className="hidden sm:inline text-[13px] font-medium text-[#64748B] hover:text-[#0F172A]"
            >
              代理店ログイン
            </Link>
          </div>
        </div>
      </header>

      {/* ═══════════════ Hero (mobile) — メッセージ先行 ═══════════════
          スマホでは写真より先に「これは何か・何が楽になるか・次の一歩」を
          1 スクロールで伝える。写真は下部に帯として残す。 */}
      <section className="md:hidden px-5 pt-10 pb-4">
        <p className="inline-flex items-center gap-2 text-[11px] font-bold tracking-wide text-[#C8102E] border border-[#C8102E]/30 bg-[#C8102E]/5 rounded-full px-3 py-1.5 mb-5">
          訪日旅行代理店・ランドオペレーター向け
        </p>
        <h1 className="text-[32px] font-bold leading-[1.35] text-[#0F172A] mb-4">
          旅程を送るだけで、
          <br />
          荷物配送手配が完了。
        </h1>
        <p className="text-[14px] text-[#334155] leading-[1.9] mb-5">
          ホテル間の荷物配送に必要な面倒ごとを、BondEx がまとめて代行します。
        </p>
        <ul className="space-y-2.5 mb-7">
          {[
            "バウチャー・送り状の作成はすべて BondEx",
            "運賃は立替、月末にまとめて一括請求",
            "変更・問い合わせの窓口も BondEx に一本化",
          ].map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-[14px] font-medium text-[#0F172A]">
              <svg viewBox="0 0 20 20" className="w-5 h-5 shrink-0 mt-[1px]" aria-hidden="true">
                <circle cx="10" cy="10" r="9" fill="none" stroke="#C8102E" strokeWidth="1.8" />
                <path d="M 6 10.5 L 8.8 13.2 L 14 7.5" fill="none" stroke="#C8102E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {b}
            </li>
          ))}
        </ul>
        <a
          href={CONTACT_FORM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full h-[52px] rounded-xl bg-[#C8102E] text-white text-[15px] font-bold hover:bg-[#A00D25]"
        >
          導入相談へ
          <ArrowRight className="w-4 h-4" strokeWidth={2} />
        </a>
        <div className="flex items-center justify-between mt-3 mb-6">
          <p className="text-[11px] text-[#64748B]">通常 1 営業日以内にご連絡します。</p>
          <a href="#price" className="text-[12px] font-medium text-[#0F172A] underline underline-offset-4 decoration-[#CBD5E1]">
            料金を見る
          </a>
        </div>
        {/* 写真は「ゲスト体験」を語るビジュアルとしてキャプション付きで使う */}
        <div
          className="relative h-52 rounded-2xl overflow-hidden bg-cover bg-center"
          style={{ backgroundImage: "url('/hero-family.png')" }}
          role="img"
          aria-label="スーツケースを持たずに日本を旅行する家族"
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4">
            <p className="text-white text-[16px] font-bold leading-snug drop-shadow">
              ゲストは手ぶらで、次の街へ。
            </p>
            <p className="text-white/85 text-[11.5px] mt-1 drop-shadow">
              お荷物はホテルからホテルへ、BondEx が配送手配
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════ Hero (desktop) — Full-bleed family image ═══════════════ */}
      <section
        className="relative w-full h-[calc(100vh-4rem)] min-h-[640px] max-h-[820px] overflow-hidden bg-cover bg-center bg-no-repeat hidden md:flex items-end"
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.0) 25%, rgba(0,0,0,0.0) 50%, rgba(0,0,0,0.78) 100%), url('/hero-family.png')",
        }}
      >
        <div className="w-full max-w-6xl mx-auto px-6 pb-16 md:pb-24 text-white">
          <p className="text-[12px] font-medium tracking-[0.15em] text-white/90 mb-6 drop-shadow">
            訪日旅行代理店様向け ・ 荷物配送手配代行
          </p>
          <h1 className="text-3xl sm:text-5xl md:text-[54px] lg:text-[64px] font-bold leading-[1.3] tracking-normal mb-8 drop-shadow-lg max-w-4xl">
            旅程を送るだけで、
            <br className="hidden md:inline" />
            荷物配送手配が完了。
          </h1>
          <p className="text-base md:text-[17px] font-medium text-white/95 max-w-2xl leading-[1.8] mb-10 drop-shadow">
            バウチャー発行・送り状手配・月次請求・変更対応まで一括で。
            <br className="hidden md:inline" />
            旅行代理店様に代わり、BondEx が配送事業者との取次を担当します。
          </p>
          <div className="flex flex-col items-start gap-3">
            <a
              href={CONTACT_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-7 py-4 rounded-md bg-[#C8102E] text-white text-[15px] font-medium hover:bg-[#A00D25]"
            >
              導入相談へ
              <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
            </a>
            <p className="text-[12px] text-white/85 drop-shadow ml-1">
              通常 1 営業日以内にご連絡します。
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════ 15秒でわかる BondEx (自動再生デモ) ═══════════════ */}
      <section className="max-w-6xl mx-auto px-5 sm:px-6 pt-6 md:pt-20">
        <div className="max-w-2xl mx-auto">
          <HeroDemo />
        </div>
      </section>

      {/* ═══════════════ Value in 3 (compact pictograms) ═══════════════ */}
      <section className="max-w-6xl mx-auto px-5 sm:px-6 pt-12 pb-16 md:pt-20 md:pb-32">
        <div className="grid gap-7 md:grid-cols-3 md:gap-16">
          {[
            {
              n: "01",
              title: "旅程を送るだけ",
              body: "PDF / Excel / 画像。何でも受け付けます。",
              icon: (
                <svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg" className="w-16 h-16">
                  <rect x="18" y="12" width="52" height="72" rx="4" fill="#F7F8FA" stroke="#0F172A" strokeWidth="2.5" />
                  <line x1="28" y1="30" x2="60" y2="30" stroke="#0F172A" strokeWidth="2" opacity="0.3" strokeLinecap="round" />
                  <line x1="28" y1="42" x2="52" y2="42" stroke="#0F172A" strokeWidth="2" opacity="0.3" strokeLinecap="round" />
                  <line x1="28" y1="54" x2="60" y2="54" stroke="#0F172A" strokeWidth="2" opacity="0.3" strokeLinecap="round" />
                  <line x1="28" y1="66" x2="46" y2="66" stroke="#0F172A" strokeWidth="2" opacity="0.3" strokeLinecap="round" />
                  <path d="M 70 48 L 86 48 M 80 42 L 86 48 L 80 54" stroke="#C8102E" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ),
            },
            {
              n: "02",
              title: "発行物一式が届く",
              body: "バウチャー・送り状を Google Drive で共有。",
              icon: (
                <svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg" className="w-16 h-16">
                  <rect x="22" y="26" width="42" height="56" rx="3" fill="#F7F8FA" stroke="#0F172A" strokeWidth="2.5" opacity="0.6" />
                  <rect x="30" y="18" width="42" height="56" rx="3" fill="#F7F8FA" stroke="#0F172A" strokeWidth="2.5" opacity="0.8" />
                  <rect x="38" y="10" width="42" height="56" rx="3" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2.5" />
                  <line x1="46" y1="24" x2="72" y2="24" stroke="#0F172A" strokeWidth="2" opacity="0.4" strokeLinecap="round" />
                  <line x1="46" y1="34" x2="66" y2="34" stroke="#0F172A" strokeWidth="2" opacity="0.4" strokeLinecap="round" />
                  <line x1="46" y1="44" x2="72" y2="44" stroke="#0F172A" strokeWidth="2" opacity="0.4" strokeLinecap="round" />
                  <circle cx="72" cy="58" r="6" fill="#C8102E" />
                  <path d="M 69 58 L 71 60 L 75 56" stroke="#FFFFFF" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ),
            },
            {
              n: "03",
              title: "月次まとめ請求",
              body: "運賃立替、月末締め翌月末払い。",
              icon: (
                <svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg" className="w-16 h-16">
                  <rect x="16" y="20" width="64" height="60" rx="4" fill="#F7F8FA" stroke="#0F172A" strokeWidth="2.5" />
                  <rect x="16" y="20" width="64" height="14" fill="#0F172A" />
                  <line x1="30" y1="12" x2="30" y2="26" stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="66" y1="12" x2="66" y2="26" stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round" />
                  <circle cx="30" cy="46" r="2" fill="#64748B" />
                  <circle cx="42" cy="46" r="2" fill="#64748B" />
                  <circle cx="54" cy="46" r="2" fill="#64748B" />
                  <circle cx="66" cy="46" r="2" fill="#64748B" />
                  <circle cx="30" cy="58" r="2" fill="#64748B" />
                  <circle cx="42" cy="58" r="2" fill="#64748B" />
                  <circle cx="54" cy="58" r="2" fill="#64748B" />
                  <circle cx="66" cy="58" r="4" fill="#C8102E" />
                  <text x="66" y="61.5" textAnchor="middle" fontSize="6" fontWeight="bold" fill="#FFFFFF">
                    ¥
                  </text>
                  <circle cx="30" cy="70" r="2" fill="#64748B" />
                  <circle cx="42" cy="70" r="2" fill="#64748B" />
                </svg>
              ),
            },
          ].map((v) => (
            <div key={v.n} className="flex items-start gap-4 md:block">
              {/* モバイル: 枠付きの小アイコンを左に、テキストを右に (縦の間延び防止) */}
              <div className="w-14 h-14 shrink-0 rounded-2xl border border-[#E5E7EB] bg-[#F7F8FA] flex items-center justify-center [&_svg]:w-9 [&_svg]:h-9 md:w-auto md:h-auto md:border-0 md:bg-transparent md:rounded-none md:block md:mb-6 md:[&_svg]:w-16 md:[&_svg]:h-16">
                {v.icon}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-mono tracking-widest text-[#64748B] mb-1 md:mb-3">{v.n}</p>
                <h3 className="text-[16px] md:text-xl font-bold tracking-tight mb-1 md:mb-4 text-[#0F172A]">{v.title}</h3>
                <p className="text-[13px] md:text-[15px] font-medium text-[#334155] leading-[1.75] md:leading-[1.85]">{v.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════ Difference — 旅行商品の付加価値化 ═══════════════ */}
      <section id="difference" className="border-y border-[#E5E7EB] bg-white">
        <div className="max-w-5xl mx-auto px-5 sm:px-6 py-20 md:py-28">
          <div className="mb-14 md:mb-16 max-w-2xl">
            <Eyebrow en="DIFFERENCE" jp="従来手配との違い" />
            <SectionH2 first="荷物配送を、" second="旅行商品の一部に。" />
            <p className="mt-7 text-[15px] md:text-[16px] text-[#334155] leading-[1.9]">
              BondEx は、旅程データをもとに荷物配送の手配・発行物・月次請求まで代行します。
              旅行代理店様は、手ぶら観光やホテル間配送を旅行プランの付加価値として案内できます。
            </p>
          </div>

          {/* Quiet editorial comparison — hairline rules only, no icons/circles/timeline */}
          <div className="grid md:grid-cols-2 border-t border-[#0F172A]/15 divide-y md:divide-y-0 md:divide-x divide-[#0F172A]/10 mb-14 md:mb-16">
            <div className="py-8 md:py-10 md:pr-12">
              <p className="text-[11px] font-mono tracking-widest uppercase text-[#94A3B8] mb-3">
                Conventional
              </p>
              <h3 className="text-[16px] font-bold text-[#64748B] mb-4">従来の手配</h3>
              <p className="text-[14px] text-[#64748B] leading-[1.95]">
                旅行者自身が配送業者を探し、個別に申込・支払いを行います。
                バウチャーや送り状は旅程とは別に管理され、変更や遅延の問い合わせも旅行者本人が対応します。
              </p>
            </div>
            <div className="py-8 md:py-10 md:pl-12">
              <p className="text-[11px] font-mono tracking-widest uppercase text-[#C8102E] mb-3">
                BondEx
              </p>
              <h3 className="text-[16px] font-bold text-[#0F172A] mb-4">弊社の手配</h3>
              <p className="text-[14px] text-[#334155] leading-[1.95]">
                代理店様が旅程データを送るだけで、バウチャー・送り状・追跡情報をまとめて準備します。
                配送費は旅行代金に含められ、手ぶら観光を旅行プランの一部としてご案内いただけます。
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4 md:gap-5">
            {[
              {
                n: "01",
                title: "旅行商品に組み込める",
                body:
                  "手ぶら観光・ホテル間配送を、旅程に含まれるサービスとして案内できます。",
              },
              {
                n: "02",
                title: "手配が一本化される",
                body:
                  "旅程データを送るだけで、バウチャー・送り状・追跡情報までまとめて準備します。",
              },
              {
                n: "03",
                title: "月次請求で処理できる",
                body:
                  "配送費は個別決済ではなく、代理店様宛に月次でまとめて請求できます。",
              },
            ].map((c) => (
              <div
                key={c.n}
                className="rounded-lg border border-[#E5E7EB] bg-white p-6 md:p-7 border-l-2 border-l-[#C8102E]"
              >
                <p className="text-[11px] font-mono tracking-widest text-[#94A3B8] mb-4">
                  {c.n}
                </p>
                <h3 className="text-[17px] md:text-[18px] font-bold tracking-tight text-[#0F172A] mb-3 leading-[1.5]">
                  {c.title}
                </h3>
                <p className="text-[14px] text-[#334155] leading-[1.9]">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ FLOW (5-step visual with connecting line) ═══════════════ */}
      <section id="function" className="border-y border-[#E5E7EB] bg-[#F7F8FA]">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <div className="mb-16 max-w-2xl">
            <Eyebrow en="FLOW" jp="流れ" />
            <SectionH2 first="旅程を送ったら、" second="受け取るだけ。" />
          </div>

          {(() => {
            const flowSteps = [
                {
                  n: "01",
                  title: "旅程を送付",
                  desc: "PDF / Excel / 画像",
                  svg: (
                    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                      <circle cx="60" cy="60" r="52" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="2" />
                      <rect x="34" y="30" width="42" height="54" rx="3" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2.5" />
                      <rect x="40" y="38" width="18" height="4" rx="1" fill="#0F172A" />
                      <line x1="40" y1="50" x2="70" y2="50" stroke="#0F172A" strokeWidth="1.8" opacity="0.3" strokeLinecap="round" />
                      <line x1="40" y1="58" x2="64" y2="58" stroke="#0F172A" strokeWidth="1.8" opacity="0.3" strokeLinecap="round" />
                      <line x1="40" y1="66" x2="70" y2="66" stroke="#0F172A" strokeWidth="1.8" opacity="0.3" strokeLinecap="round" />
                      <line x1="40" y1="74" x2="58" y2="74" stroke="#0F172A" strokeWidth="1.8" opacity="0.3" strokeLinecap="round" />
                      <path d="M 78 60 L 92 54 L 84 62 L 92 54 L 82 68 Z" fill="#C8102E" stroke="#C8102E" strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                  ),
                },
                {
                  n: "02",
                  title: "AI が抽出",
                  desc: "担当者が最終確認",
                  svg: (
                    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                      <circle cx="60" cy="60" r="52" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="2" />
                      <rect x="28" y="32" width="42" height="54" rx="3" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2.5" />
                      <rect x="34" y="42" width="24" height="4" rx="1" fill="#C8102E" opacity="0.85" />
                      <rect x="34" y="52" width="30" height="4" rx="1" fill="#C8102E" opacity="0.85" />
                      <rect x="34" y="62" width="22" height="4" rx="1" fill="#0F172A" opacity="0.3" />
                      <rect x="34" y="72" width="28" height="4" rx="1" fill="#0F172A" opacity="0.3" />
                      <circle cx="76" cy="62" r="20" fill="#FFFFFF" fillOpacity="0.92" stroke="#0F172A" strokeWidth="2.5" />
                      <line x1="90" y1="76" x2="98" y2="86" stroke="#0F172A" strokeWidth="3.5" strokeLinecap="round" />
                    </svg>
                  ),
                },
                {
                  n: "03",
                  title: "バウチャー即日",
                  desc: "旅行者用引換証",
                  svg: (
                    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                      <circle cx="60" cy="60" r="52" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="2" />
                      <path
                        d="M 28 40 L 82 40 L 82 54 Q 76 58 82 62 L 82 84 L 28 84 L 28 62 Q 34 58 28 54 Z"
                        fill="#FFFFFF"
                        stroke="#0F172A"
                        strokeWidth="2.5"
                        strokeLinejoin="round"
                      />
                      <line x1="28" y1="58" x2="82" y2="58" stroke="#0F172A" strokeWidth="1.2" strokeDasharray="2 2" opacity="0.5" />
                      <rect x="34" y="46" width="20" height="4" rx="1" fill="#0F172A" />
                      <rect x="34" y="68" width="30" height="3" rx="0.5" fill="#0F172A" opacity="0.3" />
                      <rect x="34" y="76" width="24" height="3" rx="0.5" fill="#0F172A" opacity="0.3" />
                      {/* QR mini */}
                      <rect x="66" y="66" width="14" height="14" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.2" />
                      <rect x="68" y="68" width="3" height="3" fill="#0F172A" />
                      <rect x="75" y="68" width="3" height="3" fill="#0F172A" />
                      <rect x="68" y="75" width="3" height="3" fill="#0F172A" />
                      <rect x="72" y="72" width="2" height="2" fill="#0F172A" />
                      <rect x="76" y="76" width="2" height="2" fill="#0F172A" />
                      {/* Seal */}
                      <circle cx="90" cy="46" r="9" fill="#C8102E" />
                      <path d="M 86 46 L 89 49 L 94 43" stroke="#FFFFFF" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ),
                },
                {
                  n: "04",
                  title: "送り状発行",
                  desc: "集荷 1ヶ月前から",
                  svg: (
                    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                      <defs>
                        <pattern id="flow-barcode" x="0" y="0" width="4" height="14" patternUnits="userSpaceOnUse">
                          <rect x="0" y="0" width="1" height="14" fill="#0F172A" />
                          <rect x="1.5" y="0" width="1.5" height="14" fill="#0F172A" />
                        </pattern>
                      </defs>
                      <circle cx="60" cy="60" r="52" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="2" />
                      <rect x="28" y="34" width="64" height="52" rx="3" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2.5" />
                      <rect x="28" y="34" width="64" height="12" fill="#0F172A" />
                      <rect x="34" y="52" width="24" height="3" rx="0.5" fill="#0F172A" opacity="0.3" />
                      <rect x="34" y="60" width="20" height="3" rx="0.5" fill="#0F172A" opacity="0.3" />
                      <path d="M 62 55 L 68 55 M 66 53 L 68 55 L 66 57" stroke="#C8102E" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      <rect x="70" y="52" width="18" height="3" rx="0.5" fill="#0F172A" opacity="0.3" />
                      <rect x="70" y="60" width="16" height="3" rx="0.5" fill="#0F172A" opacity="0.3" />
                      <rect x="34" y="70" width="54" height="12" fill="url(#flow-barcode)" />
                    </svg>
                  ),
                },
                {
                  n: "05",
                  title: "Drive で共有",
                  desc: "Email / Slack で通知",
                  svg: (
                    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                      <circle cx="60" cy="60" r="52" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="2" />
                      <path
                        d="M 28 60 Q 26 42 44 44 Q 50 30 66 36 Q 82 30 86 48 Q 100 48 96 62 Q 100 74 84 74 L 44 74 Q 28 74 28 60 Z"
                        fill="#F7F8FA"
                        stroke="#0F172A"
                        strokeWidth="2.5"
                        strokeLinejoin="round"
                        opacity="0.65"
                      />
                      <path
                        d="M 32 76 Q 32 70 38 70 L 52 70 L 58 76 L 82 76 Q 88 76 88 82 L 88 96 Q 88 102 82 102 L 38 102 Q 32 102 32 96 Z"
                        fill="#FFFFFF"
                        stroke="#0F172A"
                        strokeWidth="2.5"
                        strokeLinejoin="round"
                      />
                      <rect x="40" y="82" width="40" height="3" rx="1" fill="#0F172A" opacity="0.4" />
                      <rect x="40" y="90" width="34" height="3" rx="1" fill="#0F172A" opacity="0.4" />
                      <circle cx="92" cy="76" r="10" fill="#C8102E" />
                      <path
                        d="M 88 74 Q 88 69 92 69 Q 96 69 96 74 L 96 78 Q 97 80 94 80 L 90 80 Q 87 80 88 78 Z M 90 82 Q 90 84 92 84 Q 94 84 94 82"
                        fill="#FFFFFF"
                      />
                    </svg>
                  ),
                },
            ]

            return (
              <>
                {/* Mobile: compact horizontal list, fixed-size icons — no full-width blow-up */}
                <div className="md:hidden divide-y divide-[#E5E7EB] border-t border-b border-[#E5E7EB]">
                  {flowSteps.map((step) => (
                    <div key={step.n} className="flex items-center gap-4 py-5">
                      <div className="w-14 h-14 shrink-0 rounded-full bg-white border border-[#E5E7EB] flex items-center justify-center p-2">
                        {step.svg}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-mono font-bold tracking-widest text-[#C8102E] mb-1">
                          {step.n}
                        </p>
                        <h3 className="text-[14px] font-bold tracking-tight text-[#0F172A] mb-0.5 leading-snug">
                          {step.title}
                        </h3>
                        <p className="text-[12px] text-[#64748B] leading-[1.6]">{step.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop: 5-col circles with connecting dashed line */}
                <div className="hidden md:block relative">
                  <div className="absolute top-[92px] left-[5%] right-[5%] h-px border-t-2 border-dashed border-[#CBD5E1] z-0" />
                  <div className="grid grid-cols-5 gap-4 relative z-10">
                    {flowSteps.map((step) => (
                      <div key={step.n} className="flex flex-col">
                        <div className="aspect-square rounded-full bg-white border border-[#E5E7EB] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.04)] mb-5 flex items-center justify-center p-3">
                          {step.svg}
                        </div>
                        <p className="text-[13px] font-mono font-bold tracking-widest text-[#C8102E] mb-2">
                          {step.n}
                        </p>
                        <h3 className="text-[15px] font-bold tracking-tight text-[#0F172A] mb-2 leading-snug">
                          {step.title}
                        </h3>
                        <p className="text-[12px] text-[#64748B] leading-[1.85]">{step.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )
          })()}
        </div>
      </section>

      {/* ═══════════════ Deliverables (Voucher / Waybill) ═══════════════ */}
      <section id="deliverables" className="border-y border-[#E5E7EB] bg-[#F7F8FA]"><div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <div className="mb-14 max-w-2xl">
          <Eyebrow en="DELIVERABLES" jp="発行物" />
          <SectionH2 first="必要な発行物を、" second="まとめて用意。" />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* ─── Voucher card ─── */}
          <div className="rounded-2xl border border-[#E5E7EB] bg-white overflow-hidden flex flex-col shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.04)]">
            <div className="aspect-[16/9] bg-[#F7F8FA] border-b border-[#E5E7EB] flex items-center justify-center p-6">
              <svg
                viewBox="0 0 320 200"
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-auto max-h-[220px]"
              >
                <defs>
                  <pattern id="qr" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
                    <rect x="0" y="0" width="2" height="2" fill="#0F172A" />
                    <rect x="2" y="2" width="2" height="2" fill="#0F172A" />
                  </pattern>
                </defs>
                <path
                  d="M 20 20 L 220 20 L 220 92 Q 208 100 220 108 L 220 180 L 20 180 Z"
                  fill="#FFFFFF"
                  stroke="#0F172A"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M 220 20 L 300 20 L 300 180 L 220 180 L 220 108 Q 232 100 220 92 Z"
                  fill="#F1F3F5"
                  stroke="#0F172A"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
                <line
                  x1="220"
                  y1="20"
                  x2="220"
                  y2="180"
                  stroke="#0F172A"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  opacity="0.4"
                />
                <rect x="35" y="35" width="90" height="8" rx="1.5" fill="#C8102E" />
                <rect x="35" y="52" width="60" height="4" rx="1" fill="#0F172A" opacity="0.4" />
                <rect x="35" y="82" width="35" height="4" rx="1" fill="#0F172A" opacity="0.6" />
                <rect x="35" y="92" width="120" height="5" rx="1" fill="#0F172A" opacity="0.3" />
                <rect x="35" y="114" width="35" height="4" rx="1" fill="#0F172A" opacity="0.6" />
                <rect x="35" y="124" width="140" height="5" rx="1" fill="#0F172A" opacity="0.3" />
                <rect x="35" y="146" width="35" height="4" rx="1" fill="#0F172A" opacity="0.6" />
                <rect x="35" y="156" width="90" height="5" rx="1" fill="#0F172A" opacity="0.3" />
                <g transform="translate(238, 60)">
                  <rect x="0" y="0" width="46" height="46" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.5" />
                  <g fill="#0F172A">
                    <rect x="3" y="3" width="10" height="10" />
                    <rect x="5" y="5" width="6" height="6" fill="#F1F3F5" />
                    <rect x="7" y="7" width="2" height="2" fill="#0F172A" />
                    <rect x="33" y="3" width="10" height="10" />
                    <rect x="35" y="5" width="6" height="6" fill="#F1F3F5" />
                    <rect x="37" y="7" width="2" height="2" fill="#0F172A" />
                    <rect x="3" y="33" width="10" height="10" />
                    <rect x="5" y="35" width="6" height="6" fill="#F1F3F5" />
                    <rect x="7" y="37" width="2" height="2" fill="#0F172A" />
                  </g>
                  <rect x="15" y="15" width="16" height="16" fill="url(#qr)" opacity="0.85" />
                  <rect x="15" y="33" width="10" height="10" fill="url(#qr)" opacity="0.85" />
                  <rect x="33" y="15" width="10" height="16" fill="url(#qr)" opacity="0.85" />
                  <rect x="33" y="33" width="10" height="10" fill="url(#qr)" opacity="0.85" />
                </g>
              </svg>
            </div>
            <div className="p-8 md:p-10">
              <p className="text-[10px] tracking-widest text-[#64748B] mb-2 uppercase">Voucher</p>
              <h3 className="text-2xl font-bold tracking-tight mb-4 text-[#0F172A]">
                旅行者用バウチャー
              </h3>
              <p className="text-[15px] text-[#334155] leading-[1.85]">
                旅程受領後、<strong className="text-[#0F172A]">即日発行</strong>。
                英/日バイリンガル、ホテル担当者向け一時預かり案内も同梱。
              </p>
            </div>
          </div>

          {/* ─── Waybill card ─── */}
          <div className="rounded-2xl border border-[#E5E7EB] bg-white overflow-hidden flex flex-col shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.04)]">
            <div className="aspect-[16/9] bg-[#F7F8FA] border-b border-[#E5E7EB] flex items-center justify-center p-6">
              <svg
                viewBox="0 0 320 200"
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-auto max-h-[220px]"
              >
                <defs>
                  <pattern id="barcode" x="0" y="0" width="7" height="30" patternUnits="userSpaceOnUse">
                    <rect x="0" y="0" width="1.5" height="30" fill="#0F172A" />
                    <rect x="2.5" y="0" width="2" height="30" fill="#0F172A" />
                    <rect x="5.5" y="0" width="1" height="30" fill="#0F172A" />
                  </pattern>
                </defs>
                <rect x="20" y="20" width="280" height="160" rx="4" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2.5" />
                <rect x="20" y="20" width="280" height="26" fill="#0F172A" />
                <text x="35" y="38" fill="#FFFFFF" fontSize="10" fontWeight="bold" letterSpacing="2" fontFamily="monospace">
                  SHIPPING LABEL
                </text>
                <rect x="35" y="58" width="110" height="52" rx="2" fill="none" stroke="#0F172A" strokeWidth="1.5" opacity="0.55" />
                <rect x="43" y="64" width="24" height="3.5" rx="0.5" fill="#0F172A" opacity="0.7" />
                <rect x="43" y="76" width="65" height="4.5" rx="0.5" fill="#0F172A" />
                <rect x="43" y="88" width="70" height="3" rx="0.5" fill="#0F172A" opacity="0.4" />
                <rect x="43" y="97" width="55" height="3" rx="0.5" fill="#0F172A" opacity="0.4" />
                <path d="M 152 84 L 168 84 M 162 78 L 168 84 L 162 90" stroke="#C8102E" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="175" y="58" width="110" height="52" rx="2" fill="none" stroke="#0F172A" strokeWidth="1.5" opacity="0.55" />
                <rect x="183" y="64" width="16" height="3.5" rx="0.5" fill="#0F172A" opacity="0.7" />
                <rect x="183" y="76" width="60" height="4.5" rx="0.5" fill="#0F172A" />
                <rect x="183" y="88" width="72" height="3" rx="0.5" fill="#0F172A" opacity="0.4" />
                <rect x="183" y="97" width="50" height="3" rx="0.5" fill="#0F172A" opacity="0.4" />
                <rect x="35" y="122" width="250" height="42" fill="#F7F8FA" stroke="#0F172A" strokeWidth="1.5" strokeOpacity="0.25" />
                <rect x="45" y="130" width="214" height="26" fill="url(#barcode)" />
                <rect x="102" y="168" width="116" height="5" rx="0.5" fill="#0F172A" opacity="0.55" />
              </svg>
            </div>
            <div className="p-8 md:p-10">
              <p className="text-[10px] tracking-widest text-[#64748B] mb-2 uppercase">
                Shipping Label
              </p>
              <h3 className="text-2xl font-bold tracking-tight mb-4 text-[#0F172A]">
                物流業者の送り状
              </h3>
              <p className="text-[15px] text-[#334155] leading-[1.85]">
                集荷日の <strong className="text-[#0F172A]">1 ヶ月前</strong> に発行 (物流業者仕様)。
                追跡番号付き、大手宅配便ネットワークを利用。
              </p>
            </div>
          </div>
        </div>
        </div>
      </section>

      {/* ═══════════════ Trust band — ご安心いただける理由 ═══════════════ */}
      <section id="trust" className="border-y border-[#E5E7EB] bg-[#F7F8FA]">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <div className="mb-14 max-w-2xl">
            <Eyebrow en="TRUST" jp="ご安心の理由" />
            <SectionH2 first="代理店様が" second="安心して任せられる理由。" />
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                icon: Shield,
                title: "補償",
                head: "1 個あたり最大 30 万円",
                body:
                  "配送は大手宅配便。運送約款に基づき、1 個あたり最大 30 万円まで補償されます。",
                anchor: "#faq",
              },
              {
                icon: Handshake,
                title: "取次",
                head: "代理店様と配送事業者の間に立ちます",
                body:
                  "BondEx は取次業者。代理店様に代わり配送事業者との手配・調整を担当し、業務を吸収します。",
                anchor: "#faq",
              },
              {
                icon: Lock,
                title: "個人情報",
                head: "SSL 通信・権限限定・目的外利用なし",
                body:
                  "旅程データはすべて SSL 通信、アクセスは業務担当者のみに限定。目的外利用はいたしません。",
                anchor: "#faq",
              },
            ].map((c) => {
              const Icon = c.icon
              return (
                <a
                  key={c.title}
                  href={c.anchor}
                  className="rounded-2xl bg-white border border-[#E5E7EB] p-7 hover:border-[#C8102E]/30 hover:shadow-[0_4px_16px_rgba(200,16,46,0.06)] transition-all block group"
                >
                  <div className="w-11 h-11 rounded-full bg-[#C8102E]/8 flex items-center justify-center mb-5">
                    <Icon className="w-5 h-5 text-[#C8102E]" strokeWidth={1.8} />
                  </div>
                  <p className="text-[10px] tracking-widest text-[#64748B] mb-2 uppercase">
                    {c.title}
                  </p>
                  <h3 className="text-[17px] font-bold tracking-tight text-[#0F172A] mb-3 leading-snug">
                    {c.head}
                  </h3>
                  <p className="text-[13px] text-[#334155] leading-[1.85]">{c.body}</p>
                </a>
              )
            })}
          </div>
        </div>
      </section>

      {/* ═══════════════ Price (Timeline visual) ═══════════════ */}
      <section id="price" className="max-w-6xl mx-auto px-5 sm:px-6 py-20 md:py-28">
        <div className="mb-12 md:mb-16 max-w-2xl">
          <Eyebrow en="PRICE" jp="料金" />
          <SectionH2 first="1 件単価、" second="月次まとめ請求。" />
          <p className="mt-7 text-[15px] md:text-[16px] text-[#334155] leading-[1.9]">
            初期費用・月額費用はありません。
            送料は原則として均一単価でご案内し、正式な料金は取扱件数・配送条件を確認のうえ契約時に確定します。
          </p>
        </div>

        {/* Billing conditions — quiet contract-style */}
        <div className="grid md:grid-cols-[1fr_1.1fr] gap-8 md:gap-14 mb-12">
          <div>
            <p className="text-[11px] font-mono tracking-widest text-[#64748B] uppercase mb-4">
              Billing / 請求条件
            </p>
            <h3 className="text-2xl md:text-[28px] font-bold tracking-tight text-[#0F172A] mb-5 leading-[1.4]">
              請求条件
            </h3>
            <p className="text-[15px] text-[#334155] leading-[1.9]">
              配送費は BondEx が事前に立替え、月末に当月分をまとめて集計します。
              翌月初に請求書を発行し、翌月末までにお支払いいただきます。
            </p>
          </div>

          <dl className="border-t border-[#E5E7EB]">
            {[
              { term: "締め日", desc: "月末" },
              { term: "請求書発行", desc: "翌月初" },
              { term: "支払期限", desc: "翌月末" },
              { term: "支払方法", desc: "銀行振込" },
              { term: "運賃", desc: "BondEx が事前立替" },
              { term: "請求単位", desc: "月次まとめ請求" },
            ].map((row) => (
              <div
                key={row.term}
                className="grid grid-cols-[minmax(0,110px)_1fr] gap-4 py-4 border-b border-[#E5E7EB]"
              >
                <dt className="text-[13px] text-[#64748B] leading-[1.7]">{row.term}</dt>
                <dd className="text-[14px] md:text-[15px] font-semibold text-[#0F172A] leading-[1.7]">
                  {row.desc}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-[13px] text-[#64748B] leading-[1.9] max-w-3xl">
          宅配便の受託限度 (3辺合計 160cm・25kg 以内) を超える荷物・離島や一部地域宛・
          冷蔵冷凍等の特殊配送は原則対象外となります。具体条件は個別にご相談ください。
        </p>
      </section>

      {/* ═══════════════ FAQ (with 3 anxiety callouts + accordion) ═══════════════ */}
      <section id="faq" className="border-t border-[#E5E7EB] bg-white">
        <div className="max-w-4xl mx-auto px-6 py-24 md:py-32">
          <div className="mb-14 max-w-2xl">
            <Eyebrow en="FAQ" jp="よくあるご質問" />
            <SectionH2 first="はじめての方の、" second="よくあるご質問。" />
          </div>

          {/* Top 3 anxiety callout cards */}
          <div className="grid md:grid-cols-3 gap-4 mb-10">
            {[
              {
                icon: Shield,
                label: "補償",
                text: "提携物流会社の約款で 1 個あたり最大 30 万円まで。",
              },
              {
                icon: Clock,
                label: "締切",
                text: "旅程受領即日でバウチャー発行。送り状は集荷 1 ヶ月前。",
              },
              {
                icon: Ban,
                label: "キャンセル",
                text: "集荷前日 17 時までのご連絡で無償キャンセル可。",
              },
            ].map((c) => {
              const Icon = c.icon
              return (
                <div
                  key={c.label}
                  className="rounded-xl border border-[#E5E7EB] bg-[#F7F8FA] p-5 flex gap-3 items-start"
                >
                  <div className="w-10 h-10 shrink-0 rounded-full bg-[#C8102E]/10 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-[#C8102E]" strokeWidth={2} />
                  </div>
                  <div>
                    <p className="text-[11px] font-mono tracking-widest text-[#64748B] mb-1 uppercase">
                      {c.label}
                    </p>
                    <p className="text-[14px] font-medium text-[#0F172A] leading-[1.7]">{c.text}</p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Full accordion */}
          <div className="space-y-3">
            {[
              {
                q: "旅程はどの形式で送れますか?",
                a: "Excel / PDF / 画像 / スクリーンショット、いずれも受け付けます。代理店様の使い慣れたフォーマットのままで結構です。",
              },
              {
                q: "バウチャーはすぐ発行できるのに、送り状はなぜ 1ヶ月前?",
                a: "物流業者の発行仕様上、集荷日から 30 日以内でないと送り状を発行できないためです。バウチャーは BondEx 発行のため即日対応可能です。",
              },
              {
                q: "料金の請求サイクルは?",
                a: "月末日締めで当月発行分を集計、翌月初に PDF 請求書を代理店様宛に送付。お支払期限は対象月の翌月末日です。物流業者への運賃は BondEx が立替払いします。",
              },
              {
                q: "補償の範囲は?",
                a: "実運送を担う物流業者の運送約款に完全に準じます。現在の提携宅配便で 1 個あたり上限 30 万円。BondEx 独自の追加補償はありません。",
              },
              {
                q: "運用中のサポート体制は?",
                a: "導入時のオンボーディング、運用中の変更・宛先変更対応、集荷遅延やクレーム時の一次対応まで、担当窓口が伴走します。代理店様の追加工数を最小化します。",
              },
              {
                q: "契約から運用開始まで、どのくらい?",
                a: "業務委託契約 (取次業として明記) の締結後、代理店ポータルのアカウントを発行して即日運用開始できます。初回旅程 PDF で当日中にテスト発行いただけます。",
              },
            ].map((f, i) => (
              <details
                key={i}
                className="group rounded-xl border border-[#E5E7EB] bg-white p-6 open:bg-[#F7F8FA]"
              >
                <summary className="cursor-pointer text-[17px] font-semibold flex items-center justify-between gap-4 list-none tracking-normal leading-[1.55] text-[#0F172A]">
                  <span>{f.q}</span>
                  <span className="w-7 h-7 shrink-0 rounded-full border border-[#E5E7EB] flex items-center justify-center group-open:bg-[#C8102E] group-open:border-[#C8102E] transition-colors">
                    <Plus className="w-3.5 h-3.5 text-[#64748B] group-open:hidden" strokeWidth={2} />
                    <Minus className="w-3.5 h-3.5 text-white hidden group-open:inline-block" strokeWidth={2} />
                  </span>
                </summary>
                <p className="mt-5 text-[15px] text-[#334155] leading-[1.9]">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ CTA (Red brand section) ═══════════════ */}
      <section id="contact" className="bg-[#C8102E] text-white">
        <div className="max-w-4xl mx-auto px-6 py-24 md:py-32 text-center">
          <p className="text-[12px] font-medium tracking-[0.2em] text-white/80 mb-6 uppercase">
            Contact
          </p>
          <h2 className="text-3xl sm:text-4xl md:text-[46px] lg:text-[52px] font-bold tracking-normal leading-[1.35] mb-10">
            試験運用は 1 件から。
          </h2>
          <p className="text-[16px] text-white/95 leading-[1.85] mb-12 max-w-2xl mx-auto">
            契約書・責任分界表・請求書サンプル・法務レビュー用パッケージを、
            <br className="hidden md:inline" />
            打合せ日程調整とあわせてお送りいたします。
          </p>
          <div className="flex flex-col items-center gap-3">
            <a
              href={CONTACT_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 px-8 py-4 rounded-md bg-white text-[#C8102E] text-[15px] font-bold hover:bg-white/95"
            >
              導入相談フォームへ
              <ArrowRight className="w-4 h-4" strokeWidth={2} />
            </a>
            <p className="text-[12px] text-white/85">通常 1 営業日以内にご連絡します。</p>
          </div>
        </div>
      </section>

      {/* ═══════════════ Footer ═══════════════ */}
      <footer className="bg-white border-t border-[#E5E7EB]">
        <div className="max-w-6xl mx-auto px-6 py-14 flex flex-col md:flex-row items-start md:items-center justify-between gap-8 text-sm">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bondex-logo.png" alt="BondEx" className="h-8 w-auto object-contain" />
            <p className="text-[13px] font-medium text-[#64748B] leading-loose">
              運営: 株式会社JOJO / 東京都世田谷区野毛1-9-12
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-7 gap-y-3 text-[13px] font-medium text-[#334155]">
            <Link href="/agency/login" className="hover:text-[#C8102E]">代理店ログイン</Link>
            <Link href="/track" className="hover:text-[#C8102E]">トラッキング</Link>
            <Link href="/legal/terms" className="hover:text-[#C8102E]">利用規約</Link>
            <Link href="/legal/privacy" className="hover:text-[#C8102E]">プライバシー</Link>
            <Link href="/legal/commercial-transactions" className="hover:text-[#C8102E]">
              特定商取引法
            </Link>
          </div>
        </div>
        <div className="border-t border-[#E5E7EB]">
          <div className="max-w-6xl mx-auto px-6 py-6 text-[12px] text-[#64748B] leading-[1.9]">
            BondEx は運送人ではなく、旅程情報を受けて物流業者への発送を取り次ぐ取次サービスです。
            実運送・運送責任・補償は当社が利用する物流業者の運送約款に準じます。
            <br />
            © {new Date().getFullYear()} 株式会社JOJO / BondEx
          </div>
        </div>
      </footer>
    </main>
  )
}
