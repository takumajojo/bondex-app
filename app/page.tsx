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
  HandshakeIcon,
  MessageCircleQuestion,
  ShieldCheck,
} from "lucide-react"

const CONTACT_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfztfArRTfT4lgAdcNHeZFCDE23gwWivcjgzOUOkUSH9ah_Ew/viewform?usp=header"

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#FAF7F2] text-[#111]">
      {/* ═══════════════ Header ═══════════════ */}
      <header className="sticky top-0 z-40 border-b border-[#111]/8 bg-[#FAF7F2]/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bondex-logo.png" alt="BondEx" className="h-10 w-auto object-contain" />
          <nav className="hidden md:flex items-center gap-8 text-[13px] text-[#111]/70">
            <a href="#feature" className="hover:text-[#111]">特長</a>
            <a href="#function" className="hover:text-[#111]">機能</a>
            <a href="#price" className="hover:text-[#111]">料金</a>
            <a href="#support" className="hover:text-[#111]">サポート</a>
            <a href="#story" className="hover:text-[#111]">ストーリー</a>
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

      {/* ═══════════════ Hero — Brand story type (候補 B) ═══════════════ */}
      <section className="relative">
        <div className="max-w-4xl mx-auto px-6 pt-28 pb-24 md:pt-40 md:pb-32 text-center">
          <p className="text-[11px] tracking-[0.35em] text-[#111]/50 mb-10">
            BONDEX ─ HOTEL-TO-HOTEL LUGGAGE FORWARDING
          </p>
          <h1 className="text-[44px] sm:text-6xl md:text-[72px] font-extrabold leading-[1.2] tracking-tight mb-10">
            荷物のことは、<br />
            BondEx にお預けください。
          </h1>
          <p className="text-[17px] md:text-lg text-[#111]/75 leading-loose max-w-2xl mx-auto">
            日本を旅する荷物を、ホテルからホテルへ。<br />
            BondEx が代理店様に代わり、静かに運びます。
          </p>
          <p className="mt-6 text-[15px] text-[#111]/60 leading-loose max-w-xl mx-auto">
            代理店様は旅程作りに、旅行者は身軽な移動に。<br />
            それぞれが本来の楽しみに集中できるように。
          </p>
          <div className="mt-14 flex flex-wrap items-center justify-center gap-3">
            <a
              href={CONTACT_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-7 py-4 rounded-md bg-[#111] text-[#FAF7F2] text-[15px] font-medium hover:bg-[#111]/90"
            >
              導入相談フォームへ
              <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
            </a>
            <a
              href="#function"
              className="inline-flex items-center gap-2 px-7 py-4 rounded-md text-[15px] text-[#111]/70 hover:text-[#111]"
            >
              流れを見る
              <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
            </a>
          </div>
        </div>
      </section>

      {/* ═══════════════ 特長 — Feature ═══════════════ */}
      <section id="feature" className="border-y border-[#111]/8 bg-[#F1EBE0]/60">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <div className="mb-16 max-w-2xl">
            <p className="text-[11px] tracking-[0.35em] text-[#111]/50 mb-4">FEATURE / 特長</p>
            <h2 className="text-4xl md:text-[44px] font-extrabold tracking-tight leading-[1.35]">
              代理店様の手間を、<br />
              限りなくゼロに。
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8 md:gap-12">
            {[
              {
                num: "01",
                title: "旅程 PDF を送るだけ",
                body:
                  "旅程表 (Excel / PDF / 画像) を BondEx にお送りいただくだけ。宿泊ホテル・移動区間・荷物数を AI が読み取り、担当者が目視で最終確認します。使い慣れたフォーマットのままで結構です。",
              },
              {
                num: "02",
                title: "発行物は Google Drive で",
                body:
                  "旅行者用バウチャー + 物流業者の送り状を PDF で発行、案件専用フォルダに集約 → 更新のたびに Email もしくは Slack で自動通知。「PDF どこ?」を代理店様の現場から無くします。",
              },
              {
                num: "03",
                title: "立替、月末締め翌月末払い",
                body:
                  "物流業者への運賃 (ヤマト等) は BondEx が事前立替払い。代理店様は月末締めの一本化された PDF 請求書を、翌月末日までにお支払いいただくだけ。原価計算・経理処理を大幅に軽減します。",
              },
            ].map((f) => (
              <div key={f.num}>
                <p className="text-[11px] font-mono tracking-widest text-[#111]/40 mb-4">{f.num}</p>
                <h3 className="text-xl font-extrabold tracking-tight mb-4">{f.title}</h3>
                <p className="text-[15px] text-[#111]/75 leading-loose">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ 機能 — Function (5 step flow) ═══════════════ */}
      <section id="function" className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <div className="mb-16 max-w-2xl">
          <p className="text-[11px] tracking-[0.35em] text-[#111]/50 mb-4">FUNCTION / 機能</p>
          <h2 className="text-4xl md:text-[44px] font-extrabold tracking-tight leading-[1.35]">
            旅程を送ったら、<br />
            あとは受け取るだけ。
          </h2>
        </div>

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
                <div className="h-full rounded-md border border-[#111]/10 bg-white p-6 flex flex-col">
                  <div className="flex items-center justify-between mb-5">
                    <span className="text-[10px] font-mono text-[#111]/40 tracking-widest">{step.n}</span>
                    <Icon className="w-4 h-4 text-[#111]/60" strokeWidth={1.5} />
                  </div>
                  <h3 className="text-[15px] font-extrabold leading-snug mb-3 tracking-tight">
                    {step.title}
                  </h3>
                  <p className="text-[12.5px] text-[#111]/65 leading-loose">{step.body}</p>
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

      {/* ═══════════════ 発行物 — Deliverables (Voucher / Waybill) ═══════════════ */}
      <section id="deliverables" className="border-y border-[#111]/8 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <div className="mb-16 max-w-2xl">
            <p className="text-[11px] tracking-[0.35em] text-[#111]/50 mb-4">DELIVERABLES / 発行物</p>
            <h2 className="text-4xl md:text-[44px] font-extrabold tracking-tight leading-[1.35]">
              バウチャーは即日。<br />
              送り状は集荷 1 ヶ月前から。
            </h2>
            <p className="mt-8 text-[15px] text-[#111]/75 leading-loose">
              物流業者側の仕様で、集荷日から 1 ヶ月以内でないと配送伝票を発行できません。
              バウチャー (旅行者にお渡しする引換証) だけは、旅程受領後 即日 で発行してお渡しします。
            </p>
          </div>

          {/* Timeline */}
          <div className="relative mb-14">
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
                    className={`inline-flex w-3 h-3 rounded-full -mt-8 mb-4 ${
                      t.highlight ? "bg-[#111]" : "bg-[#111]/30"
                    }`}
                  />
                  <p className="text-[14px] font-extrabold tracking-tight mb-2">{t.label}</p>
                  <p className="text-[11px] text-[#111]/60 leading-loose">{t.sub}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 2 cards */}
          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded-md border border-[#111]/10 p-8 bg-[#FAF7F2]">
              <div className="flex items-start gap-4 mb-5">
                <div className="w-11 h-11 rounded-md bg-[#111] text-[#FAF7F2] flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-[10px] tracking-widest text-[#111]/50 mb-1">VOUCHER</p>
                  <h3 className="text-xl font-extrabold tracking-tight">旅行者用バウチャー</h3>
                </div>
              </div>
              <p className="text-[14px] text-[#111]/75 leading-loose mb-5">
                旅程受領後、<strong className="text-[#111]">即日発行</strong>。
                ホテル担当者様への日本語案内も同梱した 2 ページ構成 PDF。
              </p>
              <ul className="space-y-2.5 text-[13px] text-[#111]/70 leading-loose">
                <li>・英語 / 日本語 バイリンガル</li>
                <li>・出発元・配達先ホテル、日付、代表者名、区間ごとの荷物数</li>
                <li>・ホテル担当者向け「一時預かり」お願い文面付き</li>
              </ul>
            </div>

            <div className="rounded-md border border-[#111]/10 p-8 bg-[#FAF7F2]">
              <div className="flex items-start gap-4 mb-5">
                <div className="w-11 h-11 rounded-md bg-[#111] text-[#FAF7F2] flex items-center justify-center shrink-0">
                  <Truck className="w-5 h-5" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-[10px] tracking-widest text-[#111]/50 mb-1">SHIPPING LABEL</p>
                  <h3 className="text-xl font-extrabold tracking-tight">物流業者の送り状</h3>
                </div>
              </div>
              <p className="text-[14px] text-[#111]/75 leading-loose mb-5">
                集荷日の <strong className="text-[#111]">1 ヶ月前</strong> になった時点で発行可能に。
                発行完了と同時に PDF で共有します。
              </p>
              <ul className="space-y-2.5 text-[13px] text-[#111]/70 leading-loose">
                <li>・現在の物流業者: ヤマト運輸 (宅急便)</li>
                <li>・追跡番号付き、集荷から翌日配送 (主要都市)</li>
                <li>・BondEx が事前に発行 → 発送元ホテルへ送付する運用も可</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════ 共有フロー — Sharing (Drive mockup) ═══════════════ */}
      <section className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <div className="grid md:grid-cols-[1fr_1.2fr] gap-14 items-center">
          <div>
            <p className="text-[11px] tracking-[0.35em] text-[#111]/50 mb-4">SHARING / 共有</p>
            <h2 className="text-4xl md:text-[44px] font-extrabold tracking-tight leading-[1.35] mb-6">
              発行物は、<br />
              Drive で 1 箇所に。
            </h2>
            <p className="text-[15px] text-[#111]/75 leading-loose mb-8">
              案件ごとの Google Drive フォルダに、バウチャーと送り状を PDF で集約。
              追加・更新のたびに Email もしくは Slack で自動通知します。
              代理店様の現場で「PDF どこ?」を無くします。
            </p>
            <div className="space-y-4">
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
                      <p className="text-[14px] font-extrabold tracking-tight">{c.label}</p>
                      <p className="text-[13px] text-[#111]/65 leading-loose">{c.body}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="rounded-md border border-[#111]/10 bg-white p-6 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.2)]">
            <div className="flex items-center gap-2 pb-3 border-b border-[#111]/10 mb-4">
              <FolderOpen className="w-4 h-4 text-[#111]/60" strokeWidth={1.5} />
              <p className="text-[14px] font-medium">BondEx / BDX-260710-428 / Costanzo 様</p>
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
              <span>通知: 代理店ご担当者様宛 Email / 貴社 Slack チャンネル</span>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════ 料金 — Price ═══════════════ */}
      <section id="price" className="border-y border-[#111]/8 bg-[#F1EBE0]/60">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <div className="mb-16 max-w-2xl">
            <p className="text-[11px] tracking-[0.35em] text-[#111]/50 mb-4">PRICE / 料金と請求</p>
            <h2 className="text-4xl md:text-[44px] font-extrabold tracking-tight leading-[1.35]">
              料金は 1 件単価、<br />
              請求は月次でまとめて。
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {[
              {
                icon: CreditCard,
                title: "立替払い",
                body:
                  "物流業者への運賃 (ヤマト等) は BondEx が事前に立替払いします。代理店様は月末締めの一本化された請求書 1 枚を受け取るのみ。",
              },
              {
                icon: Building2,
                title: "月次まとめ請求",
                body:
                  "毎月末日締めで当月発行分を集計、翌月初に PDF 請求書を発行。原価計算・経理処理を大幅に軽減します。",
              },
              {
                icon: Clock,
                title: "翌月末払い",
                body:
                  "対象月の翌月末日払い。振込先は BondEx (株式会社JOJO) 名義。振込手数料は代理店様のご負担でお願いいたします。",
              },
            ].map((c) => {
              const Icon = c.icon
              return (
                <div key={c.title} className="rounded-md bg-white border border-[#111]/10 p-8">
                  <Icon className="w-5 h-5 text-[#111]/60 mb-5" strokeWidth={1.5} />
                  <h3 className="text-lg font-extrabold tracking-tight mb-4">{c.title}</h3>
                  <p className="text-[14px] text-[#111]/75 leading-loose">{c.body}</p>
                </div>
              )
            })}
          </div>

          <div className="mt-10 rounded-md border border-[#111]/10 bg-white p-8">
            <p className="text-[10px] tracking-widest text-[#111]/50 mb-3">サイズ・重量について</p>
            <p className="text-[14px] text-[#111]/80 leading-loose">
              スーツケース (S / M / L / XL)・段ボール・ゴルフバッグ、
              <strong className="text-[#111]">サイズ・重量問わず 1 個単価は同じ</strong>です。
              利用する物流業者の受託限度 (現在ヤマト運輸: 3 辺合計 160cm・25kg 以内) を超えるものは対象外となります。
              単価の詳細は個別ご案内いたします。
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════ 補償 — Liability ═══════════════ */}
      <section className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <div className="grid md:grid-cols-[1fr_1.5fr] gap-12 items-start">
          <div>
            <p className="text-[11px] tracking-[0.35em] text-[#111]/50 mb-4">LIABILITY / 補償</p>
            <h2 className="text-4xl md:text-[44px] font-extrabold tracking-tight leading-[1.35] mb-5">
              補償は、<br />
              物流業者の約款どおり。
            </h2>
            <p className="text-[15px] text-[#111]/75 leading-loose">
              BondEx は取次サービスで独自補償はありません。
              実運送を担う物流業者の運送約款に完全に準じます。
            </p>
          </div>

          <div className="rounded-md border border-[#111]/10 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#111]/10 bg-[#F1EBE0]/40">
                  <th className="text-left px-6 py-4 font-medium text-[11px] tracking-widest text-[#111]/50">物流業者</th>
                  <th className="text-left px-6 py-4 font-medium text-[11px] tracking-widest text-[#111]/50">運送約款</th>
                  <th className="text-left px-6 py-4 font-medium text-[11px] tracking-widest text-[#111]/50">補償上限</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[#111]/10 bg-white">
                  <td className="px-6 py-5">
                    <p className="font-extrabold">ヤマト運輸</p>
                    <p className="text-[11px] text-[#111]/50">現在利用中</p>
                  </td>
                  <td className="px-6 py-5 text-[#111]/80">宅急便運送約款</td>
                  <td className="px-6 py-5">
                    <p className="font-extrabold">30 万円 / 個</p>
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-5">
                    <p className="font-extrabold">佐川急便</p>
                    <p className="text-[11px] text-[#111]/50">参考</p>
                  </td>
                  <td className="px-6 py-5 text-[#111]/80">飛脚宅配便運送約款</td>
                  <td className="px-6 py-5">
                    <p className="font-extrabold">30 万円 / 個</p>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="px-6 py-4 text-[12px] text-[#111]/65 bg-[#FAF7F2] leading-loose border-t border-[#111]/10">
              現金・貴重品・宝石・美術品・生もの・危険物等は各社約款上の対象外品目となります。
              高額品を含む案件では事前にご相談ください。物流業者を変更する際は事前告知のうえ、切替後は新たな物流業者の運送約款が適用されます。
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════ サポート — Support (NEW) ═══════════════ */}
      <section id="support" className="border-y border-[#111]/8 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <div className="mb-16 max-w-2xl">
            <p className="text-[11px] tracking-[0.35em] text-[#111]/50 mb-4">SUPPORT / サポート</p>
            <h2 className="text-4xl md:text-[44px] font-extrabold tracking-tight leading-[1.35]">
              導入から運用まで、<br />
              担当窓口が伴走します。
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8 md:gap-12">
            {[
              {
                num: "01",
                icon: HandshakeIcon,
                title: "導入時",
                items: [
                  "業務委託契約 (取次業として明記) の締結",
                  "代理店ポータルのアカウント発行",
                  "テスト旅程 1 件で発行フローの確認",
                  "Slack チャンネル / Drive 共有設定",
                ],
              },
              {
                num: "02",
                icon: BellRing,
                title: "運用時",
                items: [
                  "旅程を送っていただいた日のうちに一次連絡",
                  "バウチャー即日発行、送り状も準備でき次第共有",
                  "旅程変更・宛先変更にも柔軟に対応",
                  "月末に PDF 請求書を発行 → Drive 共有",
                ],
              },
              {
                num: "03",
                icon: ShieldCheck,
                title: "トラブル時",
                items: [
                  "集荷遅延・住所ミス・宛先変更を担当窓口が一次対応",
                  "物流業者への調査依頼・トレースは BondEx が代行",
                  "クレーム発生時は運送約款に沿って手続きを進行",
                  "代理店様側の追加工数を最小化",
                ],
              },
            ].map((s) => {
              const Icon = s.icon
              return (
                <div key={s.num} className="border-t border-[#111]/15 pt-6">
                  <div className="flex items-center gap-3 mb-5">
                    <span className="text-[11px] font-mono tracking-widest text-[#111]/40">{s.num}</span>
                    <Icon className="w-5 h-5 text-[#111]/70" strokeWidth={1.5} />
                    <h3 className="text-xl font-extrabold tracking-tight">{s.title}</h3>
                  </div>
                  <ul className="space-y-3 text-[14px] text-[#111]/75 leading-loose">
                    {s.items.map((it) => (
                      <li key={it} className="flex gap-2.5">
                        <span className="text-[#111]/40 mt-0.5">─</span>
                        <span>{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ═══════════════ ストーリー — Story (谷口さんの背景) ═══════════════ */}
      <section id="story" className="max-w-4xl mx-auto px-6 py-24 md:py-32">
        <p className="text-[11px] tracking-[0.35em] text-[#111]/50 mb-4">STORY / BondEx のはじまり</p>
        <h2 className="text-4xl md:text-[44px] font-extrabold tracking-tight leading-[1.35] mb-12">
          荷物を運ぶのではない、<br />
          旅を運ぶのだ。
        </h2>

        {/*
          NOTE: 以下は仮のテキスト。谷口さん自身の背景 (旅行/物流両方の経験・思い) で差替え予定。
          残された「[…]」内は差替候補プロンプト、または削除。
        */}
        <div className="space-y-6 text-[16px] text-[#111]/80 leading-loose">
          <p className="text-[#111]/50 text-[13px] italic">
            ※ 以下は仮テキストです。谷口さんの実際の経験・想いに差し替え予定。
          </p>
          <p>
            旅行代理店の現場では、旅程を組み終えたあとに毎日のように
            「荷物の問い合わせ」が入ります。 どこで受け取れますか、
            チェックアウト後どうすれば、ホテルに送ってもらえますか——
            本来、旅の提案に使うべき時間が、荷物の連絡と手配に消えていく。
          </p>
          <p>
            私自身、旅行と物流の両方の現場に関わってきました。
            旅の設計と、物を動かす仕組み。この 2 つがちゃんと繋がっていないから、
            旅行者は荷物を抱えて疲れ、代理店様は毎日同じ調整を繰り返している。
          </p>
          <p>
            BondEx は、代理店様の"もう 1 人の物流担当"として、
            旅程受領から発行・配送・請求までを引き受ける取次サービスです。
            代理店様が本来の「旅の提案とおもてなし」に集中できるように、
            荷物のことは、私たちが静かに整えます。
          </p>
          <p>
            日本の旅をつくる方々と、共に長く付き合えるサービスへ育てていく。
            それが、BondEx の始まりであり、続けていく理由です。
          </p>
          <p className="text-right text-[14px] text-[#111]/60 mt-8">
            株式会社JOJO 代表 谷口 琢真
          </p>
        </div>
      </section>

      {/* ═══════════════ FAQ ═══════════════ */}
      <section id="faq" className="border-y border-[#111]/8 bg-white">
        <div className="max-w-3xl mx-auto px-6 py-24 md:py-32">
          <p className="text-[11px] tracking-[0.35em] text-[#111]/50 mb-4">FAQ / よくあるご質問</p>
          <h2 className="text-4xl md:text-[44px] font-extrabold tracking-tight leading-[1.35] mb-12">
            はじめての方の、<br />
            よくあるご質問。
          </h2>
          <div className="space-y-3">
            {[
              {
                q: "旅程はどの形式で送れますか?",
                a:
                  "Excel / PDF / 画像 / スクリーンショット、いずれも受け付けます。代理店様の使い慣れたフォーマットのままで結構です。手書き旅程やメール本文の場合はテキスト形式でお送りください。",
              },
              {
                q: "バウチャーはすぐに発行できるのに、送り状はなぜ 1ヶ月前なのですか?",
                a:
                  "物流業者 (ヤマト運輸等) の発行仕様上、集荷日から 30 日以内でないと送り状を発行できないためです。バウチャーは BondEx 発行のため即日対応が可能です。送り状は集荷 1 ヶ月前になり次第、順次発行して Drive に追加します。",
              },
              {
                q: "料金の請求サイクルを教えてください。",
                a:
                  "月末日締めで当月発行分を集計、翌月初に PDF 請求書を代理店様宛にお送りします。お支払期限は対象月の翌月末日です。物流業者への運賃は BondEx が立替払いしていますので、代理店様が月次で BondEx にご入金いただく流れとなります。",
              },
              {
                q: "共有方法はメール以外に対応していますか?",
                a:
                  "はい、Slack への Webhook 連携もご提供予定です (現時点は Email 中心)。Google Drive フォルダは常時アクセスできる状態でお渡しし、追加・更新のたびに通知します。",
              },
              {
                q: "補償はどこまでですか?",
                a:
                  "実運送を担う物流業者の運送約款に完全に準じます。現在ヤマト運輸の宅急便を利用しており、1 個あたり上限 30 万円です。BondEx 独自の追加補償はありません。将来 佐川急便その他への切替を行う場合は、事前告知のうえ切替後の物流業者の運送約款が適用されます。",
              },
              {
                q: "契約から運用開始までどのくらいかかりますか?",
                a:
                  "業務委託契約 (取次業として明記) の締結後、代理店ポータルのアカウントを発行して即日運用開始できます。初回の旅程 PDF をお送りいただければ、当日中にバウチャーを発行してテストいただけます。",
              },
              {
                q: "第一種貨物利用運送事業の登録は?",
                a:
                  "BondEx は取次サービスであり運送人ではないため、所管の運輸局に照会中です。書面回答を取得次第、本ページに照会番号と回答内容を掲載いたします。",
              },
            ].map((f, i) => (
              <details key={i} className="group rounded-md border border-[#111]/10 bg-[#FAF7F2] p-6">
                <summary className="cursor-pointer text-[15px] font-extrabold flex items-center justify-between gap-4 list-none tracking-tight">
                  <span>{f.q}</span>
                  <ChevronRight className="w-4 h-4 shrink-0 transition-transform group-open:rotate-90" strokeWidth={1.5} />
                </summary>
                <p className="mt-4 text-[14px] text-[#111]/75 leading-loose">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ CTA / お問い合わせ ═══════════════ */}
      <section id="contact" className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <div className="rounded-md border border-[#111]/10 bg-[#111] text-[#FAF7F2] p-10 md:p-16">
          <p className="text-[11px] tracking-[0.35em] text-[#FAF7F2]/60 mb-5">CONTACT / お問い合わせ</p>
          <h2 className="text-4xl md:text-[44px] font-extrabold tracking-tight leading-[1.35] mb-8 max-w-2xl">
            試験運用は 1 件から。<br />
            まずは 30 分、話を聞かせてください。
          </h2>
          <p className="text-[15px] text-[#FAF7F2]/70 leading-loose mb-12 max-w-2xl">
            契約書・責任分界表・請求書サンプル・法務レビュー用パッケージを、
            打合せ日程調整とあわせてお送りいたします。<br />
            まずは以下のフォームより、必要事項をお知らせください。
          </p>
          <div>
            <a
              href={CONTACT_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 px-8 py-4 rounded-md bg-[#FAF7F2] text-[#111] text-[15px] font-medium hover:bg-[#FAF7F2]/90"
            >
              <MessageCircleQuestion className="w-5 h-5" strokeWidth={1.5} />
              導入相談フォームへ
              <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
            </a>
          </div>
        </div>
      </section>

      {/* ═══════════════ Footer ═══════════════ */}
      <footer className="border-t border-[#111]/8 bg-[#FAF7F2]">
        <div className="max-w-6xl mx-auto px-6 py-14 grid gap-10 md:grid-cols-4 text-sm">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bondex-logo.png" alt="BondEx" className="h-8 w-auto object-contain mb-4" />
            <p className="text-[12px] text-[#111]/60 leading-loose">
              運営: 株式会社JOJO<br />
              東京都世田谷区野毛1-9-12
            </p>
          </div>
          <div>
            <p className="text-[10px] tracking-widest text-[#111]/50 mb-4">SERVICE</p>
            <ul className="space-y-3 text-[12px] leading-loose">
              <li><a href="#feature" className="hover:text-[#111]">特長</a></li>
              <li><a href="#function" className="hover:text-[#111]">機能</a></li>
              <li><a href="#price" className="hover:text-[#111]">料金</a></li>
              <li><a href="#support" className="hover:text-[#111]">サポート</a></li>
              <li><a href="#story" className="hover:text-[#111]">ストーリー</a></li>
              <li><Link href="/track" className="hover:text-[#111]">トラッキング</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-[10px] tracking-widest text-[#111]/50 mb-4">PORTALS</p>
            <ul className="space-y-3 text-[12px] leading-loose">
              <li><Link href="/agency/login" className="hover:text-[#111]">代理店ログイン</Link></li>
              <li><Link href="/operator/login" className="hover:text-[#111]">運用ログイン</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-[10px] tracking-widest text-[#111]/50 mb-4">LEGAL</p>
            <ul className="space-y-3 text-[12px] leading-loose">
              <li><Link href="/legal/terms" className="hover:text-[#111]">利用規約</Link></li>
              <li><Link href="/legal/privacy" className="hover:text-[#111]">プライバシーポリシー</Link></li>
              <li><Link href="/legal/commercial-transactions" className="hover:text-[#111]">特定商取引法に基づく表記</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-[#111]/8">
          <div className="max-w-6xl mx-auto px-6 py-6 text-[11px] text-[#111]/60 leading-loose">
            <p className="mb-2">
              BondEx は自らが運送を引き受ける運送人ではなく、旅程情報を受けて物流業者への発送を取り次ぐ「取次サービス」です。
              実運送・運送責任・補償は、当社が利用する物流業者 (現在: ヤマト運輸 宅急便運送約款) に完全に準じます。
              第一種貨物利用運送事業の登録要否については所管の運輸局に照会中で、書面回答取得後に照会番号と回答内容を本ページに掲載します。
            </p>
            <p>© {new Date().getFullYear()} 株式会社JOJO / BondEx</p>
          </div>
        </div>
      </footer>
    </main>
  )
}
