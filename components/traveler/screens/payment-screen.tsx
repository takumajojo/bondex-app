"use client"

import { useEffect, useMemo, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Lock, Package } from "lucide-react"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { loadStripe } from "@stripe/stripe-js"
import { Button } from "@/components/ui/button"
import { createPaymentIntent } from "@/lib/shipandco-api"
import { generateOrderId, TRAVELER_CHECKOUT_DRAFT_KEY } from "@/lib/booking-store"
import type { BookingData } from "../traveler-flow"

const TRAVELER_PAYMENT_RETURN_PATH = "/?role=traveler&step=payment"

function storageKeyPiDone(paymentIntentId: string) {
  return `bondex_pi_done_${paymentIntentId}`
}

interface PaymentScreenProps {
  data: BookingData
  onUpdate: (data: BookingData) => void
  onNext: (finalBooking?: BookingData) => void
  onBack: () => void
}

const PRICE_YEN: Record<NonNullable<BookingData["items"]>[number]["size"], number> = {
  S: 2500,
  M: 3500,
  L: 4500,
  LL: 6000,
}

function CheckoutForm({
  data,
  orderId,
  totalPrice,
  estimatedMax,
  isLoadingIntent,
  onPaid,
}: {
  data: BookingData
  orderId: string
  totalPrice: number
  estimatedMax: number
  isLoadingIntent: boolean
  onPaid: (paymentIntentId: string | undefined) => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    setError(null)
    if (!stripe || !elements) return
    setIsSubmitting(true)
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : ""
      const returnUrl = `${origin}${TRAVELER_PAYMENT_RETURN_PATH}`
      try {
        sessionStorage.setItem(TRAVELER_CHECKOUT_DRAFT_KEY, JSON.stringify({ data, orderId, totalPrice }))
      } catch {
        // ignore storage failures (private mode, quota)
      }
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      })
      if (result.error) {
        setError(result.error.message || "Payment failed. Please try again.")
        return
      }
      onPaid((result.paymentIntent && ("id" in result.paymentIntent ? result.paymentIntent.id : undefined)) || undefined)
    } finally {
      setIsSubmitting(false)
    }
  }

  const disabled = !stripe || !elements || isSubmitting || isLoadingIntent

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="w-4 h-4" />
          <span>Secure payment</span>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <PaymentElement />
        </div>

        <p className="text-muted-foreground text-xs leading-relaxed">
          PayPay and similar methods may open another page or app to authorize payment.
        </p>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>

      <Button onClick={handleSubmit} disabled={disabled} className="w-full h-12">
        {isLoadingIntent || isSubmitting ? "Processing..." : `Pay ¥${totalPrice.toLocaleString()}`}
      </Button>

      <p className="text-[11px] text-muted-foreground text-center">
        Order: <span className="font-mono">{orderId}</span> · Max auto-charge: ¥{estimatedMax.toLocaleString()}
      </p>
    </div>
  )
}

