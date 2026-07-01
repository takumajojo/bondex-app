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
    a: "補償はヤマト運輸宅急便運送約款に基づき、1個あたり上限 30 万円です。BondEx 独自の追加補償は現時点でありません。宅急便約款上、現金・貴重品・宝石・美術品・貴金属・有価証券・生もの・危険物等は補償対象外または引受不可です。高額品を含む富裕層案件では、事前に品目確認のうえ、対象外品目は別手段 (旅行者による直送・手荷物携行) をご案内します。",
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
            <p className="text-xs text-muted-foreground italic">Flat ¥5,000 / bag (excl. tax)</p>
          </div>

          <div className="rounded-3xl border border-border bg-card p-8">
            <p className="text-sm text-foreground mb-4 leading-relaxed">
              距離・都市に関わらず一律。ヤマト運輸宅急便運送約款の範囲内 (3辺合計 160cm 以内・25kg 以内・貴重品/生もの/危険物等の禁制品を除く) が対象です。
            </p>
            <p className="text-xs text-muted-foreground mb-6 leading-relaxed">
              ¥5,000 の内訳は「ヤマト運輸への実運賃 + BondEx 手配料 (AI 読取・Voucher/送り状発行・代理店ポータル・サポート)」。代理店様には契約時に内訳を書面開示します。離島・僻地・サイズオーバー・当日配送要件は原則対象外 (別途相談)。ヤマト運賃改定時は事前告知のうえ改定する場合があります。
            </p>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-3">
              Included
            </p>
            <ul className="space-y-2 text-sm">
              {[
                "ヤマト運輸 (宅急便) による実運送 (翌日配送・全国主要都市)",
                "AI 旅程読取 + 人的ダブルチェック",
                "Voucher (旅行者向け) + ホテル担当者様向け日本語案内 + ヤマト送り状の発行",
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
              <strong className="text-foreground">法的位置付け:</strong> BondEx は自らが運送を引き受ける運送人ではなく、旅程情報を受けてヤマト運輸への発送を取り次ぐ「取次サービス」です。実運送・運送責任・補償はヤマト運輸宅急便運送約款に従います。第一種貨物利用運送事業の登録要否については所管の運輸局に照会中で、書面回答取得後に照会番号と回答内容を本ページに掲載します。
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
