"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Package,
  Building2,
  Plane,
  Upload,
  CheckCircle2,
  FileText,
  Truck,
  ChevronRight,
  ArrowRight,
  MapPin,
  Shield,
  Sparkles,
  MessageSquare,
} from "lucide-react"

type Segment = "landop" | "agency" | "traveler"

const SEGMENTS = [
  { key: "landop" as const, ja: "ランドオペレーター", en: "Land Operator", icon: Building2 },
  { key: "agency" as const, ja: "旅行代理店", en: "Travel Agency", icon: Package },
  { key: "traveler" as const, ja: "旅行者", en: "Traveler", icon: Plane },
]

const SEGMENT_CONTENT: Record<
  Segment,
  {
    badge: string
    headline: string
    subhead: string
    bullets: string[]
    ctaLabel: string
    ctaHref: string
  }
> = {
  landop: {
    badge: "For Land Operators",
    headline: "旅程 PDF を投げるだけ。ホテル間配送の英語調整・伝票記入・集荷手配、全部こちらで引き受けます。",
    subhead: "1件あたり 15〜30 分かかっていた手配作業を、AI 読取 + ワンクリック発行で 60 秒に短縮。",
    bullets: [
      "旅程 PDF/画像を AI が自動読取 → 人的ダブルチェック後にワンクリック発行",
      "月末締め・翌々月20日払い + 月次請求書 PDF を自動発行",
      "業務委託契約書 (取次業として明記) 締結で、翌案件から即運用開始",
      "対応都市・除外エリア (北海道/沖縄/離島) と繁忙期の運用ガイドを事前開示",
      "トラブル時の一次対応窓口 (メール、日/英) を BondEx が引き受け",
    ],
    ctaLabel: "資料ダウンロード / デモ予約",
    ctaHref: "#contact",
  },
  agency: {
    badge: "For Travel Agencies",
    headline: "「荷物おまかせ」を原価が読める新オプション商品に。¥5,000 一律で商品カタログに即掲載可能。",
    subhead: "パッケージ組込みモデルと責任分界表 1 枚図解で、法務・企画・経理レビューを最短化。",
    bullets: [
      "組込みモデル: 7泊8日ゴールデンルート + 荷物おまかせ ¥5,000 × 6区間 (粗利シミュ付)",
      "責任分界表: BondEx (取次) / ヤマト (実運送・約款補償) / 代理店 / 旅行者 の義務を明示",
      "代理店ポータル: 案件一覧・ステータス・請求書 DL (Supabase Auth + RLS で自社案件のみ)",
      "旅行業法上の位置付けを整理した法的ポジションペーパーを法務レビュー用に提供",
      "Voucher / トラッキングページ の多言語 (英/中/韓) 対応ロードマップあり",
    ],
    ctaLabel: "法務レビュー用パッケージ請求",
    ctaHref: "#contact",
  },
  traveler: {
    badge: "For Travelers",
    headline: "Skip the suitcase struggle. Drop it at the hotel, pick it up at the next one.",
    subhead: "Flat ¥5,000 per bag — includes pickup, Yamato delivery, tracking, and English support.",
    bullets: [
      "3 steps: upload your itinerary → confirm → leave the bag at your hotel front desk",
      "Track anytime at bondex.express/track/BDX-XXX (secure, unguessable ID)",
      "Next-day delivery to Tokyo, Hakone, Kyoto, Osaka, Kanazawa, Hiroshima, Fukuoka",
      "Coverage follows Yamato Transport's terms (up to ¥300,000 per bag; some items excluded)",
      "Support in English via email (JST business hours). WhatsApp coming soon.",
    ],
    ctaLabel: "Book now (via our agency partners)",
    ctaHref: "#contact",
  },
}

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "旅程をアップロード",
    body: "代理店ポータル or 申込フォームに旅程 PDF・画像・スクリーンショットをドロップ。Anthropic Claude Sonnet が宿泊ホテル・チェックイン日・部屋割りを自動抽出。",
  },
  {
    step: "02",
    title: "AI 抽出を人的ダブルチェック",
    body: "抽出したホテル名・住所・日付・荷物個数を確認画面で目視。AI 誤読を防ぐため、送り状発行前に必ず人的レビューを挟みます。修正はその場で編集可能。",
  },
  {
    step: "03",
    title: "Voucher と 送り状を発行",
    body: "旅行者向け引換証 + ホテル担当者様向け日本語案内 + ヤマト送り状を PDF で一括発行。旅行者はホテルフロントに Voucher と荷物を預けるだけ。",
  },
  {
    step: "04",
    title: "翌日、次のホテルへ",
    body: "ヤマト運輸 (宅急便) が集荷 → 翌日、次のホテルに配送。旅行者・代理店の双方が /track/BDX-XXX でリアルタイム追跡。トラブル時はメール窓口が一次対応。",
  },
]

