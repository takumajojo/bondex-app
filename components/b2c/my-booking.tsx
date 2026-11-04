"use client"

/**
 * My Booking（旅行者の予約の確認ページ・Stage 4）。秘密のリンクで開く。スマホ優先の 1列。
 * 予約・配送・決済の状態はサーバー（lib/b2c/my-booking.ts）が決め、画面は旅行者の言葉に読み替えて出すだけ。
 * 確認待ちの間は「確定」「集荷」を約束する表現を使わない。取消は集荷の前日 18:30 まで（サーバーでも確かめる）。
 * 佐川へ集荷依頼済みの予約は、取消を申請として受け付け、佐川の確認後に BondEx が確定する（それまでは予約のまま）。
 */
import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { MyBookingView } from "@/lib/b2c/my-booking"

type Lang = "ja" | "en"
const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`
function day(ymd: string, lang: Lang) {
  const d = new Date(`${ymd}T12:00:00Z`)
  return lang === "ja"
    ? d.toLocaleDateString("ja-JP", { timeZone: "UTC", month: "long", day: "numeric", weekday: "short" })
    : d.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
}
function due(iso: string, lang: Lang) {
  return new Date(iso).toLocaleString(lang === "ja" ? "ja-JP" : "en-GB", { timeZone: "Asia/Tokyo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + (lang === "ja" ? "（日本時間）" : " JST")
}

const STAGE: Record<Lang, Record<MyBookingView["stage"], { title: string; tone: "ok" | "wait" | "muted" | "bad" }>> = {
  ja: {
    card_pending: { title: "カードの登録が終わっていません", tone: "wait" },
    awaiting_hotel: { title: "受付済み・ホテルに確認中（まだ確定していません）", tone: "wait" },
    confirmed: { title: "予約が確定しています", tone: "ok" },
    picked_up: { title: "佐川急便が集荷しました", tone: "ok" },
    in_transit: { title: "配送中です", tone: "ok" },
    delivered: { title: "お届けしました", tone: "ok" },
    completed: { title: "完了しました", tone: "ok" },
    cancelled: { title: "取り消し済みです", tone: "muted" },
    problem: { title: "配送で確認が必要なことがあります。BondEx からご連絡します", tone: "bad" },
  },
  en: {
    card_pending: { title: "Card registration is not finished", tone: "wait" },
    awaiting_hotel: { title: "Request received — confirming with hotel (not confirmed yet)", tone: "wait" },
    confirmed: { title: "Your booking is confirmed", tone: "ok" },
    picked_up: { title: "Sagawa has picked up your bags", tone: "ok" },
    in_transit: { title: "Your bags are on the way", tone: "ok" },
    delivered: { title: "Delivered", tone: "ok" },
    completed: { title: "Completed", tone: "ok" },
    cancelled: { title: "Cancelled", tone: "muted" },
    problem: { title: "There is an issue with the delivery. BondEx will contact you", tone: "bad" },
  },
}
const PAY: Record<Lang, Record<MyBookingView["payment"], string>> = {
  ja: {
    no_card: "カード未登録（請求はありません）",
    card_registered_not_charged: "カード登録済み・まだ請求していません（集荷の後に請求します）",
    charge_scheduled: "集荷を確認しました。まもなく請求します",
    charged: "お支払い済み",
    charge_failed: "お支払いを完了できませんでした。下のボタンからお支払いください",
    refunded: "返金しました",
    not_charged_cancelled: "取消のため請求はありません",
  },
  en: {
    no_card: "No card registered (no charge)",
    card_registered_not_charged: "Card registered — not charged yet (we charge after pickup)",
    charge_scheduled: "Pickup confirmed — payment will be processed shortly",
    charged: "Paid",
    charge_failed: "Payment could not be completed. Please pay with the button below",
    refunded: "Refunded",
    not_charged_cancelled: "Cancelled — no charge",
  },
}
const CANCEL_REASON: Record<Lang, Record<string, string>> = {
  ja: { guest: "お客様のご依頼による取消", hotel_refused: "ホテルでお預かりできないための取消", hotel_unsupported: "ホテルでお預かりできないための取消", confirmation_timeout: "期限までにホテルの確認が取れなかったための取消", card_timeout: "カードの登録が完了しなかったための取消", ops: "BondEx による取消" },
  en: { guest: "Cancelled at your request", hotel_refused: "Cancelled — the hotel cannot hold the bags", hotel_unsupported: "Cancelled — the hotel cannot hold the bags", confirmation_timeout: "Cancelled — we could not confirm with the hotel in time", card_timeout: "Cancelled — card registration was not finished", ops: "Cancelled by BondEx" },
}

const T = {
  ja: {
    lang: "English", orderNo: "受付番号", pickup: "集荷", delivery: "お届け", bags: "個数", price: "料金", payment: "お支払い",
    by11: "11:00 までにフロントへ", morning: "お届け", unit: (n: number, u: string) => `${u} × ${n}個`, tax: "消費税", total: "合計（税込）",
    stay: (a: string, b: string) => `宿泊 ${a} 〜 ${b}`,
    awaitingNote: (d: string) => `${d}までにホテルに確認し、確定したらメールと WhatsApp でお知らせします。確定するまで、お荷物をフロントに預けないでください。期限までに確定できない場合は自動で取り消し、料金は一切かかりません。`,
    guideTitle: "集荷の日にすること",
    guide: ["11:00 までに、お荷物をホテルのフロントに預けてください。", "「BondEx の配送で、佐川急便が集荷に来ます」とお伝えください。送り状は佐川急便が持参します。", "貴重品・壊れやすい物・現金・パスポートはお荷物に入れず、お手元でお持ちください（補償の対象外です）。"],
    frontDesk: "ホテルのスタッフ向けの案内を開く（フロントでお見せください）",
    tracking: "佐川急便の問い合わせ番号", cancelTitle: "予約の取消", cancelUntil: (d: string) => `${d} まで取り消せます。料金はかかりません。`,
    cancelBtn: "この予約を取り消す", cancelConfirm: "本当に取り消しますか？ 取り消すと元に戻せません。", cancelYes: "取り消す", cancelNo: "やめる",
    cancelClosed: "取消の期限を過ぎました。変更・取消はお問い合わせください。", contact: "お問い合わせ",
    cancelRequested: "取消のお申し込みを受け付けました。集荷の手配が済んでいるため、佐川急便に確認してから取消を確定し、メールでお知らせします。確定するまでは、ご予約はそのままです。料金はかかりません。",
    errors: { too_late: "取消の期限を過ぎました。お問い合わせください。", not_cancellable: "集荷の後のため、ここでは取り消せません。お問い合わせください。", temporarily_unavailable: "ただいま混み合っています。少し待ってからお試しください。", server_error: "エラーが発生しました。もう一度お試しください。" } as Record<string, string>,
  },
  en: {
    lang: "日本語", orderNo: "Request number", pickup: "Pickup", delivery: "Delivery", bags: "Bags", price: "Price", payment: "Payment",
    by11: "Front desk by 11:00", morning: "Delivery", unit: (n: number, u: string) => `${u} × ${n}`, tax: "Consumption tax", total: "Total (tax incl.)",
    stay: (a: string, b: string) => `Stay ${a} – ${b}`,
    awaitingNote: (d: string) => `We are checking with the hotel(s) and will let you know by email and WhatsApp by ${d}. Please do not leave your bags at the front desk until the booking is confirmed. If we cannot confirm by then, the request is cancelled automatically at no charge.`,
    guideTitle: "On pickup day",
    guide: ["Leave your bags at the hotel front desk by 11:00.", "Tell the staff: \"BondEx delivery — Sagawa will pick these up.\" Sagawa brings the shipping labels.", "Keep valuables, fragile items, cash and your passport with you. They are not covered."],
    frontDesk: "Open the note for the hotel staff (show it at the front desk)",
    tracking: "Sagawa tracking number", cancelTitle: "Cancel booking", cancelUntil: (d: string) => `You can cancel free of charge until ${d}.`,
    cancelBtn: "Cancel this booking", cancelConfirm: "Are you sure? This cannot be undone.", cancelYes: "Yes, cancel", cancelNo: "Keep booking",
    cancelClosed: "The cancellation deadline has passed. Please contact us to change or cancel.", contact: "Contact",
    cancelRequested: "We have received your cancellation request. Your pickup has already been arranged, so we will confirm with Sagawa first and then email you when the cancellation is complete. Until then, your booking stays as it is. There is no charge.",
    errors: { too_late: "The cancellation deadline has passed. Please contact us.", not_cancellable: "Your bags have already been picked up. Please contact us.", temporarily_unavailable: "Our system is busy. Please try again in a moment.", server_error: "Something went wrong. Please try again." } as Record<string, string>,
  },
}

export function B2cMyBooking({ token, view, initialLang, supportEmail }: { token: string; view: MyBookingView; initialLang: Lang; supportEmail: string }) {
  const [lang, setLang] = useState<Lang>(initialLang)
  const [v, setV] = useState(view)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")
  const t = T[lang]
  const st = STAGE[lang][v.stage]
  const tone = { ok: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100", wait: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100", muted: "bg-muted", bad: "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100" }[st.tone]
  // 英語の表示は英語のホテル名・住所（無ければ日本語）。日本語の表示は日本語
  const hn = (h: MyBookingView["origin"]) => (lang === "en" && h.nameEn ? h.nameEn : h.name)
  const ha = (h: MyBookingView["origin"]) => (lang === "en" && h.addressEn ? h.addressEn : h.address)
  const showGuide = ["confirmed", "picked_up", "in_transit"].includes(v.stage)

  const cancel = async () => {
    setBusy(true)
    setErr("")
    try {
      const res = await fetch("/api/b2c/my/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; cancelRequested?: boolean }
      if (data.ok && data.cancelRequested) {
        // 集荷依頼済み: 取消申請を受け付けただけ。予約はまだ取り消されていない
        setV({ ...v, canCancel: false, cancelRequested: true })
        setAsking(false)
      } else if (data.ok) {
        setV({ ...v, stage: "cancelled", canCancel: false, cancelReason: "guest", payment: "not_charged_cancelled" })
        setAsking(false)
      } else setErr(data.error ?? "server_error")
    } catch {
      setErr("server_error")
    }
    setBusy(false)
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-background px-4 pb-16 pt-6 sm:max-w-xl" data-my-stage={v.stage}>
      <header className="mb-4 flex items-center justify-between">
        <p className="text-lg font-bold tracking-tight">BondEx</p>
        <button type="button" className="rounded-full border px-3 py-1.5 text-sm font-medium" onClick={() => setLang(lang === "en" ? "ja" : "en")}>{t.lang}</button>
      </header>

      <section className={`rounded-2xl p-4 ${tone}`}>
        <p className="text-xs opacity-80">{t.orderNo} {v.orderNumber}</p>
        <h1 className="mt-1 text-lg font-semibold leading-snug">{st.title}</h1>
        {v.stage === "awaiting_hotel" && v.confirmationDueAt ? <p className="mt-2 text-sm leading-relaxed">{t.awaitingNote(due(v.confirmationDueAt, lang))}</p> : null}
        {v.stage === "cancelled" && v.cancelReason ? <p className="mt-2 text-sm">{CANCEL_REASON[lang][v.cancelReason] ?? ""}</p> : null}
      </section>

      {v.payNeeded ? (
        <section className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50" data-my-pay-banner>
          <p className="font-semibold">{lang === "ja" ? "お支払いの手続きが必要です" : "Payment needed"}</p>
          <p className="mt-1 leading-relaxed">{lang === "ja" ? "ご登録のカードでお支払いができませんでした。本人認証または別のカードでお支払いください。" : "We could not take the payment with your registered card. Please confirm it or pay with another card."}</p>
          <a className="mt-3 block rounded-xl bg-foreground px-3 py-3 text-center font-semibold text-background" href={`/my/${token}/pay${lang === "ja" ? "?lang=ja" : ""}`}>
            {lang === "ja" ? "お支払いのページへ" : "Go to payment"}
          </a>
        </section>
      ) : null}

      <section className="mt-4 space-y-3 rounded-2xl border bg-card p-4 text-sm shadow-sm">
        <div>
          <p className="text-xs text-muted-foreground">{t.pickup}</p>
          <p className="font-medium">{day(v.pickupDate, lang)} · {t.by11}</p>
          <p>{hn(v.origin)}</p>
          <p className="text-xs text-muted-foreground">{ha(v.origin)}</p>
        </div>
        <div className="border-t pt-3">
          <p className="text-xs text-muted-foreground">{t.delivery}</p>
          <p className="font-medium">{day(v.deliveryDate, lang)}</p>
          <p>{hn(v.dest)}</p>
          <p className="text-xs text-muted-foreground">{ha(v.dest)} · {t.stay(v.dest.checkIn, v.dest.checkOut)}</p>
        </div>
        <div className="flex justify-between border-t pt-3"><span>{t.bags}</span><span className="font-medium">{v.pieces}</span></div>
        {v.trackingNumbers.length ? <div className="flex justify-between border-t pt-3"><span>{t.tracking}</span><span className="font-mono">{v.trackingNumbers.join(", ")}</span></div> : null}
      </section>

      <section className="mt-4 space-y-1.5 rounded-2xl border bg-card p-4 text-sm shadow-sm">
        <p className="text-xs text-muted-foreground">{t.price}</p>
        <div className="flex justify-between"><span>{t.unit(v.pieces, yen(v.unitNetYen))}</span><span className="tabular-nums">{yen(v.subtotalNetYen)}</span></div>
        <div className="flex justify-between text-muted-foreground"><span>{t.tax}</span><span className="tabular-nums">{yen(v.taxYen)}</span></div>
        <div className="flex justify-between border-t pt-2 text-base font-semibold"><span>{t.total}</span><span className="tabular-nums">{yen(v.totalGrossYen)}</span></div>
        <p className="pt-2 text-xs text-muted-foreground">{t.payment}</p>
        <p data-my-payment={v.payment}>{PAY[lang][v.payment]}</p>
        {v.payNeeded ? (
          <a data-my-pay-link className="mt-2 block rounded-xl bg-foreground px-3 py-3 text-center font-semibold text-background" href={`/my/${token}/pay${lang === "ja" ? "?lang=ja" : ""}`}>
            {lang === "ja" ? "お支払いのページへ" : "Go to payment"}
          </a>
        ) : null}
      </section>

      {showGuide ? (
        <section className="mt-4 rounded-2xl border bg-card p-4 text-sm shadow-sm">
          <h2 className="font-semibold">{t.guideTitle}</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 leading-relaxed">{t.guide.map((g) => <li key={g}>{g}</li>)}</ol>
          <a className="mt-3 block rounded-xl border px-3 py-3 text-center font-medium underline-offset-2 hover:underline" href={`/my/${token}/frontdesk${lang === "ja" ? "?lang=ja" : ""}`}>{t.frontDesk}</a>
        </section>
      ) : null}

      {v.stage !== "cancelled" && ["card_pending", "awaiting_hotel", "confirmed"].includes(v.stage) ? (
        <section className="mt-4 rounded-2xl border bg-card p-4 text-sm shadow-sm">
          <h2 className="font-semibold">{t.cancelTitle}</h2>
          {v.canCancel ? (
            <>
              <p className="mt-1 text-muted-foreground">{t.cancelUntil(due(v.cancelDeadline, lang))}</p>
              {!asking ? (
                <Button type="button" variant="outline" className="mt-3 h-11 w-full" onClick={() => setAsking(true)}>{t.cancelBtn}</Button>
              ) : (
                <div className="mt-3 space-y-2" role="alertdialog" aria-label={t.cancelConfirm}>
                  <p className="font-medium">{t.cancelConfirm}</p>
                  <div className="flex gap-2">
                    <Button type="button" variant="destructive" className="h-11 flex-1" disabled={busy} onClick={cancel}>{t.cancelYes}</Button>
                    <Button type="button" variant="outline" className="h-11 flex-1" disabled={busy} onClick={() => setAsking(false)}>{t.cancelNo}</Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="mt-1 text-muted-foreground" data-my-cancel-requested={v.cancelRequested ? "1" : undefined}>{v.cancelRequested ? t.cancelRequested : t.cancelClosed}</p>
          )}
          {err ? <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-red-900 dark:bg-red-950 dark:text-red-100">{t.errors[err] ?? t.errors.server_error}</p> : null}
        </section>
      ) : null}

      <p className="mt-6 text-center text-xs text-muted-foreground">{t.contact}: <a className="underline" href={`mailto:${supportEmail}`}>{supportEmail}</a></p>
    </main>
  )
}
