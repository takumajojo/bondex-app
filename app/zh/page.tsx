import type { Metadata } from "next"
import { Landing } from "@/components/landing/landing"

// 簡体字中国語ランディング。/zh で配信。同一のランディングページを簡体字中国語で表示する。
const SITE_TITLE_ZH = "面向旅行社与地接社的日本酒店间行李转运代办 | BondEx"
const SITE_DESC_ZH =
  "BondEx 面向旅行社与地接社，代办日本全国酒店间的行李转运。只需发送行程，取件、运单、追踪与月结账单全部由我们处理，无需酒店代填运单。"

// hreflang 相互リンク。全 6 言語 + x-default を列挙する。
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
  title: SITE_TITLE_ZH,
  description: SITE_DESC_ZH,
  alternates: {
    canonical: "/zh",
    languages: LANGUAGE_ALTERNATES,
  },
  openGraph: {
    type: "website",
    url: "https://bondex.express/zh",
    siteName: "BondEx",
    title: SITE_TITLE_ZH,
    description: SITE_DESC_ZH,
    locale: "zh_CN",
    images: [{ url: "/og-image.jpg?v=2", width: 1200, height: 630, alt: "BondEx" }],
  },
}

export default function Page() {
  return <Landing lang="zh" />
}
