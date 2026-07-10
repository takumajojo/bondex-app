
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Privacy Policy | BondEx',
  robots: { index: false },
}

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground mb-2">Privacy Policy</h1>
      <p className="text-xs text-muted-foreground mb-8">Last updated: July 10, 2026</p>

      <p className="text-sm text-foreground/80 leading-relaxed mb-8">
        BondEx is operated by JOJO Corporation (株式会社JOJO). This policy explains how we
        handle personal information when partner travel agencies use BondEx to coordinate
        luggage forwarding for their guests.
      </p>

      <div className="space-y-6 text-sm text-foreground/80 leading-relaxed">
        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">1. Information We Collect</h2>
          <p className="mb-2">To coordinate a luggage forwarding shipment, we handle:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Guest / recipient name provided by the partner agency</li>
            <li>Hotel and itinerary details (origin, destination, dates)</li>
            <li>Number and details of luggage items</li>
            <li>Agency contact information (name, email)</li>
            <li>Payment information (processed by our payment provider — we do not store full card numbers)</li>
            <li>Website usage data (device, IP address, access logs, and analytics — see §7)</li>
          </ul>
          <p className="mt-2">If required information is missing, we may be unable to process a shipment.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">2. Legal Basis for Processing</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Performance of a contract (to coordinate luggage forwarding)</li>
            <li>Your consent (where required, e.g. analytics cookies)</li>
            <li>Compliance with legal obligations</li>
            <li>Our legitimate interests, such as fraud prevention and service improvement</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">3. How We Use Information</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Prepare vouchers, shipping labels, tracking and billing</li>
            <li>Coordinate with courier partners and hotels</li>
            <li>Communicate service updates by email</li>
            <li>Process payments</li>
            <li>Respond to support inquiries and resolve issues</li>
            <li>Improve and secure the service</li>
            <li>Comply with applicable laws</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">4. Sharing &amp; International Transfers</h2>
          <p className="mb-2">We share information only as needed with:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Courier partners (e.g. Yamato Transport, Sagawa Express) to carry out delivery</li>
            <li>Hotels / accommodations that receive or hand over the luggage</li>
            <li>Our payment and infrastructure providers (e.g. Stripe, Supabase, Vercel)</li>
          </ul>
          <p className="mt-2">Some providers may operate outside Japan; we apply appropriate safeguards under applicable data protection laws. We do not sell personal information.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">5. Data Retention</h2>
          <p>
            We retain personal information only as long as needed to provide the service,
            meet legal obligations, resolve disputes and prevent fraud, then delete or
            anonymize it.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">6. Your Rights</h2>
          <p className="mb-2">Subject to applicable law, you may request to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Access your personal information</li>
            <li>Correct or delete it</li>
            <li>Restrict or object to processing</li>
            <li>Withdraw consent (where processing relies on consent)</li>
          </ul>
          <p className="mt-2">
            To exercise these rights, contact{" "}
            <a href="mailto:support@bondex.express" className="underline">support@bondex.express</a>.
            We may verify your identity before responding.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">7. Cookies &amp; Analytics</h2>
          <p>
            We use Google Analytics to understand how the website is used and to improve it.
            Analytics cookies are only set after you accept them in the consent banner; until
            then, measurement runs in a consent-denied, cookieless mode. You can change your
            choice at any time by clearing site data.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">8. Security</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Encryption of data in transit (HTTPS/TLS)</li>
            <li>Secure payment processing via certified providers</li>
            <li>Access controls and authentication</li>
          </ul>
          <p className="mt-2">No system can guarantee absolute security.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">9. Changes</h2>
          <p>
            We may update this policy from time to time. Material changes will be posted on
            this page with a revised &quot;Last updated&quot; date.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">10. Contact</h2>
          <p>JOJO Corporation (株式会社JOJO)</p>
          <p>1-9-12 Noge, Setagaya-ku, Tokyo 158-0092, Japan</p>
          <p>Email: <a href="mailto:support@bondex.express" className="underline">support@bondex.express</a></p>
          <p className="mt-2">
            If you are located in Japan, you may also contact the Personal Information
            Protection Commission of Japan.
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
