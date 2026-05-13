
export const dynamic = 'force-dynamic'

export default function CommercialTransactionsPage() {
  return (
    <div className="min-h-screen bg-background max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground mb-2">
        Notation Based on the Specified Commercial Transactions Act
      </h1>
      <p className="text-xs text-muted-foreground mb-8">
        (特定商取引法に基づく表記)
      </p>

      <div className="space-y-0 text-sm">
        <div className="grid grid-cols-[140px_1fr] border-t border-border">
          <div className="py-3 pr-4 font-semibold text-foreground border-b border-border">Seller</div>
          <div className="py-3 pl-4 text-foreground/80 border-b border-border">BondEx Inc.</div>
        </div>
        <div className="grid grid-cols-[140px_1fr]">
          <div className="py-3 pr-4 font-semibold text-foreground border-b border-border">Representative</div>
          <div className="py-3 pl-4 text-foreground/80 border-b border-border">[Representative Name]</div>
        </div>
        <div className="grid grid-cols-[140px_1fr]">
          <div className="py-3 pr-4 font-semibold text-foreground border-b border-border">Address</div>
          <div className="py-3 pl-4 text-foreground/80 border-b border-border">[Business Address, Tokyo, Japan]</div>
        </div>
        <div className="grid grid-cols-[140px_1fr]">
          <div className="py-3 pr-4 font-semibold text-foreground border-b border-border">Phone</div>
          <div className="py-3 pl-4 text-foreground/80 border-b border-border">[Phone Number]</div>
        </div>
        <div className="grid grid-cols-[140px_1fr]">
          <div className="py-3 pr-4 font-semibold text-foreground border-b border-border">Email</div>
          <div className="py-3 pl-4 text-foreground/80 border-b border-border">support@bondex.app</div>
        </div>
        <div className="grid grid-cols-[140px_1fr]">
          <div className="py-3 pr-4 font-semibold text-foreground border-b border-border">Service Fee</div>
          <div className="py-3 pl-4 text-foreground/80 border-b border-border">
            Varies by luggage size. Displayed at checkout before payment. Prices include tax.
          </div>
        </div>
        <div className="grid grid-cols-[140px_1fr]">
          <div className="py-3 pr-4 font-semibold text-foreground border-b border-border">Additional Fees</div>
          <div className="py-3 pl-4 text-foreground/80 border-b border-border">
            If the actual luggage size differs from your selection, the price is adjusted automatically (up to the estimated max displayed at checkout).
          </div>
        </div>
        <div className="grid grid-cols-[140px_1fr]">
          <div className="py-3 pr-4 font-semibold text-foreground border-b border-border">Payment Method</div>
          <div className="py-3 pl-4 text-foreground/80 border-b border-border">
            Credit card, Apple Pay, Google Pay
          </div>
        </div>
        <div className="grid grid-cols-[140px_1fr]">
          <div className="py-3 pr-4 font-semibold text-foreground border-b border-border">Payment Timing</div>
          <div className="py-3 pl-4 text-foreground/80 border-b border-border">
            Charged at the time of booking. Adjustments charged upon delivery completion.
          </div>
        </div>
        <div className="grid grid-cols-[140px_1fr]">
          <div className="py-3 pr-4 font-semibold text-foreground border-b border-border">Delivery Time</div>
          <div className="py-3 pl-4 text-foreground/80 border-b border-border">
            Selected by user at the time of booking. Typically same-day or next-day within Japan.
          </div>
        </div>
        <div className="grid grid-cols-[140px_1fr]">
          <div className="py-3 pr-4 font-semibold text-foreground border-b border-border">Cancellation</div>
          <div className="py-3 pl-4 text-foreground/80 border-b border-border">
            Full refund if cancelled more than 24 hours before pickup. Up to 50% fee within 24 hours.
          </div>
        </div>
        <div className="grid grid-cols-[140px_1fr]">
          <div className="py-3 pr-4 font-semibold text-foreground border-b border-border">Returns</div>
          <div className="py-3 pl-4 text-foreground/80 border-b border-border">
            Not applicable (delivery service).
          </div>
        </div>
      </div>

      <div className="mt-12 pt-6 border-t border-border">
        <a href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          &larr; Back to Home
        </a>
      </div>
    </div>
  )
}
