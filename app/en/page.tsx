import type { Metadata } from "next"
import { Landing } from "@/components/landing/landing"

// 英語ランディング。/en で配信。同一のランディングページを英語で表示する。
const SITE_TITLE_EN = "BondEx | Luggage forwarding between hotels across Japan"
const SITE_DESC_EN =
  "BondEx is a luggage forwarding coordination service for inbound travel agencies and land operators, moving luggage between hotels across Japan. From your itinerary data we issue traveler vouchers and shipping labels, provide tracking, and handle consolidated monthly billing or card payment."

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
  title: SITE_TITLE_EN,
  description: SITE_DESC_EN,
  alternates: {
    canonical: "/en",
    languages: LANGUAGE_ALTERNATES,
  },
  openGraph: {
    type: "website",
    url: "https://bondex.express/en",
    siteName: "BondEx",
    title: SITE_TITLE_EN,
    description: SITE_DESC_EN,
    locale: "en_US",
    images: [{ url: "/og-image.jpg", width: 1200, height: 630, alt: "BondEx" }],
  },
}

export default function Page() {
  return <Landing lang="en" />
}
