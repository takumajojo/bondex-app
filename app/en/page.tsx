import type { Metadata } from "next"
import { Landing } from "@/components/landing/landing"

// 英語ランディング。/en で配信。同一のランディングページを英語で表示する。
const SITE_TITLE_EN = "Luggage Forwarding in Japan for Travel Agencies & DMCs | BondEx"
const SITE_DESC_EN =
  "BondEx arranges luggage forwarding between hotels across Japan for travel agencies, DMCs and land operators. Send the itinerary and we handle pickup, shipping labels, tracking and monthly billing. No paperwork for hotels, and hands-free travel becomes part of your product."

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
    images: [{ url: "/og-image.jpg?v=2", width: 1200, height: 630, alt: "BondEx" }],
  },
}

export default function Page() {
  return <Landing lang="en" />
}
