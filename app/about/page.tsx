import type { Metadata } from "next"
import Link from "next/link"
import { DocPage } from "@/components/doc-page"

// 運営会社ページ (日本語)。英語版は /en/about。
// 記載する事実は 特定商取引法ページ・サービス概要資料 (docs/collateral/service-overview) に
// 既に公開/確定しているものだけに限定する (数字の捏造禁止)。

const TITLE = "運営会社 | BondEx（ボンデックス）"
const DESC =
  "BondEx（ボンデックス）は、株式会社JOJO（東京・世田谷）が運営する、旅行会社・DMC・ランドオペレーター向けの訪日旅行ホテル間荷物配送の手配代行サービスです。会社概要・サービスの定義・同名の他社との区別について。"

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/about", languages: { ja: "/about", en: "/en/about", "x-default": "/about" } },
  openGraph: { type: "website", url: "https://bondex.express/about", siteName: "BondEx", title: TITLE, description: DESC, locale: "ja_JP" },
}

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  "@id": "https://bondex.express/about#page",
  url: "https://bondex.express/about",
  name: TITLE,
  inLanguage: "ja",
  about: { "@id": "https://bondex.express/#organization" },
  isPartOf: { "@id": "https://bondex.express/#website" },
}

export default function AboutPage() {
  return (
    <DocPage lang="ja" eyebrow="About BondEx" title="BondEx（ボンデックス）について" lead={DESC} updated="2026-10-27" jsonLd={jsonLd}>
      <h2>サービスの定義</h2>
      <p>
        <strong>BondEx（ボンデックス）</strong>は、旅行会社・DMC・ランドオペレーターから旅程を受け取り、訪日旅行者の荷物をホテルからホテルへ届けるための配送手配を代行するサービスです。ホテルへの連絡、集荷手配、バウチャーの発行、配送追跡、異常時の対応、月次のまとめ請求までを一括して担当します。
      </p>
      <p>
        BondEx は運送会社ではありません。実際の輸送は佐川急便・ヤマト運輸などの物流会社が行い、BondEx は取次業者として手配・連絡・管理を行います。運送契約は旅行者または旅行会社と物流会社の間で成立します。
      </p>

      <h2>会社概要</h2>
      <dl>
        <div><dt>サービス名</dt><dd>BondEx（ボンデックス）</dd></div>
        <div><dt>運営会社</dt><dd>株式会社JOJO / JOJO Co., Ltd.</dd></div>
        <div><dt>設立</dt><dd>2015年10月</dd></div>
        <div><dt>所在地</dt><dd>〒158-0092 東京都世田谷区野毛1-9-12</dd></div>
        <div><dt>代表者</dt><dd>谷口 琢真</dd></div>
        <div><dt>サービス開始</dt><dd>2026年8月</dd></div>
        <div><dt>対象</dt><dd>旅行会社・DMC・ランドオペレーター（個人旅行・団体旅行の両方）</dd></div>
        <div><dt>対応言語</dt><dd>日本語・英語・スペイン語・フランス語・中国語・イタリア語（サイト）、バウチャーは多言語対応</dd></div>
        <div><dt>連絡先</dt><dd><a href="mailto:support@bondex.express">support@bondex.express</a></dd></div>
        <div><dt>コーポレートサイト</dt><dd><a href="https://www.jojotokyo.com" target="_blank" rel="noopener noreferrer">www.jojotokyo.com</a></dd></div>
      </dl>

      <h2>同名の他社・他サービスとの区別</h2>
      <p>
        「BondEx / Bondex / ボンデックス」という名称は、当サービスとは無関係の企業・製品にも使われています。暗号資産・Web3の人材ネットワーク「Bondex」、障がい福祉事業を行う「株式会社Bondex」、塗料や接着機の「BONDEX」、ヘアケア製品の「ボンデックス」などは、いずれも当サービスとは関係ありません。当サービスの正式表記は <strong>BondEx</strong>（大文字B・大文字E）、公式サイトは <strong>bondex.express</strong> のみです。
      </p>

      <h2>沿革</h2>
      <ul>
        <li>2015年10月 株式会社JOJO 設立（東京都世田谷区）</li>
        <li>2026年8月 BondEx サービス開始。旅行会社・ランドオペレーター向けにホテル間荷物配送の手配代行を提供</li>
        <li>2026年9月 旅行会社・DMC向けに代理店ポータル（旅程登録・配送状況の確認・バウチャー取得）を提供</li>
      </ul>

      <h2>関連ページ</h2>
      <ul>
        <li><Link href="/">サービス紹介（トップ）</Link></li>
        <li><Link href="/guide/lead-time">ホテル間荷物配送の所要日数と受付締切</Link></li>
        <li><Link href="/guide/group-tours">団体ツアーの荷物配送を手配する手順</Link></li>
        <li><Link href="/legal/commercial-transactions">特定商取引法に基づく表記</Link></li>
      </ul>
    </DocPage>
  )
}
