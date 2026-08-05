import type { Metadata } from "next"
import { Landing } from "@/components/landing/landing"

// 簡体字中国語ランディング。/zh で配信。同一のランディングページを簡体字中国語で表示する。
const SITE_TITLE_ZH = "BondEx | 日本全国酒店间行李转运服务"
const SITE_DESC_ZH =
  "BondEx 是面向入境旅行社与地接社的行李转运协调服务，在日本全国的酒店之间转运行李。我们依据您的行程数据开具旅客兑换券与运单，提供追踪，并处理每月汇总账单或信用卡付款。"

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
    images: [{ url: "/og-image.jpg", width: 1200, height: 630, alt: "BondEx" }],
  },
}

export default function Page() {
  return <Landing lang="zh" />
}
