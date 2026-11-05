"use client"

/**
 * B2C のカード登録の画面（Stage 3）。予約の下書きの後に表示する。
 *
 * - カードの番号は Stripe の入力欄（Payment Element）から直接 Stripe に送られ、BondEx のサーバーには来ない。
 * - 登録の結果は必ずサーバー（/api/b2c/card/status）に照合させる。画面の判定で「確定」と表示しない。
 * - 通信が切れても、予約番号と秘密の token をこのタブ（sessionStorage）に残しているので、開き直すと照合から再開する。
 * - カード登録の成功は予約の確定ではない。サーバーが返した予約の状態（confirmed / awaiting_hotel_confirmation）で表示を分ける。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js"
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js"
import { Button } from "@/components/ui/button"
import { B2C_CARD_CONSENT_TEXT, b2cCardChargeTerms, b2cLegalPath } from "@/lib/b2c/legal-text"

type Lang = "en" | "ja"

export interface B2cPendingOrder {
  orderNumber: number
  accessToken: string
  totalGrossYen: number
}

interface StatusView {
  orderNumber: number
  status: string
  cardStatus: string
  confirmationMode: string
  confirmationDueAt: string | null
  totalGrossYen: number
  card?: { brand: string; last4: string }
  cardError?: string
}

const T = {
  en: {
    title: "Register your card",
    orderNo: (n: number) => `Request number ${n}`,
    noCharge: "Nothing is charged now.",
    whenCharged: (y: string) => b2cCardChargeTerms("en", y),
    consent: B2C_CARD_CONSENT_TEXT.en,
    terms: "Terms of Service",
    cancel: "Cancellation Policy",
    start: "Enter card",
    starting: "Preparing…",
    register: "Register card",
    registering: "Checking your card…",
    checking: "Confirming with the card company… Please keep this page open.",
    checkingSlow: "This is taking longer than usual. Your card registration is saved even if the connection drops. We will update this page automatically.",
    secure: "Your card number goes directly to Stripe, our payment provider. BondEx does not store it.",
    brands: "Accepted cards: Visa, Mastercard, JCB, American Express, Diners Club, Discover. UnionPay is not accepted.",
    confirmedTitle: "Your booking is confirmed",
    confirmedBody: "Leave your bags at the front desk by 11:00 on the pickup day. We will send the details by email.",
    awaitingTitle: "Card registered — booking not yet confirmed",
    awaitingBody: (due: string) => `We are checking with the hotel(s). We will confirm by ${due}. If a hotel cannot accept your bags, we cancel at no charge.`,
    reviewTitle: "Card registered — our team will contact you",
    reviewBody: "Your card was registered after the booking deadline. Our team will check and contact you. Nothing has been charged.",
    cancelledTitle: "This request has expired",
    cancelledBody: "The time for card registration ran out, so the request was cancelled. Nothing has been charged. Please book again.",
    cardOnFile: (b: string, l: string) => `Card: ${b.toUpperCase()} •••• ${l}`,
    again: "Start a new booking",
    myBooking: "View your booking (save this link)",
    errors: {
      card_consent_required: "Please tick the box to continue.",
      quote_changed: "The price has changed. Please book again.",
      date_not_available: "This date is no longer available (it may be full). Please book again and choose another date.",
      too_close_to_deadline: "It is too close to the booking deadline for this date. Please book again and choose another date.",
      capacity_full: "This pickup date has just become full. Please book again and choose another date.",
      order_cancelled: "This request has expired. Please book again.",
      order_not_found: "We could not find this request. Please book again.",
      card_unavailable: "Card registration is temporarily unavailable. Please try again later.",
      server_error: "Something went wrong. Please try again.",
      temporarily_unavailable: "Our system is temporarily busy. Your booking is safe — please wait a moment and try again. Do not book again.",
      network: "Connection problem. Please check your internet and try again.",
      card_failed: "Your card could not be registered. Please try another card.",
      cvc_check_failed: "The security code (CVC) could not be verified, so we cannot accept this card. Please try another card.",
    } as Record<string, string>,
  },
  ja: {
    title: "カードの登録",
    orderNo: (n: number) => `受付番号 ${n}`,
    noCharge: "いまは請求されません。",
    whenCharged: (y: string) => b2cCardChargeTerms("ja", y),
    consent: B2C_CARD_CONSENT_TEXT.ja,
    terms: "利用規約",
    cancel: "キャンセル規定",
    start: "カードを入力する",
    starting: "準備しています…",
    register: "カードを登録する",
    registering: "カードを確認しています…",
    checking: "カード会社に確認しています…このページを開いたままお待ちください。",
    checkingSlow: "確認に時間がかかっています。通信が切れても登録は保存されます。このページは自動で更新されます。",
    secure: "カードの番号は決済会社の Stripe に直接送られます。BondEx は保存しません。",
    brands: "使えるカード: Visa・Mastercard・JCB・American Express・Diners Club・Discover。銀聯（UnionPay）は使えません。",
    confirmedTitle: "予約が確定しました",
    confirmedBody: "集荷日の 11:00 までにホテルのフロントへお預けください。詳しくはメールでお送りします。",
    awaitingTitle: "カードを登録しました（予約はまだ確定していません）",
    awaitingBody: (due: string) => `ホテルに確認しています。${due}までに確定のご連絡をします。ホテルが受けられない場合は、無料で取り消します。`,
    reviewTitle: "カードを登録しました（担当者からご連絡します）",
    reviewBody: "予約の締切の後にカードの登録が終わりました。担当者が確認してご連絡します。まだ請求はされていません。",
    cancelledTitle: "この受付は期限が切れました",
    cancelledBody: "カード登録の時間が過ぎたため、受付を取り消しました。請求はされていません。お手数ですが、もう一度ご予約ください。",
    cardOnFile: (b: string, l: string) => `カード：${b.toUpperCase()} •••• ${l}`,
    again: "最初から予約する",
    myBooking: "予約の確認ページを開く（このリンクを保存してください）",
    errors: {
      card_consent_required: "チェックを入れてください。",
      quote_changed: "料金が変わりました。もう一度ご予約ください。",
      date_not_available: "この日程は満枠などで受けられなくなりました。別の日程でもう一度ご予約ください。",
      too_close_to_deadline: "この日程は予約の締切が近いため受けられません。別の日程でもう一度ご予約ください。",
      capacity_full: "この集荷日は満枠になりました。別の日程でもう一度ご予約ください。",
      order_cancelled: "この受付は期限が切れました。もう一度ご予約ください。",
      order_not_found: "受付が見つかりません。もう一度ご予約ください。",
      card_unavailable: "カード登録を一時的に停止しています。時間をおいてお試しください。",
      server_error: "エラーが発生しました。もう一度お試しください。",
      temporarily_unavailable: "ただいま混み合っています。ご予約は保存されています。少し待ってからもう一度お試しください（新しく予約し直さないでください）。",
      network: "通信に問題があります。接続を確かめてもう一度お試しください。",
      card_failed: "このカードは登録できませんでした。別のカードをお試しください。",
      cvc_check_failed: "セキュリティコード（裏面の3桁など）を確認できなかったため、このカードはお受けできません。別のカードをお試しください。",
    } as Record<string, string>,
  },
}

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`
function fmtDue(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleString(lang === "ja" ? "ja-JP" : "en-GB", { timeZone: "Asia/Tokyo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + (lang === "ja" ? "（日本時間）" : " JST")
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

async function post<R>(path: string, body: unknown): Promise<{ status: number; data: R } | null> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    return { status: res.status, data: (await res.json().catch(() => ({}))) as R }
  } catch {
    return null
  }
}

const FINAL = (v: StatusView) => v.status === "confirmed" || v.status === "awaiting_hotel_confirmation" || v.status === "cancelled" || v.cardStatus === "registered"

function CardForm({ lang, onStarted, onSubmitted }: { lang: Lang; onStarted: () => void; onSubmitted: (err?: string) => void }) {
  const t = T[lang]
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async () => {
    if (!stripe || !elements || busy) return
    setBusy(true)
    setError("")
    // Stripe の部品からの返事が来ない場合（3D セキュアで銀行のアプリに切り替わって戻った等）に備え、
    // 確認を始めた時点からサーバーにも結果を問い合わせる（onStarted）。どちらか早い方で結果を表示する。
    onStarted()
    const { error: e } = await stripe.confirmSetup({ elements, redirect: "if_required" })
    setBusy(false)
    if (e) {
      // カードの拒否・3D セキュアの失敗など。Stripe の文はカードの情報を含まない（言語は Elements の locale）。
      setError(e.message ?? t.errors.card_failed)
      onSubmitted(e.type === "card_error" || e.type === "validation_error" ? e.code ?? "card_failed" : "network")
      return
    }
    onSubmitted()
  }
  return (
    <div className="space-y-4">
      <PaymentElement options={{ layout: "tabs", wallets: { applePay: "never", googlePay: "never" } }} />
      {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">{error}</p> : null}
      <Button type="button" className="h-12 w-full text-base" disabled={!stripe || busy} onClick={submit}>
        {busy ? t.registering : t.register}
      </Button>
    </div>
  )
}

export function B2cCardStep({ token, lang, order, onRestart }: { token: string; lang: Lang; order: B2cPendingOrder; onRestart: () => void }) {
  const t = T[lang]
  const [consent, setConsent] = useState(false)
  const [starting, setStarting] = useState(false)
  const [intent, setIntent] = useState<{ clientSecret: string; publishableKey: string } | null>(null)
  const [view, setView] = useState<StatusView | null>(null)
  const [error, setError] = useState("")
  const [checking, setChecking] = useState(false)
  const [slow, setSlow] = useState(false)
  const alive = useRef(true)
  // 表示中の印。開き直し（開発時の React の二重の実行・画面の戻り）の時に必ず true に戻す
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const auth = { token, orderNumber: order.orderNumber, accessToken: order.accessToken }

  /** サーバーに照合させる。登録の結果が出るまで、間隔をあけて数回くり返す（通信が切れても続ける）。 */
  const run = useRef(0)
  /**
   * サーバーに照合させる。
   * once: 1回だけ（開き直した時・カードの失敗の後の同期）
   * untilFinal: 登録の結果が出るまで、間隔をあけてくり返す（通信が切れても続ける）
   * watch: カードの確認の最中。Stripe の部品の返事を待たずに、サーバーが登録を確認できたら結果を出す（失敗は部品の返事で扱う）
   * 新しい照合を始めると、前の照合は止まる。
   */
  const reconcile = useCallback(async (mode: "once" | "untilFinal" | "watch") => {
    const me = ++run.current
    setChecking(true)
    setSlow(false)
    for (let i = 0; alive.current && run.current === me; i++) {
      const r = await post<{ ok?: boolean; view?: StatusView; error?: string }>("/api/b2c/card/status", auth)
      if (r?.data.view) {
        setView(r.data.view)
        if (r.data.view.cardError === "cvc_check_failed") {
          // 受け付けなかったカード。入力欄を閉じ、もう一度「カードを入力する」から新しい登録を始めてもらう
          setIntent(null)
          setConsent(true)
          setError("cvc_check_failed")
          break
        }
        if (run.current !== me) break
        if (mode === "once" || FINAL(r.data.view)) break
        if (mode === "untilFinal" && r.data.view.cardStatus === "failed") break
      } else if (r && r.status === 404) {
        setError("order_not_found")
        break
      }
      if (i === 5 && mode === "untilFinal") setSlow(true)
      await new Promise((res) => setTimeout(res, Math.min(2000 + i * 1000, 10000)))
    }
    if (run.current === me) setChecking(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, order.orderNumber, order.accessToken])

  // 開き直した時（通信の切断・再読込）は、まず今の状態を照合する
  useEffect(() => {
    reconcile("once")
  }, [reconcile])

  const start = async () => {
    setError("")
    if (!consent) return setError("card_consent_required")
    setStarting(true)
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await post<{ ok?: boolean; error?: string; clientSecret?: string; publishableKey?: string; alreadyRegistered?: boolean; view?: StatusView }>(
        "/api/b2c/card/start",
        { ...auth, cardConsent: true },
      )
      if (!r) { setError("network"); break }
      if (r.data.ok && r.data.clientSecret && r.data.publishableKey) {
        setIntent({ clientSecret: r.data.clientSecret, publishableKey: r.data.publishableKey })
        if (r.data.view) setView(r.data.view)
        break
      }
      if (r.data.ok && r.data.alreadyRegistered && r.data.view) { setView(r.data.view); break }
      if (r.data.error === "stripe_busy") { await new Promise((res) => setTimeout(res, 1500)); continue }
      setError(r.data.error ?? "server_error")
      break
    }
    setStarting(false)
  }

  const header = (
    <div>
      <h1 className="text-xl font-semibold">{t.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t.orderNo(order.orderNumber)}</p>
    </div>
  )

  // 結果の表示（サーバーが返した予約の状態だけで分ける）
  if (view && (view.status === "cancelled" || view.cardStatus === "registered")) {
    const confirmed = view.status === "confirmed"
    const awaiting = view.status === "awaiting_hotel_confirmation"
    const cancelled = view.status === "cancelled"
    const title = cancelled ? t.cancelledTitle : confirmed ? t.confirmedTitle : awaiting ? t.awaitingTitle : t.reviewTitle
    const body = cancelled ? t.cancelledBody : confirmed ? t.confirmedBody : awaiting ? t.awaitingBody(fmtDue(view.confirmationDueAt ?? "", lang)) : t.reviewBody
    const tone = confirmed ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" : cancelled ? "bg-muted" : "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
    return (
      <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm" data-b2c-result={view.status}>
        <p className="text-sm text-muted-foreground">{t.orderNo(view.orderNumber)}</p>
        <div className={`rounded-xl p-4 ${tone}`}>
          <h1 className="text-lg font-semibold leading-snug">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed">{body}</p>
        </div>
        {!cancelled ? (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt>{lang === "ja" ? "合計（税込・集荷の後に請求）" : "Total (tax incl., charged after pickup)"}</dt><dd className="font-semibold tabular-nums">{yen(view.totalGrossYen)}</dd></div>
            {view.card ? <div className="text-muted-foreground">{t.cardOnFile(view.card.brand, view.card.last4)}</div> : null}
          </dl>
        ) : null}
        {cancelled ? (
          <Button type="button" variant="outline" className="h-12 w-full" onClick={onRestart}>{t.again}</Button>
        ) : confirmed || awaiting ? (
          <a className="block rounded-xl border px-3 py-3 text-center text-sm font-medium underline-offset-2 hover:underline" href={`/my/${order.accessToken}${lang === "ja" ? "?lang=ja" : ""}`} data-my-booking-link>
            {t.myBooking}
          </a>
        ) : null}
      </section>
    )
  }

  const fatal = ["quote_changed", "date_not_available", "too_close_to_deadline", "capacity_full", "order_cancelled", "order_not_found"].includes(error)

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
      {header}
      <div className="rounded-xl bg-emerald-50 p-3 text-sm leading-relaxed text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
        <p className="font-semibold">{t.noCharge}</p>
        <p className="mt-1" data-b2c-charge-terms>{t.whenCharged(yen(order.totalGrossYen))}</p>
        <p className="mt-2 flex flex-wrap gap-x-4">
          <a className="underline underline-offset-2" href={b2cLegalPath("terms", lang)} target="_blank" rel="noopener noreferrer">{t.terms}</a>
          <a className="underline underline-offset-2" href={b2cLegalPath("cancellation", lang)} target="_blank" rel="noopener noreferrer">{t.cancel}</a>
        </p>
      </div>

      <p className="text-sm font-medium" data-card-brands>{t.brands}</p>

      {checking && intent ? (
        <p className="rounded-lg bg-muted p-3 text-sm" aria-live="polite">{slow ? t.checkingSlow : t.checking}</p>
      ) : null}

      {!intent ? (
        <>
          <label className="flex items-start gap-3 text-sm leading-relaxed">
            <input type="checkbox" aria-label={t.consent} className="mt-1 h-5 w-5 shrink-0" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={fatal} />
            <span>{t.consent}</span>
          </label>
          {!fatal ? (
            <Button type="button" className="h-12 w-full text-base" disabled={starting} onClick={start}>{starting ? t.starting : t.start}</Button>
          ) : null}
        </>
      ) : (
        <Elements stripe={stripeFor(intent.publishableKey)} options={{ clientSecret: intent.clientSecret, locale: lang }}>
          <CardForm lang={lang} onStarted={() => reconcile("watch")} onSubmitted={(err) => reconcile(err ? "once" : "untilFinal")} />
        </Elements>
      )}

      {error ? (
        <div role="alert" className="space-y-3 rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">
          <p>{t.errors[error] ?? t.errors.server_error}</p>
          {fatal ? <Button type="button" variant="outline" className="h-11 w-full" onClick={onRestart}>{t.again}</Button> : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{t.secure}</p>
    </section>
  )
}
