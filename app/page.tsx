"use client"

import Link from "next/link"
import {
  ArrowRight,
  ChevronRight,
  FileText,
  Truck,
  Send,
  Sparkles,
  BadgeCheck,
  CalendarClock,
  BellRing,
  CreditCard,
  Building2,
  Clock,
} from "lucide-react"

const CONTACT_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfztfArRTfT4lgAdcNHeZFCDE23gwWivcjgzOUOkUSH9ah_Ew/viewform?usp=header"

// FLOW セクションの各ステップカード — 上部に mock、下部に番号/タイトル/1行説明
function FlowCard({
  n,
  title,
  desc,
  icon: Icon,
  children,
}: {
  n: string
  title: string
  desc: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border border-[#111]/10 bg-white overflow-hidden flex flex-col">
      <div className="aspect-square bg-[#FAF7F2] border-b border-[#111]/8 flex items-center justify-center">
        {children}
      </div>
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-mono tracking-widest text-[#111]/40">{n}</span>
          <Icon className="w-4 h-4 text-[#111]/60" strokeWidth={1.5} />
        </div>
        <h3 className="text-[15px] font-extrabold tracking-tight mb-2 leading-snug">{title}</h3>
        <p className="text-[12px] text-[#111]/60 leading-loose">{desc}</p>
      </div>
    </div>
  )
}

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#FAF7F2] text-[#111]">
      {/* ═══════════════ Header (solid sticky, above hero) ═══════════════ */}
      <header className="sticky top-0 z-40 bg-[#FAF7F2] border-b border-[#111]/10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bondex-logo.png"
            alt="BondEx"
            className="h-9 w-auto object-contain"
          />
          <nav className="hidden md:flex items-center gap-7 text-[13px] text-[#111]/70">
            <a href="#function" className="hover:text-[#111]">流れ</a>
            <a href="#deliverables" className="hover:text-[#111]">発行物</a>
            <a href="#price" className="hover:text-[#111]">料金</a>
            <a href="#faq" className="hover:text-[#111]">FAQ</a>
          </nav>
          <div className="flex items-center gap-4">
            <a
              href={CONTACT_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium px-4 py-1.5 rounded-md bg-[#111] text-[#FAF7F2] hover:bg-[#111]/85"
            >
              導入相談
            </a>
            <Link
              href="/agency/login"
              className="hidden sm:inline text-[12px] text-[#111]/60 hover:text-[#111] underline underline-offset-4 decoration-[#111]/25 hover:decoration-[#111]/60"
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
          <p className="text-[11px] tracking-[0.4em] text-white/80 mb-6 drop-shadow">
            訪日旅行代理店様向け ・ 荷物配送手配代行
          </p>
          <h1 className="text-4xl md:text-6xl lg:text-[76px] font-extrabold leading-[1.15] tracking-tight mb-8 drop-shadow-lg max-w-4xl">
            旅程を送るだけで、荷物配送手配が完了。
          </h1>
          <p className="text-base md:text-lg text-white/90 max-w-2xl leading-relaxed mb-10 drop-shadow">
            バウチャー発行、送り状手配、月次請求、変更対応まで。
            BondEx が旅行代理店様の配送オペレーションを代行します。
          </p>
          <div className="flex flex-col items-start gap-3">
            <a
              href={CONTACT_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-7 py-4 rounded-md bg-white text-[#111] text-[15px] font-medium hover:bg-white/90"
            >
              導入相談へ
              <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
            </a>
            <p className="text-[12px] text-white/75 drop-shadow ml-1">
              通常 1 営業日以内にご連絡します。
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════ Value in 3 lines (compact) ═══════════════ */}
      <section className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <div className="grid md:grid-cols-3 gap-12 md:gap-16">
          {[
            {
              title: "旅程を送るだけ",
              body: "PDF / Excel / 画像。何でも受け付けます。",
            },
            {
              title: "Google Drive で共有",
              body: "案件別フォルダに集約、Email / Slack で通知。",
            },
            {
              title: "月末締め翌月末払い",
              body: "運賃は BondEx が立替、月次まとめて請求。",
            },
          ].map((v, i) => (
            <div key={v.title}>
              <p className="text-[11px] font-mono tracking-widest text-[#111]/40 mb-4">
                0{i + 1}
              </p>
              <h3 className="text-2xl font-extrabold tracking-tight mb-3">{v.title}</h3>
              <p className="text-[15px] text-[#111]/70 leading-loose">{v.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════ Function (5 step, each with product mockup) ═══════════════ */}
      <section id="function" className="border-y border-[#111]/8 bg-[#F1EBE0]/60">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <div className="mb-16 max-w-xl">
            <p className="text-[11px] tracking-[0.35em] text-[#111]/50 mb-4">FLOW / 流れ</p>
            <h2 className="text-4xl md:text-[52px] font-extrabold tracking-tight leading-[1.2]">
              旅程を送ったら、受け取るだけ。
            </h2>
          </div>

          <div className="grid md:grid-cols-5 gap-4">
            {/* ─── 01: 旅程を送付 (paper airplane w/ document trail) ─── */}
            <FlowCard n="01" title="旅程を送付" icon={Send} desc="PDF / Excel / 画像。何でも可。">
              <svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                <circle cx="120" cy="120" r="100" fill="#E8DFCE" opacity="0.55" />
                {/* Paper document */}
                <g transform="translate(38,60)">
                  <rect x="0" y="0" width="90" height="115" rx="4" fill="#FFFFFF" stroke="#111" strokeWidth="2.5" />
                  <rect x="10" y="14" width="34" height="6" rx="1.5" fill="#111" />
                  <line x1="10" y1="34" x2="80" y2="34" stroke="#111" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
                  <line x1="10" y1="48" x2="68" y2="48" stroke="#111" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
                  <line x1="10" y1="62" x2="80" y2="62" stroke="#111" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
                  <line x1="10" y1="76" x2="58" y2="76" stroke="#111" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
                  <line x1="10" y1="90" x2="72" y2="90" stroke="#111" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
                </g>
                {/* Paper airplane */}
                <g transform="translate(148,100)">
                  <path d="M 0 20 L 48 4 L 32 26 L 48 4 L 22 32 Z" fill="#111" stroke="#111" strokeWidth="2" strokeLinejoin="round" />
                </g>
                {/* Trail dots */}
                <circle cx="146" cy="140" r="2.5" fill="#111" opacity="0.35" />
                <circle cx="156" cy="152" r="2" fill="#111" opacity="0.25" />
                <circle cx="167" cy="164" r="1.5" fill="#111" opacity="0.18" />
              </svg>
            </FlowCard>

            {/* ─── 02: AI が抽出 (magnifier over doc + sparkles) ─── */}
            <FlowCard n="02" title="AI が抽出" icon={Sparkles} desc="担当者が最終確認。">
              <svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                <circle cx="120" cy="120" r="100" fill="#E8DFCE" opacity="0.55" />
                {/* Document (behind) */}
                <g transform="translate(30,70)">
                  <rect x="0" y="0" width="88" height="112" rx="4" fill="#FFFFFF" stroke="#111" strokeWidth="2.5" />
                  <line x1="10" y1="22" x2="70" y2="22" stroke="#111" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
                  <line x1="10" y1="38" x2="60" y2="38" stroke="#111" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
                  <line x1="10" y1="54" x2="70" y2="54" stroke="#111" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
                  <line x1="10" y1="70" x2="50" y2="70" stroke="#111" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
                  <line x1="10" y1="86" x2="65" y2="86" stroke="#111" strokeWidth="2" opacity="0.25" strokeLinecap="round" />
                </g>
                {/* Magnifying glass */}
                <g>
                  <circle cx="150" cy="128" r="42" fill="#FFFFFF" fillOpacity="0.92" stroke="#111" strokeWidth="3.5" />
                  {/* Data highlights inside */}
                  <rect x="122" y="112" width="30" height="4" rx="1" fill="#111" opacity="0.8" />
                  <rect x="122" y="124" width="42" height="4" rx="1" fill="#111" />
                  <rect x="122" y="136" width="26" height="4" rx="1" fill="#111" opacity="0.8" />
                  <rect x="122" y="148" width="38" height="4" rx="1" fill="#111" opacity="0.6" />
                  {/* Handle */}
                  <line x1="180" y1="158" x2="205" y2="185" stroke="#111" strokeWidth="6" strokeLinecap="round" />
                </g>
                {/* Sparkles */}
                <g fill="#111">
                  <path d="M 45 55 L 47 61 L 53 63 L 47 65 L 45 71 L 43 65 L 37 63 L 43 61 Z" opacity="0.55" />
                  <path d="M 190 68 L 192 72 L 197 74 L 192 76 L 190 80 L 188 76 L 183 74 L 188 72 Z" opacity="0.55" />
                </g>
              </svg>
            </FlowCard>

            {/* ─── 03: バウチャー即日 (ticket with seal) ─── */}
            <FlowCard n="03" title="バウチャー即日" icon={BadgeCheck} desc="旅行者用引換証を当日発行。">
              <svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                <circle cx="120" cy="120" r="100" fill="#E8DFCE" opacity="0.55" />
                {/* Voucher ticket */}
                <g transform="translate(35,58)">
                  <path
                    d="M 0 12 Q 0 0 12 0 L 158 0 Q 170 0 170 12 L 170 52 Q 160 58 160 66 Q 160 74 170 80 L 170 118 Q 170 130 158 130 L 12 130 Q 0 130 0 118 L 0 80 Q 10 74 10 66 Q 10 58 0 52 Z"
                    fill="#FFFFFF"
                    stroke="#111"
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                  />
                  {/* Perforation */}
                  <line
                    x1="10"
                    y1="66"
                    x2="160"
                    y2="66"
                    stroke="#111"
                    strokeWidth="1.5"
                    strokeDasharray="3 4"
                    opacity="0.5"
                  />
                  {/* Header (BONDEX mark) */}
                  <rect x="20" y="18" width="60" height="6" rx="1.5" fill="#111" />
                  <rect x="20" y="30" width="80" height="4" rx="1" fill="#111" opacity="0.4" />
                  <rect x="20" y="44" width="50" height="4" rx="1" fill="#111" opacity="0.3" />
                  {/* Bottom detail lines */}
                  <rect x="20" y="82" width="45" height="4" rx="1" fill="#111" opacity="0.3" />
                  <rect x="20" y="94" width="68" height="4" rx="1" fill="#111" opacity="0.3" />
                  <rect x="20" y="106" width="40" height="4" rx="1" fill="#111" opacity="0.3" />
                </g>
                {/* Checkmark seal (over top-right) */}
                <g transform="translate(178,68)">
                  <circle cx="0" cy="0" r="22" fill="#111" />
                  <path
                    d="M -8 1 L -2 8 L 10 -6"
                    stroke="#FAF7F2"
                    strokeWidth="3.5"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              </svg>
            </FlowCard>

            {/* ─── 04: 送り状を発行 (package with barcode label) ─── */}
            <FlowCard n="04" title="送り状を発行" icon={CalendarClock} desc="集荷 1ヶ月前から順次。">
              <svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                <circle cx="120" cy="120" r="100" fill="#E8DFCE" opacity="0.55" />
                {/* Isometric package */}
                <g transform="translate(38,55)">
                  {/* Package (rectangular) */}
                  <path
                    d="M 0 40 L 82 12 L 164 40 L 164 128 L 82 156 L 0 128 Z"
                    fill="#FFFFFF"
                    stroke="#111"
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                  />
                  {/* Top edges */}
                  <path
                    d="M 0 40 L 82 68 L 164 40 M 82 68 L 82 156"
                    stroke="#111"
                    strokeWidth="2.5"
                    fill="none"
                    strokeLinejoin="round"
                  />
                  {/* Tape */}
                  <path
                    d="M 82 12 L 82 68"
                    stroke="#111"
                    strokeWidth="2.5"
                    opacity="0.4"
                  />
                  {/* Shipping label (on left face) */}
                  <g transform="translate(12,80)">
                    <path d="M 0 0 L 55 -18 L 55 44 L 0 62 Z" fill="#FAF7F2" stroke="#111" strokeWidth="2" strokeLinejoin="round" />
                    {/* Barcode lines */}
                    <line x1="6" y1="6" x2="6" y2="52" stroke="#111" strokeWidth="1.5" />
                    <line x1="11" y1="4.5" x2="11" y2="50.5" stroke="#111" strokeWidth="2.2" />
                    <line x1="16" y1="3" x2="16" y2="49" stroke="#111" strokeWidth="1.2" />
                    <line x1="20" y1="1.5" x2="20" y2="47.5" stroke="#111" strokeWidth="1.5" />
                    <line x1="24" y1="0" x2="24" y2="46" stroke="#111" strokeWidth="1.2" />
                    <line x1="29" y1="-1.5" x2="29" y2="44.5" stroke="#111" strokeWidth="2" />
                    <line x1="34" y1="-3" x2="34" y2="43" stroke="#111" strokeWidth="1.5" />
                    <line x1="38" y1="-4.5" x2="38" y2="41.5" stroke="#111" strokeWidth="1.2" />
                    <line x1="43" y1="-6" x2="43" y2="40" stroke="#111" strokeWidth="2.2" />
                  </g>
                </g>
              </svg>
            </FlowCard>

            {/* ─── 05: Drive で共有 (folder + cloud + notification) ─── */}
            <FlowCard n="05" title="Drive で共有" icon={BellRing} desc="Email / Slack で通知。">
              <svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                <circle cx="120" cy="120" r="100" fill="#E8DFCE" opacity="0.55" />
                {/* Cloud (background) */}
                <path
                  d="M 60 68 Q 55 40 82 42 Q 92 22 116 32 Q 140 22 148 50 Q 172 48 168 74 Q 175 88 155 88 L 78 88 Q 55 88 60 68 Z"
                  fill="#FFFFFF"
                  stroke="#111"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  opacity="0.75"
                />
                {/* Folder */}
                <g transform="translate(38,110)">
                  <path
                    d="M 0 8 Q 0 -2 10 -2 L 60 -2 L 72 10 L 154 10 Q 164 10 164 20 L 164 88 Q 164 98 154 98 L 10 98 Q 0 98 0 88 Z"
                    fill="#FFFFFF"
                    stroke="#111"
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                  />
                  {/* Peek of files inside */}
                  <rect x="16" y="28" width="130" height="5" rx="1.5" fill="#111" opacity="0.35" />
                  <rect x="16" y="44" width="108" height="5" rx="1.5" fill="#111" opacity="0.35" />
                  <rect x="16" y="60" width="124" height="5" rx="1.5" fill="#111" opacity="0.35" />
                  <rect x="16" y="76" width="90" height="5" rx="1.5" fill="#111" opacity="0.35" />
                </g>
                {/* Notification badge (top-right of folder) */}
                <g transform="translate(185,105)">
                  <circle cx="0" cy="0" r="20" fill="#111" />
                  {/* Bell shape */}
                  <path
                    d="M -7 -3 Q -7 -12 0 -12 Q 7 -12 7 -3 L 7 3 Q 9 6 5 6 L -5 6 Q -9 6 -7 3 Z M -2 9 Q -2 12 0 12 Q 2 12 2 9"
                    fill="#FAF7F2"
                    strokeLinejoin="round"
                  />
                </g>
              </svg>
            </FlowCard>
          </div>
        </div>
      </section>

      {/* ═══════════════ Deliverables (Voucher / Waybill) ═══════════════ */}
      <section id="deliverables" className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <div className="mb-14 max-w-xl">
          <p className="text-[11px] tracking-[0.35em] text-[#111]/50 mb-4">DELIVERABLES / 発行物</p>
          <h2 className="text-4xl md:text-[52px] font-extrabold tracking-tight leading-[1.2]">
            必要な発行物を、まとめて用意。
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* ─── Voucher card ─── */}
          <div className="rounded-md border border-[#111]/10 bg-white overflow-hidden flex flex-col">
            <div className="aspect-[16/9] bg-[#FAF7F2] border-b border-[#111]/8 flex items-center justify-center p-6">
              <svg
                viewBox="0 0 320 200"
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-full max-h-[220px]"
              >
                <defs>
                  <pattern id="qr" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
                    <rect x="0" y="0" width="2" height="2" fill="#111" />
                    <rect x="2" y="2" width="2" height="2" fill="#111" />
                  </pattern>
                </defs>
                {/* Left ticket body */}
                <path
                  d="M 20 20 L 220 20 L 220 92 Q 208 100 220 108 L 220 180 L 20 180 Z"
                  fill="#FFFFFF"
                  stroke="#111"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
                {/* Right stub */}
                <path
                  d="M 220 20 L 300 20 L 300 180 L 220 180 L 220 108 Q 232 100 220 92 Z"
                  fill="#F1EBE0"
                  stroke="#111"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
                {/* Perforation */}
                <line
                  x1="220"
                  y1="20"
                  x2="220"
                  y2="180"
                  stroke="#111"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  opacity="0.4"
                />
                {/* Header */}
                <rect x="35" y="35" width="90" height="8" rx="1.5" fill="#111" />
                <rect x="35" y="52" width="60" height="4" rx="1" fill="#111" opacity="0.4" />
                {/* Body labels: Traveler / Hotel / Date */}
                <rect x="35" y="82" width="35" height="4" rx="1" fill="#111" opacity="0.6" />
                <rect x="35" y="92" width="120" height="5" rx="1" fill="#111" opacity="0.3" />
                <rect x="35" y="114" width="35" height="4" rx="1" fill="#111" opacity="0.6" />
                <rect x="35" y="124" width="140" height="5" rx="1" fill="#111" opacity="0.3" />
                <rect x="35" y="146" width="35" height="4" rx="1" fill="#111" opacity="0.6" />
                <rect x="35" y="156" width="90" height="5" rx="1" fill="#111" opacity="0.3" />
                {/* QR block */}
                <g transform="translate(238, 60)">
                  <rect x="0" y="0" width="46" height="46" fill="#FFFFFF" stroke="#111" strokeWidth="1.5" />
                  {/* QR position markers (3 corners) */}
                  <g fill="#111">
                    <rect x="3" y="3" width="10" height="10" />
                    <rect x="5" y="5" width="6" height="6" fill="#FFFFFF" />
                    <rect x="7" y="7" width="2" height="2" fill="#111" />
                    <rect x="33" y="3" width="10" height="10" />
                    <rect x="35" y="5" width="6" height="6" fill="#FFFFFF" />
                    <rect x="37" y="7" width="2" height="2" fill="#111" />
                    <rect x="3" y="33" width="10" height="10" />
                    <rect x="5" y="35" width="6" height="6" fill="#FFFFFF" />
                    <rect x="7" y="37" width="2" height="2" fill="#111" />
                  </g>
                  {/* QR data area (pattern fills middle) */}
                  <rect x="15" y="15" width="16" height="16" fill="url(#qr)" opacity="0.85" />
                  <rect x="15" y="33" width="10" height="10" fill="url(#qr)" opacity="0.85" />
                  <rect x="33" y="15" width="10" height="16" fill="url(#qr)" opacity="0.85" />
                  <rect x="33" y="33" width="10" height="10" fill="url(#qr)" opacity="0.85" />
                </g>
              </svg>
            </div>
            <div className="p-8 md:p-10">
              <p className="text-[10px] tracking-widest text-[#111]/50 mb-2">VOUCHER</p>
              <h3 className="text-2xl font-extrabold tracking-tight mb-4">旅行者用バウチャー</h3>
              <p className="text-[15px] text-[#111]/70 leading-loose">
                旅程受領後、<strong className="text-[#111]">即日発行</strong>。
                英/日バイリンガル、ホテル担当者向け一時預かり案内も同梱。
              </p>
            </div>
          </div>

          {/* ─── Waybill card ─── */}
          <div className="rounded-md border border-[#111]/10 bg-white overflow-hidden flex flex-col">
            <div className="aspect-[16/9] bg-[#FAF7F2] border-b border-[#111]/8 flex items-center justify-center p-6">
              <svg
                viewBox="0 0 320 200"
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-full max-h-[220px]"
              >
                <defs>
                  <pattern id="barcode" x="0" y="0" width="7" height="30" patternUnits="userSpaceOnUse">
                    <rect x="0" y="0" width="1.5" height="30" fill="#111" />
                    <rect x="2.5" y="0" width="2" height="30" fill="#111" />
                    <rect x="5.5" y="0" width="1" height="30" fill="#111" />
                  </pattern>
                </defs>
                {/* Label rectangle */}
                <rect
                  x="20"
                  y="20"
                  width="280"
                  height="160"
                  rx="4"
                  fill="#FFFFFF"
                  stroke="#111"
                  strokeWidth="2.5"
                />
                {/* Header strip */}
                <rect x="20" y="20" width="280" height="26" fill="#111" />
                <text
                  x="35"
                  y="38"
                  fill="#FAF7F2"
                  fontSize="10"
                  fontWeight="bold"
                  letterSpacing="2"
                  fontFamily="monospace"
                >
                  SHIPPING LABEL
                </text>
                {/* FROM box */}
                <rect
                  x="35"
                  y="58"
                  width="110"
                  height="52"
                  rx="2"
                  fill="none"
                  stroke="#111"
                  strokeWidth="1.5"
                  opacity="0.55"
                />
                <rect x="43" y="64" width="24" height="3.5" rx="0.5" fill="#111" opacity="0.7" />
                <rect x="43" y="76" width="65" height="4.5" rx="0.5" fill="#111" />
                <rect x="43" y="88" width="70" height="3" rx="0.5" fill="#111" opacity="0.4" />
                <rect x="43" y="97" width="55" height="3" rx="0.5" fill="#111" opacity="0.4" />
                {/* Arrow */}
                <path
                  d="M 152 84 L 168 84 M 162 78 L 168 84 L 162 90"
                  stroke="#111"
                  strokeWidth="2.2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* TO box */}
                <rect
                  x="175"
                  y="58"
                  width="110"
                  height="52"
                  rx="2"
                  fill="none"
                  stroke="#111"
                  strokeWidth="1.5"
                  opacity="0.55"
                />
                <rect x="183" y="64" width="16" height="3.5" rx="0.5" fill="#111" opacity="0.7" />
                <rect x="183" y="76" width="60" height="4.5" rx="0.5" fill="#111" />
                <rect x="183" y="88" width="72" height="3" rx="0.5" fill="#111" opacity="0.4" />
                <rect x="183" y="97" width="50" height="3" rx="0.5" fill="#111" opacity="0.4" />
                {/* Barcode area */}
                <rect
                  x="35"
                  y="122"
                  width="250"
                  height="42"
                  fill="#FAF7F2"
                  stroke="#111"
                  strokeWidth="1.5"
                  strokeOpacity="0.25"
                />
                <rect
                  x="45"
                  y="130"
                  width="214"
                  height="26"
                  fill="url(#barcode)"
                />
                {/* Tracking number placeholder */}
                <rect
                  x="102"
                  y="168"
                  width="116"
                  height="5"
                  rx="0.5"
                  fill="#111"
                  opacity="0.55"
                />
              </svg>
            </div>
            <div className="p-8 md:p-10">
              <p className="text-[10px] tracking-widest text-[#111]/50 mb-2">SHIPPING LABEL</p>
              <h3 className="text-2xl font-extrabold tracking-tight mb-4">物流業者の送り状</h3>
              <p className="text-[15px] text-[#111]/70 leading-loose">
                集荷日の <strong className="text-[#111]">1 ヶ月前</strong> に発行 (物流業者仕様)。
                追跡番号付き、現在ヤマト運輸の宅急便を利用中。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════ Price (compressed) ═══════════════ */}
      <section id="price" className="border-y border-[#111]/8 bg-[#F1EBE0]/60">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <div className="mb-14 max-w-xl">
            <p className="text-[11px] tracking-[0.35em] text-[#111]/50 mb-4">PRICE / 料金</p>
            <h2 className="text-4xl md:text-[52px] font-extrabold tracking-tight leading-[1.2]">
              1 件単価、月次まとめ請求。
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {[
              { icon: CreditCard, title: "立替払い", body: "運賃は BondEx が事前立替" },
              { icon: Building2, title: "月末締め", body: "翌月初に PDF 請求書発行" },
              { icon: Clock, title: "翌月末払い", body: "対象月の翌月末日までにお振込み" },
            ].map((c) => {
              const Icon = c.icon
              return (
                <div key={c.title} className="rounded-md bg-white border border-[#111]/10 p-8">
                  <Icon className="w-5 h-5 text-[#111]/60 mb-5" strokeWidth={1.5} />
                  <h3 className="text-lg font-extrabold tracking-tight mb-2">{c.title}</h3>
                  <p className="text-[14px] text-[#111]/70 leading-loose">{c.body}</p>
                </div>
              )
            })}
          </div>

          <p className="mt-8 text-[13px] text-[#111]/60 leading-loose max-w-3xl">
            サイズ・重量問わず 1 個単価は同じ (ヤマト運輸受託限度: 3辺合計 160cm・25kg 以内)。
            単価詳細は個別ご案内いたします。
          </p>
        </div>
      </section>

      {/* ═══════════════ FAQ (holds practical detail — 補償・サポート含む) ═══════════════ */}
      <section id="faq" className="max-w-3xl mx-auto px-6 py-24 md:py-32">
        <p className="text-[11px] tracking-[0.35em] text-[#111]/50 mb-4">FAQ</p>
        <h2 className="text-4xl md:text-[52px] font-extrabold tracking-tight leading-[1.2] mb-12">
          よくあるご質問。
        </h2>
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
            <details key={i} className="group rounded-md border border-[#111]/10 bg-white p-6">
              <summary className="cursor-pointer text-[15px] font-extrabold flex items-center justify-between gap-4 list-none tracking-tight">
                <span>{f.q}</span>
                <ChevronRight
                  className="w-4 h-4 shrink-0 transition-transform group-open:rotate-90"
                  strokeWidth={1.5}
                />
              </summary>
              <p className="mt-4 text-[14px] text-[#111]/70 leading-loose">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ═══════════════ CTA ═══════════════ */}
      <section id="contact" className="border-t border-[#111]/8 bg-[#111] text-[#FAF7F2]">
        <div className="max-w-4xl mx-auto px-6 py-24 md:py-32 text-center">
          <p className="text-[11px] tracking-[0.35em] text-white/60 mb-6">CONTACT</p>
          <h2 className="text-4xl md:text-[56px] font-extrabold tracking-tight leading-[1.2] mb-10">
            試験運用は 1 件から。
          </h2>
          <div className="flex flex-col items-center gap-3">
            <a
              href={CONTACT_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 px-8 py-4 rounded-md bg-white text-[#111] text-[15px] font-medium hover:bg-white/90"
            >
              導入相談フォームへ
              <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
            </a>
            <p className="text-[12px] text-white/70">通常 1 営業日以内にご連絡します。</p>
          </div>
        </div>
      </section>

      {/* ═══════════════ Footer ═══════════════ */}
      <footer className="bg-[#FAF7F2]">
        <div className="max-w-6xl mx-auto px-6 py-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 text-sm">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bondex-logo.png" alt="BondEx" className="h-8 w-auto object-contain" />
            <p className="text-[12px] text-[#111]/60 leading-loose">
              運営: 株式会社JOJO / 東京都世田谷区野毛1-9-12
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-[#111]/70">
            <Link href="/agency/login" className="hover:text-[#111]">代理店ログイン</Link>
            <Link href="/track" className="hover:text-[#111]">トラッキング</Link>
            <Link href="/legal/terms" className="hover:text-[#111]">利用規約</Link>
            <Link href="/legal/privacy" className="hover:text-[#111]">プライバシー</Link>
            <Link href="/legal/commercial-transactions" className="hover:text-[#111]">
              特定商取引法
            </Link>
          </div>
        </div>
        <div className="border-t border-[#111]/8">
          <div className="max-w-6xl mx-auto px-6 py-4 text-[11px] text-[#111]/50 leading-loose">
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