export function PaymentScreen({ data, onUpdate, onNext, onBack }: PaymentScreenProps) {
  const router = useRouter()
  const dataRef = useRef(data)
  useEffect(() => {
    dataRef.current = data
  }, [data])

  const [isLoadingIntent, setIsLoadingIntent] = useState(false)
  const [intentError, setIntentError] = useState<string | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [urlReady, setUrlReady] = useState(false)
  const [completingReturn, setCompletingReturn] = useState(false)
  const handlePaidRef = useRef<(paymentIntentId: string | undefined) => void>(() => {})
  const [stripeReturn, setStripeReturn] = useState<{ secret: string | null }>({ secret: null })

  const stripePublishableKey =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY : undefined

  const stripePromise = useMemo(() => {
    if (!stripePublishableKey) return null
    return loadStripe(stripePublishableKey)
  }, [stripePublishableKey])

  const orderId = useMemo(() => data.orderId || generateOrderId(), [data.orderId])

  const totalPrice = useMemo(() => {
    return data.items.reduce((sum, item) => sum + (PRICE_YEN[item.size] || 0), 0)
  }, [data.items])

  const estimatedMax = useMemo(() => totalPrice + data.items.length * 1500, [totalPrice, data.items.length])

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    setStripeReturn({ secret: p.get("payment_intent_client_secret") })
    setUrlReady(true)
  }, [])

  useEffect(() => {
    if (!urlReady) return
    let cancelled = false
    async function run() {
      setIntentError(null)
      setClientSecret(null)

      if (!stripePromise) {
        setIntentError("Stripe is not configured (missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY).")
        return
      }
      if (!orderId || totalPrice <= 0) {
        setIntentError("Missing order or amount.")
        return
      }

      if (stripeReturn.secret) {
        setClientSecret(stripeReturn.secret)
        setIsLoadingIntent(false)
        return
      }

      setIsLoadingIntent(true)
      const res = await createPaymentIntent({ orderId, amount: totalPrice, currency: "jpy" })
      if (cancelled) return
      if (!res.ok) {
        setIntentError(res.error || "Failed to start payment.")
        setIsLoadingIntent(false)
        return
      }
      setClientSecret(res.data.clientSecret)
      setIsLoadingIntent(false)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [urlReady, stripeReturn.secret, orderId, stripePromise, totalPrice])

  const handlePaid = useCallback(
    (paymentIntentId: string | undefined) => {
      if (paymentIntentId) {
        try {
          const k = storageKeyPiDone(paymentIntentId)
          if (sessionStorage.getItem(k) === "1") return
          sessionStorage.setItem(k, "1")
        } catch {
          // ignore
        }
      }
      try {
        const raw = sessionStorage.getItem(TRAVELER_CHECKOUT_DRAFT_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as { data?: BookingData }
          if (parsed?.data) {
            dataRef.current = parsed.data
          }
        }
      } catch {
        // ignore
      }
      const merged: BookingData = {
        ...dataRef.current,
        orderId,
        paymentIntentId,
      }
      try {
        sessionStorage.removeItem(TRAVELER_CHECKOUT_DRAFT_KEY)
      } catch {
        // ignore
      }
      onUpdate(merged)
      router.replace("/?role=traveler&step=completion")
      onNext(merged)
    },
    [onUpdate, onNext, orderId, router]
  )

  handlePaidRef.current = handlePaid

  useEffect(() => {
    if (!urlReady || !stripeReturn.secret || !stripePromise) return
    let cancelled = false
    async function finishReturn() {
      setCompletingReturn(true)
      const stripe = await stripePromise
      if (!stripe || cancelled) {
        setCompletingReturn(false)
        return
      }
      const { error, paymentIntent } = await stripe.retrievePaymentIntent(stripeReturn.secret!)
      if (cancelled) {
        setCompletingReturn(false)
        return
      }
      if (error) {
        setCompletingReturn(false)
        setIntentError(error.message || "Could not confirm payment after redirect.")
        return
      }
      const status = paymentIntent?.status
      if (status === "succeeded" || status === "processing") {
        handlePaidRef.current(paymentIntent?.id)
        setCompletingReturn(false)
      } else if (status === "requires_payment_method") {
        setCompletingReturn(false)
        setIntentError("Payment was not completed. Please choose another method and try again.")
      } else {
        setCompletingReturn(false)
        setIntentError("Payment is still pending. Please wait or try again.")
      }
    }
    finishReturn()
    return () => {
      cancelled = true
    }
  }, [urlReady, stripeReturn.secret, stripePromise])

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
      {}
      <header className="p-4 flex items-center gap-3 border-b border-border">
        <button onClick={onBack} className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-semibold text-foreground">Payment</h1>
          <p className="text-sm text-muted-foreground">Step 5 of 6</p>
        </div>
      </header>

      {}
      <div className="flex-1 overflow-auto p-4 space-y-5">
        {}
        <div className="p-4 rounded-lg bg-card border border-border">
          <div className="space-y-2">
            {data.items.map((item, index) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-muted-foreground" />
                  <span>
                    Item {index + 1} ({item.size})
                  </span>
                </div>
                <span className="text-muted-foreground">¥{(PRICE_YEN[item.size] || 0).toLocaleString()}</span>
              </div>
            ))}

            <div className="pt-3 mt-2 border-t border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Pay now</span>
                <span className="font-bold text-lg">{"\u00a5"}{totalPrice.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Estimated total (max)</span>
                <span>{"\u00a5"}{estimatedMax.toLocaleString()}</span>
              </div>
              <p className="text-xs text-muted-foreground pt-1">Prices may vary by destination.</p>
            </div>
          </div>

          {}
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50 mt-3">
            <p className="text-sm font-semibold text-foreground leading-snug mb-1">
              Up to {"\u00a5"}{estimatedMax.toLocaleString()} may be charged automatically
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              If the carrier measures a different size, the difference (up to the estimated max) will be charged to this
              payment method automatically. No action needed from you. You{"'"}ll receive an email notification with the
              updated amount.
            </p>
          </div>
        </div>

        {intentError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {intentError}
          </div>
        )}

        {completingReturn ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Confirming payment after redirect…
          </div>
        ) : !stripePromise || !clientSecret ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            {isLoadingIntent ? "Preparing secure payment..." : "Payment is not ready yet."}
          </div>
        ) : (
          <Elements stripe={stripePromise} options={{ clientSecret }}>
            <CheckoutForm
              data={data}
              orderId={orderId}
              totalPrice={totalPrice}
              estimatedMax={estimatedMax}
              isLoadingIntent={isLoadingIntent}
              onPaid={handlePaid}
            />
          </Elements>
        )}
      </div>
    </div>
  )
}