const TRUST_SIGNALS = [
  { title: "実運送: ヤマト運輸 (宅急便)", body: "全国配送網とブランド信頼性。Ship&co 経由の正規 API 連携" },
  { title: "運営会社: 株式会社JOJO", body: "東京・世田谷区。特商法に基づく事業者情報をフッターに開示" },
  { title: "AI 読取 + 人的ダブルチェック", body: "AI 抽出後、必ず人的目視レビューを経てから送り状発行" },
  { title: "取次業として整理・照会中", body: "第一種貨物利用運送事業の登録要否について運輸局に照会中 (書面回答取得次第、本 LP に照会番号を掲載予定)" },
  { title: "業務委託契約書 締結", body: "取次業として明記。月末締め翌々月20日払い + 月次請求書 PDF 発行" },
  { title: "セキュアなトラッキング", body: "URL は署名付きトークン、旅行終了後 30 日で自動失効" },
]

const FAQ = [
  {
    q: "「取次業」とは何ですか? ヤマトに直接頼むのと何が違いますか?",
    a: "BondEx は自らが運送を引き受ける『運送人』ではなく、旅程情報から必要な発送手配を代理し、ヤマト運輸へ発送を取り次ぐ事業者です。実運送・運送責任・補償はヤマト運輸宅急便運送約款に従います。¥5,000 の内訳は『ヤマトへの実運賃 + BondEx 手配料 (AI 読取・Voucher/送り状発行・代理店ポータル・多言語サポート・トラブル一次対応)』です。ヤマト直接と比較したメリットは、旅程 PDF を渡すだけで複数区間を一括手配できること、英語での伝票記入・集荷調整が不要になること、代理店ポータルで案件管理と月次請求書 PDF が一括発行されることです。第一種貨物利用運送事業の登録要否については所管の運輸局に照会中で、書面回答を取得次第、本 LP に照会番号と回答内容を掲載します。",
  },
  {
    q: "補償はいくらまで? 高額品 (ブランド品・カメラ機材) は?",
    a: "補償は当社が利用する物流業者の運送約款に完全に準じます。現在はヤマト運輸を利用しており、宅急便運送約款に基づき 1 個あたり上限 30 万円です (現金・貴重品・宝石・美術品・貴金属・有価証券・生もの・危険物等は補償対象外または引受不可)。将来 佐川急便その他への切替を行う場合は、事前告知のうえ切替後の物流業者の運送約款が適用されます。BondEx 独自の追加補償は現時点でありません。高額品を含む富裕層案件では、事前に品目確認のうえ、対象外品目は別手段 (旅行者による直送・手荷物携行) をご案内します。",
  },
  {
    q: "AI 誤読で誤送先に届いてしまうリスクは?",
    a: "AI 抽出結果は必ず人的ダブルチェック (確認画面での目視レビュー) を経てから送り状を発行します。加えて代理店ポータルで発送前の最終承認フローを設けています。それでも誤送が発生した場合、ヤマトの転送手続き費用は BondEx が負担し、旅行者への代替手段の分担は業務委託契約書に明記した責任分界表に従います。",
  },
  {
    q: "WhatsApp・中国語・韓国語での旅行者サポートは?",
    a: "現時点のサポートはメール (日本語・英語, 平日 9:00-18:00 JST) が中心です。WhatsApp・中国語 (簡/繁)・韓国語対応は開発ロードマップに掲載していますが、実装時期は現段階では確約しません。代理店様の案件で旅行者から直接問合せが発生した場合の一次窓口・エスカレーションフローは業務委託契約書に明文化します。",
  },
  {
    q: "対応エリアと除外エリアは?",
    a: "全国主要観光都市 (東京・箱根・京都・大阪・金沢・広島・福岡等) を翌日配送でカバーします。北海道・沖縄本島は翌日〜翌々日、離島 (利尻・礼文・小笠原・沖縄離島等) と一部僻地は翌々日以降または対象外となります。当日配送 (朝チェックアウト → 同日夕方の次ホテル着) は宅急便では原則対応できません。台風・地震・大雪等の不可抗力による遅延の取り扱いは業務委託契約書のとおりです。",
  },
  {
    q: "キャンセル・旅程変更時はどうなりますか?",
    a: "集荷前日 18:00 JST までのキャンセルは無料、それ以降のキャンセルおよび発送後の返金は原則不可です。旅程変更 (次ホテル変更・日程変更) はヤマトの転送手続きが可能ですが、追加料金と時間が発生します。詳細は約款・業務委託契約書に明記しています。",
  },
  {
    q: "代理店ポータルは自社システムと連携できますか?",
    a: "現在は代理店ポータル (Web) からの操作を基本とし、API 連携・CSV 一括アップロード・SAML SSO は開発ロードマップに掲載しています。大手代理店様との個別調整は営業担当までご相談ください。",
  },
  {
    q: "個人情報はどう扱われますか? 海外 (米国) に移転されますか?",
    a: "旅程 PDF は Anthropic (米国) の Claude API による読取処理、案件データは Supabase (米国) に保管され、改正個人情報保護法第 28 条に基づき本人同意を取得したうえで移転します。EU/UK 発の代理店様との案件では SCC (標準契約条項) 適用を含めて別途調整します。第三者提供先 (ヤマト運輸・Ship&co・Supabase・Anthropic・決済 PSP) はプライバシーポリシーで明示します。",
  },
]

