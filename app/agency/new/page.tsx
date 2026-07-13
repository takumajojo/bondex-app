"use client"

import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Loader2, Check, Plus, Trash2, ArrowLeft, Info } from "lucide-react"
import { getBrowserSupabase } from "@/lib/supabase-browser"
import { useAgencyLocale, AgencyLocaleToggle } from "@/lib/agency-i18n"

type Leg = {
  fromHotel: string
  toHotel: string
  shipmentDate: string
  expectedArrival: string
  recipient: string
  suitcaseCount: number
  notes: string
}

const emptyLeg = (): Leg => ({
  fromHotel: "",
  toHotel: "",
  shipmentDate: "",
  expectedArrival: "",
  recipient: "",
  suitcaseCount: 1,
  notes: "",
})

const GUEST_LANGS: Array<[string, string]> = [
  ["en", "English"],
  ["zh", "中文"],
  ["it", "Italiano"],
  ["fr", "Français"],
  ["es", "Español"],
]

const messages = {
  en: {
    back: "Back to portal",
    badge: "New issuance request",
    title: "Register a booking",
    lead: "Enter the trip details. BondEx will prepare the voucher and Yamato labels and share a Google Drive folder link here — no label is issued (or charged) at this step.",
    representative: "Lead traveler name",
    representativePlaceholder: "e.g. John Smith",
    tourNumber: "Your booking number",
    tourNumberPlaceholder: "e.g. JPT2607-045 (your own reference)",
    travelerCount: "Travelers",
    guestLanguage: "Voucher language (for the traveler)",
    legHeading: "Leg",
    fromHotel: "From (hotel / pickup)",
    toHotel: "To (hotel / delivery)",
    shipmentDate: "Ship date",
    expectedArrival: "Arrival date",
    recipient: "Recipient (optional)",
    recipientPlaceholder: "Defaults to the delivery hotel front desk",
    suitcases: "Suitcases",
    notes: "Notes (optional)",
    addLeg: "Add leg",
    removeLeg: "Remove",
    submit: "Submit request",
    submitting: "Submitting…",
    monthNote:
      "Yamato labels can only be created within one month of the ship date. If your ship date is further out, we'll prepare everything and contact you once it's within a month.",
    doneTitle: "Request received",
    doneBooking: "Booking number",
    doneWait:
      "Your ship date is more than a month away. Yamato labels can only be created within one month, so we'll prepare all documents and share the Drive folder link here once it's within a month. We've emailed you a confirmation.",
    doneSoon:
      "We'll prepare the voucher and Yamato labels and share the Google Drive folder link here shortly. We've emailed you a confirmation.",
    doneBack: "Back to portal",
    errGeneric: "Could not register the request. Please try again.",
    errNetwork: "Network error. Please check your connection.",
    notLoggedIn: "Your session expired. Please sign in again.",
  },
  ja: {
    back: "ポータルに戻る",
    badge: "新規発行依頼",
    title: "発行依頼を登録",
    lead: "旅程をご入力ください。BondEx がバウチャーとヤマト伝票を用意し、Google Drive フォルダのリンクをこちらでご案内します。この段階では送り状は発行されません（課金もありません）。",
    representative: "代表者名",
    representativePlaceholder: "例: 山田 太郎 / John Smith",
    tourNumber: "貴社の予約番号",
    tourNumberPlaceholder: "例: JPT2607-045（貴社管理用の番号）",
    travelerCount: "人数",
    guestLanguage: "バウチャー言語（お客様向け）",
    legHeading: "区間",
    fromHotel: "発送元（ホテル・集荷）",
    toHotel: "お届け先（ホテル・配達）",
    shipmentDate: "発送日",
    expectedArrival: "到着日",
    recipient: "受取人（任意）",
    recipientPlaceholder: "未入力ならお届け先ホテルのフロント宛",
    suitcases: "個数",
    notes: "備考（任意）",
    addLeg: "区間を追加",
    removeLeg: "削除",
    submit: "発行依頼を送信",
    submitting: "送信中…",
    monthNote:
      "ヤマトの送り状は出荷日の1ヶ月前から発行可能です。発送日が1ヶ月以上先の場合は、1ヶ月前になりましたら書類一式をご用意しご連絡します。",
    doneTitle: "発行依頼を受け付けました",
    doneBooking: "予約番号",
    doneWait:
      "発送日が1ヶ月以上先です。ヤマトの送り状は1ヶ月前からしか発行できないため、1ヶ月前になりましたら書類一式をご用意し、Drive フォルダのリンクをこちらでご案内します。確認メールをお送りしました。",
    doneSoon:
      "バウチャーとヤマト伝票を用意し、Google Drive フォルダのリンクをこちらでまもなくご案内します。確認メールをお送りしました。",
    doneBack: "ポータルに戻る",
    errGeneric: "発行依頼の登録に失敗しました。もう一度お試しください。",
    errNetwork: "通信エラーです。接続をご確認ください。",
    notLoggedIn: "セッションが切れました。再度サインインしてください。",
  },
} as const

