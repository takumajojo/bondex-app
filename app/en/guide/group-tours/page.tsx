import type { Metadata } from "next"
import Link from "next/link"
import { DocPage } from "@/components/doc-page"
import { PRICING, formatYen } from "@/lib/pricing"

const TITLE = "How to Arrange Luggage Forwarding for Group Tours in Japan | BondEx"
const DESC =
  "A step-by-step guide for travel agencies and DMCs running group tours of 10 or more in Japan: send the itinerary and shipping dates, and BondEx handles hotel contact, pickup, vouchers, tracking and one monthly invoice. No tour leader minding bags, no shipping forms for hotels. Book 5 days ahead; last-minute changes handled wherever possible."

const faqs = [
  { q: "How many guests count as a group?", a: "Group tours of 10 or more guests. Luggage for 30–45 guests is managed in one place and multiple pieces are confirmed together." },
  { q: "When do groups need to book?", a: "Five days ahead as a rule. Later changes to piece counts, hotels or dates do happen, and we accommodate them wherever possible — contact us first." },
  { q: "Do we need to compare carrier quotes?", a: "No. BondEx selects the best-fit carrier for each route and shipment, such as Sagawa Express or Yamato Transport, and arranges the pickup." },
  { q: "Is there any work for the tour leader or the hotel?", a: "Hotels are never asked to fill in shipping forms or call the carrier, and tour leaders do not have to guard bags or prepare paperwork. Guests leave their luggage at the front desk on departure morning and collect it at the next hotel." },
  { q: "What do groups pay?", a: `${formatYen(PRICING.regularPrice)} per item excluding tax, flat for any size or weight. ${PRICING.volumeDiscount}% off from ${PRICING.volumeThreshold} items per month, and custom plans for groups and large accounts. Shipping is invoiced to the agency monthly; overseas agencies can pay by credit card.` },
]

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/en/guide/group-tours", languages: { ja: "/guide/group-tours", en: "/en/guide/group-tours", "x-default": "/guide/group-tours" } },
  openGraph: { type: "article", url: "https://bondex.express/en/guide/group-tours", siteName: "BondEx", title: TITLE, description: DESC, locale: "en_US" },
}

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": "https://bondex.express/en/guide/group-tours#article",
    headline: "How to arrange luggage forwarding for group tours in Japan",
    description: DESC,
    inLanguage: "en",
    datePublished: "2026-10-27",
    dateModified: "2026-10-27",
    author: { "@id": "https://bondex.express/#organization" },
    publisher: { "@id": "https://bondex.express/#organization" },
    mainEntityOfPage: "https://bondex.express/en/guide/group-tours",
    about: { "@id": "https://bondex.express/#service" },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  },
]

export default function GroupToursGuideEn() {
  return (
    <DocPage lang="en" eyebrow="Guide · Group Tours" title="How to arrange luggage forwarding for group tours" lead={DESC} updated="2026-10-27" jsonLd={jsonLd}>
      <h2>When forwarding pays off on a group tour</h2>
      <ul>
        <li>Itineraries with several Shinkansen or local-train legs where large suitcases slow the group down</li>
        <li>Tour leaders spending time calling the arrival hotel and preparing shipping forms</li>
        <li>Front desks that are reluctant, or refuse, to fill in shipping forms on the group&apos;s behalf</li>
        <li>Nobody can say where all 30–45 bags are at any given moment</li>
      </ul>

      <h2>Step by step</h2>
      <ol>
        <li><strong>Send the itinerary and shipping dates.</strong> PDF, Excel or an image is fine. Specify when, from which hotel, to which hotel, and how many pieces. Book five days ahead as a rule.</li>
        <li><strong>BondEx arranges everything.</strong> Contact with the departure and arrival hotels, carrier selection and pickup, and traveler vouchers. No need to compare carrier quotes.</li>
        <li><strong>Guests leave bags at the front desk.</strong> They show the voucher and hand over the luggage. The hotel does not fill in any forms.</li>
        <li><strong>Collect at the next hotel.</strong> Arrival is normally the day after pickup or later (<Link href="/en/guide/lead-time">lead times</Link>). BondEx emails the agency on pickup and on delivery.</li>
        <li><strong>One invoice at month-end.</strong> Monthly closing, payment the following month-end. Overseas agencies can pay by credit card.</li>
      </ol>

      <h2>Changes and exceptions</h2>
      <ul>
        <li>Tell us about piece-count, hotel or date changes as soon as you know. Last-minute changes after the cut-off are handled wherever possible.</li>
        <li>Missed pickups, delays, loss or damage, and guest inquiries: BondEx checks with the carrier, confirms the facts and reports to the agency.</li>
        <li>If a shipment status does not change by the expected time, an internal alert fires and we start checking before anyone has to ask.</li>
      </ul>

      <h2>Pricing</h2>
      <ul>
        <li>{formatYen(PRICING.regularPrice)} per item excluding tax, flat for any size or weight. No setup or monthly fee.</li>
        <li>{PRICING.volumeDiscount}% off from {PRICING.volumeThreshold} items per month. Custom plans for groups and large accounts.</li>
        <li>First-time trial: {formatYen(PRICING.trialPrice)} per item (excl. tax) for the first {PRICING.trialLimit} items per company.</li>
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
        <li><Link href="/en/guide/lead-time">Delivery lead times and booking cut-offs</Link></li>
        <li><Link href="/en#price">Pricing</Link></li>
        <li><Link href="/en/about">About BondEx</Link></li>
      </ul>
    </DocPage>
  )
}
