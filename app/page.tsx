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
  Check,
  FolderOpen,
  Paperclip,
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
      <div className="aspect-[3/4] bg-[#F1EBE0]/40 border-b border-[#111]/8 p-5 flex items-center justify-center">
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
      {/* ═══════════════ Header (transparent over hero) ═══════════════ */}
      <header className="absolute top-0 left-0 right-0 z-40">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="inline-flex items-center bg-[#FAF7F2]/95 backdrop-blur-sm rounded-md px-3 py-1.5 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/bondex-logo.png"
              alt="BondEx"
              className="h-8 w-auto object-contain"
            />
          </div>
          <nav className="hidden md:flex items-center gap-8 text-[13px] text-white/90">
            <a href="#function" className="hover:text-white drop-shadow">流れ</a>
            <a href="#deliverables" className="hover:text-white drop-shadow">発行物</a>
            <a href="#price" className="hover:text-white drop-shadow">料金</a>
            <a href="#faq" className="hover:text-white drop-shadow">FAQ</a>
          </nav>
          <Link
            href="/agency/login"
            className="text-[12px] text-white/70 hover:text-white drop-shadow underline underline-offset-4 decoration-white/30 hover:decoration-white/70"
          >
            代理店ログイン
          </Link>
        </div>
      </header>

      {/* ═══════════════ Hero — Full-bleed family image ═══════════════ */}
      <section
        className="relative w-full h-screen min-h-[720px] max-h-[900px] overflow-hidden bg-cover bg-center bg-no-repeat flex items-end"
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.0) 30%, rgba(0,0,0,0.0) 55%, rgba(0,0,0,0.75) 100%), url('/hero-family.png')",
        }}
      >
        <div className="w-full max-w-6xl mx-auto px-6 pb-16 md:pb-24 text-white">
          <p className="text-[11px] tracking-[0.4em] text-white/80 mb-6 drop-shadow">
            訪日旅行代理店様向け ・ 荷物配送手配代行
          </p>
          <h1 className="text-4xl md:text-6xl lg:text-[76px] font-extrabold leading-[1.15] tracking-tight mb-8 drop-shadow-lg">
            旅程を送るだけで、
            <br />
            荷物配送手配が完了。
          </h1>
          <p className="text-base md:text-lg text-white/90 max-w-2xl leading-relaxed mb-10 drop-shadow">
            バウチャー発行、送り状手配、月次請求、変更対応まで。
            <br />
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
              旅程を送ったら、
              <br />
              受け取るだけ。
            </h2>
          </div>

          <div className="grid md:grid-cols-5 gap-4">
            {/* ─── 01: 旅程を送付 ─── */}
            <FlowCard n="01" title="旅程を送付" icon={Send} desc="PDF / Excel / 画像。何でも可。">
              <div className="w-full bg-white shadow-sm rounded p-3 border border-[#111]/10">
                <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-[#111]/10">
                  <Paperclip className="w-3 h-3 text-[#111]/50" strokeWidth={1.8} />
                  <span className="text-[9px] font-mono text-[#111]/60 truncate">
                    fujiwara_itinerary.pdf
                  </span>
                </div>
                <div className="space-y-1 text-[9px] leading-loose">
                  <div className="text-[7px] tracking-widest text-[#111]/40">4-DAY JAPAN TRIP</div>
                  <div className="text-[#111]/75">Day 1 · Tokyo</div>
                  <div className="text-[#111]/75">Day 2 · Hakone</div>
                  <div className="text-[#111]/75">Day 3 · Kyoto</div>
                  <div className="text-[#111]/75">Day 4 · Osaka</div>
                </div>
              </div>
            </FlowCard>

            {/* ─── 02: AI が抽出 ─── */}
            <FlowCard n="02" title="AI が抽出" icon={Sparkles} desc="担当者が最終確認。">
              <div className="w-full bg-white shadow-sm rounded p-3 border border-[#111]/10">
                <div className="flex items-center gap-1.5 mb-3 pb-2 border-b border-[#111]/10">
                  <Sparkles className="w-3 h-3 text-[#111]/70" strokeWidth={1.8} />
                  <span className="text-[7px] font-mono tracking-widest text-[#111]/60 uppercase">
                    Extracting
                  </span>
                </div>
                <div className="space-y-2 text-[9px] leading-loose">
                  {[
                    "Guest: Fujiwara Family",
                    "4 travelers · 8 pieces",
                    "3 legs identified",
                  ].map((line) => (
                    <div key={line} className="flex items-start gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#111] flex items-center justify-center shrink-0 mt-0.5">
                        <Check className="w-1.5 h-1.5 text-white" strokeWidth={3} />
                      </div>
                      <span className="text-[#111]/75">{line}</span>
                    </div>
                  ))}
                </div>
              </div>
            </FlowCard>

            {/* ─── 03: バウチャー即日 ─── */}
            <FlowCard n="03" title="バウチャー即日" icon={BadgeCheck} desc="旅行者用引換証を当日発行。">
              <div className="w-full bg-white shadow-sm rounded p-3 border border-[#111]/10">
                <div className="text-center pb-2 mb-2 border-b border-[#111]/15">
                  <div className="text-[10px] font-extrabold tracking-widest">BONDEX</div>
                  <div className="text-[6px] tracking-widest text-[#111]/50 mt-0.5">
                    LUGGAGE FORWARDING
                  </div>
                </div>
                <div className="space-y-1.5 text-[9px]">
                  <div>
                    <div className="text-[6px] tracking-widest text-[#111]/50">FROM</div>
                    <div className="font-bold text-[#111]">Hilton Tokyo</div>
                  </div>
                  <div>
                    <div className="text-[6px] tracking-widest text-[#111]/50">TO</div>
                    <div className="font-bold text-[#111]">Hyatt Kyoto</div>
                  </div>
                  <div>
                    <div className="text-[6px] tracking-widest text-[#111]/50">DATE / PIECES</div>
                    <div className="text-[#111]/75 text-[8px]">2026-07-10 · 8 pcs</div>
                  </div>
                </div>
              </div>
            </FlowCard>

            {/* ─── 04: 送り状を発行 ─── */}
            <FlowCard
              n="04"
              title="送り状を発行"
              icon={CalendarClock}
              desc="集荷 1ヶ月前から順次。"
            >
              <div className="w-full bg-white shadow-sm rounded p-3 border border-[#111]/10">
                <div className="pb-2 mb-2 border-b border-[#111]/15">
                  <span className="text-[9px] font-bold text-[#111]">ヤマト運輸 宅急便</span>
                </div>
                <div className="space-y-1.5 text-[9px]">
                  <div>
                    <div className="text-[6px] tracking-widest text-[#111]/50">TRACKING</div>
                    <div className="font-mono font-bold text-[8px]">4877-3891-5591</div>
                  </div>
                  <div>
                    <div className="text-[6px] tracking-widest text-[#111]/50">発送元</div>
                    <div className="text-[#111]/75 text-[8px]">ヒルトン東京</div>
                  </div>
                  <div>
                    <div className="text-[6px] tracking-widest text-[#111]/50">お届け先</div>
                    <div className="text-[#111]/75 text-[8px]">ハイアット京都</div>
                  </div>
                </div>
              </div>
            </FlowCard>

            {/* ─── 05: Drive で共有 ─── */}
            <FlowCard n="05" title="Drive で共有" icon={BellRing} desc="Email / Slack で通知。">
              <div className="w-full bg-white shadow-sm rounded p-3 border border-[#111]/10">
                <div className="flex items-center gap-1.5 pb-2 mb-2 border-b border-[#111]/10">
                  <FolderOpen className="w-3 h-3 text-[#111]/60" strokeWidth={1.8} />
                  <span className="text-[8px] font-medium text-[#111]/70 truncate">
                    BDX-260710-428
                  </span>
                </div>
                <div className="space-y-1">
                  {[
                    "voucher_leg1.pdf",
                    "voucher_leg2.pdf",
                    "label_leg1.pdf",
                    "label_leg2.pdf",
                  ].map((f) => (
                    <div key={f} className="flex items-center gap-1.5 py-0.5">
                      <FileText className="w-2.5 h-2.5 text-[#111]/40 shrink-0" strokeWidth={1.8} />
                      <span className="text-[8px] font-mono text-[#111]/65 truncate flex-1">
                        {f}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </FlowCard>
          </div>
        </div>
      </section>

      {/* ═══════════════ Deliverables (Voucher / Waybill) ═══════════════ */}
      <section id="deliverables" className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <div className="mb-14 max-w-xl">
          <p className="text-[11px] tracking-[0.35em] text-[#111]/50 mb-4">DELIVERABLES / 発行物</p>
          <h2 className="text-4xl md:text-[52px] font-extrabold tracking-tight leading-[1.2]">
            バウチャーと、
            <br />
            送り状。
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-md border border-[#111]/10 p-10 bg-white">
            <div className="w-12 h-12 rounded-md bg-[#111] text-[#FAF7F2] flex items-center justify-center mb-6">
              <FileText className="w-5 h-5" strokeWidth={1.5} />
            </div>
            <p className="text-[10px] tracking-widest text-[#111]/50 mb-2">VOUCHER</p>
            <h3 className="text-2xl font-extrabold tracking-tight mb-4">旅行者用バウチャー</h3>
            <p className="text-[15px] text-[#111]/70 leading-loose">
              旅程受領後、<strong className="text-[#111]">即日発行</strong>。
              英/日バイリンガル、ホテル担当者向け一時預かり案内も同梱。
            </p>
          </div>

          <div className="rounded-md border border-[#111]/10 p-10 bg-white">
            <div className="w-12 h-12 rounded-md bg-[#111] text-[#FAF7F2] flex items-center justify-center mb-6">
              <Truck className="w-5 h-5" strokeWidth={1.5} />
            </div>
            <p className="text-[10px] tracking-widest text-[#111]/50 mb-2">SHIPPING LABEL</p>
            <h3 className="text-2xl font-extrabold tracking-tight mb-4">物流業者の送り状</h3>
            <p className="text-[15px] text-[#111]/70 leading-loose">
              集荷日の <strong className="text-[#111]">1 ヶ月前</strong> に発行 (物流業者仕様)。
              追跡番号付き、現在ヤマト運輸の宅急便を利用中。
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════ Price (compressed) ═══════════════ */}
      <section id="price" className="border-y border-[#111]/8 bg-[#F1EBE0]/60">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-32">
          <div className="mb-14 max-w-xl">
            <p className="text-[11px] tracking-[0.35em] text-[#111]/50 mb-4">PRICE / 料金</p>
            <h2 className="text-4xl md:text-[52px] font-extrabold tracking-tight leading-[1.2]">
              1 件単価、
              <br />
              月次まとめ請求。
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
