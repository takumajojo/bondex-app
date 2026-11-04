"use client"

/**
 * 旅行者の支払のページ（Stage 5・`/my/<秘密の token>/pay`）。lib/b2c/pay-service.ts。
 * 集荷の後の請求ができなかった時（本人認証が必要・カードが使えない）に、同じ請求を本人認証または別のカードで払う。
 * 金額はサーバーの値だけを表示する。カード情報は Stripe の部品の中だけで扱い、こちらのサーバーには来ない。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { Button } from "@/components/ui/button"

type Lang = "ja" | "en"
interface PayResp {
  ok: boolean
  error?: string
  state?: "pay" | "paid" | "checking" | "nothing_due"
  orderNumber?: number
  language?: Lang
  amountYen?: number
  reason?: string | null
  clientSecret?: string
  piStatus?: string
  publishableKey?: string
}

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`

const T = {
  ja: {
    title: "お支払い",
    orderNo: (n: number) => `受付番号 ${n}`,
    amount: "お支払いの額（税込）",
    picked: "佐川急便がお荷物を集荷しました。ご登録のカードでお支払いができなかったため、こちらでお支払いください。お荷物の配送は続けています。",
    reasons: {
      authentication_required: "カード会社による本人認証が必要です。",
      insufficient_funds: "カードの利用可能額が足りませんでした。",
      expired_card: "カードの有効期限が切れています。",
      lost_card: "このカードは使えません。別のカードでお支払いください。",
      stolen_card: "このカードは使えません。別のカードでお支払いください。",
      card_declined: "カード会社にお支払いを断られました。",
      generic_decline: "カード会社にお支払いを断られました。",
      do_not_honor: "カード会社にお支払いを断られました。",
    } as Record<string, string>,
    reasonOther: "ご登録のカードでお支払いができませんでした。",
    authenticate: "本人認証してお支払い",
    otherCard: "別のカードで払う",
    pay: (y: string) => `${y} を支払う`,
    paying: "処理しています…",
    paid: "お支払いを受け付けました。ありがとうございます。",
    checking: "お支払いの結果を確認しています。このままお待ちください（再読み込みしても二重には請求されません）。",
    nothing: "いまお支払いいただくものはありません。",
    notFound: "このリンクは無効です。",
    error: "通信の問題が起きました。もう一度お試しください（二重には請求されません）。",
    back: "ご予約の確認へ戻る",
    secure: "カード情報は決済代行の Stripe が扱い、BondEx のサーバーには保存されません。",
    brands: "使えるカード: Visa・Mastercard・JCB・American Express・Diners Club・Discover。銀聯（UnionPay）は使えません。",
  },
  en: {
    title: "Payment",
    orderNo: (n: number) => `Request number ${n}`,
    amount: "Amount (tax included)",
    picked: "Sagawa has picked up your bags. We could not take the payment with your registered card, so please pay here. Your bags are still being delivered.",
    reasons: {
      authentication_required: "Your card issuer needs you to confirm this payment.",
      insufficient_funds: "Your card did not have enough available credit.",
      expired_card: "Your card has expired.",
      lost_card: "This card cannot be used. Please pay with another card.",
      stolen_card: "This card cannot be used. Please pay with another card.",
      card_declined: "Your card issuer declined the payment.",
      generic_decline: "Your card issuer declined the payment.",
      do_not_honor: "Your card issuer declined the payment.",
    } as Record<string, string>,
    reasonOther: "We could not take the payment with your registered card.",
    authenticate: "Confirm and pay",
    otherCard: "Pay with another card",
    pay: (y: string) => `Pay ${y}`,
    paying: "Processing…",
    paid: "Payment received. Thank you.",
    checking: "We are checking the payment result. Please wait (reloading will not charge you twice).",
    nothing: "There is nothing to pay right now.",
    notFound: "This link is not valid.",
    error: "Connection problem. Please try again (you will not be charged twice).",
    back: "Back to my booking",
    secure: "Card details are handled by Stripe, our payment provider, and are not stored on BondEx servers.",
    brands: "Accepted cards: Visa, Mastercard, JCB, American Express, Diners Club, Discover. UnionPay is not accepted.",
  },
}

let stripePromise: Promise<StripeJs | null> | null = null
let stripeKey = ""
function stripeFor(pk: string) {
  if (!stripePromise || stripeKey !== pk) {
    stripeKey = pk
    stripePromise = loadStripe(pk)
  }
  return stripePromise
}

async function post(path: string, token: string): Promise<PayResp | null> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
    return (await res.json().catch(() => ({ ok: false, error: "server_error" }))) as PayResp
  } catch {
    return null
  }
}

function PayForm({ lang, amountYen, piStatus, clientSecret, onDone }: { lang: Lang; amountYen: number; piStatus: string; clientSecret: string; onDone: (err?: string) => void }) {
  const t = T[lang]
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [useOther, setUseOther] = useState(piStatus !== "requires_action")
  const authenticate = async () => {
    if (!stripe || busy) return
    setBusy(true)
    setError("")
    const r = await stripe.handleNextAction({ clientSecret })
    setBusy(false)
    if (r.error) {
      setError(r.error.message ?? t.error)
      onDone("card")
      return
    }
    onDone()
  }
  const pay = async () => {
    if (!stripe || !elements || busy) return
    setBusy(true)
    setError("")
    const { error: e } = await stripe.confirmPayment({ elements, redirect: "if_required" })
    setBusy(false)
    if (e) {
      setError(e.message ?? t.error)
      onDone(e.type === "card_error" || e.type === "validation_error" ? "card" : "network")
      return
    }
    onDone()
  }
  return (
    <div className="space-y-4">
      {piStatus === "requires_action" && !useOther ? (
        <>
          <Button type="button" className="h-12 w-full text-base" disabled={!stripe || busy} onClick={authenticate} data-testid="pay-authenticate">
            {busy ? t.paying : t.authenticate}
          </Button>
          <button type="button" className="w-full text-sm underline" onClick={() => setUseOther(true)} data-testid="pay-other-card">
            {t.otherCard}
          </button>
        </>
      ) : (
        <>
          <PaymentElement options={{ layout: "tabs", wallets: { applePay: "never", googlePay: "never" } }} />
          <p className="text-xs text-muted-foreground">{t.brands}</p>
          <Button type="button" className="h-12 w-full text-base" disabled={!stripe || busy} onClick={pay} data-testid="pay-submit">
            {busy ? t.paying : t.pay(yen(amountYen))}
          </Button>
        </>
      )}
      {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">{error}</p> : null}
    </div>
  )
}

export function B2cPayPage({ token, initialLang }: { token: string; initialLang: Lang | null }) {
  const [lang, setLang] = useState<Lang>(initialLang ?? "en")
  const [view, setView] = useState<PayResp | null>(null)
  const [failed, setFailed] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const alive = useRef(true)
  const t = T[lang]

  const load = useCallback(async () => {
    const r = await post("/api/b2c/pay/start", token)
    if (!alive.current) return
    if (!r) return setFailed(true)
    setFailed(false)
    setView(r)
    if (r.language && !initialLang) setLang(r.language)
  }, [token, initialLang])

  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
    }
  }, [load])

  // 支払の後: サーバーに Stripe の結果を反映させ、決まるまで少し待つ
  const afterPay = useCallback(
    async (err?: string) => {
      if (err === "card") {
        // 同じ請求でもう一度（別のカード・やり直し）。状態を取り直す
        await load()
        setFormKey((k) => k + 1)
        return
      }
      for (let i = 0; i < 10 && alive.current; i++) {
        const r = await post("/api/b2c/pay/status", token)
        if (r && r.ok && r.state !== "checking") {
          if (r.state === "pay") await load()
          else setView(r)
          setFormKey((k) => k + 1)
          return
        }
        await new Promise((res) => setTimeout(res, 2000))
      }
      setView((v) => (v ? { ...v, state: "checking" } : v))
    },
    [token, load],
  )

  const myUrl = `/my/${token}${lang === "ja" ? "?lang=ja" : ""}`
  return (
    <main className="mx-auto max-w-lg space-y-5 px-4 py-8" data-pay-state={view ? (view.ok ? view.state : view.error ?? "error") : failed ? "error" : "loading"}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <div className="flex gap-1 text-sm">
          {(["ja", "en"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} className={`rounded px-2 py-1 ${lang === l ? "bg-foreground text-background" : "border"}`}>
              {l === "ja" ? "日本語" : "English"}
            </button>
          ))}
        </div>
      </div>
      {failed ? <p role="alert">{t.error}</p> : null}
      {view && !view.ok && view.error === "not_found" ? <p>{t.notFound}</p> : null}
      {view?.ok && view.orderNumber ? <p className="text-sm text-muted-foreground">{t.orderNo(view.orderNumber)}</p> : null}
      {view?.ok && view.state === "pay" && view.clientSecret && view.publishableKey ? (
        <section className="space-y-4 rounded-xl border p-4">
          <p>{t.picked}</p>
          <p className="font-medium">{(view.reason && t.reasons[view.reason]) || t.reasonOther}</p>
          <p className="flex items-baseline justify-between">
            <span>{t.amount}</span>
            <span className="text-2xl font-semibold" data-testid="pay-amount">{yen(view.amountYen ?? 0)}</span>
          </p>
          <Elements key={formKey} stripe={stripeFor(view.publishableKey)} options={{ clientSecret: view.clientSecret, locale: lang }}>
            <PayForm lang={lang} amountYen={view.amountYen ?? 0} piStatus={view.piStatus ?? ""} clientSecret={view.clientSecret} onDone={afterPay} />
          </Elements>
          <p className="text-xs text-muted-foreground">{t.secure}</p>
        </section>
      ) : null}
      {view?.ok && view.state === "paid" ? <p className="rounded-lg bg-green-50 p-4 text-green-900 dark:bg-green-950 dark:text-green-100" data-testid="pay-paid">{t.paid}</p> : null}
      {view?.ok && view.state === "checking" ? <p className="rounded-lg bg-amber-50 p-4 text-amber-900 dark:bg-amber-950 dark:text-amber-100">{t.checking}</p> : null}
      {view?.ok && view.state === "nothing_due" ? <p>{t.nothing}</p> : null}
      <a className="block text-sm underline" href={myUrl}>
        {t.back}
      </a>
    </main>
  )
}
