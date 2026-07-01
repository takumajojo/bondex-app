"use client"

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
  Calendar,
  Package,
  CheckCircle2,
  Check,
  X,
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

// H2 heading with proper Japanese wrap + semantic responsive break
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
      className={`text-[40px] md:text-[48px] font-bold tracking-normal leading-[1.45] text-[#0F172A] [word-break:keep-all] [overflow-wrap:break-word] ${className}`}
    >
      <span className="inline-block">{first}</span>
      {second && (
        <>
          <br className="hidden md:inline" />
          <span className="inline-block">{second}</span>
        </>
      )}
    </h2>
  )
}

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-white text-[#0F172A]">
      {/* ═══════════════ Header ═══════════════ */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-[#E5E7EB]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex flex-col leading-none" aria-label="BondEx home">
            <span className="text-[22px] font-semibold tracking-tight text-[#0F172A]">
              BondEx
            </span>
            <span className="mt-1 text-[9px] font-medium tracking-[0.24em] uppercase text-[#64748B]">
              Luggage Forwarding
            </span>
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

      {/* ═══════════════ Hero — Full-bleed family image ═══════════════ */}
      <section
        className="relative w-full h-[calc(100vh-4rem)] min-h-[640px] max-h-[820px] overflow-hidden bg-cover bg-center bg-no-repeat flex items-end"
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.0) 25%, rgba(0,0,0,0.0) 50%, rgba(0,0,0,0.78) 100%), url('/hero-family.png')",
        }}
      >
        <div className="w-full max-w-6xl mx-auto px-6 pb-16 md:pb-24 text-white">
          <p className="text-[12px] font-medium tracking-[0.15em] text-white/90 mb-6 drop-shadow">
            訪日旅行代理店様向け ・ 荷物配送手配代行
          </p>
          <h1 className="text-4xl md:text-6xl lg:text-[64px] font-bold leading-[1.3] tracking-normal mb-8 drop-shadow-lg max-w-4xl [word-break:keep-all] [overflow-wrap:break-word]">
            <span className="inline-block">旅程を送るだけで、</span>
            <br className="hidden md:inline" />
            <span className="inline-block">荷物配送手配が完了。</span>
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

      {/* ═══════════════ Value in 3 (compact pictograms) ═══════════════ */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-24 md:pt-20 md:pb-32">
        <div className="grid md:grid-cols-3 gap-12 md:gap-16">
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
            <div key={v.n} className="flex flex-col">
              <div className="mb-6">{v.icon}</div>
              <p className="text-[11px] font-mono tracking-widest text-[#64748B] mb-3">{v.n}</p>
              <h3 className="text-xl font-bold tracking-tight mb-4 text-[#0F172A]">{v.title}</h3>
              <p className="text-[15px] font-medium text-[#334155] leading-[1.85]">{v.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════ Difference — 従来手配との比較 ═══════════════ */}
      <section id="difference" className="border-y border-[#E5E7EB] bg-[#F7F8FA]">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <div className="mb-14 max-w-3xl">
            <Eyebrow en="DIFFERENCE" jp="従来手配との違い" />
            <SectionH2 first="旅行者に頼らず、" second="手配をパッケージに組み込む。" />
            <p className="mt-7 text-[16px] font-medium text-[#334155] leading-[1.9] max-w-2xl">
              従来の宅配手配は、旅行者自身の支払い・入力・確認が発生し、
              旅程中の小さな負担になりがちです。BondEx は代理店様側で手配を完結させ、
              旅行パッケージの一部として自然に組み込めます。
            </p>
          </div>

          <div className="grid lg:grid-cols-[1fr_auto_1fr] gap-5 items-stretch">
            <div className="rounded-2xl border border-[#E5E7EB] bg-white p-7 md:p-8">
              <div className="flex items-center gap-3 mb-7">
                <div className="w-10 h-10 rounded-full bg-[#F1F5F9] flex items-center justify-center">
                  <Ban className="w-5 h-5 text-[#64748B]" strokeWidth={1.7} />
                </div>
                <div>
                  <p className="text-[10px] tracking-widest uppercase text-[#64748B] mb-1">
                    Conventional
                  </p>
                  <h3 className="text-xl font-bold tracking-tight text-[#0F172A]">
                    従来の配送手配
                  </h3>
                </div>
              </div>

              <div className="space-y-4">
                {[
                  "旅行者が配送方法を調べ、個別に申し込む必要がある",
                  "支払いが旅行代金と分かれ、現地での説明・確認が増える",
                  "送り状・追跡番号・ホテルへの共有が案件ごとに分散する",
                  "変更やキャンセル時に、代理店・旅行者・配送会社の調整が発生する",
                ].map((item) => (
                  <div key={item} className="flex gap-3">
                    <span className="mt-2 block h-1.5 w-1.5 rounded-full bg-[#CBD5E1] shrink-0" />
                    <p className="text-[14px] text-[#475569] leading-[1.85]">{item}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="hidden lg:flex items-center justify-center px-1">
              <div className="w-12 h-12 rounded-full bg-[#0F172A] text-white flex items-center justify-center shadow-[0_8px_24px_rgba(15,23,42,0.18)]">
                <ArrowRight className="w-5 h-5" strokeWidth={1.8} />
              </div>
            </div>

            <div className="rounded-2xl border border-[#C8102E]/20 bg-white p-7 md:p-8 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(200,16,46,0.08)]">
              <div className="flex items-center gap-3 mb-7">
                <div className="w-10 h-10 rounded-full bg-[#C8102E]/10 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-[#C8102E]" strokeWidth={1.8} />
                </div>
                <div>
                  <p className="text-[10px] tracking-widest uppercase text-[#C8102E] mb-1">
                    BondEx
                  </p>
                  <h3 className="text-xl font-bold tracking-tight text-[#0F172A]">
                    BondEx の手配代行
                  </h3>
                </div>
              </div>

              <div className="space-y-4">
                {[
                  "代理店様は旅程を送るだけ。BondEx が配送手配をまとめて進行",
                  "旅行者の個別支払いをなくし、旅行パッケージの中に自然に組み込める",
                  "バウチャー・送り状・追跡情報を案件単位で共有",
                  "月末締め翌月末払い。請求も旅行会社様向けに一本化",
                ].map((item) => (
                  <div key={item} className="flex gap-3">
                    <CheckCircle2 className="mt-1 w-4 h-4 text-[#C8102E] shrink-0" strokeWidth={1.8} />
                    <p className="text-[14px] font-medium text-[#334155] leading-[1.85]">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-2xl bg-[#0F172A] text-white p-6 md:p-7 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <p className="text-[16px] font-medium leading-[1.8]">
              旅行者には、手ぶらで移動できる体験を。代理店様には、配送手配を抱え込まない運用を。
            </p>
            <a
              href={CONTACT_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md bg-white text-[#0F172A] text-[14px] font-medium hover:bg-[#F8FAFC] shrink-0"
            >
              試験運用を相談
              <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
            </a>
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

          <div className="relative">
            {/* Connecting dashed line behind cards */}
            <div className="hidden md:block absolute top-[92px] left-[5%] right-[5%] h-px border-t-2 border-dashed border-[#CBD5E1] z-0" />

            <div className="grid md:grid-cols-5 gap-4 relative z-10">
              {[
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
              ].map((step) => (
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
        </div>
      </section>

      {/* ═══════════════ Difference — 従来の手配 vs BondEx ═══════════════ */}
      <section id="difference" className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <div className="mb-14 max-w-2xl">
          <Eyebrow en="DIFFERENCE" jp="従来との違い" />
          <SectionH2 first="旅行者の負担ゼロで、" second="旅程に自然に組み込む。" />
          <p className="mt-8 text-[16px] font-medium text-[#334155] leading-[1.85]">
            従来の手配は、お客様が現地で個別に支払い・連絡する形が一般的でした。
            <br className="hidden md:inline" />
            BondEx は代理店様のパッケージに組み込まれ、旅行者は追加の手続き・支払いなく手ぶらで移動できます。
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* ─── Before: 従来の手配 ─── */}
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-8 md:p-10">
            <p className="text-[11px] font-mono tracking-widest text-[#64748B] mb-3 uppercase">
              Before
            </p>
            <h3 className="text-[26px] font-bold tracking-tight text-[#64748B] mb-8">
              従来の手配
            </h3>
            <ul className="space-y-6">
              {[
                {
                  title: "旅行者が現地で個別支払い",
                  body: "現金・カード決済の手間、為替や言語での不安。旅先で財布を出す度に体験が中断する。",
                },
                {
                  title: "旅程作成とは別ルートで手配",
                  body: "移動当日または前日に別業者へ連絡。手配の失念、宛先ミス、連絡漏れが起きやすい。",
                },
                {
                  title: "旅行者本人が直接問い合わせ",
                  body: "遅延・紛失時にお客様が英語で対応。旅行の途中で疲弊し、代理店の評価も下がる。",
                },
                {
                  title: "追加出費で満足度が低下",
                  body: "「日本の旅は現地で意外な出費が多い」の印象、リピート率・紹介率に影響。",
                },
              ].map((item) => (
                <li key={item.title} className="flex gap-4">
                  <div className="w-7 h-7 shrink-0 rounded-full bg-[#F1F3F5] flex items-center justify-center mt-0.5">
                    <X className="w-4 h-4 text-[#64748B]" strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="text-[15px] font-semibold text-[#334155] leading-snug">
                      {item.title}
                    </p>
                    <p className="text-[13px] text-[#64748B] leading-[1.85] mt-1.5">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* ─── With BondEx ─── */}
          <div className="rounded-2xl border-2 border-[#C8102E] bg-white p-8 md:p-10 relative shadow-[0_1px_2px_rgba(200,16,46,0.04),0_8px_24px_rgba(200,16,46,0.06)]">
            <span className="absolute -top-3 left-8 bg-[#C8102E] text-white text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded">
              BondEx
            </span>
            <p className="text-[11px] font-mono tracking-widest text-[#C8102E] mb-3 uppercase">
              With BondEx
            </p>
            <h3 className="text-[26px] font-bold tracking-tight text-[#0F172A] mb-8">
              パッケージ組込型
            </h3>
            <ul className="space-y-6">
              {[
                {
                  title: "旅行者の追加支払いはゼロ",
                  body: "代理店様のパッケージ料金にすべて含まれる。お客様の財布は一度も動かない。",
                },
                {
                  title: "旅程作成時に自動で組込",
                  body: "旅程 PDF を BondEx に送るだけ、以降は発行・配送・請求までワンストップ。",
                },
                {
                  title: "問い合わせは代理店 → BondEx",
                  body: "旅行者は連絡不要、遅延・変更対応も BondEx が代理店様の窓口で完結。",
                },
                {
                  title: "手ぶらで移動、旅に集中",
                  body: "「日本の旅は身軽で快適」というブランド体験。満足度・リピート率・紹介率を押し上げ。",
                },
              ].map((item) => (
                <li key={item.title} className="flex gap-4">
                  <div className="w-7 h-7 shrink-0 rounded-full bg-[#C8102E] flex items-center justify-center mt-0.5">
                    <Check className="w-4 h-4 text-white" strokeWidth={3} />
                  </div>
                  <div>
                    <p className="text-[15px] font-semibold text-[#0F172A] leading-snug">
                      {item.title}
                    </p>
                    <p className="text-[13px] text-[#334155] leading-[1.85] mt-1.5">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-10 text-[13px] text-[#64748B] leading-[1.85] max-w-3xl">
          代理店様は月次まとめで BondEx に支払い、お客様には旅行代金に組み込んだ形でご案内いただけます。
          運賃は BondEx が事前立替、変更対応まで一括で担当します。
        </p>
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
                className="w-full h-full max-h-[220px]"
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
                className="w-full h-full max-h-[220px]"
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
                追跡番号付き、現在ヤマト運輸の宅急便を利用中。
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
                  "配送はヤマト運輸の宅急便。宅急便運送約款に基づき、1 個あたり最大 30 万円まで補償されます。",
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
      <section id="price" className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <div className="mb-14 max-w-2xl">
          <Eyebrow en="PRICE" jp="料金" />
          <SectionH2 first="1 件単価、" second="月次まとめ請求。" />
          <p className="mt-8 text-[16px] font-medium text-[#334155] leading-[1.85]">
            初期費用・月額費用はありません。
            <br className="hidden md:inline" />
            送料は原則として均一単価でご案内し、正式な料金は取扱件数・配送条件を確認のうえ契約時に確定します。
          </p>
        </div>

        {/* Billing timeline SVG */}
        <div className="mb-10">
          <div className="rounded-2xl bg-[#F7F8FA] border border-[#E5E7EB] p-8 md:p-12">
            <p className="text-[10px] tracking-widest text-[#64748B] mb-8 uppercase">
              Billing cycle / ご請求サイクル
            </p>
            <div className="grid grid-cols-5 gap-2 relative">
              {/* Connecting line */}
              <div className="hidden md:block absolute top-[28px] left-[10%] right-[10%] h-0.5 bg-gradient-to-r from-[#CBD5E1] via-[#C8102E]/40 to-[#0F172A]/60" />
              {[
                { icon: FileText, day: "手配日", label: "旅程受領・発行", sub: "T日" },
                { icon: Package, day: "利用日", label: "集荷 → 配達", sub: "実運送" },
                { icon: Calendar, day: "月末", label: "当月分を締め", sub: "自動集計", accent: true },
                { icon: FileText, day: "翌月初", label: "PDF 請求書", sub: "Drive で共有", accent: true },
                { icon: CreditCard, day: "翌月末", label: "お振込み", sub: "支払期限" },
              ].map((t, i) => {
                const Icon = t.icon
                return (
                  <div key={i} className="text-center relative z-10">
                    <div
                      className={`w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-4 border-2 ${
                        t.accent
                          ? "bg-[#C8102E] border-[#C8102E] text-white"
                          : "bg-white border-[#0F172A]/25 text-[#0F172A]"
                      }`}
                    >
                      <Icon className="w-5 h-5" strokeWidth={1.8} />
                    </div>
                    <p className="text-[11px] font-mono tracking-widest text-[#64748B] mb-1.5">
                      {t.day}
                    </p>
                    <p className="text-[13px] font-bold text-[#0F172A] mb-1 leading-snug">
                      {t.label}
                    </p>
                    <p className="text-[10px] text-[#64748B] leading-loose">{t.sub}</p>
                  </div>
                )
              })}
            </div>
            <p className="mt-10 text-center text-[14px] font-medium text-[#0F172A]">
              月次まとめ、締めは月末。運賃は BondEx が事前立替え。
            </p>
          </div>
        </div>

        <p className="text-[13px] text-[#64748B] leading-[1.85] max-w-3xl">
          ヤマト運輸の受託限度 (3辺合計 160cm・25kg 以内) を超える荷物・離島や一部地域宛・
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
                text: "ヤマト運輸で 1 個あたり最大 30 万円まで。",
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
                a: "物流業者 (ヤマト運輸等) の発行仕様上、集荷日から 30 日以内でないと送り状を発行できないためです。バウチャーは BondEx 発行のため即日対応可能です。",
              },
              {
                q: "料金の請求サイクルは?",
                a: "月末日締めで当月発行分を集計、翌月初に PDF 請求書を代理店様宛に送付。お支払期限は対象月の翌月末日です。物流業者への運賃は BondEx が立替払いします。",
              },
              {
                q: "補償の範囲は?",
                a: "実運送を担う物流業者の運送約款に完全に準じます。現在ヤマト運輸の宅急便で 1 個あたり上限 30 万円。BondEx 独自の追加補償はありません。",
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
          <h2 className="text-4xl md:text-[52px] font-bold tracking-normal leading-[1.35] mb-10 [word-break:keep-all] [overflow-wrap:break-word]">
            <span className="inline-block">試験運用は</span>
            <span className="inline-block">1 件から。</span>
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
            実運送・運送責任・補償は当社が利用する物流業者 (現在: ヤマト運輸 宅急便運送約款) に準じます。
            <br />
            © {new Date().getFullYear()} 株式会社JOJO / BondEx
          </div>
        </div>
      </footer>
    </main>
  )
}
