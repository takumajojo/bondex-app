
export const dynamic = 'force-dynamic'

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-background max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground mb-2">Terms of Service</h1>
      <p className="text-xs text-muted-foreground mb-8">Last updated: February 9, 2026</p>

      <p className="text-sm text-foreground/80 leading-relaxed mb-8">
        Welcome to BondEx.<br />
        We{"'"}re here to make your travel in Japan more comfortable by helping you move your luggage safely and conveniently.<br /><br />
        By using our service, you agree to the following terms.
      </p>

      <div className="space-y-6 text-sm text-foreground/80 leading-relaxed">
        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">1. Our Service</h2>
          <p>
            BondEx provides a luggage delivery coordination service within Japan.
            We work with trusted logistics partners, including Yamato Transport, to transport your luggage between designated locations.
          </p>
          <p className="mt-2">
            BondEx coordinates the service, while transportation is carried out by our logistics partners.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">2. Who Can Use the Service</h2>
          <p>You must be at least 18 years old.</p>
          <p className="mt-2">You are responsible for:</p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>Providing accurate information</li>
            <li>Ensuring your luggage complies with our restrictions</li>
            <li>Packing your items securely</li>
          </ul>
          <p className="mt-2">If required information is missing or incorrect, delivery may be delayed.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">3. Booking and Payment</h2>
          <p>Prices are based on luggage size and weight.</p>
          <p className="mt-2">
            If the carrier measures a different size than originally selected, the price will automatically adjust.
            The maximum possible amount is shown at checkout as {"\""}Estimated total (max).{"\""}
          </p>
          <p className="mt-2">
            Payments are securely processed through providers such as Stripe.
            BondEx does not store full credit card information.
          </p>
        </section>

        <section id="luggage-guidelines">
          <h2 className="text-base font-semibold text-foreground mb-2">4. Luggage Guidelines</h2>
          <p>For safety reasons:</p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>Maximum size: 200 cm (length + width + height)</li>
            <li>Maximum weight: 30 kg per item</li>
          </ul>
          <p className="mt-2">Please do not include:</p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>Cash or valuables</li>
            <li>Fragile high-value items</li>
            <li>Dangerous or flammable materials</li>
            <li>Perishable goods</li>
            <li>Illegal items</li>
          </ul>
          <p className="mt-2">If restricted items are discovered, delivery may be refused.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">5. Delivery Timing</h2>
          <p>We aim to deliver within your selected time window.</p>
          <p className="mt-2">
            However, delivery times are estimates and may be affected by weather, traffic, or other unexpected conditions.
          </p>
          <p className="mt-2">We appreciate your understanding if delays occur due to circumstances beyond our control.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">6. Loss or Damage</h2>
          <p>We understand your luggage is important.</p>
          <p className="mt-2">
            If loss or damage occurs, compensation is handled in accordance with the applicable carrier{"'"}s terms
            (for example, coverage up to 300,000 JPY per item under standard policies).
          </p>
          <p className="mt-2">Please report any issues within 7 days of delivery so we can assist you promptly.</p>
          <p className="mt-2">
            To the extent permitted by law, BondEx{"'"}s total liability is limited to the amount paid for the specific booking.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">7. Cancellations</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>More than 24 hours before pickup: Full refund</li>
            <li>Within 24 hours: Up to 50% cancellation fee</li>
            <li>No-show: Fees may not be refundable</li>
          </ul>
          <p className="mt-2">Refund timing depends on your payment provider.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">8. Fair Use</h2>
          <p>To ensure smooth service for everyone, please:</p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>Provide accurate information</li>
            <li>Declare luggage size correctly</li>
            <li>Use the service lawfully</li>
          </ul>
          <p className="mt-2">We may suspend service if misuse is detected.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">9. Service Changes</h2>
          <p>
            We may update or improve the service from time to time.
            Updated terms will be posted with a revised date.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">10. Governing Law</h2>
          <p>
            These terms are governed by the laws of Japan.
            Any disputes shall be handled by the courts in Tokyo, Japan.
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
