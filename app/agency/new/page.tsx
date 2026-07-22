"use client"

import { useEffect, useState, useCallback, useMemo, Fragment, type FormEvent, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { HotelSearchInput, type PlaceCandidate } from "@/components/hotel-search-input"
import {
  Loader2, Check, Plus, Trash2, ArrowLeft, Info,
  ClipboardList, CalendarClock, PackageCheck, MailCheck, ChevronRight, FolderOpen,
  UploadCloud, Sparkles, Download, type LucideIcon,
} from "lucide-react"
import { getBrowserSupabase } from "@/lib/supabase-browser"
import { useAgencyLocale, AgencyLocaleToggle } from "@/lib/agency-i18n"
import { isNextDayEarlySlotRisky } from "@/lib/yamato-delivery"
import { DEFAULT_CARRIER, carrierConfig, slotLabel } from "@/lib/carrier"

type Leg = {
  fromHotel: string
  fromPlaceId: string
  fromCity: string
  toHotel: string
  toPlaceId: string
  toCity: string
  shipmentDate: string
  expectedArrival: string
  fromCheckIn: string
  toCheckOut: string
  deliveryTime: string
  recipient: string
  suitcaseCount: number
  notes: string
}

const emptyLeg = (): Leg => ({
  fromHotel: "",
  fromPlaceId: "",
  fromCity: "",
  toHotel: "",
  toPlaceId: "",
  toCity: "",
  shipmentDate: "",
  expectedArrival: "",
  fromCheckIn: "",
  toCheckOut: "",
  deliveryTime: "before-noon", // 既定は午前中
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
    lead: "Enter the trip details. BondEx will prepare the voucher and shipping labels and share a Google Drive folder link here — no label is issued (or charged) at this step.",
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
    hotelSearchPlaceholder: "Type a hotel name (Google Maps)",
    bookingName: "Booking name (on voucher)",
    bookingNamePlaceholder: "Same as representative if blank",
    groupName: "Group name (optional)",
    groupNamePlaceholder: "e.g. Johnson Family",
    fromCheckIn: "Check-in at pickup hotel (optional)",
    toCheckOut: "Check-out at delivery hotel (optional)",
    deliveryTime: "Delivery time slot",
    nextDayRisk: "For next-day arrival, morning slots may not be guaranteed.",
    deliverySlots: {
      "not-specified": "Not specified",
      "before-noon": "Before noon (recommended)",
      "before-ten": "Before 10:00",
      "before-five": "Before 17:00",
      "14-16": "14:00 – 16:00",
      "16-18": "16:00 – 18:00",
      "18-20": "18:00 – 20:00",
      "19-21": "19:00 – 21:00",
    } as Record<string, string>,
    dupTitle: "Possible duplicate request",
    dupBody: "A request with the same traveler and ship date already exists:",
    dupProceed: "Register anyway",
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
      { title: "Until 1 month before shipping", sub: "shipping labels can't be created earlier", key: true },
      { title: "BondEx issues the documents", sub: "Voucher + shipping labels", key: false },
      { title: "Drive folder shared to your email", sub: "Open the voucher & labels inside", key: true },
    ],
    // 出荷が1ヶ月以内 → その場で発行してすぐDL
    flowSoon: [
      { title: "Register request", sub: "Enter the itinerary (you are here)", key: false },
      { title: "Issued on the spot", sub: "Within a month — voucher + shipping label", key: true },
      { title: "Download immediately", sub: "A copy is kept in the shared Drive", key: true },
    ],
    monthNote:
      "shipping labels can only be created from one month before the ship date. Once it's within a month we'll prepare everything and share a Google Drive folder with your registered email — the voucher and labels will be inside.",
    doneTitle: "Request received",
    doneBooking: "Booking number",
    doneShareHeading: "How you'll receive the documents",
    doneWait:
      "shipping labels can only be created from one month before shipping. Once your ship date is within a month, we'll prepare everything and share a Google Drive folder with your registered email. The voucher and shipping labels will be inside.",
    doneSoon:
      "Your shipment is within a month, so we'll prepare the documents (voucher and shipping labels) right away and share a Google Drive folder with your registered email.",
    doneReadyHeading: "Your documents are ready",
    doneReadyBody:
      "The voucher and shipping label have been issued — download them right below. A copy is also kept in the shared Google Drive.",
    dlVoucher: "Download voucher",
    dlLabel: "Download shipping label",
    dlLeg: (n: number) => `Shipping label (leg ${n})`,
    doneBack: "Back to portal",
    errGeneric: "Could not register the request. Please try again.",
    errNetwork: "Network error. Please check your connection.",
    notLoggedIn: "Your session expired. Please sign in again.",
  },
  ja: {
    back: "ポータルに戻る",
    badge: "新規発行依頼",
    title: "発行依頼を登録",
    lead: "旅程をご入力ください。BondEx がバウチャーと配送伝票を用意し、Google Drive フォルダのリンクをこちらでご案内します。この段階では送り状は発行されません（課金もありません）。",
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
    hotelSearchPlaceholder: "ホテル名を入力（Google マップ検索）",
    bookingName: "予約者名（バウチャー表示）",
    bookingNamePlaceholder: "空欄なら代表者と同じ",
    groupName: "団体名（任意）",
    groupNamePlaceholder: "例: 山田ご一行",
    fromCheckIn: "発送元ホテルのチェックイン日（任意）",
    toCheckOut: "お届け先ホテルのチェックアウト日（任意）",
    deliveryTime: "配達時間帯",
    nextDayRisk: "翌日到着では午前中の指定が難しい場合があります。",
    deliverySlots: {
      "not-specified": "指定なし",
      "before-noon": "午前中（推奨）",
      "before-ten": "10時まで",
      "before-five": "17時まで",
      "14-16": "14時〜16時",
      "16-18": "16時〜18時",
      "18-20": "18時〜20時",
      "19-21": "19時〜21時",
    } as Record<string, string>,
    dupTitle: "重複の可能性があります",
    dupBody: "同じ代表者・同じ発送日の依頼が既にあります：",
    dupProceed: "このまま登録する",
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
      { title: "出荷1ヶ月前まで", sub: "配送伝票は1ヶ月前から発行", key: true },
      { title: "BondExが書類を発行", sub: "バウチャー＋配送伝票", key: false },
      { title: "Driveフォルダをメールで共有", sub: "中の書類をご利用ください", key: true },
    ],
    // 出荷が1ヶ月以内 → その場で発行してすぐDL
    flowSoon: [
      { title: "発行依頼を登録", sub: "旅程を入力（今ここ）", key: false },
      { title: "その場で発行", sub: "1ヶ月以内なので即発行（バウチャー＋伝票）", key: true },
      { title: "すぐにダウンロード", sub: "共有ドライブにも保管します", key: true },
    ],
    monthNote:
      "配送伝票（送り状）は出荷日の1ヶ月前からしか発行できません。1ヶ月前になりましたら書類一式をご用意し、ご登録のメールアドレス宛に Google Drive フォルダを共有します（中にバウチャー・配送伝票が入ります）。",
    doneTitle: "発行依頼を受け付けました",
    doneBooking: "予約番号",
    doneShareHeading: "書類の受け取り方法",
    doneWait:
      "配送伝票（送り状）は出荷の1ヶ月前からしか発行できません。出荷日の1ヶ月前になりましたら書類一式をご用意し、ご登録のメールアドレス宛に Google Drive フォルダを共有します。フォルダの中にバウチャー・配送伝票が入っています。",
    doneSoon:
      "出荷まで1ヶ月以内のため、すぐに書類一式（バウチャー・配送伝票）をご用意し、ご登録のメールアドレス宛に Google Drive フォルダを共有します。",
    doneReadyHeading: "書類の準備ができました",
    doneReadyBody:
      "バウチャーと配送伝票（送り状）を発行しました。下のボタンからすぐにダウンロードできます。共有ドライブにも保管しています。",
    dlVoucher: "バウチャーをダウンロード",
    dlLabel: "送り状をダウンロード",
    dlLeg: (n: number) => `送り状をダウンロード（区間${n}）`,
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
  const [bookingName, setBookingName] = useState("")
  const [groupName, setGroupName] = useState("")
  const [travelerCount, setTravelerCount] = useState(1)
  const [guestLanguage, setGuestLanguage] = useState("en")
  const [legs, setLegs] = useState<Leg[]>([emptyLeg()])
  const [dupMatches, setDupMatches] = useState<
    Array<{ booking_id: string; representative: string; shipment_date: string }>
  >([])
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle")
  const [error, setError] = useState("")
  const [result, setResult] = useState<{
    bookingId: string
    needsLabelWait: boolean
    allIssued: boolean
    labels: Array<{ legIndex: number; url: string }>
  } | null>(null)
  const [dlBusy, setDlBusy] = useState(false)
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

  // ホテル検索 (Google Places) を代理店ルートに Bearer 付きで叩かせる
  const placesAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const sb = getBrowserSupabase()
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
    return token ? { Authorization: `Bearer ${token}` } : {}
  }, [])

  // フロー図の出し分け: 入力中の最短発送日が1ヶ月以内なら「すぐ発行」版を表示。
  // 日付未入力なら1ヶ月ルールを説明する待機版をデフォルト表示。
  const previewNeedsWait = useMemo(() => {
    const dates = legs.map((l) => l.shipmentDate).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    if (dates.length === 0) return true
    const earliest = [...dates].sort()[0]
    const days = Math.round((new Date(`${earliest}T00:00:00`).getTime() - Date.now()) / 86_400_000)
    return days > 30
  }, [legs])

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
          from?: { hotel?: string; city?: string }
          to?: { hotel?: string; city?: string }
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
          fromPlaceId: "", // AI 解析では placeId は付かない → 必要なら候補から選び直す
          fromCity: s.from?.city || "",
          toHotel: s.to?.hotel || "",
          toPlaceId: "",
          toCity: s.to?.city || "",
          shipmentDate: ymd(s.shipmentDate),
          expectedArrival: ymd(s.expectedArrival) || ymd(s.shipmentDate),
          fromCheckIn: "",
          toCheckOut: "",
          deliveryTime: "before-noon",
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

  // 実際の登録 (重複チェックを通過 or「このまま登録」後に呼ぶ)
  const submitBooking = async () => {
    setError("")
    setDupMatches([])
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
        body: JSON.stringify({
          representative,
          tourNumber,
          bookingName,
          groupName,
          travelerCount,
          guestLanguage,
          legs,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || t.errGeneric)
        setStatus("error")
        return
      }
      setResult({
        bookingId: data.bookingId,
        needsLabelWait: Boolean(data.needsLabelWait),
        allIssued: Boolean(data.allIssued),
        labels: Array.isArray(data.labels) ? data.labels : [],
      })
      setStatus("done")
    } catch {
      setError(t.errNetwork)
      setStatus("error")
    }
  }

  // 成功画面からバウチャーを直接DL (代理店 JWT で自社限定エンドポイントを叩く)
  const downloadVoucher = async (bookingId: string) => {
    setDlBusy(true)
    try {
      const sb = getBrowserSupabase()
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
      if (!token) {
        setError(t.notLoggedIn)
        return
      }
      const res = await fetch(`/api/agency/voucher?booking_id=${encodeURIComponent(bookingId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        alert(t.errNetwork)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${bookingId}_voucher.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      alert(t.errNetwork)
    } finally {
      setDlBusy(false)
    }
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError("")
    setDupMatches([])
    // 二重依頼チェック (自社内・警告のみ)。マッチしたら止めて確認を促す。
    try {
      const sb = getBrowserSupabase()
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
      if (token) {
        const dates = Array.from(new Set(legs.map((l) => l.shipmentDate).filter(Boolean)))
        if (representative && dates.length > 0) {
          const res = await fetch("/api/agency/duplicate-check", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ names: [representative], dates }),
          })
          const data = (await res.json().catch(() => ({ matches: [] }))) as {
            matches?: Array<{ booking_id: string; representative: string; shipment_date: string }>
          }
          const matches = Array.isArray(data.matches) ? data.matches : []
          if (matches.length > 0) {
            setDupMatches(matches)
            return // 警告を出して止める (「このまま登録」で submitBooking)
          }
        }
      }
    } catch {
      /* 重複チェック失敗は無視して登録に進む (ベストエフォート) */
    }
    await submitBooking()
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

          {result.allIssued ? (
            /* 1ヶ月以内 → 即発行済み。その場でDL */
            <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-6">
              <div className="flex items-center gap-2 mb-3">
                <Check className="w-5 h-5 text-emerald-700" strokeWidth={2.5} />
                <p className="text-[15px] font-bold text-emerald-900">{t.doneReadyHeading}</p>
              </div>
              <p className="text-[14px] text-emerald-800 leading-[2] mb-4">{t.doneReadyBody}</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => downloadVoucher(result.bookingId)}
                  disabled={dlBusy}
                  className="inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-xl bg-[#C8102E] text-white text-[13px] font-bold hover:bg-[#a00d25] disabled:opacity-50"
                >
                  {dlBusy ? "…" : t.dlVoucher}
                </button>
                {result.labels.map((l) => (
                  <a
                    key={l.legIndex}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-xl border border-[#C8102E] text-[#C8102E] text-[13px] font-bold hover:bg-[#FFF1F2]"
                  >
                    {result.labels.length > 1 ? t.dlLeg(l.legIndex + 1) : t.dlLabel}
                  </a>
                ))}
              </div>
            </div>
          ) : (
            /* 1ヶ月超 → 発行窓の外。窓が開いたら発行してご連絡 */
            <>
              <div className="rounded-2xl border-2 border-[#FED7AA] bg-[#FFF7ED] p-6">
                <div className="flex items-center gap-2 mb-3">
                  <FolderOpen className="w-5 h-5 text-[#C8102E]" strokeWidth={2} />
                  <p className="text-[15px] font-bold text-[#9A3412]">{t.doneShareHeading}</p>
                </div>
                <p className="text-[14px] text-[#7C2D12] leading-[2]">{t.doneWait}</p>
              </div>
              <FlowDiagram heading={t.flowHeading} steps={t.flow} icons={FLOW_ICONS} />
            </>
          )}

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
          <FlowDiagram
            heading={t.flowHeading}
            steps={previewNeedsWait ? t.flow : t.flowSoon}
            icons={previewNeedsWait ? FLOW_ICONS : FLOW_ICONS_SOON}
          />
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
            <Field label={t.bookingName} htmlFor="bookingName">
              <input id="bookingName" className={inputCls} value={bookingName}
                onChange={(e) => setBookingName(e.target.value)}
                placeholder={t.bookingNamePlaceholder} autoComplete="off" />
            </Field>
            <Field label={t.groupName} htmlFor="groupName">
              <input id="groupName" className={inputCls} value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={t.groupNamePlaceholder} autoComplete="off" />
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
                  <HotelSearchInput
                    inputId={`from${i}`}
                    value={leg.fromHotel}
                    placeholder={t.hotelSearchPlaceholder}
                    lang={locale}
                    selectedPlaceId={leg.fromPlaceId || undefined}
                    endpoint="/api/agency/places/search"
                    getAuthHeaders={placesAuthHeaders}
                    className="h-11 text-[15px]"
                    ariaLabel={t.fromHotel}
                    onChange={(v) => updateLeg(i, { fromHotel: v, fromPlaceId: "" })}
                    onSelect={(c: PlaceCandidate) =>
                      updateLeg(i, { fromHotel: c.name, fromPlaceId: c.placeId, fromCity: c.city })
                    }
                  />
                </Field>
                <Field label={t.toHotel} htmlFor={`to${i}`} required>
                  <HotelSearchInput
                    inputId={`to${i}`}
                    value={leg.toHotel}
                    placeholder={t.hotelSearchPlaceholder}
                    lang={locale}
                    selectedPlaceId={leg.toPlaceId || undefined}
                    endpoint="/api/agency/places/search"
                    getAuthHeaders={placesAuthHeaders}
                    className="h-11 text-[15px]"
                    ariaLabel={t.toHotel}
                    onChange={(v) => updateLeg(i, { toHotel: v, toPlaceId: "" })}
                    onSelect={(c: PlaceCandidate) =>
                      updateLeg(i, { toHotel: c.name, toPlaceId: c.placeId, toCity: c.city })
                    }
                  />
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
                <Field label={t.fromCheckIn} htmlFor={`ci${i}`}>
                  <input id={`ci${i}`} type="date" className={inputCls} value={leg.fromCheckIn}
                    onChange={(e) => updateLeg(i, { fromCheckIn: e.target.value })} />
                </Field>
                <Field label={t.toCheckOut} htmlFor={`co${i}`}>
                  <input id={`co${i}`} type="date" className={inputCls} value={leg.toCheckOut}
                    min={leg.expectedArrival || undefined}
                    onChange={(e) => updateLeg(i, { toCheckOut: e.target.value })} />
                </Field>
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`dt${i}`} className="text-[12px] font-medium text-[#334155]">
                  {t.deliveryTime}
                </label>
                <select id={`dt${i}`} className={inputCls} value={leg.deliveryTime}
                  onChange={(e) => updateLeg(i, { deliveryTime: e.target.value })}>
                  {carrierConfig(DEFAULT_CARRIER).timeSlots.map((slot) => (
                    <option key={slot} value={slot}>{slotLabel(slot, locale)}</option>
                  ))}
                </select>
                {isNextDayEarlySlotRisky(leg.shipmentDate, leg.expectedArrival, leg.deliveryTime) && (
                  <p className="text-[11px] text-amber-600 flex items-start gap-1">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" strokeWidth={1.6} />
                    {t.nextDayRisk}
                  </p>
                )}
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

          {/* 二重依頼の警告 (自社内・止めるだけ・そのまま登録可) */}
          {dupMatches.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" strokeWidth={1.7} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-amber-900">{t.dupTitle}</p>
                  <p className="text-[12px] text-amber-800 mt-1">{t.dupBody}</p>
                  <ul className="mt-1.5 space-y-0.5">
                    {dupMatches.slice(0, 5).map((m) => (
                      <li key={m.booking_id} className="text-[12px] text-amber-900 font-mono">
                        {m.booking_id} ・ {m.representative} ・ {m.shipment_date}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => void submitBooking()}
                    disabled={status === "submitting"}
                    className="mt-3 h-9 px-4 rounded-lg bg-amber-600 text-white text-[13px] font-bold hover:bg-amber-700 disabled:opacity-50"
                  >
                    {t.dupProceed}
                  </button>
                </div>
              </div>
            </div>
          )}

          <button type="submit" disabled={status === "submitting" || !representative}
            className="w-full h-12 rounded-xl bg-[#C8102E] text-white text-[14px] font-bold flex items-center justify-center gap-2 hover:bg-[#A00D25] disabled:opacity-50 disabled:cursor-not-allowed">
            {status === "submitting" ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} /> : t.submit}
          </button>
        </form>
      </div>
    </main>
  )
}

const FLOW_ICONS: LucideIcon[] = [ClipboardList, CalendarClock, PackageCheck, MailCheck]
// 1ヶ月以内 (待ち無し) 版: 待機ステップが無いのでカレンダー時計を使わない
const FLOW_ICONS_SOON: LucideIcon[] = [ClipboardList, PackageCheck, Download]

function FlowDiagram({
  heading,
  steps,
  icons = FLOW_ICONS,
}: {
  heading: string
  steps: ReadonlyArray<{ title: string; sub: string; key: boolean }>
  icons?: LucideIcon[]
}) {
  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5">
      <p className="text-[12px] font-semibold text-[#334155] mb-4">{heading}</p>
      <div className="flex flex-col md:flex-row md:items-stretch gap-2">
        {steps.map((s, i) => {
          const Icon = icons[i] ?? ClipboardList
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
