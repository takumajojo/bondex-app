import type { Metadata } from "next"
import { Landing } from "@/components/landing/landing"

// 日本語 (既定) ランディング。/ で配信。英語版は /en。
// タイトル・説明は app/layout.tsx の SITE_TITLE / SITE_DESC と揃える。
const SITE_TITLE = "BondEx（ボンデックス）｜旅行会社・DMC向け 訪日旅行のホテル間荷物配送手配"
const SITE_DESC =
  "旅行会社・DMC・ランドオペレーター向けの荷物配送手配代行。旅程を送るだけで、ホテル間配送の集荷・送り状・追跡・月次請求まで BondEx が対応。ホテルへの伝票依頼は不要で、手ぶら観光を旅行商品に組み込めます。"

// SNS/チャット共有プレビュー用の日英併記(SEO用の <title>/description は日本語のまま)。
const OG_TITLE =
  "BondEx（ボンデックス）｜訪日旅行のホテル間荷物配送手配 / Hotel-to-Hotel Luggage Forwarding in Japan for Travel Agencies & DMCs"
const OG_DESC =
  "旅行会社・DMC・ランドオペレーター向けのホテル間荷物配送手配代行。旅程を送るだけで集荷・送り状・追跡・月次請求まで対応し、ホテルへの伝票依頼は不要です。 / BondEx arranges hotel-to-hotel luggage forwarding across Japan for travel agencies, DMCs and land operators — send the itinerary and we handle pickup, labels, tracking and monthly billing, with no shipping paperwork for hotels."

// hreflang 相互リンク。Phase 2 で ES/FR/ZH/IT を足すときは languages に追記する。
const LANGUAGE_ALTERNATES = {
  ja: "/",
  en: "/en",
  es: "/es",
  fr: "/fr",
  zh: "/zh",
  it: "/it",
  "x-default": "/",
}

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESC,
  alternates: {
    canonical: "/",
    languages: LANGUAGE_ALTERNATES,
  },
  openGraph: {
    type: "website",
    url: "https://bondex.express/",
    siteName: "BondEx",
    title: OG_TITLE,
    description: OG_DESC,
    locale: "ja_JP",
    images: [{ url: "/og-image.jpg?v=2", width: 1200, height: 630, alt: "BondEx" }],
  },
}

export default function Page() {
  return <Landing lang="ja" />
}
