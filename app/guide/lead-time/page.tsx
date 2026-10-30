import type { Metadata } from "next"
import Link from "next/link"
import { DocPage } from "@/components/doc-page"
import { PRICING, formatYen } from "@/lib/pricing"

// ガイド: 所要日数と受付締切。所要日数は 佐川急便「配達日数検索」の実測 (2026-10-30 取得・
// data/sagawa-lead-times/README.md)、受付締切・補償は LP の FAQ に既に公開済みのものだけを使う。

const TITLE = "ホテル間荷物配送の所要日数と受付締切 | BondEx"
const DESC =
  "訪日旅行のホテル間荷物配送は、午前中の集荷で通常は翌日着（東京→京都・大阪・名古屋・金沢など）。東京→福岡・北海道・広島は翌々日。沖縄は飛脚航空便で翌日（地域により異なる）。受付は個人旅行が集荷前日16:00まで、団体は原則5日前。BondEx が旅行会社・DMC向けにまとめました。"

const faqs = [
  { q: "荷物は何日で届きますか？", a: "午前中の集荷を前提に、東京→京都・大阪・名古屋・金沢・飛騨高山、京都・大阪→東京・名古屋・広島・福岡は通常翌日に到着します。東京→福岡・北海道・広島は翌々日、京都・大阪→北海道は3日後が目安です。沖縄発着は飛脚航空便で翌日に届きます（地域により異なります）。同じ都市でも集荷エリアによって1日多くかかることがあります。" },
  { q: "当日中に次のホテルへ届けられますか？", a: "届けられません。ホテル間配送は最短でも翌日着です。集荷当日に次のホテルへ移動する旅程では、翌日以降の到着を前提に、1泊分の手荷物は旅行者が携行してください。" },
  { q: "申し込みはいつまでに必要ですか？", a: "個人旅行は集荷前日の16:00（日本時間）まで受け付けます。団体は原則5日前までにご予約ください。それ以降の個数変更・ホテル変更・日程変更も、可能な限り調整しますのでまずご連絡ください。" },
  { q: "料金はいくらですか？", a: `荷物1個あたり ${formatYen(PRICING.regularPrice)}（税抜）の均一料金です。サイズ・重さを問いません。初期費用・月額費用はかかりません。沖縄・離島・大型荷物は個別にご案内します。` },
  { q: "荷物が破損・紛失した場合の補償は？", a: "実運送を担う物流会社の運送約款に準じ、1個あたり最大30万円まで補償されます。スーツケースの外装・キャスターの破損は補償対象外です。" },
]

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/guide/lead-time", languages: { ja: "/guide/lead-time", en: "/en/guide/lead-time", "x-default": "/guide/lead-time" } },
  openGraph: { type: "article", url: "https://bondex.express/guide/lead-time", siteName: "BondEx", title: TITLE, description: DESC, locale: "ja_JP" },
}

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": "https://bondex.express/guide/lead-time#article",
    headline: "ホテル間荷物配送の所要日数と受付締切",
    description: DESC,
    inLanguage: "ja",
    datePublished: "2026-10-27",
    dateModified: "2026-10-27",
    author: { "@id": "https://bondex.express/#organization" },
    publisher: { "@id": "https://bondex.express/#organization" },
    mainEntityOfPage: "https://bondex.express/guide/lead-time",
    about: { "@id": "https://bondex.express/#service" },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  },
]

export default function LeadTimeGuide() {
  return (
    <DocPage lang="ja" eyebrow="Guide · Lead Time" title="ホテル間荷物配送の所要日数と受付締切" lead={DESC} updated="2026-10-30" jsonLd={jsonLd}>
      <h2>所要日数の目安</h2>
      <p>午前中の集荷を前提とした目安です。佐川急便の「配達日数検索」の結果（2026年10月時点）に基づきます。沖縄発着は飛脚航空便で送ります。</p>
      <table>
        <thead>
          <tr><th>到着</th><th>区間</th></tr>
        </thead>
        <tbody>
          <tr><td>翌日</td><td>東京 → 名古屋・金沢・飛騨高山・京都・大阪<br />京都・大阪 → 東京・名古屋・広島・福岡</td></tr>
          <tr><td>翌々日</td><td>東京 → 福岡・北海道・広島</td></tr>
          <tr><td>3日後</td><td>京都・大阪 → 北海道</td></tr>
          <tr><td>翌日（飛脚航空便）</td><td>沖縄発着（地域により異なる）</td></tr>
        </tbody>
      </table>
      <p className="note">同じ都市でも、集荷するホテルのエリアによって1日多くかかることがあります（例: 東京・銀座 → 函館は3日後、東京のほかのエリア → 函館は翌々日）。予約時にホテルごとの最短お届け日を確認してご案内します。</p>
      <p className="note">当日着のサービスではありません。集荷当日に移動する旅程では、1泊分の手荷物は旅行者が携行し、スーツケースは翌日以降に次のホテルで受け取る前提で組んでください。</p>

      <h2>受付締切</h2>
      <table>
        <thead>
          <tr><th>区分</th><th>締切</th><th>備考</th></tr>
        </thead>
        <tbody>
          <tr><td>個人旅行（FIT）</td><td>集荷前日 16:00（日本時間）</td><td>1件から受付</td></tr>
          <tr><td>団体（10名以上）</td><td>原則 5日前</td><td>個数の増減・ホテル変更・日程変更は早めにご連絡ください。締切後の急な変更も可能な限り調整します</td></tr>
        </tbody>
      </table>

      <h2>旅程に組み込むときの考え方</h2>
      <ol>
        <li>連泊しない都市間移動の前日までに、荷物を送る日とホテルを決める。</li>
        <li>旅程（PDF・Excel・画像のままで可）と配送日を BondEx に送る。ホテルへの連絡、集荷手配、バウチャー発行は BondEx が行う。</li>
        <li>旅行者は出発日の朝、フロントに荷物を預ける。ホテルに伝票の代筆をお願いする必要はない。</li>
        <li>翌日以降、次のホテルで荷物を受け取る。集荷完了・配送完了は BondEx から旅行会社へメールで報告。</li>
      </ol>

      <h2>料金と補償</h2>
      <ul>
        <li>荷物1個あたり {formatYen(PRICING.regularPrice)}（税抜）の均一料金。サイズ・重さを問いません。初期費用・月額費用は0円。</li>
        <li>月間{PRICING.volumeThreshold}個以上のご利用で{PRICING.volumeDiscount}% OFF。団体・大口は個別プラン。</li>
        <li>補償は物流会社の運送約款に準じ、1個あたり最大30万円。スーツケースの外装・キャスターの破損は対象外。</li>
      </ul>

      <h2>よくある質問</h2>
      {faqs.map((f) => (
        <div key={f.q}>
          <h3>{f.q}</h3>
          <p>{f.a}</p>
        </div>
      ))}

      <h2>関連ページ</h2>
      <ul>
        <li><Link href="/guide/group-tours">団体ツアーの荷物配送を手配する手順</Link></li>
        <li><Link href="/#price">料金</Link></li>
        <li><Link href="/about">運営会社</Link></li>
      </ul>
    </DocPage>
  )
}
