import type { Metadata } from "next"
import Link from "next/link"
import { DocPage } from "@/components/doc-page"
import { PRICING, formatYen } from "@/lib/pricing"

const TITLE = "Luggage Forwarding in Japan: Delivery Lead Times and Booking Cut-offs | BondEx"
const DESC =
  "Hotel-to-hotel luggage forwarding in Japan normally arrives the day after a morning pickup (Tokyo to Kyoto, Osaka, Nagoya, Kanazawa). Tokyo to Fukuoka or Hokkaido takes two days, Honshu to Okinawa two days or more. Cut-offs: FIT by 16:00 JST the day before pickup, groups 5 days ahead. A guide by BondEx for travel agencies and DMCs."

const faqs = [
  { q: "How many days does luggage forwarding take?", a: "With a morning pickup, Tokyo to Kyoto, Osaka, Nagoya, Kanazawa or Hida-Takayama, and Kyoto or Osaka to Tokyo, Nagoya or Hiroshima, normally arrive the next day. Tokyo to Fukuoka or Hokkaido takes two days; Honshu to Okinawa two days or more." },
  { q: "Can luggage be delivered to the next hotel the same day?", a: "No. Hotel-to-hotel forwarding arrives the next day at the earliest. When guests travel on the pickup day, plan for arrival the following day and have guests carry an overnight bag." },
  { q: "What is the booking cut-off?", a: "Individual travelers (FIT): until 16:00 JST on the day before pickup. Groups: 5 days ahead as a rule. Later changes to piece counts, hotels or dates are accommodated wherever possible — contact us first." },
  { q: "How much does it cost?", a: `${formatYen(PRICING.regularPrice)} per item excluding tax, flat for any size or weight. No setup or monthly fee. Okinawa, remote islands and oversized items are quoted separately.` },
  { q: "What if luggage is damaged or lost?", a: "Coverage follows the carrier's terms of carriage: up to ¥300,000 per item. Damage to suitcase shells and wheels is excluded." },
]

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/en/guide/lead-time", languages: { ja: "/guide/lead-time", en: "/en/guide/lead-time", "x-default": "/guide/lead-time" } },
  openGraph: { type: "article", url: "https://bondex.express/en/guide/lead-time", siteName: "BondEx", title: TITLE, description: DESC, locale: "en_US" },
}

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": "https://bondex.express/en/guide/lead-time#article",
    headline: "Luggage forwarding in Japan: delivery lead times and booking cut-offs",
    description: DESC,
    inLanguage: "en",
    datePublished: "2026-10-27",
    dateModified: "2026-10-27",
    author: { "@id": "https://bondex.express/#organization" },
    publisher: { "@id": "https://bondex.express/#organization" },
    mainEntityOfPage: "https://bondex.express/en/guide/lead-time",
    about: { "@id": "https://bondex.express/#service" },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  },
]

export default function LeadTimeGuideEn() {
  return (
    <DocPage lang="en" eyebrow="Guide · Lead Time" title="Delivery lead times and booking cut-offs" lead={DESC} updated="2026-10-27" jsonLd={jsonLd}>
      <h2>Typical lead times</h2>
      <p>Based on a morning pickup and the standard delivery schedule of Sagawa Express.</p>
      <table>
        <thead>
          <tr><th>Arrival</th><th>Route</th></tr>
        </thead>
        <tbody>
          <tr><td>Next day</td><td>Tokyo → Nagoya, Kanazawa, Hida-Takayama, Kyoto, Osaka<br />Kyoto / Osaka → Tokyo, Nagoya, Hiroshima</td></tr>
          <tr><td>Two days</td><td>Tokyo → Fukuoka, Hokkaido</td></tr>
          <tr><td>Two days or more</td><td>Honshu → Okinawa</td></tr>
        </tbody>
      </table>
      <p className="note">This is not a same-day service. When guests move cities on the pickup day, have them carry an overnight bag and collect the suitcase at the next hotel the following day.</p>

      <h2>Booking cut-offs</h2>
      <table>
        <thead>
          <tr><th>Type</th><th>Cut-off</th><th>Notes</th></tr>
        </thead>
        <tbody>
          <tr><td>Individual travelers (FIT)</td><td>16:00 JST, the day before pickup</td><td>From a single booking</td></tr>
          <tr><td>Groups (10+ guests)</td><td>5 days ahead, as a rule</td><td>Tell us early about piece-count, hotel or date changes. Last-minute changes are handled wherever possible</td></tr>
        </tbody>
      </table>

      <h2>How to build it into an itinerary</h2>
      <ol>
        <li>Before each inter-city move without a connecting night, fix the shipping date and the hotels.</li>
        <li>Send the itinerary (PDF, Excel or image is fine) and shipping dates to BondEx. BondEx contacts the hotels, arranges pickup and issues vouchers.</li>
        <li>On departure morning the guest leaves the luggage at the front desk. The hotel is never asked to fill in shipping forms.</li>
        <li>The guest collects the luggage at the next hotel the following day or later. BondEx emails the agency when luggage is picked up and when it is delivered.</li>
      </ol>

      <h2>Price and coverage</h2>
      <ul>
        <li>{formatYen(PRICING.regularPrice)} per item excluding tax, flat for any size or weight. No setup or monthly fee.</li>
        <li>{PRICING.volumeDiscount}% off from {PRICING.volumeThreshold} items per month. Custom plans for groups and large accounts.</li>
        <li>Coverage follows the carrier&apos;s terms: up to ¥300,000 per item. Suitcase shells and wheels are excluded.</li>
      </ul>

      <h2>FAQ</h2>
      {faqs.map((f) => (
        <div key={f.q}>
          <h3>{f.q}</h3>
          <p>{f.a}</p>
        </div>
      ))}

      <h2>Related</h2>
      <ul>
        <li><Link href="/en/guide/group-tours">How to arrange luggage forwarding for group tours</Link></li>
        <li><Link href="/en#price">Pricing</Link></li>
        <li><Link href="/en/about">About BondEx</Link></li>
      </ul>
    </DocPage>
  )
}
