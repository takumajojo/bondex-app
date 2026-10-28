import type { Metadata } from "next"
import Link from "next/link"
import { DocPage } from "@/components/doc-page"

const TITLE = "About BondEx | Luggage Forwarding in Japan for Travel Agencies & DMCs"
const DESC =
  "BondEx is a luggage-forwarding coordination service for travel agencies, DMCs and land operators handling inbound travel to Japan, operated by JOJO Co., Ltd. (Tokyo). Company profile, what the service is, and how it differs from unrelated companies with a similar name."

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/en/about", languages: { ja: "/about", en: "/en/about", "x-default": "/about" } },
  openGraph: { type: "website", url: "https://bondex.express/en/about", siteName: "BondEx", title: TITLE, description: DESC, locale: "en_US" },
}

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  "@id": "https://bondex.express/en/about#page",
  url: "https://bondex.express/en/about",
  name: TITLE,
  inLanguage: "en",
  about: { "@id": "https://bondex.express/#organization" },
  isPartOf: { "@id": "https://bondex.express/#website" },
}

export default function AboutPageEn() {
  return (
    <DocPage lang="en" eyebrow="About BondEx" title="About BondEx" lead={DESC} updated="2026-10-27" jsonLd={jsonLd}>
      <h2>What BondEx is</h2>
      <p>
        <strong>BondEx</strong> receives an itinerary from a travel agency, DMC or land operator and arranges the forwarding of guests&apos; luggage from one hotel to the next across Japan. It contacts the hotels, arranges pickup, issues vouchers, tracks each shipment, handles exceptions and sends one consolidated monthly invoice.
      </p>
      <p>
        BondEx is not a carrier. Transport is performed by partner carriers such as Sagawa Express and Yamato Transport; BondEx acts as the coordinating agent that arranges, communicates and manages. The contract of carriage is between the traveler or travel company and the carrier.
      </p>

      <h2>Company profile</h2>
      <dl>
        <div><dt>Service</dt><dd>BondEx (ボンデックス)</dd></div>
        <div><dt>Operator</dt><dd>JOJO Co., Ltd. (株式会社JOJO)</dd></div>
        <div><dt>Founded</dt><dd>October 2015</dd></div>
        <div><dt>Address</dt><dd>1-9-12 Noge, Setagaya-ku, Tokyo 158-0092, Japan</dd></div>
        <div><dt>Representative</dt><dd>Takuma Taniguchi</dd></div>
        <div><dt>Service launched</dt><dd>August 2026</dd></div>
        <div><dt>Customers</dt><dd>Travel agencies, DMCs and land operators (FIT and groups)</dd></div>
        <div><dt>Languages</dt><dd>Japanese, English, Spanish, French, Chinese and Italian (website); multilingual vouchers</dd></div>
        <div><dt>Contact</dt><dd><a href="mailto:support@bondex.express">support@bondex.express</a></dd></div>
        <div><dt>Corporate site</dt><dd><a href="https://www.jojotokyo.com" target="_blank" rel="noopener noreferrer">www.jojotokyo.com</a></dd></div>
      </dl>

      <h2>Not to be confused with</h2>
      <p>
        The name &quot;BondEx / Bondex&quot; is also used by unrelated companies and products: the Web3 talent network and BDXN token &quot;Bondex&quot;, the Japanese welfare-services company 株式会社Bondex, the paint and adhesive brands &quot;BONDEX&quot;, and the hair-care line &quot;Bondex&quot;. None of them is connected to this service. The official spelling is <strong>BondEx</strong> and the only official website is <strong>bondex.express</strong>.
      </p>

      <h2>History</h2>
      <ul>
        <li>October 2015 — JOJO Co., Ltd. founded in Setagaya, Tokyo</li>
        <li>August 2026 — BondEx launched for travel agencies and land operators: hotel-to-hotel luggage forwarding, fully arranged</li>
        <li>September 2026 — Agency portal released (itinerary registration, shipment status, voucher download)</li>
      </ul>

      <h2>Related pages</h2>
      <ul>
        <li><Link href="/en">Service overview</Link></li>
        <li><Link href="/en/guide/lead-time">Delivery lead times and booking cut-offs</Link></li>
        <li><Link href="/en/guide/group-tours">How to arrange luggage forwarding for group tours</Link></li>
      </ul>
    </DocPage>
  )
}
