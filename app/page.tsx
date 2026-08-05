import type { Metadata } from "next"
import { Landing } from "@/components/landing/landing"

// 日本語 (既定) ランディング。/ で配信。英語版は /en。
// タイトル・説明は app/layout.tsx の SITE_TITLE / SITE_DESC と揃える。
const SITE_TITLE = "BondEx | 荷物配送を、旅行商品の一部に。"
const SITE_DESC =
  "BondEx（ボンデックス）は、訪日旅行代理店・ランドオペレーター向けの荷物配送手配代行サービスです。旅程データからバウチャー・送り状・追跡情報・月次請求までまとめて対応します。"

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
    images: [{ url: "/og-image.jpg", width: 1200, height: 630, alt: "BondEx" }],
  },
}

export default function Page() {
  return <Landing lang="ja" />
}
