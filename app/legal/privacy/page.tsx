
export const dynamic = 'force-dynamic'

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground mb-2">Privacy Policy</h1>
      <p className="text-xs text-muted-foreground mb-8">Last updated: February 9, 2026</p>

      <div className="space-y-6 text-sm text-foreground/80 leading-relaxed">
        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">1. Information We Collect</h2>
          <p className="mb-2">We collect the following personal information when you use our luggage delivery service:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Full name</li>
            <li>Email address</li>
            <li>Phone number</li>
            <li>Hotel/accommodation details</li>
            <li>Booking confirmation information</li>
            <li>Flight information (if provided)</li>
            <li>Payment information (processed via third-party payment providers)</li>
            <li>Photos of your luggage for condition documentation</li>
            <li>Device information, IP address, and usage logs for security and service improvement purposes</li>
          </ul>
          <p className="mt-2">Providing this information is necessary to use our service. If you do not provide required information, we may not be able to process your order.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">2. Legal Basis for Processing</h2>
          <p className="mb-2">We process your personal information based on:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Performance of a contract (to provide luggage delivery services)</li>
            <li>Your consent (where required)</li>
            <li>Compliance with legal obligations</li>
            <li>Our legitimate business interests, such as fraud prevention and service improvement</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">3. How We Use Your Information</h2>
          <p className="mb-2">We use your personal information to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Process and fulfill your luggage delivery orders</li>
            <li>Coordinate with logistics partners and hotels</li>
            <li>Communicate service updates via email or SMS</li>
            <li>Verify your identity and prevent fraud</li>
            <li>Process payments and refunds</li>
            <li>Respond to customer support inquiries</li>
            <li>Improve our services</li>
            <li>Comply with applicable laws and regulations</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">4. Information Sharing and International Transfers</h2>
          <p className="mb-2">We may share your personal information with:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Logistics partners (e.g., Yamato Transport)</li>
            <li>Hotels or accommodations for luggage reception</li>
            <li>Payment processing providers</li>
            <li>Cloud service providers supporting our system</li>
          </ul>
          <p className="mt-2">Some of these service providers may be located outside Japan. In such cases, we take appropriate safeguards in accordance with applicable data protection laws.</p>
          <p className="mt-2">We do not sell your personal information to third parties.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">5. Data Retention</h2>
          <p className="mb-2">We retain personal information only for as long as necessary to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Provide our services</li>
            <li>Comply with legal obligations</li>
            <li>Resolve disputes</li>
            <li>Prevent fraud</li>
          </ul>
          <p className="mt-2">Luggage condition photos are retained for 30 days after delivery completion unless required for dispute resolution.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">6. Your Rights</h2>
          <p className="mb-2">Subject to applicable law, you have the right to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Access your personal information</li>
            <li>Request correction or deletion</li>
            <li>Request restriction of processing</li>
            <li>Request data portability</li>
            <li>Withdraw consent (where processing is based on consent)</li>
          </ul>
          <p className="mt-2">To exercise your rights, please contact us at: privacy@bondex.app</p>
          <p className="mt-1">We may verify your identity before responding to requests.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">7. Security Measures</h2>
          <p className="mb-2">We implement appropriate technical and organizational security measures, including:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Encryption of data in transit and at rest</li>
            <li>Secure payment processing via certified providers</li>
            <li>Access controls and authentication procedures</li>
            <li>Monitoring and fraud detection measures</li>
          </ul>
          <p className="mt-2">However, no system can guarantee absolute security.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">8. Children</h2>
          <p>Our service is not intended for children under the age of 16 without parental consent. If we become aware that we have collected personal information from a child without appropriate consent, we will delete it.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">9. International Users</h2>
          <p>If you access our services from outside Japan, please note that your information will be processed and stored in Japan. By using our services, you consent to the transfer of your information to Japan.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">10. Payment Processing</h2>
          <p>Payments are processed securely through third-party payment providers such as Stripe. We do not store full credit card numbers on our servers.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">11. Changes to This Policy</h2>
          <p>We may update this Privacy Policy from time to time. When we make material changes, we will notify users through the app or website. The updated version will be indicated by a revised &quot;Last updated&quot; date.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">12. Contact Information</h2>
          <p>BondEx Inc.</p>
          <p>[Full Legal Address]</p>
          <p>Tokyo, Japan</p>
          <p>Email: privacy@bondex.app</p>
          <p className="mt-2">If you are located in Japan, you may also contact the relevant supervisory authority, including the Personal Information Protection Commission of Japan.</p>
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
