import type { Metadata } from "next"
import { Landing } from "@/components/landing/landing"

// 日本語 (既定) ランディング。/ で配信。英語版は /en。
// タイトル・説明は app/layout.tsx の SITE_TITLE / SITE_DESC と揃える。
const SITE_TITLE = "BondEx｜旅行会社・DMC向け 訪日旅行のホテル間荷物配送手配"
const SITE_DESC =
  "旅行会社・DMC・ランドオペレーター向けの荷物配送手配代行。旅程を送るだけで、ホテル間配送の集荷・送り状・追跡・月次請求まで BondEx が対応。ホテルへの伝票依頼は不要で、手ぶら観光を旅行商品に組み込めます。"

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
    title: SITE_TITLE,
    description: SITE_DESC,
    locale: "ja_JP",
    images: [{ url: "/og-image.jpg?v=2", width: 1200, height: 630, alt: "BondEx" }],
  },
}

export default function Page() {
  return <Landing lang="ja" />
}
