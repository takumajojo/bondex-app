"use client"

/**
 * B2C の旅行者の予約画面（Stage 2・阪急交通社向けの限定 Beta）。スマホを最優先にした 1列の画面。
 * 料金・選べる日付・ホテルの状態はすべてサーバー（/api/b2c/quote）が計算し、画面は表示するだけ。
 * 予約の下書きの作成（/api/b2c/orders）もサーバーで計算し直す。その後のカード登録は card-step.tsx（Stage 3）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { B2cCardStep, type B2cPendingOrder } from "./card-step"
import { B2C_LANG_EVENT } from "@/components/consent-banner"

type Lang = "en" | "ja"
type HotelStatus = "verified" | "unknown"

interface Candidate {
  placeId: string
  name: string
  address: string
  prefecture: string
  status: HotelStatus
}
interface DateOption {
  pickupDate: string
  deliveryDates: string[]
  earliestDelivery: string
  confirmationMode: "instant" | "awaiting_hotel_verification" | "awaiting_hotel_acceptance"
  confirmationDueAt: string | null
}
interface Price {
  routeClass: "standard" | "okinawa"
  pieces: number
  unitNetYen: number
  subtotalNetYen: number
  taxYen: number
  totalGrossYen: number
}
interface QuoteRes {
  ok: boolean
  errors: string[]
  origin?: { placeId: string; status: HotelStatus }
  dest?: { placeId: string; status: HotelStatus }
  transitDays?: number
  price?: Price
  options: DateOption[]
}

const T = {
  en: {
    lang: "日本語",
    via: (r: string) => `For ${r} travelers`,
    title: "Send your luggage to your next hotel",
    lead: "Leave your bags at the front desk. We deliver them to your next hotel. You pay only after Sagawa picks them up.",
    s1: "Where are your bags now?",
    s1h: "The hotel where Sagawa picks up your bags",
    s2: "Where should we deliver them?",
    s2h: "Your next hotel",
    search: "Hotel name",
    searchPh: "Type your hotel name",
    noResult: "No hotels found. Try the English or Japanese name.",
    checkIn: "Check-in",
    checkOut: "Check-out",
    change: "Change",
    verified: "Checked by BondEx: staffed front desk, accepts luggage",
    unknown: "Not yet checked by BondEx. We will confirm with the hotel before your booking is confirmed.",
    s3: "How many bags?",
    s3h: "Suitcases up to 160 cm (length + width + height). Valuables are not covered — keep them with you.",
    s4: "Pickup and delivery",
    s4h: "Only dates we can actually deliver are shown.",
    pickupDay: "Pickup day (bags at the front desk by 11:00)",
    deliveryDay: "Delivery day (arrives in the morning)",
    earliest: "Earliest",
    fillFirst: "Choose both hotels and your stay dates first.",
    loading: "Checking dates…",
    noDates: "Sorry — we cannot deliver within these stays. Check the dates, or contact us.",
    instant: "Confirmed right after card registration",
    awaitingVerify: (due: string) => `Not confirmed yet: we will check the hotel by ${due}. If the hotel cannot accept, we cancel at no charge.`,
    awaitingAccept: (due: string) => `Not confirmed yet: we will ask both hotels by ${due}. If a hotel cannot accept, we cancel at no charge.`,
    s5: "Price",
    unit: (n: number, y: string) => `${y} × ${n} bag${n > 1 ? "s" : ""}`,
    tax: "Consumption tax (10%)",
    total: "Total (tax included)",
    payNote: "No charge now. We charge your card only after Sagawa picks up your bags.",
    okinawa: "Okinawa route",
    s6: "Your contact",
    name: "Full name (as on your hotel booking)",
    email: "Email",
    wa: "WhatsApp number with country code",
    waPh: "+31 6 1234 5678",
    waHelp: "We send pickup reminders and urgent updates on WhatsApp.",
    consent: "I agree to the Terms. I understand: valuables are not covered; a hotel may be unable to accept my bags, in which case BondEx cancels at no charge; my card is charged only after pickup.",
    submit: "Continue to card registration",
    submitting: "Saving…",
    errors: {
      invalid_name: "Please enter your name.",
      invalid_email: "Please check your email address.",
      invalid_whatsapp: "Please enter your WhatsApp number starting with + and the country code.",
      consent_required: "Please agree to the Terms.",
      date_not_available: "This date is no longer available. Please choose again.",
      server_error: "Something went wrong. Please try again.",
      invalid_link: "This booking link is not valid. Please ask your travel agent for the correct link.",
      booking_closed: "Booking is currently closed.",
    } as Record<string, string>,
  },
  ja: {
    lang: "English",
    via: (r: string) => `${r}のお客様専用`,
    title: "お荷物を次のホテルへお届けします",
    lead: "ホテルのフロントに預けるだけ。次のホテルへお届けします。お支払いは佐川急便の集荷の後です。",
    s1: "いまお荷物があるホテル",
    s1h: "佐川急便が集荷に伺うホテル",
    s2: "お届け先のホテル",
    s2h: "次にお泊まりのホテル",
    search: "ホテル名",
    searchPh: "ホテル名を入力",
    noResult: "見つかりません。英語名や日本語名でもお試しください。",
    checkIn: "チェックイン",
    checkOut: "チェックアウト",
    change: "変更",
    verified: "BondEx 確認済み：フロントに係員がいて荷物を預かれるホテル",
    unknown: "BondEx が未確認のホテルです。予約の確定の前に、ホテルに確認します。",
    s3: "お荷物の個数",
    s3h: "スーツケースは3辺の合計160cmまで。貴重品は補償の対象外のため、お手元でお持ちください。",
    s4: "集荷日とお届け日",
    s4h: "お届けできる日だけを表示しています。",
    pickupDay: "集荷日（11:00までにフロントへお預けください）",
    deliveryDay: "お届け日（午前中に到着）",
    earliest: "最短",
    fillFirst: "先に両方のホテルと宿泊日を入力してください。",
    loading: "日程を確認しています…",
    noDates: "この宿泊日ではお届けできる日がありません。日程をご確認いただくか、お問い合わせください。",
    instant: "カード登録の後、すぐに予約が確定します",
    awaitingVerify: (due: string) => `まだ確定していません：${due}までにホテルに確認します。受けられない場合は無料で取り消します。`,
    awaitingAccept: (due: string) => `まだ確定していません：${due}までに両方のホテルに確認します。受けられない場合は無料で取り消します。`,
    s5: "料金",
    unit: (n: number, y: string) => `${y} × ${n}個`,
    tax: "消費税（10%）",
    total: "合計（税込）",
    payNote: "いまは請求しません。佐川急便が集荷した後に、登録したカードへ請求します。",
    okinawa: "沖縄の区間",
    s6: "ご連絡先",
    name: "お名前（ホテルの予約と同じ表記）",
    email: "メールアドレス",
    wa: "WhatsApp の番号（国番号から）",
    waPh: "+81 90 1234 5678",
    waHelp: "集荷のリマインドや至急のご連絡を WhatsApp でお送りします。",
    consent: "利用規約に同意します。貴重品は補償の対象外であること、ホテルの都合で受けられない場合は BondEx が無料で取り消すこと、カードへの請求は集荷の後であることを理解しました。",
    submit: "カード登録へ進む",
    submitting: "保存しています…",
    errors: {
      invalid_name: "お名前を入力してください。",
      invalid_email: "メールアドレスをご確認ください。",
      invalid_whatsapp: "WhatsApp の番号を + と国番号から入力してください。",
      consent_required: "利用規約に同意してください。",
      date_not_available: "この日程は選べなくなりました。もう一度お選びください。",
      server_error: "エラーが発生しました。もう一度お試しください。",
      invalid_link: "この予約のリンクは無効です。旅行会社に正しいリンクをご確認ください。",
      booking_closed: "現在、受付を停止しています。",
    } as Record<string, string>,
  },
}

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`

function fmtDate(ymd: string, lang: Lang): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  return d.toLocaleDateString(lang === "ja" ? "ja-JP" : "en-GB", { timeZone: "UTC", month: "short", day: "numeric", weekday: "short" })
}
function fmtDue(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleString(lang === "ja" ? "ja-JP" : "en-GB", { timeZone: "Asia/Tokyo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + (lang === "ja" ? "（日本時間）" : " JST")
}

async function post<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as T
  return { status: res.status, data }
}

function Section({ n, title, help, children, muted }: { n: number; title: string; help?: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <section className={`rounded-2xl border bg-card p-4 shadow-sm sm:p-5 ${muted ? "opacity-60" : ""}`}>
      <div className="mb-3 flex items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{n}</span>
        <div>
          <h2 className="text-base font-semibold leading-snug">{title}</h2>
          {help ? <p className="mt-0.5 text-sm text-muted-foreground">{help}</p> : null}
        </div>
      </div>
      {children}
    </section>
  )
}

function HotelPicker({ token, lang, value, onChange, label, placeholder, serverStatus }: { token: string; lang: Lang; value: Candidate | null; onChange: (c: Candidate | null) => void; label: string; placeholder: string; serverStatus?: HotelStatus }) {
  const t = T[lang]
  const [q, setQ] = useState("")
  const [list, setList] = useState<Candidate[]>([])
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (value) return
    if (timer.current) clearTimeout(timer.current)
    if (q.trim().length < 2) {
      setList([])
      setSearched(false)
      return
    }
    timer.current = setTimeout(async () => {
      setBusy(true)
      const r = await post<{ candidates?: Candidate[] }>("/api/b2c/places", { token, query: q, lang })
      setList(r.data.candidates ?? [])
      setSearched(true)
      setBusy(false)
    }, 450)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [q, lang, token, value])

  if (value) {
    // 表示する状態は、サーバーの見積（/api/b2c/quote）が返した最新の状態を優先する
    const status = serverStatus ?? value.status
    return (
      <div className="rounded-xl border bg-muted/40 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium leading-snug">{value.name}</p>
            <p className="truncate text-xs text-muted-foreground">{value.address}</p>
          </div>
          <button type="button" className="shrink-0 text-sm font-medium underline underline-offset-4" onClick={() => { onChange(null); setQ("") }}>
            {t.change}
          </button>
        </div>
        <p className={`mt-2 rounded-lg px-2.5 py-1.5 text-xs leading-relaxed ${status === "verified" ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" : "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"}`}>
          {status === "verified" ? t.verified : t.unknown}
        </p>
      </div>
    )
  }
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      <Input aria-label={label} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-12 text-base" autoComplete="off" inputMode="search" />
      {busy ? <p className="mt-2 text-sm text-muted-foreground">…</p> : null}
      {list.length > 0 ? (
        <ul className="mt-2 divide-y overflow-hidden rounded-xl border" role="listbox">
          {list.slice(0, 6).map((c) => (
            <li key={c.placeId}>
              <button type="button" className="w-full p-3 text-left active:bg-muted" onClick={() => onChange(c)}>
                <span className="block font-medium leading-snug">{c.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{c.address}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : searched && !busy ? (
        <p className="mt-2 text-sm text-muted-foreground">{t.noResult}</p>
      ) : null}
    </div>
  )
}

function StayDates({ lang, value, onChange }: { lang: Lang; value: { checkIn: string; checkOut: string }; onChange: (v: { checkIn: string; checkOut: string }) => void }) {
  const t = T[lang]
  return (
    <div className="mt-3 grid grid-cols-2 gap-3">
      <label className="text-sm">
        <span className="mb-1 block font-medium">{t.checkIn}</span>
        <Input type="date" aria-label={t.checkIn} className="h-12 text-base" value={value.checkIn} onChange={(e) => onChange({ ...value, checkIn: e.target.value })} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">{t.checkOut}</span>
        <Input type="date" aria-label={t.checkOut} className="h-12 text-base" min={value.checkIn || undefined} value={value.checkOut} onChange={(e) => onChange({ ...value, checkOut: e.target.value })} />
      </label>
    </div>
  )
}

export function B2cBookingForm({ token, referrerName, initialLang }: { token: string; referrerName: string; initialLang: Lang }) {
  const [lang, setLang] = useState<Lang>(initialLang)
  const t = T[lang]
  const [origin, setOrigin] = useState<Candidate | null>(null)
  const [dest, setDest] = useState<Candidate | null>(null)
  const [oStay, setOStay] = useState({ checkIn: "", checkOut: "" })
  const [dStay, setDStay] = useState({ checkIn: "", checkOut: "" })
  const [pieces, setPieces] = useState(1)
  const [quote, setQuote] = useState<QuoteRes | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [pickup, setPickup] = useState("")
  const [delivery, setDelivery] = useState("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [wa, setWa] = useState("")
  const [consent, setConsent] = useState(false)
  const [errs, setErrs] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<B2cPendingOrder | null>(null)

  // 言語の切替を URL（?lang=）にも残す（再読込でも同じ言語・Cookie の案内も同じ言語にする）
  const switchLang = (next: Lang) => {
    setLang(next)
    try {
      const u = new URL(window.location.href)
      u.searchParams.set("lang", next)
      window.history.replaceState(null, "", u.toString())
      window.dispatchEvent(new Event(B2C_LANG_EVENT))
    } catch {
      /* noop */
    }
  }

  // 下書きの後の予約番号と秘密の token はこのタブにだけ残す（再読込・通信の切断の後にカード登録から再開する）
  const storeKey = `b2c-pending:${token}`
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storeKey)
      if (raw) setDone(JSON.parse(raw) as B2cPendingOrder)
    } catch {
      /* 保存できない環境では再開しない */
    }
  }, [storeKey])
  const restart = () => {
    try { sessionStorage.removeItem(storeKey) } catch { /* noop */ }
    setDone(null)
  }

  const ready = !!(origin && dest && oStay.checkIn && oStay.checkOut && dStay.checkIn && dStay.checkOut)

  const runQuote = useCallback(async () => {
    if (!ready || !origin || !dest) return
    setQuoting(true)
    const r = await post<QuoteRes>("/api/b2c/quote", { token, originPlaceId: origin.placeId, destPlaceId: dest.placeId, origin: oStay, dest: dStay, pieces })
    setQuote(r.data)
    setQuoting(false)
    const first = r.data.options?.[0]
    setPickup((cur) => (r.data.options?.some((o) => o.pickupDate === cur) ? cur : first?.pickupDate ?? ""))
  }, [ready, origin, dest, oStay, dStay, pieces, token])

  useEffect(() => {
    const id = setTimeout(runQuote, 250)
    return () => clearTimeout(id)
  }, [runQuote])

  const opt = useMemo(() => quote?.options.find((o) => o.pickupDate === pickup) ?? null, [quote, pickup])
  useEffect(() => {
    if (!opt) return setDelivery("")
    setDelivery((cur) => (opt.deliveryDates.includes(cur) ? cur : opt.earliestDelivery))
  }, [opt])

  const submit = async () => {
    setErrs([])
    setSubmitting(true)
    const r = await post<{ ok?: boolean; errors?: string[]; error?: string; orderNumber?: number; accessToken?: string; totalGrossYen?: number }>("/api/b2c/orders", {
      token, originPlaceId: origin?.placeId, destPlaceId: dest?.placeId, origin: oStay, dest: dStay, pieces,
      pickupDate: pickup, deliveryDate: delivery, name, email, whatsapp: wa, language: lang, consent,
    })
    setSubmitting(false)
    if (r.data.ok && r.data.orderNumber && r.data.accessToken && r.data.totalGrossYen) {
      const pending = { orderNumber: r.data.orderNumber, accessToken: r.data.accessToken, totalGrossYen: r.data.totalGrossYen }
      try { sessionStorage.setItem(storeKey, JSON.stringify(pending)) } catch { /* noop */ }
      setDone(pending)
      window.scrollTo({ top: 0, behavior: "smooth" })
      return
    }
    setErrs(r.data.errors ?? [r.data.error ?? "server_error"])
    if ((r.data.errors ?? []).includes("date_not_available")) runQuote()
    setTimeout(() => document.getElementById("b2c-errors")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50)
  }

  const header = (
    <header className="mb-4 flex items-center justify-between">
      <div>
        <p className="text-lg font-bold tracking-tight">BondEx</p>
        <p className="text-xs text-muted-foreground">{t.via(referrerName)}</p>
      </div>
      <button type="button" className="rounded-full border px-3 py-1.5 text-sm font-medium" onClick={() => switchLang(lang === "en" ? "ja" : "en")}>
        {t.lang}
      </button>
    </header>
  )

  if (done) {
    return (
      <main className="mx-auto min-h-dvh max-w-md bg-background px-4 py-6">
        {header}
        <B2cCardStep token={token} lang={lang} order={done} onRestart={restart} />
      </main>
    )
  }

  const p = quote?.price
  const modeText = opt
    ? opt.confirmationMode === "instant"
      ? t.instant
      : opt.confirmationMode === "awaiting_hotel_verification"
        ? t.awaitingVerify(fmtDue(opt.confirmationDueAt ?? "", lang))
        : t.awaitingAccept(fmtDue(opt.confirmationDueAt ?? "", lang))
    : ""

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-background px-4 pb-32 pt-6 sm:max-w-xl">
      {header}
      <h1 className="text-2xl font-bold leading-tight tracking-tight">{t.title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t.lead}</p>

      <div className="mt-5 space-y-4">
        <Section n={1} title={t.s1} help={t.s1h}>
          <HotelPicker token={token} lang={lang} value={origin} onChange={setOrigin} label={t.search} placeholder={t.searchPh} serverStatus={quote?.origin?.placeId === origin?.placeId ? quote?.origin?.status : undefined} />
          <StayDates lang={lang} value={oStay} onChange={setOStay} />
        </Section>

        <Section n={2} title={t.s2} help={t.s2h}>
          <HotelPicker token={token} lang={lang} value={dest} onChange={setDest} label={t.search} placeholder={t.searchPh} serverStatus={quote?.dest?.placeId === dest?.placeId ? quote?.dest?.status : undefined} />
          <StayDates lang={lang} value={dStay} onChange={setDStay} />
        </Section>

        <Section n={3} title={t.s3} help={t.s3h}>
          <div className="flex items-center gap-4">
            <Button type="button" variant="outline" className="h-12 w-12 text-xl" disabled={pieces <= 1} onClick={() => setPieces(pieces - 1)} aria-label="-">−</Button>
            <span className="min-w-8 text-center text-2xl font-semibold tabular-nums" aria-live="polite">{pieces}</span>
            <Button type="button" variant="outline" className="h-12 w-12 text-xl" disabled={pieces >= 10} onClick={() => setPieces(pieces + 1)} aria-label="+">+</Button>
          </div>
        </Section>

        <Section n={4} title={t.s4} help={t.s4h} muted={!ready}>
          {!ready ? (
            <p className="text-sm text-muted-foreground">{t.fillFirst}</p>
          ) : quoting && !quote ? (
            <p className="text-sm text-muted-foreground">{t.loading}</p>
          ) : quote && quote.options.length === 0 ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{t.noDates}</p>
          ) : quote ? (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium">{t.pickupDay}</p>
                <div className="flex flex-wrap gap-2">
                  {quote.options.map((o) => (
                    <button key={o.pickupDate} type="button" onClick={() => setPickup(o.pickupDate)}
                      className={`h-11 rounded-full border px-4 text-sm font-medium ${pickup === o.pickupDate ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>
                      {fmtDate(o.pickupDate, lang)}
                    </button>
                  ))}
                </div>
              </div>
              {opt ? (
                <div>
                  <p className="mb-2 text-sm font-medium">{t.deliveryDay}</p>
                  <div className="flex flex-wrap gap-2">
                    {opt.deliveryDates.map((d, i) => (
                      <button key={d} type="button" onClick={() => setDelivery(d)}
                        className={`h-11 rounded-full border px-4 text-sm font-medium ${delivery === d ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>
                        {fmtDate(d, lang)}{i === 0 ? ` · ${t.earliest}` : ""}
                      </button>
                    ))}
                  </div>
                  <p className={`mt-3 rounded-lg px-3 py-2 text-sm leading-relaxed ${opt.confirmationMode === "instant" ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" : "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"}`}>
                    {modeText}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </Section>

        <Section n={5} title={t.s5} muted={!p}>
          {p ? (
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt>{t.unit(p.pieces, yen(p.unitNetYen))}{p.routeClass === "okinawa" ? ` (${t.okinawa})` : ""}</dt><dd className="tabular-nums">{yen(p.subtotalNetYen)}</dd></div>
              <div className="flex justify-between text-muted-foreground"><dt>{t.tax}</dt><dd className="tabular-nums">{yen(p.taxYen)}</dd></div>
              <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>{t.total}</dt><dd className="tabular-nums">{yen(p.totalGrossYen)}</dd></div>
              <p className="pt-1 text-xs text-muted-foreground">{t.payNote}</p>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{t.fillFirst}</p>
          )}
        </Section>

        <Section n={6} title={t.s6}>
          <div className="space-y-3">
            <label className="block text-sm"><span className="mb-1 block font-medium">{t.name}</span>
              <Input className="h-12 text-base" aria-label={t.name} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
            <label className="block text-sm"><span className="mb-1 block font-medium">{t.email}</span>
              <Input className="h-12 text-base" aria-label={t.email} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
            <label className="block text-sm"><span className="mb-1 block font-medium">{t.wa}</span>
              <Input className="h-12 text-base" aria-label={t.wa} type="tel" inputMode="tel" placeholder={t.waPh} value={wa} onChange={(e) => setWa(e.target.value)} autoComplete="tel" />
              <span className="mt-1 block text-xs text-muted-foreground">{t.waHelp}</span></label>
          </div>
        </Section>

        <label className="flex items-start gap-3 rounded-2xl border bg-card p-4 text-sm leading-relaxed">
          <input type="checkbox" aria-label={t.consent} className="mt-1 h-5 w-5 shrink-0" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{t.consent}</span>
        </label>

        {errs.length > 0 ? (
          <ul id="b2c-errors" className="space-y-1 rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100" role="alert">
            {errs.map((e) => <li key={e}>{t.errors[e] ?? t.errors.server_error}</li>)}
          </ul>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 p-4 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3 sm:max-w-xl">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{t.total}</p>
            <p className="text-lg font-semibold tabular-nums">{p ? yen(p.totalGrossYen) : "—"}</p>
          </div>
          <Button type="button" className="h-12 flex-1 text-base" disabled={!opt || !delivery || submitting} onClick={submit}>
            {submitting ? t.submitting : t.submit}
          </Button>
        </div>
      </div>
    </main>
  )
}
