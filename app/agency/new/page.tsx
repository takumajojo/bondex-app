"use client"

import { useEffect, useState, Fragment, type FormEvent, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Loader2, Check, Plus, Trash2, ArrowLeft, Info,
  ClipboardList, CalendarClock, PackageCheck, MailCheck, ChevronRight, FolderOpen,
  UploadCloud, Sparkles,
} from "lucide-react"
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
    autoHeading: "Auto-fill from an itinerary",
    autoBody: "Upload the itinerary (PDF or image) and we'll read the hotels, dates and lead traveler into the form below. You can edit anything afterward.",
    autoButton: "Upload itinerary",
    autoParsing: "Reading the itinerary…",
    autoDone: "Loaded — please review the fields below.",
    autoErr: "Couldn't read the itinerary. Please fill in the form manually.",
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
    flowHeading: "How it works",
    flow: [
      { title: "Register request", sub: "Enter the itinerary (you are here)", key: false },
      { title: "Until 1 month before shipping", sub: "Yamato labels can't be created earlier", key: true },
      { title: "BondEx issues the documents", sub: "Voucher + Yamato labels", key: false },
      { title: "Drive folder shared to your email", sub: "Open the voucher & labels inside", key: true },
    ],
    monthNote:
      "Yamato labels can only be created from one month before the ship date. Once it's within a month we'll prepare everything and share a Google Drive folder with your registered email — the voucher and labels will be inside.",
    doneTitle: "Request received",
    doneBooking: "Booking number",
    doneShareHeading: "How you'll receive the documents",
    doneWait:
      "Yamato labels can only be created from one month before shipping. Once your ship date is within a month, we'll prepare everything and share a Google Drive folder with your registered email. The voucher and Yamato labels will be inside.",
    doneSoon:
      "We'll prepare everything and share a Google Drive folder with your registered email. The voucher and Yamato labels will be inside.",
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
    autoHeading: "旅程表から自動入力",
    autoBody: "旅程表（PDF・画像）をアップロードすると、ホテル・日付・代表者を読み取って下のフォームに反映します。読み取り後は自由に修正できます。",
    autoButton: "旅程表を読み込む",
    autoParsing: "旅程表を読み取り中…",
    autoDone: "読み込みました。下の内容をご確認ください。",
    autoErr: "旅程表を読み取れませんでした。お手数ですが手入力でお願いします。",
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
    flowHeading: "この後の流れ",
    flow: [
      { title: "発行依頼を登録", sub: "旅程を入力（今ここ）", key: false },
      { title: "出荷1ヶ月前まで", sub: "ヤマト伝票は1ヶ月前から発行", key: true },
      { title: "BondExが書類を発行", sub: "バウチャー＋ヤマト伝票", key: false },
      { title: "Driveフォルダをメールで共有", sub: "中の書類をご利用ください", key: true },
    ],
    monthNote:
      "ヤマトの伝票（送り状）は出荷日の1ヶ月前からしか発行できません。1ヶ月前になりましたら書類一式をご用意し、ご登録のメールアドレス宛に Google Drive フォルダを共有します（中にバウチャー・ヤマト伝票が入ります）。",
    doneTitle: "発行依頼を受け付けました",
    doneBooking: "予約番号",
    doneShareHeading: "書類の受け取り方法",
    doneWait:
      "ヤマトの伝票（送り状）は出荷の1ヶ月前からしか発行できません。出荷日の1ヶ月前になりましたら書類一式をご用意し、ご登録のメールアドレス宛に Google Drive フォルダを共有します。フォルダの中にバウチャー・ヤマト伝票が入っています。",
    doneSoon:
      "書類一式をご用意し、ご登録のメールアドレス宛に Google Drive フォルダを共有します。フォルダの中にバウチャー・ヤマト伝票が入っています。",
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
  const [parsing, setParsing] = useState(false)
  const [parseNote, setParseNote] = useState("")
  const [parseError, setParseError] = useState("")

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

  // 旅程表 (PDF/画像) を AI 解析してフォームに反映。発行はしないので課金なし。
  const onParseFile = async (file: File) => {
    setParseError("")
    setParseNote("")
    setParsing(true)
    try {
      const sb = getBrowserSupabase()
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
      if (!token) {
        setParseError(t.notLoggedIn)
        return
      }
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/agency/itinerary/parse", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        guest?: { travelerCount?: number; travelers?: Array<{ name?: string; title?: string }> }
        shipments?: Array<{
          shipmentDate?: string
          expectedArrival?: string
          from?: { hotel?: string }
          to?: { hotel?: string }
          recipient?: string
        }>
      }
      if (!res.ok) {
        setParseError(data.error || t.autoErr)
        return
      }
      const ships = Array.isArray(data.shipments) ? data.shipments : []
      if (ships.length === 0) {
        setParseError(t.autoErr)
        return
      }
      const ymd = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "")
      const firstTraveler = data.guest?.travelers?.[0]
      const rep =
        ships[0]?.recipient ||
        (firstTraveler ? [firstTraveler.title, firstTraveler.name].filter(Boolean).join(" ").trim() : "")
      if (rep) setRepresentative(rep)
      const tc = Number(data.guest?.travelerCount) || (data.guest?.travelers?.length ?? 0)
      if (tc >= 1) setTravelerCount(tc)
      setLegs(
        ships.map((s) => ({
          fromHotel: s.from?.hotel || "",
          toHotel: s.to?.hotel || "",
          shipmentDate: ymd(s.shipmentDate),
          expectedArrival: ymd(s.expectedArrival) || ymd(s.shipmentDate),
          recipient: s.recipient || "",
          suitcaseCount: 1, // 旅程表には個数が無いことが多い → 既定 1、後で修正
          notes: "",
        })),
      )
      setParseNote(t.autoDone)
    } catch {
      setParseError(t.autoErr)
    } finally {
      setParsing(false)
    }
  }

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
      <main className="min-h-screen bg-slate-50 px-6 py-10">
        <div className="w-full max-w-2xl mx-auto space-y-5">
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
              <Check className="w-6 h-6 text-emerald-700" strokeWidth={2.5} />
            </div>
            <h1 className="text-[18px] font-bold text-[#0F172A]">{t.doneTitle}</h1>
            <p className="text-[12px] text-muted-foreground mt-3">{t.doneBooking}</p>
            <p className="font-mono text-[15px] text-[#0F172A]">{result.bookingId}</p>
          </div>

          {/* 書類の受け取り方法 — 大きく強調 */}
          <div className="rounded-2xl border-2 border-[#FED7AA] bg-[#FFF7ED] p-6">
            <div className="flex items-center gap-2 mb-3">
              <FolderOpen className="w-5 h-5 text-[#C8102E]" strokeWidth={2} />
              <p className="text-[15px] font-bold text-[#9A3412]">{t.doneShareHeading}</p>
            </div>
            <p className="text-[14px] text-[#7C2D12] leading-[2]">
              {result.needsLabelWait ? t.doneWait : t.doneSoon}
            </p>
          </div>

          <FlowDiagram heading={t.flowHeading} steps={t.flow} />

          <div className="text-center">
            <Link
              href="/agency"
              className="inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-xl bg-[#0F172A] text-white text-[14px] font-bold hover:bg-[#1E293B]"
            >
              {t.doneBack}
            </Link>
          </div>
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

        <div className="mb-6">
          <FlowDiagram heading={t.flowHeading} steps={t.flow} />
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
          {/* 旅程表の AI 自動読み込み (任意) */}
          <div className="rounded-2xl border border-dashed border-[#C8102E]/40 bg-[#FFF5F6] p-5">
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-9 h-9 rounded-full bg-[#C8102E]/10 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-[#C8102E]" strokeWidth={1.9} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-[#0F172A]">{t.autoHeading}</p>
                <p className="text-[12px] text-[#64748B] mt-1 leading-relaxed">{t.autoBody}</p>
                <label
                  className={`inline-flex items-center gap-2 mt-3 h-10 px-4 rounded-xl text-[13px] font-bold text-white ${
                    parsing ? "bg-[#94A3B8] cursor-wait" : "bg-[#0F172A] hover:bg-[#1E293B] cursor-pointer"
                  }`}
                >
                  {parsing ? (
                    <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
                  ) : (
                    <UploadCloud className="w-4 h-4" strokeWidth={2} />
                  )}
                  {parsing ? t.autoParsing : t.autoButton}
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    disabled={parsing}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void onParseFile(f)
                      e.target.value = ""
                    }}
                  />
                </label>
                {parseNote && (
                  <p className="text-[12px] text-emerald-700 mt-2 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" strokeWidth={2} />
                    {parseNote}
                  </p>
                )}
                {parseError && <p className="text-[12px] text-red-600 mt-2">{parseError}</p>}
              </div>
            </div>
          </div>

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

