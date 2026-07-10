"use client"

import { useState } from "react"
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js"
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js"
import { Loader2, Check, CreditCard } from "lucide-react"
import { getBrowserSupabase } from "@/lib/supabase-browser"

/**
 * 代理店のカード登録ウィジェット (Stripe SetupIntent + Elements)。
 *  - /api/stripe/setup-intent で clientSecret + publishableKey を取得
 *  - Stripe キー未設定なら「準備中」を表示 (枠だけ先に作る方針)
 *  - 成功で /api/stripe/card-confirm を呼び card_on_file=true にし onDone()
 *
 * バウチャー画面など複数箇所から使い回せるよう、表示は最小限のカード内に収める。
 */

async function authHeader(): Promise<Record<string, string>> {
  const sb = getBrowserSupabase()
  const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// publishableKey ごとに Stripe をロード (再マウントでも 1 回)
let _stripePromise: Promise<StripeJs | null> | null = null
let _stripeKey = ""
function stripeFor(pk: string): Promise<StripeJs | null> {
  if (!_stripePromise || _stripeKey !== pk) {
    _stripeKey = pk
    _stripePromise = loadStripe(pk)
  }
  return _stripePromise
}

function CardForm({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    setError("")
    const { error: confirmErr, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    })
    if (confirmErr) {
      setError(confirmErr.message || "カード登録に失敗しました。")
      setSubmitting(false)
      return
    }
    // サーバーで既定カード設定 + card_on_file 更新
    try {
      const res = await fetch("/api/stripe/card-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ setupIntentId: setupIntent?.id }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "カード登録の確定に失敗しました。")
        setSubmitting(false)
        return
      }
      onDone()
    } catch {
      setError("カード登録の確定に失敗しました。")
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <PaymentElement />
      {error && <p className="text-[13px] text-red-600" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !stripe}
          className="flex-1 h-11 rounded-xl bg-[#0F172A] text-white text-[14px] font-bold flex items-center justify-center gap-2 hover:bg-[#1E293B] disabled:opacity-50"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "カードを登録する"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="h-11 px-4 rounded-xl border border-[#CBD5E1] text-[13px] text-[#475569] hover:bg-[#F8FAFC]"
          >
            あとで
          </button>
        )}
      </div>
    </form>
  )
}

export function AgencyCardSetup({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "unavailable" | "error">("idle")
  const [clientSecret, setClientSecret] = useState("")
  const [pk, setPk] = useState("")
  const [error, setError] = useState("")

  const begin = async () => {
    setState("loading")
    setError("")
    try {
      const res = await fetch("/api/stripe/setup-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || "カード登録の準備に失敗しました。")
        setState("error")
        return
      }
      if (!data.available) {
        setState("unavailable")
        return
      }
      setClientSecret(data.clientSecret)
      setPk(data.publishableKey)
      setState("ready")
    } catch {
      setError("カード登録の準備に失敗しました。")
      setState("error")
    }
  }

  if (state === "unavailable") {
    return (
      <p className="text-[13px] text-[#64748B] leading-relaxed">
        カード登録は現在準備中です。バウチャー発行時に改めてご案内します。
      </p>
    )
  }

  if (state === "ready" && clientSecret && pk) {
    return (
      <Elements stripe={stripeFor(pk)} options={{ clientSecret, appearance: { theme: "stripe" } }}>
        <CardForm onDone={onDone} onCancel={onCancel} />
      </Elements>
    )
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => void begin()}
        disabled={state === "loading"}
        className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-[#C8102E] text-white text-[14px] font-bold hover:bg-[#A00D25] disabled:opacity-50"
      >
        {state === "loading" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <CreditCard className="w-4 h-4" strokeWidth={2} />
        )}
        カードを登録する
      </button>
    </div>
  )
}

export function CardOnFileBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700">
      <Check className="w-3.5 h-3.5" strokeWidth={2.5} /> カード登録済み
    </span>
  )
}