const ROADMAP = [
  { label: "旅程 AI 自動読取", status: "shipped" },
  { label: "Voucher / ヤマト送り状 発行", status: "shipped" },
  { label: "代理店ポータル (RLS)", status: "shipped" },
  { label: "月次請求書 PDF 発行", status: "shipped" },
  { label: "公開トラッキングページ", status: "shipped" },
  { label: "業務委託契約書テンプレ", status: "shipped" },
  { label: "クレーム管理", status: "shipped" },
  { label: "多言語 (中/韓) 対応", status: "in-development" },
  { label: "WhatsApp サポート", status: "in-development" },
  { label: "API / CSV 連携", status: "planned" },
  { label: "独自補償の追加", status: "planned" },
  { label: "SAML SSO", status: "planned" },
]

export default function LandingPage() {
  const [segment, setSegment] = useState<Segment>("landop")
  const content = SEGMENT_CONTENT[segment]

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bondex-logo.png" alt="BondEx" className="h-10 w-auto object-contain" />
          <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#how" className="hover:text-foreground">仕組み</a>
            <a href="#pricing" className="hover:text-foreground">料金</a>
            <a href="#faq" className="hover:text-foreground">FAQ</a>
            <a href="#contact" className="hover:text-foreground">お問い合わせ</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/operator/login"
              className="hidden sm:inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              オペレーター
            </Link>
            <Link
              href="/agency/login"
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-border hover:border-foreground"
            >
              代理店ログイン
              <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.5} />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-14 md:pt-24 md:pb-16">
        <div className="max-w-3xl">
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground mb-4">
            Hotel-to-Hotel Luggage Forwarding · Japan
          </p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold text-foreground leading-tight tracking-tight text-balance">
            旅程 PDF を渡すだけ。<br />
            ホテル間の手荷物、1個 <span className="whitespace-nowrap">¥5,000</span> で次のホテルへ。
          </h1>
          <p className="mt-6 text-lg text-muted-foreground text-balance leading-relaxed">
            AI が旅程を自動読取 → ワンクリックで Voucher とヤマト送り状を発行 → 実運送はヤマト運輸。
            ランドオペレーター・旅行代理店・旅行者ご本人の「荷物どうする問題」を、取次サービスとして一括で引き受けます。
          </p>
          <p className="mt-3 text-sm text-muted-foreground italic">
            Travel Japan hands-free. Your luggage meets you at the next hotel — flat ¥5,000 per bag.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="#contact"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-foreground text-background text-sm font-medium hover:bg-foreground/90"
            >
              個別デモを予約 (30 分)
              <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
            </a>
            <a
              href="#how"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl border border-border text-sm hover:border-foreground"
            >
              仕組みを見る
            </a>
          </div>
        </div>
      </section>

      {/* Segment switcher */}
      <section className="max-w-6xl mx-auto px-6 pb-16">
        <div className="rounded-3xl border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-3 border-b border-border">
            {SEGMENTS.map(({ key, ja, en, icon: Icon }) => {
              const active = segment === key
              return (
                <button
                  key={key}
                  onClick={() => setSegment(key)}
                  className={`px-4 py-4 md:py-5 flex flex-col md:flex-row items-center justify-center gap-2 md:gap-3 text-sm md:text-base transition-colors ${
                    active
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  }`}
                >
                  <Icon className="w-4 h-4 md:w-5 md:h-5" strokeWidth={1.5} />
                  <div className="flex flex-col md:flex-row md:items-baseline md:gap-2">
                    <span className={active ? "font-semibold" : "font-medium"}>{ja}</span>
                    <span className={`text-[10px] md:text-xs ${active ? "opacity-70" : "opacity-60"}`}>
                      {en}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          <div className="p-6 md:p-10">
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-3">
              {content.badge}
            </p>
            <h2 className="text-xl md:text-2xl font-semibold text-foreground leading-snug mb-3 text-balance">
              {content.headline}
            </h2>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{content.subhead}</p>

            <ul className="space-y-2.5 mb-8">
              {content.bullets.map((b, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-foreground/90">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-foreground/60" strokeWidth={1.5} />
                  <span>{b}</span>
                </li>
              ))}
            </ul>

            <a
              href={content.ctaHref}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-foreground text-background text-sm font-medium hover:bg-foreground/90"
            >
              {content.ctaLabel}
              <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
            </a>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-6 py-16 md:py-24">
          <div className="max-w-2xl mb-12">
            <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground mb-3">
              How it works
            </p>
            <h2 className="text-3xl md:text-4xl font-semibold text-foreground tracking-tight">
              旅程 PDF から翌日配送まで、4 ステップ。
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((step, i) => {
              const Icon = [Upload, CheckCircle2, FileText, Truck][i]
              return (
                <div key={step.step} className="rounded-2xl bg-background border border-border p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-xs font-mono text-muted-foreground">{step.step}</span>
                    <Icon className="w-4 h-4 text-foreground" strokeWidth={1.5} />
                  </div>
                  <h3 className="text-base font-semibold text-foreground mb-2 leading-snug">
                    {step.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Product Preview */}
      <section id="preview" className="max-w-6xl mx-auto px-6 py-16 md:py-24">
        <div className="max-w-2xl mb-10">
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground mb-3">
            Product Preview
          </p>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-3">
            実際の画面と発行物
          </h2>
          <p className="text-sm text-muted-foreground">
            代理店ポータル、旅行者向けバウチャー、公開トラッキング。全て稼働中の実物です。
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Mockup 1: Voucher PDF */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="aspect-[3/4] bg-white p-5 border-b border-border">
              <div className="flex items-start justify-between mb-3">
                <div className="w-12 h-6 rounded-sm bg-foreground/10" />
                <div className="text-right">
                  <p className="text-[6px] tracking-[0.2em] text-muted-foreground">REF</p>
                  <p className="text-[8px] font-mono">BDX-260630-428</p>
                </div>
              </div>
              <div className="h-0.5 bg-foreground mb-3" />
              <p className="text-xs font-semibold mb-3">Luggage Forwarding</p>
              <div className="inline-block border border-foreground rounded-full px-2 py-0.5 mb-4">
                <p className="text-[6px] tracking-[0.15em]">PLEASE PRESENT AT RECEPTION</p>
              </div>
              <div className="grid grid-cols-2 gap-2 bg-muted/40 rounded p-2 border border-border">
                <div>
                  <p className="text-[6px] tracking-[0.15em] text-muted-foreground mb-0.5">DROP-OFF</p>
                  <p className="text-2xl font-bold leading-none">10<span className="text-[8px] ml-0.5">JUL</span></p>
                  <p className="text-[7px] mt-1">ANA InterContinental Tokyo</p>
                </div>
                <div className="border-l border-border pl-2">
                  <p className="text-[6px] tracking-[0.15em] text-muted-foreground mb-0.5">PICK-UP</p>
                  <p className="text-2xl font-bold leading-none">12<span className="text-[8px] ml-0.5">JUL</span></p>
                  <p className="text-[7px] mt-1">Hilton Kyoto</p>
                </div>
              </div>
              <div className="mt-3 space-y-0.5">
                <div className="flex justify-between text-[7px]">
                  <span className="text-muted-foreground">NUMBER OF LUGGAGE</span>
                  <span>3 pieces</span>
                </div>
                <div className="flex justify-between text-[7px]">
                  <span className="text-muted-foreground">FORWARDED BY</span>
                  <span>BondEx</span>
                </div>
              </div>
            </div>
            <div className="p-4">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                Voucher (Traveler)
              </p>
              <h3 className="text-sm font-semibold text-foreground mb-1">旅行者向けバウチャー</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                英語と日本語 2 ページ構成。ホテル担当者様向け案内も同梱。
              </p>
            </div>
          </div>

          {/* Mockup 2: Tracking Page — live link */}
          <a
            href="/track/BDX-TEST-001"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl border border-border bg-card overflow-hidden hover:border-foreground/40 transition-colors group"
          >
            <div className="aspect-[3/4] bg-slate-50 p-4 border-b border-border">
              <div className="bg-white rounded-lg p-3 mb-3 border border-border">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-3 rounded bg-foreground/10" />
                  <div className="border-l border-border pl-2">
                    <p className="text-[6px] tracking-widest text-muted-foreground">TRACK YOUR LUGGAGE</p>
                    <p className="text-[8px] font-semibold">BDX-TEST-001</p>
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-lg p-3 border border-border">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[7px] tracking-widest text-muted-foreground">LEG 1</p>
                  <div className="inline-block bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded text-[6px] font-semibold">
                    📋 Label issued
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-center">
                  <div>
                    <p className="text-[6px] tracking-widest text-muted-foreground mb-0.5">DROP-OFF</p>
                    <p className="text-[8px] font-semibold">Test Hotel A</p>
                    <p className="text-[6px] text-muted-foreground">10 July 2026</p>
                  </div>
                  <div className="text-muted-foreground text-xs">→</div>
                  <div>
                    <p className="text-[6px] tracking-widest text-muted-foreground mb-0.5">PICK-UP</p>
                    <p className="text-[8px] font-semibold">Test Hotel B</p>
                    <p className="text-[6px] text-muted-foreground">11 July 2026</p>
                  </div>
                </div>
                <div className="mt-3 pt-2 border-t border-border">
                  <p className="text-[6px] tracking-widest text-muted-foreground mb-1">Yamato Tracking</p>
                  <p className="text-[7px] font-mono">4877-3891-5591 ↗</p>
                </div>
              </div>
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Public Tracking
                </p>
                <span className="text-[10px] text-emerald-700 font-medium">Live Demo →</span>
              </div>
              <h3 className="text-sm font-semibold text-foreground mb-1 group-hover:underline">
                公開トラッキングページ
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                クリックで実物を開く。旅行者向け、認証不要、姓のみ匿名化。
              </p>
            </div>
          </a>

          {/* Mockup 3: Agency Portal */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="aspect-[3/4] bg-slate-50 p-3 border-b border-border">
              <div className="bg-white border border-border rounded p-2 mb-2 flex items-center gap-2">
                <div className="w-5 h-3 rounded bg-foreground/10" />
                <div className="border-l border-border pl-2">
                  <p className="text-[5px] tracking-widest text-muted-foreground">AGENCY PORTAL</p>
                  <p className="text-[8px] font-semibold">My Japan Planner</p>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1 mb-2">
                {["発行済", "集荷済", "配達中", "配達完了"].map((s, i) => (
                  <div key={s} className="bg-white border border-border rounded p-1.5">
                    <p className="text-[5px] tracking-widest text-muted-foreground">{s}</p>
                    <p className="text-sm font-bold">{[3, 2, 1, 5][i]}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white border border-border rounded overflow-hidden">
                <div className="bg-muted/40 px-2 py-1 grid grid-cols-[1fr_1fr_1fr_auto] gap-1 text-[5px] tracking-widest text-muted-foreground uppercase">
                  <span>発行日</span>
                  <span>予約番号</span>
                  <span>代表者</span>
                  <span>状況</span>
                </div>
                {[
                  { d: "06/30", ref: "BDX-260630-428", rep: "Mr. Jack C.", s: "発行済" },
                  { d: "06/30", ref: "BDX-260630-960", rep: "Mr. Jack C.", s: "発行済" },
                  { d: "06/28", ref: "BDX-260628-172", rep: "Ms. Kim H.", s: "集荷済" },
                ].map((r) => (
                  <div
                    key={r.ref}
                    className="border-t border-border px-2 py-1.5 grid grid-cols-[1fr_1fr_1fr_auto] gap-1 text-[6px]"
                  >
                    <span>{r.d}</span>
                    <span className="font-mono">{r.ref}</span>
                    <span>{r.rep}</span>
                    <span className="bg-blue-100 text-blue-800 px-1 rounded text-[5px] font-semibold self-center">
                      {r.s}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                Agency Portal
              </p>
              <h3 className="text-sm font-semibold text-foreground mb-1">代理店ポータル</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                自社の案件のみ閲覧 (RLS で技術的に分離)。ステータス確認・請求書 DL。
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-6 text-center">
          ※ 上記はいずれも <strong className="text-foreground">bondex.express 上で稼働中の実際の画面</strong>です (トラッキングはクリックで開けます)。個別デモをご希望の場合はお問い合わせください。
        </p>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-16 md:py-24">
        <div className="grid md:grid-cols-[1fr_1.5fr] gap-10 items-start">
          <div>
            <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground mb-3">
              Pricing
            </p>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">
              1 個 <span className="text-5xl md:text-6xl">¥5,000</span> 一律
            </h2>
            <p className="text-sm text-muted-foreground mb-1">税別 / 税込 ¥5,500</p>
            <p className="text-xs text-muted-foreground italic">Flat ¥5,000 / piece (excl. tax)</p>
          </div>

          <div className="rounded-3xl border border-border bg-card p-8">
            <div className="mb-5 rounded-2xl bg-muted/40 border border-border p-4">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                Size · Weight
              </p>
              <p className="text-base font-semibold text-foreground leading-snug">
                スーツケース・段ボール・ゴルフバッグ ── <br className="hidden md:block" />
                <span className="whitespace-nowrap">サイズ・重量問わず 1 個 ¥5,000 一律</span>
              </p>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                機内持込サイズ (Sサイズ) から特大 (Lサイズ・XL) まで料金は変わりません。
                ただし利用する物流業者の運送約款上の受託限度 (現在ヤマト運輸: 3辺合計 160cm・25kg 以内) を超えるものは対象外です。
              </p>
            </div>

            <p className="text-sm text-foreground mb-4 leading-relaxed">
              距離・都市に関わらず一律。貴重品・生もの・危険物等、運送約款上の禁制品は対象外です。
            </p>
            <p className="text-xs text-muted-foreground mb-6 leading-relaxed">
              ¥5,000 の内訳は「物流業者への実運賃 + BondEx 手配料 (AI 読取・Voucher/送り状発行・代理店ポータル・サポート)」。代理店様には契約時に内訳を書面開示します。離島・僻地・サイズオーバー・当日配送要件は原則対象外 (別途相談)。物流業者の運賃改定時は事前告知のうえ改定する場合があります。
            </p>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3">
              Included
            </p>
            <ul className="space-y-2 text-sm">
              {[
                "全国主要都市への翌日配送 (現在利用中の物流業者: ヤマト運輸 宅急便)",
                "AI 旅程読取 + 人的ダブルチェック",
                "Voucher (旅行者向け) + ホテル担当者様向け日本語案内 + 送り状の発行",
                "代理店ポータル (案件管理・ステータス・請求書 DL)",
                "公開トラッキングページ (署名付き URL、旅行終了後 30 日で自動失効)",
                "メールサポート (日本語・英語、平日 9:00-18:00 JST)",
              ].map((it) => (
                <li key={it} className="flex gap-2.5 text-foreground/90">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-foreground/60" strokeWidth={1.5} />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 補償ポリシー — 物流業者依存であることを明示 */}
        <div className="mt-8 rounded-3xl border border-amber-200 bg-amber-50/50 p-6 md:p-8">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 mt-0.5 shrink-0 text-amber-700" strokeWidth={1.5} />
            <div>
              <h3 className="text-base font-semibold text-foreground mb-2">
                補償ポリシー — 物流業者の約款に準じます
              </h3>
              <p className="text-sm text-foreground/90 leading-relaxed mb-3">
                BondEx は取次サービスであり、独自の補償制度はありません。荷物の紛失・破損・遅延時の補償は、<strong>実際に配送を担う物流業者の運送約款</strong>に完全に準じます。
              </p>
              <div className="grid md:grid-cols-2 gap-3 mt-4">
                <div className="rounded-xl bg-background border border-border p-4">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                    現在利用中の物流業者
                  </p>
                  <p className="text-sm font-semibold text-foreground mb-1">
                    ヤマト運輸 (宅急便)
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    宅急便運送約款に基づき、1 個あたり <strong className="text-foreground">上限 30 万円</strong>。現金・貴重品・宝石・美術品・生もの・危険物・リチウム電池等は補償対象外または引受不可。
                  </p>
                </div>
                <div className="rounded-xl bg-background border border-border p-4">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                    他社利用時の例 (参考)
                  </p>
                  <p className="text-sm font-semibold text-foreground mb-1">
                    佐川急便 (飛脚宅配便) の場合
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    飛脚宅配便運送約款に準じ、1 個あたり <strong className="text-foreground">上限 30 万円</strong>。禁制品・引受不可品目は各社約款による。将来物流業者を切替える際は、事前に告知のうえ、切替後は当該物流業者の約款が適用されます。
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
                高額品を含む案件では、事前に品目確認のうえ、対象外品目は別手段 (旅行者による直送・手荷物携行) をご案内します。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust signals */}
      <section className="border-y border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-6 py-16 md:py-20">
          <div className="max-w-2xl mb-10">
            <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground mb-3">
              Trust
            </p>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
              信頼性の裏付け
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {TRUST_SIGNALS.map((t) => (
              <div key={t.title} className="rounded-2xl bg-background border border-border p-5">
                <div className="flex items-start gap-3">
                  <Shield className="w-4 h-4 mt-0.5 text-foreground/60 shrink-0" strokeWidth={1.5} />
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-1">{t.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{t.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Roadmap */}
      <section className="max-w-6xl mx-auto px-6 py-16 md:py-24">
        <div className="max-w-2xl mb-10">
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground mb-3">
            Roadmap
          </p>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-3">
            開発状況
          </h2>
          <p className="text-sm text-muted-foreground">
            機能ごとの実装状況を透明に開示しています。実装未着手の機能は、法務レビュー時にご相談ください。
          </p>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {ROADMAP.map((r) => {
            const color =
              r.status === "shipped"
                ? "bg-emerald-100 text-emerald-800"
                : r.status === "in-development"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-slate-100 text-slate-700"
            const label =
              r.status === "shipped"
                ? "✓ 実装済"
                : r.status === "in-development"
                  ? "◐ 開発中"
                  : "○ 検討中"
            return (
              <div key={r.label} className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{r.label}</span>
                <span className={`text-[10px] px-2 py-1 rounded-md font-medium whitespace-nowrap ${color}`}>
                  {label}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-y border-border bg-muted/30">
        <div className="max-w-4xl mx-auto px-6 py-16 md:py-24">
          <div className="mb-10">
            <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground mb-3">
              FAQ
            </p>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
              よくあるご質問
            </h2>
          </div>
          <div className="space-y-3">
            {FAQ.map((f, i) => (
              <details key={i} className="group rounded-2xl border border-border bg-background p-5">
                <summary className="cursor-pointer text-sm font-semibold text-foreground flex items-center justify-between gap-4 list-none">
                  <span>{f.q}</span>
                  <ChevronRight className="w-4 h-4 shrink-0 transition-transform group-open:rotate-90" strokeWidth={1.5} />
                </summary>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Contact / CTA */}
      <section id="contact" className="max-w-4xl mx-auto px-6 py-16 md:py-24">
        <div className="rounded-3xl border border-border bg-card p-8 md:p-12">
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground mb-3">
            Contact
          </p>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">
            30 分の個別デモから始めましょう
          </h2>
          <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
            代理店向け: 業務委託契約書サンプル・責任分界表・法的ポジションペーパー・運輸局照会状況・プライバシーポリシーを含む
            <strong className="text-foreground"> 法務レビュー用パッケージ</strong> を、デモ日程調整と併せて送付します。<br />
            旅行者向け: BondEx をご利用いただける代理店パートナーをご紹介します。
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            <a
              href="mailto:support@bondex.express?subject=BondEx%20デモ予約希望"
              className="rounded-2xl bg-foreground text-background p-5 flex items-start gap-3 hover:bg-foreground/90 transition-colors"
            >
              <MessageSquare className="w-5 h-5 mt-0.5 shrink-0" strokeWidth={1.5} />
              <div className="text-left">
                <p className="text-sm font-semibold">メールで問い合わせ</p>
                <p className="text-xs opacity-80 mt-0.5">support@bondex.express</p>
              </div>
            </a>
            <a
              href="tel:+81-90-1680-1142"
              className="rounded-2xl border border-border p-5 flex items-start gap-3 hover:border-foreground transition-colors"
            >
              <Sparkles className="w-5 h-5 mt-0.5 shrink-0 text-foreground" strokeWidth={1.5} />
              <div className="text-left">
                <p className="text-sm font-semibold text-foreground">電話 (営業直通)</p>
                <p className="text-xs text-muted-foreground mt-0.5">+81-90-1680-1142</p>
              </div>
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-6 py-12 grid gap-8 md:grid-cols-4 text-sm">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bondex-logo.png" alt="BondEx" className="h-8 w-auto object-contain mb-3" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              運営: 株式会社JOJO<br />
              東京都世田谷区野毛1-9-12
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Product</p>
            <ul className="space-y-2 text-xs">
              <li><a href="#how" className="hover:text-foreground">仕組み</a></li>
              <li><a href="#pricing" className="hover:text-foreground">料金</a></li>
              <li><a href="#faq" className="hover:text-foreground">FAQ</a></li>
              <li><Link href="/track" className="hover:text-foreground">Track a Booking</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Portals</p>
            <ul className="space-y-2 text-xs">
              <li><Link href="/agency/login" className="hover:text-foreground">代理店ログイン</Link></li>
              <li><Link href="/operator/login" className="hover:text-foreground">オペレーター</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Legal</p>
            <ul className="space-y-2 text-xs">
              <li><Link href="/legal/terms" className="hover:text-foreground">利用規約</Link></li>
              <li><Link href="/legal/privacy" className="hover:text-foreground">プライバシーポリシー</Link></li>
              <li><Link href="/legal/commercial-transactions" className="hover:text-foreground">特定商取引法に基づく表記</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border">
          <div className="max-w-6xl mx-auto px-6 py-4 text-[11px] text-muted-foreground leading-relaxed">
            <p className="mb-2">
              <strong className="text-foreground">法的位置付け:</strong> BondEx は自らが運送を引き受ける運送人ではなく、旅程情報を受けて物流業者への発送を取り次ぐ「取次サービス」です。実運送・運送責任・補償は、当社が利用する物流業者 (現在: ヤマト運輸 宅急便運送約款) に完全に準じます。物流業者を変更する際は事前告知し、切替後は新たな物流業者の運送約款が適用されます。第一種貨物利用運送事業の登録要否については所管の運輸局に照会中で、書面回答取得後に照会番号と回答内容を本ページに掲載します。
            </p>
            <p>
              © {new Date().getFullYear()} 株式会社JOJO / BondEx · All rights reserved
            </p>
          </div>
        </div>
      </footer>
    </main>
  )
}
