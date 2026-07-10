
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Terms of Service | BondEx',
  robots: { index: false },
}

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-background max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground mb-2">Terms of Service</h1>
      <p className="text-xs text-muted-foreground mb-8">Last updated: July 10, 2026</p>

      <p className="text-sm text-foreground/80 leading-relaxed mb-8">
        BondEx is a luggage forwarding coordination service for travel agencies and land
        operators, operated by JOJO Corporation (株式会社JOJO).<br /><br />
        By using BondEx, you (the partner agency) agree to the following terms.
      </p>

      <div className="space-y-6 text-sm text-foreground/80 leading-relaxed">
        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">1. Our Service</h2>
          <p>
            BondEx coordinates luggage forwarding within Japan on behalf of partner travel
            agencies and land operators. We prepare vouchers, shipping labels, tracking and
            monthly billing from the itinerary data you provide.
          </p>
          <p className="mt-2">
            Transportation itself is carried out by licensed courier partners such as
            Yamato Transport and Sagawa Express. BondEx acts as a coordinator (取次), not as
            the carrier.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">2. Accounts &amp; Responsibilities</h2>
          <p>The service is provided to partner agencies with a BondEx account. You are responsible for:</p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>Providing accurate guest, hotel and itinerary information</li>
            <li>Ensuring luggage complies with the carrier restrictions below</li>
            <li>Communicating handling instructions to your guests and partner hotels</li>
          </ul>
          <p className="mt-2">If required information is missing or incorrect, delivery may be delayed.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">3. Pricing &amp; Payment</h2>
          <p>Pricing is a flat rate per luggage item, agreed in your agency contract and shown before each issuance.</p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>
              <strong>Overseas / corporate agencies:</strong> paid per shipment by credit
              card via Stripe. The charge is confirmed when the courier completes pickup.
            </li>
            <li>
              <strong>Domestic agencies:</strong> monthly invoice — usage is totalled at
              month-end and billed the following month.
            </li>
          </ul>
          <p className="mt-2">
            Card payments are processed securely by Stripe. BondEx does not store full
            credit card numbers.
          </p>
        </section>

        <section id="luggage-guidelines">
          <h2 className="text-base font-semibold text-foreground mb-2">4. Luggage Guidelines</h2>
          <p>
            Size and weight limits follow the courier&apos;s standard parcel terms
            (Yamato Transport / Sagawa Express):
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>Maximum size: 160 cm total (length + width + height)</li>
            <li>Maximum weight: per the courier&apos;s limit for the selected service</li>
          </ul>
          <p className="mt-2">Please do not include:</p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>Cash or valuables</li>
            <li>Fragile high-value items</li>
            <li>Dangerous or flammable materials</li>
            <li>Perishable goods</li>
            <li>Illegal items</li>
          </ul>
          <p className="mt-2">If restricted items are discovered, the courier may refuse the shipment.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">5. Delivery Timing</h2>
          <p>We aim to deliver on the date and time window selected at booking.</p>
          <p className="mt-2">
            Delivery times are estimates and may be affected by weather, traffic or other
            conditions beyond our control.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">6. Loss or Damage</h2>
          <p>
            If loss or damage occurs, compensation is handled in accordance with the
            transporting courier&apos;s terms (for example, coverage up to 300,000 JPY per
            item under standard Yamato / Sagawa policies).
          </p>
          <p className="mt-2">Please report any issues within 7 days of delivery so we can assist promptly.</p>
          <p className="mt-2">
            To the extent permitted by law, BondEx&apos;s total liability for a booking is
            limited to the fee paid for that booking.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">7. Cancellation</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Before pickup:</strong> free of charge. Because card payments are
              confirmed at pickup, no charge is made for shipments cancelled beforehand.
            </li>
            <li>
              <strong>After pickup:</strong> the shipment is already in transit and cannot
              be cancelled; the applicable fee is charged.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">8. Fair Use</h2>
          <p>To keep the service running smoothly for everyone, please:</p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>Provide accurate information</li>
            <li>Declare luggage size and contents correctly</li>
            <li>Use the service lawfully</li>
          </ul>
          <p className="mt-2">We may suspend the account if misuse is detected.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">9. Changes</h2>
          <p>
            We may update or improve the service from time to time. Updated terms will be
            posted with a revised date.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">10. Governing Law</h2>
          <p>
            These terms are governed by the laws of Japan. Any disputes shall be handled by
            the courts having jurisdiction over the location of JOJO Corporation.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">11. Contact</h2>
          <p>
            JOJO Corporation (株式会社JOJO) — 1-9-12 Noge, Setagaya-ku, Tokyo 158-0092,
            Japan.<br />
            Email: <a href="mailto:support@bondex.express" className="underline">support@bondex.express</a>
          </p>
        </section>
      </div>

      <div className="mt-12 pt-6 border-t border-border">
        <a href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          &larr; Back to Home
        </a>
      </div>
    </div>
  )
}