const inputCls =
  "w-full h-11 rounded-xl border border-[#CBD5E1] px-3 text-[14px] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#C8102E]/40 focus:border-[#C8102E]"

export default function AgencyNewBookingPage() {
  const router = useRouter()
  const { locale, setLocale } = useAgencyLocale()
  const t = messages[locale]
  const [authChecked, setAuthChecked] = useState(false)
  const [representative, setRepresentative] = useState("")
  const [tourNumber, setTourNumber] = useState("")
  const [travelerCount, setTravelerCount] = useState(1)
  const [guestLanguage, setGuestLanguage] = useState("en")
  const [legs, setLegs] = useState<Leg[]>([emptyLeg()])
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle")
  const [error, setError] = useState("")
  const [result, setResult] = useState<{ bookingId: string; needsLabelWait: boolean } | null>(null)

  useEffect(() => {
    const sb = getBrowserSupabase()
    if (!sb) {
      setAuthChecked(true)
      return
    }
    void sb.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/agency/login?next=/agency/new")
      else setAuthChecked(true)
    })
  }, [router])

  const updateLeg = (i: number, patch: Partial<Leg>) =>
    setLegs((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  const addLeg = () => setLegs((prev) => [...prev, emptyLeg()])
  const removeLeg = (i: number) => setLegs((prev) => prev.filter((_, idx) => idx !== i))

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError("")
    setStatus("submitting")
    try {
      const sb = getBrowserSupabase()
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
      if (!token) {
        setError(t.notLoggedIn)
        setStatus("error")
        return
      }
      const res = await fetch("/api/agency/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ representative, tourNumber, travelerCount, guestLanguage, legs }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || t.errGeneric)
        setStatus("error")
        return
      }
      setResult({ bookingId: data.bookingId, needsLabelWait: Boolean(data.needsLabelWait) })
      setStatus("done")
    } catch {
      setError(t.errNetwork)
      setStatus("error")
    }
  }

  if (!authChecked) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" strokeWidth={1.5} />
      </main>
    )
  }

  if (status === "done" && result) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
        <div className="w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-white p-8 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
            <Check className="w-6 h-6 text-emerald-700" strokeWidth={2.5} />
          </div>
          <h1 className="text-[18px] font-bold text-[#0F172A]">{t.doneTitle}</h1>
          <p className="text-[12px] text-muted-foreground mt-3">{t.doneBooking}</p>
          <p className="font-mono text-[15px] text-[#0F172A]">{result.bookingId}</p>
          <p className="text-[13px] text-[#475569] mt-3 leading-[1.9]">
            {result.needsLabelWait ? t.doneWait : t.doneSoon}
          </p>
          <Link
            href="/agency"
            className="inline-flex items-center justify-center gap-1.5 mt-6 h-11 px-5 rounded-xl bg-[#0F172A] text-white text-[14px] font-bold hover:bg-[#1E293B]"
          >
            {t.doneBack}
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Link
            href="/agency"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
            {t.back}
          </Link>
          <AgencyLocaleToggle locale={locale} onChange={setLocale} />
        </div>

        <div className="mb-6">
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">{t.badge}</p>
          <h1 className="text-[22px] font-bold text-[#0F172A] mt-1">{t.title}</h1>
          <p className="text-[13px] text-[#64748B] mt-2 leading-relaxed">{t.lead}</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
          {/* 予約全体の情報 */}
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5 md:p-6 grid md:grid-cols-2 gap-4">
            <Field label={t.representative} htmlFor="rep" required>
              <input id="rep" className={inputCls} value={representative}
                onChange={(e) => setRepresentative(e.target.value)} required
                placeholder={t.representativePlaceholder} autoComplete="off" />
            </Field>
            <Field label={t.tourNumber} htmlFor="tour">
              <input id="tour" className={inputCls} value={tourNumber}
                onChange={(e) => setTourNumber(e.target.value)}
                placeholder={t.tourNumberPlaceholder} autoComplete="off" />
            </Field>
            <Field label={t.travelerCount} htmlFor="tc">
              <input id="tc" type="number" min={1} max={99} className={inputCls} value={travelerCount}
                onChange={(e) => setTravelerCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
            </Field>
            <Field label={t.guestLanguage} htmlFor="gl">
              <select id="gl" className={inputCls} value={guestLanguage}
                onChange={(e) => setGuestLanguage(e.target.value)}>
                {GUEST_LANGS.map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* 区間 */}
          {legs.map((leg, i) => (
            <div key={i} className="rounded-2xl border border-[#E5E7EB] bg-white p-5 md:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-[#334155]">
                  {t.legHeading} {i + 1}
                </p>
                {legs.length > 1 && (
                  <button type="button" onClick={() => removeLeg(i)}
                    className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700">
                    <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                    {t.removeLeg}
                  </button>
                )}
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <Field label={t.fromHotel} htmlFor={`from${i}`} required>
                  <input id={`from${i}`} className={inputCls} value={leg.fromHotel}
                    onChange={(e) => updateLeg(i, { fromHotel: e.target.value })} required />
                </Field>
                <Field label={t.toHotel} htmlFor={`to${i}`} required>
                  <input id={`to${i}`} className={inputCls} value={leg.toHotel}
                    onChange={(e) => updateLeg(i, { toHotel: e.target.value })} required />
                </Field>
                <Field label={t.shipmentDate} htmlFor={`sd${i}`} required>
                  <input id={`sd${i}`} type="date" className={inputCls} value={leg.shipmentDate}
                    onChange={(e) => updateLeg(i, { shipmentDate: e.target.value })} required />
                </Field>
                <Field label={t.expectedArrival} htmlFor={`ea${i}`} required>
                  <input id={`ea${i}`} type="date" className={inputCls} value={leg.expectedArrival}
                    min={leg.shipmentDate || undefined}
                    onChange={(e) => updateLeg(i, { expectedArrival: e.target.value })} required />
                </Field>
                <Field label={t.recipient} htmlFor={`rc${i}`}>
                  <input id={`rc${i}`} className={inputCls} value={leg.recipient}
                    onChange={(e) => updateLeg(i, { recipient: e.target.value })}
                    placeholder={t.recipientPlaceholder} />
                </Field>
                <Field label={t.suitcases} htmlFor={`sc${i}`} required>
                  <input id={`sc${i}`} type="number" min={1} max={50} className={inputCls}
                    value={leg.suitcaseCount}
                    onChange={(e) => updateLeg(i, { suitcaseCount: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                    required />
                </Field>
              </div>
              <Field label={t.notes} htmlFor={`nt${i}`}>
                <input id={`nt${i}`} className={inputCls} value={leg.notes}
                  onChange={(e) => updateLeg(i, { notes: e.target.value })} />
              </Field>
            </div>
          ))}

          <button type="button" onClick={addLeg}
            className="inline-flex items-center gap-1.5 text-sm text-[#C8102E] font-medium hover:underline">
            <Plus className="w-4 h-4" strokeWidth={2} />
            {t.addLeg}
          </button>

          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" strokeWidth={1.6} />
            <p className="text-[12px] text-amber-900 leading-relaxed">{t.monthNote}</p>
          </div>

          {error && <p className="text-[13px] text-red-600" role="alert">{error}</p>}

          <button type="submit" disabled={status === "submitting" || !representative}
            className="w-full h-12 rounded-xl bg-[#C8102E] text-white text-[14px] font-bold flex items-center justify-center gap-2 hover:bg-[#A00D25] disabled:opacity-50 disabled:cursor-not-allowed">
            {status === "submitting" ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} /> : t.submit}
          </button>
        </form>
      </div>
    </main>
  )
}

function Field({ label, htmlFor, required, children }: {
  label: string; htmlFor: string; required?: boolean; children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-[#334155]">
        {label}
        {required && <span className="text-[#C8102E] ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}