const FLOW_ICONS = [ClipboardList, CalendarClock, PackageCheck, MailCheck]

function FlowDiagram({
  heading,
  steps,
}: {
  heading: string
  steps: ReadonlyArray<{ title: string; sub: string; key: boolean }>
}) {
  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5">
      <p className="text-[12px] font-semibold text-[#334155] mb-4">{heading}</p>
      <div className="flex flex-col md:flex-row md:items-stretch gap-2">
        {steps.map((s, i) => {
          const Icon = FLOW_ICONS[i] ?? ClipboardList
          return (
            <Fragment key={i}>
              <div
                className={`flex-1 rounded-xl p-3 flex md:flex-col items-center md:text-center gap-3 md:gap-2 ${
                  s.key ? "bg-[#FFF7ED] border border-[#FED7AA]" : "bg-[#F8FAFC] border border-[#E5E7EB]"
                }`}
              >
                <div
                  className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
                    s.key ? "bg-[#C8102E] text-white" : "bg-white border border-[#CBD5E1] text-[#475569]"
                  }`}
                >
                  <Icon className="w-4 h-4" strokeWidth={1.9} />
                </div>
                <div className="min-w-0">
                  <p className={`text-[12px] font-bold ${s.key ? "text-[#9A3412]" : "text-[#0F172A]"}`}>
                    <span className="mr-1 text-[10px] font-mono opacity-60">{i + 1}</span>
                    {s.title}
                  </p>
                  <p className="text-[11px] text-[#64748B] mt-0.5 leading-snug">{s.sub}</p>
                </div>
              </div>
              {i < steps.length - 1 && (
                <div className="flex items-center justify-center text-[#CBD5E1]" aria-hidden>
                  <ChevronRight className="w-4 h-4 rotate-90 md:rotate-0" strokeWidth={2.2} />
                </div>
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
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
