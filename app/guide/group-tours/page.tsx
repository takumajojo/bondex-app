import type { Metadata } from "next"
import Link from "next/link"
import { DocPage } from "@/components/doc-page"
import { PRICING, formatYen } from "@/lib/pricing"

// ガイド: 団体ツアーの荷物配送手配。内容は LP の個人/団体セクション・困りごと・料金・FAQ と
// サービス概要資料 p6 に既に公開済みの範囲に限定する。

const TITLE = "団体ツアーの荷物配送を手配する手順（旅行会社・DMC向け） | BondEx"
const DESC =
  "10名以上の団体ツアーで、スーツケースをホテルからホテルへ送る手配の手順。旅程と配送日を送るだけで、ホテル連絡・集荷・バウチャー・追跡・月次請求まで BondEx が代行。添乗員の荷物番もホテルへの伝票依頼も不要。締切は原則5日前、急な変更も対応。"

const faqs = [
  { q: "何名から団体として扱われますか？", a: "10名以上の団体旅行に対応します。30〜45名規模の荷物も一元管理し、複数個口をまとめて確認できます。" },
  { q: "団体の予約はいつまでに必要ですか？", a: "原則5日前までにご予約ください。それ以降の個数の増減・ホテル変更・日程変更も実際によくあることなので、可能な限り調整します。まずご連絡ください。" },
  { q: "配送会社の相見積もりは必要ですか？", a: "不要です。区間・荷物・お届け条件に応じて、佐川急便・ヤマト運輸など最適な配送会社を BondEx が選定し、集荷手配まで行います。" },
  { q: "添乗員やホテルの負担はありますか？", a: "ホテルに伝票の代筆や集荷依頼をお願いすることはなく、添乗員が荷物の見張りや伝票作成をする必要もありません。旅行者は出発の朝にフロントへ荷物を預け、次のホテルで受け取るだけです。" },
  { q: "団体の料金はどうなりますか？", a: `基本は荷物1個あたり ${formatYen(PRICING.regularPrice)}（税抜）の均一料金です。月間${PRICING.volumeThreshold}個以上で${PRICING.volumeDiscount}% OFF、団体・大口案件は個別プランをご用意します。配送費は旅行会社宛に月次でまとめて請求し、海外の旅行会社はクレジットカード決済も選べます。` },
]

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/guide/group-tours", languages: { ja: "/guide/group-tours", en: "/en/guide/group-tours", "x-default": "/guide/group-tours" } },
  openGraph: { type: "article", url: "https://bondex.express/guide/group-tours", siteName: "BondEx", title: TITLE, description: DESC, locale: "ja_JP" },
}

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": "https://bondex.express/guide/group-tours#article",
    headline: "団体ツアーの荷物配送を手配する手順（旅行会社・DMC向け）",
    description: DESC,
    inLanguage: "ja",
    datePublished: "2026-10-27",
    dateModified: "2026-10-27",
    author: { "@id": "https://bondex.express/#organization" },
    publisher: { "@id": "https://bondex.express/#organization" },
    mainEntityOfPage: "https://bondex.express/guide/group-tours",
    about: { "@id": "https://bondex.express/#service" },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  },
]

export default function GroupToursGuide() {
  return (
    <DocPage lang="ja" eyebrow="Guide · Group Tours" title="団体ツアーの荷物配送を手配する手順" lead={DESC} updated="2026-10-27" jsonLd={jsonLd}>
      <h2>団体ツアーで荷物配送が効く場面</h2>
      <ul>
        <li>新幹線や在来線での都市間移動が多く、大型スーツケースの持ち込みが負担になる行程</li>
        <li>添乗員が到着ホテルへの確認電話や伝票作成に時間を取られている</li>
        <li>出発ホテルのフロントに伝票の代筆をお願いしづらい、あるいは断られることがある</li>
        <li>30〜45名分の荷物の所在を、誰がどこまで把握しているか分からなくなる</li>
      </ul>

      <h2>手配の手順</h2>
      <ol>
        <li><strong>旅程と配送日を送る。</strong>PDF・Excel・画像のままで構いません。「いつ・どのホテルから、どのホテルへ送るか」と個数を指定します。原則5日前までにご予約ください。</li>
        <li><strong>BondEx が手配する。</strong>出発ホテル・到着ホテルへの連絡、配送会社の選定と集荷手配、旅行者用バウチャーの発行まで BondEx が行います。配送会社の相見積もりは不要です。</li>
        <li><strong>出発の朝、フロントに預ける。</strong>旅行者はバウチャーを提示して荷物を預けるだけ。ホテルが伝票を書く必要はありません。</li>
        <li><strong>次のホテルで受け取る。</strong>到着は通常、集荷の翌日以降です（<Link href="/guide/lead-time">所要日数の目安</Link>）。集荷完了・配送完了は BondEx から旅行会社へメールで報告します。</li>
        <li><strong>月末にまとめて精算。</strong>配送費は月末締め・翌月末払いのまとめ請求。海外の旅行会社はクレジットカード決済も選べます。</li>
      </ol>

      <h2>変更・トラブルの扱い</h2>
      <ul>
        <li>個数の増減、ホテルの変更、日程の変更は、分かった時点でご連絡ください。締切後の急な変更も可能な限り調整します。</li>
        <li>集荷されていない、配送が遅れている、紛失・破損・誤配、旅行者からの問い合わせは、BondEx が配送会社に確認し、状況を把握してから旅行会社へご連絡します。</li>
        <li>想定時刻までに配送ステータスが変わらない場合は社内アラートで検知し、問い合わせを受ける前に確認を始めます。</li>
      </ul>

      <h2>料金</h2>
      <ul>
        <li>荷物1個あたり {formatYen(PRICING.regularPrice)}（税抜）。サイズ・重さを問わず均一。初期費用・月額費用は0円。</li>
        <li>月間{PRICING.volumeThreshold}個以上で{PRICING.volumeDiscount}% OFF。団体・大口案件は個別プラン。</li>
        <li>初回トライアルは1社につき最初の{PRICING.trialLimit}個まで {formatYen(PRICING.trialPrice)}（税抜）。</li>
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
        <li><Link href="/guide/lead-time">ホテル間荷物配送の所要日数と受付締切</Link></li>
        <li><Link href="/#price">料金</Link></li>
        <li><Link href="/about">運営会社</Link></li>
      </ul>
    </DocPage>
  )
}
