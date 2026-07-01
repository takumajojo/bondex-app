"use client"

import Link from "next/link"
import {
  ArrowRight,
  ChevronRight,
  FileText,
  Truck,
  Mail,
  FolderOpen,
  Clock,
  Building2,
  CreditCard,
  Send,
  Sparkles,
  BadgeCheck,
  CalendarClock,
  BellRing,
} from "lucide-react"

const CONTACT_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfztfArRTfT4lgAdcNHeZFCDE23gwWivcjgzOUOkUSH9ah_Ew/viewform?usp=header"

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#FAF7F2] text-[#111]">
      {/* ─────────────── Header ─────────────── */}
      <header className="sticky top-0 z-40 border-b border-[#111]/8 bg-[#FAF7F2]/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bondex-logo.png" alt="BondEx" className="h-10 w-auto object-contain" />
          <nav className="hidden md:flex items-center gap-8 text-[13px] text-[#111]/70">
            <a href="#flow" className="hover:text-[#111]">流れ</a>
            <a href="#deliverables" className="hover:text-[#111]">発行物</a>
            <a href="#pricing" className="hover:text-[#111]">料金と請求</a>
            <a href="#faq" className="hover:text-[#111]">FAQ</a>
          </nav>
          <Link
            href="/agency/login"
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-[#111]/15 hover:border-[#111]/50"
          >
            代理店ログイン
            <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.5} />
          </Link>
        </div>
      </header>

      {/* ─────────────── Hero ─────────────── */}
      <section className="relative overflow-hidden">
        <div className="max-w-6xl mx-auto px-6 pt-24 pb-20 md:pt-36 md:pb-28 text-center">
          <p className="text-[11px] tracking-[0.35em] text-[#111]/50 mb-8">
            HOTEL-TO-HOTEL LUGGAGE FORWARDING
          </p>
          <h1 className="text-[44px] sm:text-6xl md:text-[80px] font-semibold leading-[1.05] tracking-tight mb-8">
            ホテルからホテルへ、<br />
            荷物を、置いてこよう。
          </h1>
          <p className="text-lg text-[#111]/70 leading-relaxed max-w-xl mx-auto">
            旅程を送るだけ。バウチャーと配送伝票を BondEx が発行し、
            Google Drive で一括共有します。
          </p>

          {/* Journey visual — 2 hotels + luggage motion */}
          <div className="mt-14 md:mt-16 max-w-3xl mx-auto">
            <svg viewBox="0 0 720 140" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
              {/* dotted travel path */}
              <path
                d="M 110 90 Q 360 20 610 90"
                fill="none"
                stroke="#111"
                strokeOpacity="0.35"
                strokeWidth="1.5"
                strokeDasharray="2 5"
              />
              {/* hotel A */}
              <g transform="translate(60,60)">
                <rect x="0" y="0" width="60" height="70" fill="none" stroke="#111" strokeWidth="1.5" />
                <line x1="0" y1="18" x2="60" y2="18" stroke="#111" strokeWidth="1.5" />
                <rect x="10" y="26" width="8" height="10" fill="#111" opacity="0.5" />
                <rect x="26" y="26" width="8" height="10" fill="#111" opacity="0.5" />
                <rect x="42" y="26" width="8" height="10" fill="#111" opacity="0.5" />
                <rect x="10" y="44" width="8" height="10" fill="#111" opacity="0.5" />
                <rect x="26" y="44" width="8" height="10" fill="#111" opacity="0.5" />
                <rect x="42" y="44" width="8" height="10" fill="#111" opacity="0.5" />
                <text x="30" y="10" textAnchor="middle" fontSize="9" fill="#111" fontFamily="serif" letterSpacing="2">HOTEL A</text>
              </g>
              {/* hotel B */}
              <g transform="translate(600,60)">
                <rect x="0" y="0" width="60" height="70" fill="none" stroke="#111" strokeWidth="1.5" />
                <line x1="0" y1="18" x2="60" y2="18" stroke="#111" strokeWidth="1.5" />
                <rect x="10" y="26" width="8" height="10" fill="#111" opacity="0.5" />
                <rect x="26" y="26" width="8" height="10" fill="#111" opacity="0.5" />
                <rect x="42" y="26" width="8" height="10" fill="#111" opacity="0.5" />
                <rect x="10" y="44" width="8" height="10" fill="#111" opacity="0.5" />
                <rect x="26" y="44" width="8" height="10" fill="#111" opacity="0.5" />
                <rect x="42" y="44" width="8" height="10" fill="#111" opacity="0.5" />
                <text x="30" y="10" textAnchor="middle" fontSize="9" fill="#111" fontFamily="serif" letterSpacing="2">HOTEL B</text>
              </g>
              {/* luggage in transit */}
              <g transform="translate(348,32)">
                <rect x="0" y="6" width="24" height="30" rx="3" fill="#111" />
                <rect x="6" y="0" width="12" height="8" rx="2" fill="none" stroke="#111" strokeWidth="1.5" />
                <line x1="4" y1="14" x2="20" y2="14" stroke="#FAF7F2" strokeWidth="1" />
                <line x1="4" y1="26" x2="20" y2="26" stroke="#FAF7F2" strokeWidth="1" />
              </g>
              <text x="360" y="80" textAnchor="middle" fontSize="10" fill="#111" opacity="0.6" fontFamily="serif" letterSpacing="1.5">
                BondEx
              </text>
            </svg>
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
            <a
              href={CONTACT_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-md bg-[#111] text-[#FAF7F2] text-sm font-medium hover:bg-[#111]/90"
            >
              導入相談フォームへ
              <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
            </a>
            <a
              href="#flow"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-md border border-[#111]/20 text-sm hover:border-[#111]/50"
            >
              流れを見る
            </a>
          </div>
        </div>
      </section>

      {/* ─────────────── Value in 3 lines ─────────────── */}
      <section className="border-y border-[#111]/8 bg-[#F1EBE0]/70">
        <div className="max-w-6xl mx-auto px-6 py-14 grid md:grid-cols-3 gap-6 md:gap-10">
          {[
            {
              title: "旅程 PDF を送るだけ",
              body: "旅程表 (Excel/PDF/画像) を BondEx へ。宿泊ホテル・移動区間・荷物数を AI が読み取ります。",
            },
            {
              title: "発行物は Google Drive で共有",
              body: "旅行者用バウチャー + 物流業者の送り状を PDF で発行、専用フォルダに集約 → Email/Slack で通知。",
            },
            {
              title: "立替払い、月末締め翌月払い",
              body: "物流業者への運賃は BondEx が立替え、月次でまとめて代理店様へご請求します。",
            },
          ].map((v) => (
            <div key={v.title}>
              <h3 className="text-lg font-semibold mb-2 tracking-tight">{v.title}</h3>
              <p className="text-sm text-[#111]/70 leading-relaxed">{v.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────────── Operational Flow — Visual ─────────────── */}
      <section id="flow" className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <div className="mb-12 max-w-2xl">
          <p className="text-[11px] tracking-[0.3em] text-[#111]/50 mb-3">FLOW</p>
          <h2 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight">
            旅程を送ったら、<br />
            あとは受け取るだけ。
          </h2>
        </div>

        {/* Visual flow */}
        <div className="grid md:grid-cols-5 gap-3 md:gap-2 items-stretch">
          {[
            {
              n: "01",
              title: "旅程を送付",
              body: "Excel / PDF / 画像。使い慣れたフォーマットのままで OK。",
              icon: Send,
            },
            {
              n: "02",
              title: "AI が自動抽出",
              body: "ホテル・日程・荷物数を抽出。担当者が目視で最終確認。",
              icon: Sparkles,
            },
            {
              n: "03",
              title: "バウチャー即日発行",
              body: "旅行者にお渡しする引換証 (英/日) を当日中に発行。",
              icon: BadgeCheck,
            },
            {
              n: "04",
              title: "送り状は集荷 1ヶ月前",
              body: "物流業者の仕様上、送り状発行は集荷日の1ヶ月前から順次。",
              icon: CalendarClock,
            },
            {
              n: "05",
              title: "Drive 共有 + 通知",
              body: "案件専用フォルダに集約 → Email / Slack でお知らせ。",
              icon: BellRing,
            },
          ].map((step, i, arr) => {
            const Icon = step.icon
            return (
              <div key={step.n} className="relative">
                <div className="h-full rounded-md border border-[#111]/10 bg-white p-5 flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-mono text-[#111]/40 tracking-widest">{step.n}</span>
                    <Icon className="w-4 h-4 text-[#111]/60" strokeWidth={1.5} />
                  </div>
                  <h3 className="text-[15px] font-semibold leading-snug mb-2 tracking-tight">
                    {step.title}
                  </h3>
                  <p className="text-xs text-[#111]/60 leading-relaxed">{step.body}</p>
                </div>
                {i < arr.length - 1 && (
                  <div className="hidden md:flex absolute -right-1 top-1/2 -translate-y-1/2 z-10 items-center justify-center w-3 h-3">
                    <ArrowRight className="w-3 h-3 text-[#111]/30" strokeWidth={2} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ─────────────── Timing Visual ─────────────── */}
      <section id="deliverables" className="border-y border-[#111]/8 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <div className="mb-14 max-w-2xl">
            <p className="text-[11px] tracking-[0.3em] text-[#111]/50 mb-3">DELIVERABLES</p>
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight">
              バウチャーは即日。<br />
              送り状は集荷 1 ヶ月前から。
            </h2>
            <p className="mt-5 text-[15px] text-[#111]/70 leading-relaxed">
              物流業者側の仕様で、集荷日から 1 ヶ月以内でないと配送伝票を発行できません。
              バウチャー (旅行者にお渡しする引換証) だけは、旅程受領後 即日 で発行してお渡しします。
            </p>
          </div>

          {/* Timeline visual */}
          <div className="relative mb-10">
            <div className="h-1 bg-gradient-to-r from-[#111]/10 via-[#111]/30 to-[#111]/60 rounded-full" />
            <div className="grid grid-cols-4 gap-2 mt-6 relative">
              {[
                { label: "旅程受領", sub: "T日" },
                { label: "バウチャー発行", sub: "即日 (T日〜)", highlight: true },
                { label: "送り状発行", sub: "集荷 1ヶ月前", highlight: true },
                { label: "集荷 → 翌日到着", sub: "実運送" },
              ].map((t, i) => (
                <div key={i} className="text-center">
                  <div
                    className={`inline-flex w-3 h-3 rounded-full -mt-8 mb-3 ${
                      t.highlight ? "bg-[#111]" : "bg-[#111]/30"
                    }`}
                  />
                  <p className="text-sm font-semibold mb-1">{t.label}</p>
                  <p className="text-[11px] text-[#111]/60">{t.sub}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 2 deliverable cards */}
          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded-md border border-[#111]/10 p-8 bg-[#FAF7F2]">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-11 h-11 rounded-md bg-[#111] text-[#FAF7F2] flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-[10px] tracking-widest text-[#111]/50 mb-1">VOUCHER</p>
                  <h3 className="text-xl font-semibold tracking-tight">旅行者用バウチャー</h3>
                </div>
              </div>
              <p className="text-sm text-[#111]/70 leading-relaxed mb-4">
                旅程受領後、<strong className="text-[#111]">即日発行</strong>。
                ホテル担当者様への日本語案内も同梱した 2 ページ構成 PDF。
              </p>
              <ul className="space-y-1.5 text-[13px] text-[#111]/70">
                <li>・英語 / 日本語 バイリンガル</li>
                <li>・出発元・配達先ホテル、日付、代表者名、区間ごとの荷物数</li>
                <li>・ホテル担当者向け「一時預かり」お願い文面付き</li>
              </ul>
            </div>

            <div className="rounded-md border border-[#111]/10 p-8 bg-[#FAF7F2]">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-11 h-11 rounded-md bg-[#111] text-[#FAF7F2] flex items-center justify-center shrink-0">
                  <Truck className="w-5 h-5" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-[10px] tracking-widest text-[#111]/50 mb-1">SHIPPING LABEL</p>
                  <h3 className="text-xl font-semibold tracking-tight">物流業者の送り状</h3>
                </div>
              </div>
              <p className="text-sm text-[#111]/70 leading-relaxed mb-4">
                集荷日の <strong className="text-[#111]">1 ヶ月前</strong> になった時点で発行可能に。
                発行完了と同時に PDF で共有します。
              </p>
              <ul className="space-y-1.5 text-[13px] text-[#111]/70">
                <li>・現在の物流業者: ヤマト運輸 (宅急便)</li>
                <li>・追跡番号付き、集荷から翌日配送 (主要都市)</li>
                <li>・BondEx が事前に発行 → 発送元ホテルへ送付する運用も可</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────── Sharing Flow (Drive + Email/Slack) ─────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <div className="grid md:grid-cols-[1fr_1.2fr] gap-12 items-center">
          <div>
            <p className="text-[11px] tracking-[0.3em] text-[#111]/50 mb-3">SHARING</p>
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight mb-5">
              発行物は、<br />
              Drive で 1 箇所に。
            </h2>
            <p className="text-[15px] text-[#111]/70 leading-relaxed mb-6">
              案件ごとの Google Drive フォルダに、バウチャーと送り状を PDF で集約。
              追加・更新のたびに Email もしくは Slack で自動通知します。
              代理店様の現場で「PDF どこ?」を無くします。
            </p>
            <div className="space-y-3">
              {[
                { icon: FolderOpen, label: "案件別 Drive フォルダ", body: "BDX-XXX ごとに 1 フォルダ、常時アクセス可" },
                { icon: Mail, label: "Email 通知", body: "発行完了 / 追加のたびに担当者様宛にお知らせ" },
                { icon: BellRing, label: "Slack 連携 (準備中)", body: "貴社チャンネルに直接投稿、ワンクリックで DL" },
              ].map((c) => {
                const Icon = c.icon
                return (
                  <div key={c.label} className="flex items-start gap-3">
                    <Icon className="w-4 h-4 mt-1 text-[#111]/60 shrink-0" strokeWidth={1.5} />
                    <div>
                      <p className="text-sm font-semibold">{c.label}</p>
                      <p className="text-[13px] text-[#111]/60">{c.body}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Visual: Drive folder mockup */}
          <div className="rounded-md border border-[#111]/10 bg-white p-6 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.2)]">
            <div className="flex items-center gap-2 pb-3 border-b border-[#111]/10 mb-4">
              <FolderOpen className="w-4 h-4 text-[#111]/60" strokeWidth={1.5} />
              <p className="text-sm font-medium">BondEx / BDX-260710-428 / Costanzo 様</p>
              <span className="ml-auto text-[10px] text-[#111]/40">Shared with agency</span>
            </div>
            <div className="space-y-1.5">
              {[
                { name: "voucher_leg1_ANA→Hilton-Kyoto.pdf", size: "2.4 MB", tag: "即日発行" },
                { name: "voucher_leg2_Hilton-Kyoto→Hankyu-Osaka.pdf", size: "2.4 MB", tag: "即日発行" },
                { name: "yamato_label_leg1_487738915591.pdf", size: "128 KB", tag: "集荷1ヶ月前に追加" },
                { name: "yamato_label_leg2_487738915565.pdf", size: "128 KB", tag: "集荷1ヶ月前に追加" },
                { name: "operations_sheet.pdf", size: "48 KB", tag: "内部記録" },
              ].map((f) => (
                <div
                  key={f.name}
                  className="flex items-center gap-3 px-3 py-2 rounded hover:bg-[#111]/5 transition-colors"
                >
                  <FileText className="w-4 h-4 text-[#111]/50 shrink-0" strokeWidth={1.5} />
                  <p className="text-[13px] font-mono truncate flex-1">{f.name}</p>
                  <span className="text-[10px] text-[#111]/40 whitespace-nowrap">{f.size}</span>
                  <span className="text-[10px] bg-[#111]/5 text-[#111]/70 px-2 py-0.5 rounded whitespace-nowrap">
                    {f.tag}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-5 pt-4 border-t border-[#111]/10 flex items-center gap-2 text-[11px] text-[#111]/60">
              <Mail className="w-3.5 h-3.5" strokeWidth={1.5} />
              <span>通知: karen@myjapanplanner.com (即日発行) / #bondex-ops (Slack)</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────── Pricing & Invoicing ─────────────── */}
      <section id="pricing" className="border-y border-[#111]/8 bg-[#F1EBE0]/70">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <div className="mb-12 max-w-2xl">
            <p className="text-[11px] tracking-[0.3em] text-[#111]/50 mb-3">PRICING & INVOICING</p>
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight">
              料金は 1 件単価、<br />
              請求は月次でまとめて。
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {[
              {
                icon: CreditCard,
                title: "立替払い",
                body: "物流業者への運賃 (ヤマト等) は BondEx が事前に立替払いします。代理店様は月末締めの一本化された請求書 1 枚を受け取るのみ。",
              },
              {
                icon: Building2,
                title: "月次まとめ請求",
                body: "毎月末日締めで当月発行分を集計、翌月初に PDF 請求書を発行。原価計算・経理処理を大幅に軽減。",
              },
              {
                icon: Clock,
                title: "翌月末払い",
                body: "対象月の翌月末日払い。振込先は BondEx (株式会社JOJO) 名義。振込手数料は代理店様のご負担でお願いいたします。",
              },
            ].map((c) => {
              const Icon = c.icon
              return (
                <div key={c.title} className="rounded-md bg-white border border-[#111]/10 p-6">
                  <Icon className="w-5 h-5 text-[#111]/60 mb-4" strokeWidth={1.5} />
                  <h3 className="text-lg font-semibold mb-2 tracking-tight">{c.title}</h3>
                  <p className="text-sm text-[#111]/70 leading-relaxed">{c.body}</p>
                </div>
              )
            })}
          </div>

          <div className="mt-8 rounded-md border border-[#111]/10 bg-white p-6">
            <p className="text-[10px] tracking-widest text-[#111]/50 mb-2">サイズ・重量について</p>
            <p className="text-sm text-[#111]/80 leading-relaxed">
              スーツケース (S / M / L / XL)・段ボール・ゴルフバッグ、
              <strong className="text-[#111]">サイズ・重量問わず 1 個単価は同じ</strong>です。
              利用する物流業者の受託限度 (現在ヤマト運輸: 3 辺合計 160cm・25kg 以内) を超えるものは対象外となります。
              単価の詳細は個別ご案内いたします。
            </p>
          </div>
        </div>
      </section>

      {/* ─────────────── Liability ─────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <div className="grid md:grid-cols-[1fr_1.5fr] gap-10 items-start">
          <div>
            <p className="text-[11px] tracking-[0.3em] text-[#111]/50 mb-3">LIABILITY</p>
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight mb-4">
              補償は、<br />
              物流業者の約款どおり。
            </h2>
            <p className="text-[15px] text-[#111]/70 leading-relaxed">
              BondEx は取次サービスで独自補償はありません。
              実運送を担う物流業者の運送約款に完全に準じます。
            </p>
          </div>

          <div className="rounded-md border border-[#111]/10 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#111]/10 bg-[#F1EBE0]/40">
                  <th className="text-left px-5 py-3 font-medium text-[11px] tracking-widest text-[#111]/50">物流業者</th>
                  <th className="text-left px-5 py-3 font-medium text-[11px] tracking-widest text-[#111]/50">運送約款</th>
                  <th className="text-left px-5 py-3 font-medium text-[11px] tracking-widest text-[#111]/50">補償上限</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[#111]/10 bg-white">
                  <td className="px-5 py-4">
                    <p className="font-semibold">ヤマト運輸</p>
                    <p className="text-[11px] text-[#111]/50">現在利用中</p>
                  </td>
                  <td className="px-5 py-4 text-[#111]/80">宅急便運送約款</td>
                  <td className="px-5 py-4">
                    <p className="font-semibold">30 万円 / 個</p>
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-4">
                    <p className="font-semibold">佐川急便</p>
                    <p className="text-[11px] text-[#111]/50">参考</p>
                  </td>
                  <td className="px-5 py-4 text-[#111]/80">飛脚宅配便運送約款</td>
                  <td className="px-5 py-4">
                    <p className="font-semibold">30 万円 / 個</p>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="px-5 py-4 text-[12px] text-[#111]/60 bg-[#FAF7F2] leading-relaxed border-t border-[#111]/10">
              現金・貴重品・宝石・美術品・生もの・危険物等は各社約款上の対象外品目となります。
              高額品を含む案件では事前にご相談ください。物流業者を変更する際は事前告知のうえ、切替後は新たな物流業者の運送約款が適用されます。
            </p>
          </div>
        </div>
      </section>

      {/* ─────────────── FAQ ─────────────── */}
      <section id="faq" className="border-y border-[#111]/8 bg-white">
        <div className="max-w-3xl mx-auto px-6 py-20 md:py-28">
          <p className="text-[11px] tracking-[0.3em] text-[#111]/50 mb-3">FAQ</p>
          <h2 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight mb-10">
            よくあるご質問
          </h2>
          <div className="space-y-3">
            {[
              {
                q: "旅程はどの形式で送れますか?",
                a: "Excel / PDF / 画像 / スクリーンショット、いずれも受け付けます。代理店様の使い慣れたフォーマットのままで結構です。手書き旅程やメール本文の場合はテキスト形式でお送りください。",
              },
              {
                q: "バウチャーはすぐに発行できるのに、送り状はなぜ 1ヶ月前なのですか?",
                a: "物流業者 (ヤマト運輸等) の発行仕様上、集荷日から 30 日以内でないと送り状を発行できないためです。バウチャーは BondEx 発行のため即日対応が可能です。送り状は集荷 1 ヶ月前になり次第、順次発行して Drive に追加します。",
              },
              {
                q: "料金の請求サイクルを教えてください。",
                a: "月末日締めで当月発行分を集計、翌月初に PDF 請求書を代理店様宛にお送りします。お支払期限は対象月の翌月末日です。物流業者への運賃は BondEx が立替払いしていますので、代理店様が月次で BondEx にご入金いただく流れとなります。",
              },
              {
                q: "共有方法はメール以外に対応していますか?",
                a: "はい、Slack への Webhook 連携もご提供予定です (現時点は Email 中心)。Google Drive フォルダは常時アクセスできる状態でお渡しし、追加・更新のたびに通知します。",
              },
              {
                q: "補償はどこまでですか?",
                a: "実運送を担う物流業者の運送約款に完全に準じます。現在ヤマト運輸の宅急便を利用しており、1 個あたり上限 30 万円です。BondEx 独自の追加補償はありません。将来 佐川急便その他への切替を行う場合は、事前告知のうえ切替後の物流業者の運送約款が適用されます。",
              },
              {
                q: "契約から運用開始までどのくらいかかりますか?",
                a: "業務委託契約 (取次業として明記) の締結後、代理店ポータルのアカウントを発行して即日運用開始できます。初回の旅程 PDF をお送りいただければ、当日中にバウチャーを発行してテストいただけます。",
              },
              {
                q: "第一種貨物利用運送事業の登録は?",
                a: "BondEx は取次サービスであり運送人ではないため、所管の運輸局に照会中です。書面回答を取得次第、本ページに照会番号と回答内容を掲載いたします。",
              },
            ].map((f, i) => (
              <details key={i} className="group rounded-md border border-[#111]/10 bg-[#FAF7F2] p-5">
                <summary className="cursor-pointer text-[15px] font-semibold flex items-center justify-between gap-4 list-none">
                  <span>{f.q}</span>
                  <ChevronRight className="w-4 h-4 shrink-0 transition-transform group-open:rotate-90" strokeWidth={1.5} />
                </summary>
                <p className="mt-3 text-sm text-[#111]/70 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────── CTA ─────────────── */}
      <section id="contact" className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <div className="rounded-md border border-[#111]/10 bg-[#111] text-[#FAF7F2] p-10 md:p-16">
          <p className="text-[11px] tracking-[0.3em] text-[#FAF7F2]/60 mb-4">GET STARTED</p>
          <h2 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight mb-6 max-w-2xl">
            試験運用は 1 件から。<br />
            まずは 30 分、話を聞かせてください。
          </h2>
          <p className="text-[15px] text-[#FAF7F2]/70 leading-relaxed mb-8 max-w-2xl">
            契約書・責任分界表・請求書サンプル・法務レビュー用パッケージを、
            打合せ日程調整とあわせてお送りいたします。
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <a
              href={CONTACT_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-[#FAF7F2] text-[#111] p-5 flex items-start gap-3 hover:bg-[#FAF7F2]/90"
            >
              <FileText className="w-5 h-5 mt-0.5 shrink-0" strokeWidth={1.5} />
              <div className="text-left">
                <p className="text-sm font-semibold">導入相談フォーム</p>
                <p className="text-xs opacity-70 mt-0.5">3 分で入力、折り返しご連絡いたします</p>
              </div>
            </a>
            <a
              href="mailto:support@bondex.express?subject=BondEx%20導入相談"
              className="rounded-md border border-[#FAF7F2]/30 p-5 flex items-start gap-3 hover:border-[#FAF7F2]/60"
            >
              <Mail className="w-5 h-5 mt-0.5 shrink-0" strokeWidth={1.5} />
              <div className="text-left">
                <p className="text-sm font-semibold">Email</p>
                <p className="text-xs opacity-70 mt-0.5">support@bondex.express</p>
              </div>
            </a>
          </div>
        </div>
      </section>

      {/* ─────────────── Footer ─────────────── */}
      <footer className="border-t border-[#111]/8 bg-[#FAF7F2]">
        <div className="max-w-6xl mx-auto px-6 py-12 grid gap-8 md:grid-cols-4 text-sm">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bondex-logo.png" alt="BondEx" className="h-8 w-auto object-contain mb-3" />
            <p className="text-xs text-[#111]/60 leading-relaxed">
              運営: 株式会社JOJO<br />
              東京都世田谷区野毛1-9-12
            </p>
          </div>
          <div>
            <p className="text-[10px] tracking-widest text-[#111]/50 mb-3">SERVICE</p>
            <ul className="space-y-2 text-xs">
              <li><a href="#flow" className="hover:text-[#111]">流れ</a></li>
              <li><a href="#deliverables" className="hover:text-[#111]">発行物</a></li>
              <li><a href="#pricing" className="hover:text-[#111]">料金と請求</a></li>
              <li><Link href="/track" className="hover:text-[#111]">トラッキング</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-[10px] tracking-widest text-[#111]/50 mb-3">PORTALS</p>
            <ul className="space-y-2 text-xs">
              <li><Link href="/agency/login" className="hover:text-[#111]">代理店ログイン</Link></li>
              <li><Link href="/operator/login" className="hover:text-[#111]">運用ログイン</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-[10px] tracking-widest text-[#111]/50 mb-3">LEGAL</p>
            <ul className="space-y-2 text-xs">
              <li><Link href="/legal/terms" className="hover:text-[#111]">利用規約</Link></li>
              <li><Link href="/legal/privacy" className="hover:text-[#111]">プライバシーポリシー</Link></li>
              <li><Link href="/legal/commercial-transactions" className="hover:text-[#111]">特定商取引法に基づく表記</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-[#111]/8">
          <div className="max-w-6xl mx-auto px-6 py-4 text-[11px] text-[#111]/60 leading-relaxed">
            <p className="mb-2">
              BondEx は自らが運送を引き受ける運送人ではなく、旅程情報を受けて物流業者への発送を取り次ぐ「取次サービス」です。
              実運送・運送責任・補償は、当社が利用する物流業者 (現在: ヤマト運輸 宅急便運送約款) に完全に準じます。
              第一種貨物利用運送事業の登録要否については所管の運輸局に照会中で、書面回答取得後に照会番号と回答内容を本ページに掲載します。
            </p>
            <p>
              © {new Date().getFullYear()} 株式会社JOJO / BondEx
            </p>
          </div>
        </div>
      </footer>
    </main>
  )
}
