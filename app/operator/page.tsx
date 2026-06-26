"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Upload,
  Loader2,
  ArrowRight,
  MapPin,
  Calendar,
  Users,
  Package,
  AlertCircle,
  RotateCcw,
  LogOut,
  ArrowLeft,
  Check,
  Building2,
  CheckCircle2,
  ExternalLink,
  Languages,
  FileText,
  Download,
  Settings,
  X,
  Clock,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const FLAT_RATE_YEN = 5000

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

type Locale = "en" | "ja"
const LOCALE_STORAGE_KEY = "bondex_op_locale"

const messages = {
  en: {
    brand: "BondEx Operator",
    pageTitle: "Itinerary Upload",
    startOver: "Start over",
    signOut: "Sign out",
    uploadHeading: "Upload an itinerary",
    uploadHint: "Drop the traveler's PDF or photo. We'll read it and prepare the shipment plan.",
    dropzone: "Drop a file here or click to choose",
    formats: "PDF, JPG, PNG · up to 10MB",
    reading: "Reading itinerary",
    errorTitle: "We couldn't read this itinerary",
    tryAnother: "Try another file",
    guest: "Guest",
    travelers: (n: number) => `${n} ${n === 1 ? "traveler" : "travelers"}`,
    tourCompany: "Tour Company",
    tourCompanyPlaceholder: "e.g. My Japan Planner",
    shipmentPlan: "Shipment plan",
    legs: (n: number) => `${n} ${n === 1 ? "leg" : "legs"}`,
    ratePerSuitcase: `¥${FLAT_RATE_YEN.toLocaleString()} per suitcase`,
    noLegs: "No luggage forwarding legs were found in this itinerary.",
    from: "From",
    to: "To",
    shipOn: (d: string) => `Ship ${d}`,
    arriveOn: (d: string) => `Arrive ${d}`,
    recipientLabel: "Recipient:",
    suitcases: "Suitcases",
    total: "Total",
    totalSuitcases: (n: number) => `${n} ${n === 1 ? "suitcase" : "suitcases"}`,
    reviewAndConfirm: "Review & Confirm",
    enterTourCompany: "Enter a tour company name to continue.",
    backToEdit: "Back to edit",
    verifiedOf: (passed: number, total: number) => `${passed} of ${total} verified`,
    representative: "Representative",
    travelersLabel: "Travelers:",
    repCheckLabel: "Representative and tour company are correct",
    shipmentVerification: "Shipment Verification",
    legOf: (i: number, total: number) => `Leg ${i} of ${total}`,
    hotelNames: "Hotel names",
    hotelNamesOk: "Hotel names look correct",
    datesHeading: "Dates",
    shipOutLabel: "Ship out:",
    arriveLabel: "Arrive:",
    datesOk: "Dates look correct",
    addressesHeading: "Addresses",
    addressesOk: "Addresses look correct",
    generateVouchers: "Issue",
    verifyAll: "Verify every section to issue documents.",
    aiVerifying: "Verifying with AI…",
    aiVerified: "Verified",
    aiCouldNotVerify: "AI couldn't confirm — please check manually",
    aiSource: "See source",
    fromShort: "From:",
    toShort: "To:",
    generatingVouchers: "Generating documents…",
    docsReady: "Documents ready",
    bookingId: "Booking",
    voucherCardTitle: "Hotel Voucher",
    voucherCardSub: "Preview, then send a printed copy in the welcome packet to the traveler's first hotel.",
    opsCardTitle: "Operations Sheet",
    opsCardSub: "Internal record; fill in Yamato tracking numbers after labels are issued.",
    download: "Download",
    preview: "Preview",
    newBooking: "Start a new booking",
    generationFailed: "Document generation failed",
    yamatoLabelsHeading: "Yamato shipping labels",
    yamatoLegLabel: (n: number) => `Leg ${n}`,
    yamatoTracking: "Tracking",
    yamatoLabelFailed: "Label issuance failed",
    yamatoDeferred: (d: string) => `Scheduled — label will be issued on ${d}`,
    yamatoDeferredNote:
      "Yamato accepts labels only within 30 days of the shipment date. This leg is registered and will be issued automatically when it enters the window.",
    yamatoDatePast:
      "The shipment date is in the past — a label can't be issued. Please check the itinerary date.",
    yamatoDateWindow:
      "The shipment date is more than 30 days away, beyond Yamato's issuance window. The label will be issued automatically closer to the date.",
    yamatoDateInvalid: "The shipment date is invalid. Please check the itinerary date.",
    notesLabel: "Notes (optional)",
    notesPlaceholder: "Anything to tell the hotel — e.g. drop-off by 8:00, fragile, senior guest…",
    settings: "Settings",
    settingsTitle: "Operator Settings",
    settingsHint: "These details are used in every voucher. Update them here, not per-booking.",
    settingsTourCompany: "Tour company",
    settingsTourCompanyPlaceholder: "e.g. My Japan Planner",
    settingsContactName: "Contact person",
    settingsContactNamePlaceholder: "e.g. 谷口",
    settingsContactPhone: "Contact phone",
    settingsContactPhonePlaceholder: "+81-XX-XXXX-XXXX",
    settingsSave: "Save",
    settingsCancel: "Cancel",
    settingsRequired: "Please set up your tour company first.",
    aiFoundAddress: "AI found this address",
  },
  ja: {
    brand: "BondEx オペレーター",
    pageTitle: "旅程表アップロード",
    startOver: "やり直す",
    signOut: "サインアウト",
    uploadHeading: "旅程表をアップロード",
    uploadHint: "旅行者のPDFまたは写真をドロップしてください。読み取って配送プランを準備します。",
    dropzone: "ファイルをここにドロップ、またはクリックして選択",
    formats: "PDF, JPG, PNG · 最大10MB",
    reading: "旅程表を読み取り中",
    errorTitle: "旅程表を読み取れませんでした",
    tryAnother: "別のファイルを試す",
    guest: "ゲスト",
    travelers: (n: number) => `${n}名`,
    tourCompany: "旅行会社",
    tourCompanyPlaceholder: "例: My Japan Planner",
    shipmentPlan: "配送プラン",
    legs: (n: number) => `${n}区間`,
    ratePerSuitcase: `1個あたり ¥${FLAT_RATE_YEN.toLocaleString()}`,
    noLegs: "この旅程表からは配送区間が見つかりませんでした。",
    from: "出発元",
    to: "配送先",
    shipOn: (d: string) => `発送 ${d}`,
    arriveOn: (d: string) => `到着 ${d}`,
    recipientLabel: "受取人:",
    suitcases: "スーツケース",
    total: "合計",
    totalSuitcases: (n: number) => `${n}個`,
    reviewAndConfirm: "確認へ進む",
    enterTourCompany: "続行するには旅行会社名を入力してください。",
    backToEdit: "編集に戻る",
    verifiedOf: (passed: number, total: number) => `${total}件中 ${passed}件 確認済み`,
    representative: "代表者",
    travelersLabel: "旅行者数:",
    repCheckLabel: "代表者と旅行会社が正しい",
    shipmentVerification: "配送内容の確認",
    legOf: (i: number, total: number) => `区間 ${i} / ${total}`,
    hotelNames: "宿名",
    hotelNamesOk: "宿名が正しい",
    datesHeading: "日付",
    shipOutLabel: "発送日:",
    arriveLabel: "到着日:",
    datesOk: "日付が正しい",
    addressesHeading: "住所",
    addressesOk: "住所が正しい",
    generateVouchers: "発行する",
    verifyAll: "全項目を確認すると発行できます。",
    aiVerifying: "AIが確認中…",
    aiVerified: "確認済み",
    aiCouldNotVerify: "AIで確認できませんでした — 目視で確認してください",
    aiSource: "情報源を見る",
    fromShort: "From:",
    toShort: "To:",
    generatingVouchers: "書類を生成中…",
    docsReady: "書類が用意できました",
    bookingId: "予約番号",
    voucherCardTitle: "ホテル向けバウチャー",
    voucherCardSub: "プレビューで内容を確認し、印刷して旅行者の初日ホテルに送付します。",
    opsCardTitle: "オペレーションシート",
    opsCardSub: "社内記録用。後でヤマトの追跡番号を記入します。",
    download: "ダウンロード",
    preview: "プレビュー",
    newBooking: "新しい予約を開始",
    generationFailed: "書類の生成に失敗しました",
    yamatoLabelsHeading: "ヤマト送り状",
    yamatoLegLabel: (n: number) => `区間 ${n}`,
    yamatoTracking: "追跡番号",
    yamatoLabelFailed: "送り状発行に失敗",
    yamatoDeferred: (d: string) => `発行予約済み — ${d} から発行可能`,
    yamatoDeferredNote:
      "ヤマトの送り状は出荷予定日の30日前から発行可能です。この区間は登録済みで、発行可能期間に入り次第、自動で発行されます。",
    yamatoDatePast:
      "出荷予定日が過去のため送り状を発行できません。旅程の日付をご確認ください。",
    yamatoDateWindow:
      "出荷予定日が30日以上先のため、ヤマトの発行可能期間を超えています。出荷予定日が近づき次第、自動で発行されます。",
    yamatoDateInvalid: "出荷予定日が不正です。旅程の日付をご確認ください。",
    notesLabel: "備考 (任意)",
    notesPlaceholder: "ホテルに伝えたいことがあれば — 例: 8時までに発送、割れ物注意、高齢のお客様…",
    settings: "設定",
    settingsTitle: "オペレーター設定",
    settingsHint: "この情報は毎回のバウチャーで使用されます。予約ごとではなくここで管理します。",
    settingsTourCompany: "旅行会社",
    settingsTourCompanyPlaceholder: "例: My Japan Planner",
    settingsContactName: "担当者",
    settingsContactNamePlaceholder: "例: 谷口",
    settingsContactPhone: "連絡先",
    settingsContactPhonePlaceholder: "+81-XX-XXXX-XXXX",
    settingsSave: "保存",
    settingsCancel: "キャンセル",
    settingsRequired: "最初に旅行会社情報を登録してください。",
    aiFoundAddress: "AIで取得した住所",
  },
} satisfies Record<Locale, Record<string, string | ((...args: never[]) => string)>>

type Messages = typeof messages.en

// Ship&co 発行 API の既知エラーコードを localized メッセージに変換。
// 未知コードは null を返し、呼び出し側で生エラーにフォールバックする。
function mapShipmentError(code: string | undefined, t: Messages): string | null {
  switch (code) {
    case "SHIPMENT_DATE_PAST":
      return t.yamatoDatePast
    case "SHIPANDCO_DATE_WINDOW":
      return t.yamatoDateWindow
    case "SHIPMENT_DATE_INVALID":
      return t.yamatoDateInvalid
    default:
      return null
  }
}

function useLocale() {
  const [locale, setLocaleState] = useState<Locale>("en")
  useEffect(() => {
    if (typeof window === "undefined") return
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored === "ja" || stored === "en") setLocaleState(stored)
  }, [])
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, l)
    }
  }, [])
  return { locale, t: messages[locale] as Messages, setLocale }
}

interface ParsedTraveler {
  name: string
  title: string
  type: "adult" | "child"
  age?: number
}

interface ParsedGuest {
  familyName: string
  travelerCount: number
  travelers: ParsedTraveler[]
}

interface ParsedShipmentLocation {
  hotel: string
  address: string
  city: string
}

interface ParsedShipment {
  shipmentDate: string
  expectedArrival: string
  from: ParsedShipmentLocation
  to: ParsedShipmentLocation
  recipient: string
}

interface ParsedItinerary {
  guest: ParsedGuest
  shipments: ParsedShipment[]
}

// 編集可能な State: パース結果に suitcaseCount + 備考のみ加える
interface EditableShipment extends ParsedShipment {
  suitcaseCount: number
  specialNote: string
}

interface EditableItinerary {
  guest: ParsedGuest
  shipments: EditableShipment[]
}

type Phase = "idle" | "parsing" | "review" | "confirm" | "generating" | "generated" | "error"

interface GeneratedDocs {
  bookingId: string
  voucherUrl: string
  yamatoLabels: YamatoLabel[]
}

interface YamatoLabel {
  legIndex: number
  legLabel: string // e.g. "Leg 1: Hyatt Hakone → Mitsui Kyoto"
  labelUrl: string
  trackingNumbers: string[]
  status: "ok" | "failed" | "deferred"
  error?: string
  issuableFrom?: string // deferred のとき: この日から発行可能 (YYYY-MM-DD)
}

// 検証チェック: 各 leg ごとに3軸 (Name / Date / Address)、最上段に Representative 1軸。
// 全部 true でないと "Generate Vouchers" は disabled のまま。
interface LegVerification {
  names: boolean
  dates: boolean
  addresses: boolean
}
interface Verifications {
  representative: boolean
  legs: LegVerification[]
}

// AI 住所検証 + 補完
type AddressCheckStatus = "pending" | "verified" | "mismatch" | "low_confidence" | "failed"
interface AddressCheck {
  status: AddressCheckStatus
  citationUrl?: string
  sourceTitle?: string
  reasoning?: string
  canonicalAddress?: string
}

// オペレーター設定 (localStorage)
const SETTINGS_KEY = "bondex_op_settings"
interface OperatorSettings {
  tourCompany: string
  contactName: string
  contactPhone: string
}
function loadSettings(): OperatorSettings | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.tourCompany === "string" && parsed.tourCompany.trim()) {
      return {
        tourCompany: parsed.tourCompany,
        contactName: typeof parsed.contactName === "string" ? parsed.contactName : "",
        contactPhone: typeof parsed.contactPhone === "string" ? parsed.contactPhone : "",
      }
    }
  } catch {
    // ignore
  }
  return null
}
function saveSettings(s: OperatorSettings): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

// 住所が AI で自動補完されると入力住所自体が変わるため、住所はキーに含めず
// ホテル名 (小文字正規化) のみで lookup する。同名別館は Google Places の top match に依存。
function addressKey(hotel: string, _address?: string): string {
  return hotel.trim().toLowerCase()
}

function emptyVerifications(legCount: number): Verifications {
  return {
    representative: false,
    legs: Array.from({ length: legCount }, () => ({
      names: false,
      dates: false,
      addresses: false,
    })),
  }
}

export default function OperatorPage() {
  const router = useRouter()
  const { locale, t, setLocale } = useLocale()
  const [phase, setPhase] = useState<Phase>("idle")
  const [fileName, setFileName] = useState<string>("")
  const [error, setError] = useState<string>("")
  const [itinerary, setItinerary] = useState<EditableItinerary | null>(null)
  const [verifications, setVerifications] = useState<Verifications>({
    representative: false,
    legs: [],
  })
  const [addressChecks, setAddressChecks] = useState<Record<string, AddressCheck>>({})
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDocs | null>(null)
  const [generationError, setGenerationError] = useState<string>("")
  const [isDragging, setIsDragging] = useState(false)
  const [settings, setSettings] = useState<OperatorSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 初回マウントで localStorage から設定を復元。未設定なら設定モーダルを強制表示。
  useEffect(() => {
    const loaded = loadSettings()
    setSettings(loaded)
    if (!loaded) setSettingsOpen(true)
  }, [])

  const onSaveSettings = useCallback((next: OperatorSettings) => {
    saveSettings(next)
    setSettings(next)
    setSettingsOpen(false)
  }, [])

  const onLogout = useCallback(async () => {
    await fetch("/api/operator/logout", { method: "POST" })
    router.replace("/operator/login")
  }, [router])

  const totalSuitcases = useMemo(() => {
    if (!itinerary) return 0
    return itinerary.shipments.reduce((sum, s) => sum + s.suitcaseCount, 0)
  }, [itinerary])

  const totalAmount = useMemo(() => totalSuitcases * FLAT_RATE_YEN, [totalSuitcases])

  const reset = useCallback(() => {
    setPhase("idle")
    setItinerary(null)
    setFileName("")
    setError("")
    setVerifications({ representative: false, legs: [] })
    setAddressChecks({})
    setGenerationError("")
    if (generatedDocs) {
      URL.revokeObjectURL(generatedDocs.voucherUrl)
    }
    setGeneratedDocs(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [generatedDocs])

  // AI で1件の住所を検証/補完 (バックグラウンド)。結果は addressChecks に書き込み、
  // 住所が空 or 不完全だった場合は canonicalAddress で itinerary を自動補完する。
  const verifyAddress = useCallback(
    async (hotel: string, address: string, side?: { legIndex: number; which: "from" | "to" }) => {
      const key = addressKey(hotel, address)
      setAddressChecks((prev) => ({ ...prev, [key]: { status: "pending" } }))
      try {
        const res = await fetch("/api/address/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hotelName: hotel, address, lang: locale }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data) {
          setAddressChecks((prev) => ({ ...prev, [key]: { status: "failed" } }))
          return
        }
        const matched = Boolean(data.matched)
        const confidence = String(data.confidence || "")
        const canonical =
          typeof data.canonicalAddress === "string" ? data.canonicalAddress.trim() : ""
        let status: AddressCheckStatus = "failed"
        if (matched && confidence === "high") status = "verified"
        else if (matched && confidence === "medium") status = "verified"
        else if (matched && confidence === "low") status = "low_confidence"
        else if (!matched) status = "mismatch"
        setAddressChecks((prev) => ({
          ...prev,
          [key]: {
            status,
            citationUrl: typeof data.citationUrl === "string" ? data.citationUrl : undefined,
            sourceTitle: typeof data.sourceTitle === "string" ? data.sourceTitle : undefined,
            reasoning: typeof data.reasoning === "string" ? data.reasoning : undefined,
            canonicalAddress: canonical || undefined,
          },
        }))

        // canonical が見つかったら常に表示住所を差し替える (より正確な情報なので)
        if (side && canonical) {
          setItinerary((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              shipments: prev.shipments.map((s, i) => {
                if (i !== side.legIndex) return s
                if (side.which === "from") {
                  return { ...s, from: { ...s.from, address: canonical } }
                }
                return { ...s, to: { ...s.to, address: canonical } }
              }),
            }
          })
        }
      } catch {
        setAddressChecks((prev) => ({ ...prev, [key]: { status: "failed" } }))
      }
    },
    [locale],
  )

  // 検証画面へ遷移。前回の検証チェックは毎回リセット (内容が同じでも再確認を強制する)。
  // 入場と同時に各 leg の from / to 住所を AI に投げる (並列、重複は除外)。
  const goToConfirm = useCallback(() => {
    if (!itinerary) return
    setVerifications(emptyVerifications(itinerary.shipments.length))
    setPhase("confirm")

    const seen = new Set<string>()
    itinerary.shipments.forEach((s, legIndex) => {
      ;(["from", "to"] as const).forEach((which) => {
        const loc = s[which]
        if (!loc.hotel) return
        const key = addressKey(loc.hotel, loc.address)
        if (seen.has(key)) return
        seen.add(key)
        void verifyAddress(loc.hotel, loc.address, { legIndex, which })
      })
    })
  }, [itinerary, verifyAddress])

  // 戻るボタン: 検証フェーズから編集フェーズへ。検証状態もリセット (AI 結果は残しても良いが、
  // 編集で住所が変わる可能性があるのでクリアする)。
  const backToReview = useCallback(() => {
    setVerifications({ representative: false, legs: [] })
    setAddressChecks({})
    setPhase("review")
  }, [])

  // バウチャー + オペシートを並列生成。Blob URL を作成して generated phase へ。
  const generateDocuments = useCallback(async () => {
    if (!itinerary) return
    setGenerationError("")
    setPhase("generating")

    const representative =
      itinerary.guest.travelers.find((tr) => tr.type === "adult") || itinerary.guest.travelers[0]
    const representativeLabel = representative
      ? `${representative.title ? representative.title + " " : ""}${representative.name}`
      : itinerary.guest.familyName

    // クライアント側で Booking ID を1回だけ生成し、voucher / Yamato 両方に同じ ID を渡して
    // トレーサビリティを担保する (旧コードでは voucher と Yamato refNumber が別 ID になっていた)
    const now = new Date()
    const yy = String(now.getFullYear() % 100).padStart(2, "0")
    const mm = String(now.getMonth() + 1).padStart(2, "0")
    const dd = String(now.getDate()).padStart(2, "0")
    const rand = Math.floor(100 + Math.random() * 900)
    const sharedBookingId = `BDX-${yy}${mm}${dd}-${rand}`

    const tourCompanyFromSettings = settings?.tourCompany || ""
    const payload = {
      bookingId: sharedBookingId,
      representativeLabel,
      tourCompany: tourCompanyFromSettings,
      travelerCount: itinerary.guest.travelerCount,
      contactPersonName: settings?.contactName || "",
      contactPersonPhone: settings?.contactPhone || "",
      shipments: itinerary.shipments.map((s) => ({
        shipmentDate: s.shipmentDate,
        expectedArrival: s.expectedArrival,
        from: { hotel: s.from.hotel, address: s.from.address, city: s.from.city },
        to: { hotel: s.to.hotel, address: s.to.address, city: s.to.city },
        recipient: s.recipient,
        suitcaseCount: s.suitcaseCount,
        specialNote: s.specialNote,
      })),
    }

    async function fetchPdf(type: "voucher" | "ops") {
      const res = await fetch(`/api/voucher/generate?type=${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => "")
        throw new Error(errText || res.statusText)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const bookingId = res.headers.get("X-Booking-Id") || ""
      return { url, bookingId }
    }

    // Ship&co Yamato 送り状を1区間ずつ呼ぶ
    async function fetchYamatoLabel(legIndex: number): Promise<YamatoLabel> {
      const s = itinerary!.shipments[legIndex]
      const legLabel = `${s.from.hotel} → ${s.to.hotel}`
      try {
        const res = await fetch("/api/shipandco/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            refNumber: `${sharedBookingId}-L${legIndex + 1}`,
            shipmentDate: s.shipmentDate,
            suitcaseCount: s.suitcaseCount,
            from: { hotel: s.from.hotel, recipient: s.recipient },
            to: { hotel: s.to.hotel, recipient: s.recipient },
          }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data) {
          const errObj = (data ?? {}) as { error?: string; code?: string; detail?: unknown }
          // 既知のエラーコードは業務向け日本語/英語にマッピング (生の API エラーを出さない)
          const mapped = mapShipmentError(errObj.code, t)
          if (mapped) {
            return { legIndex, legLabel, labelUrl: "", trackingNumbers: [], status: "failed", error: mapped }
          }
          const detailStr =
            typeof errObj.detail === "string"
              ? errObj.detail
              : errObj.detail
                ? JSON.stringify(errObj.detail).slice(0, 200)
                : ""
          return {
            legIndex,
            legLabel,
            labelUrl: "",
            trackingNumbers: [],
            status: "failed",
            error: detailStr
              ? `${errObj.error || res.statusText}: ${detailStr}`
              : errObj.error || res.statusText,
          }
        }
        const d = data as {
          status?: string
          label?: string
          trackingNumbers?: string[]
          issuableFrom?: string
        }
        // 30日超の区間は発行延期 (deferred) — エラーではなく予約済みとして扱う
        if (d.status === "deferred") {
          return {
            legIndex,
            legLabel,
            labelUrl: "",
            trackingNumbers: [],
            status: "deferred",
            issuableFrom: d.issuableFrom,
          }
        }
        return {
          legIndex,
          legLabel,
          labelUrl: d.label ?? "",
          trackingNumbers: d.trackingNumbers ?? [],
          status: d.label ? "ok" : "failed",
        }
      } catch (err) {
        return {
          legIndex,
          legLabel,
          labelUrl: "",
          trackingNumbers: [],
          status: "failed",
          error: err instanceof Error ? err.message : "Network error",
        }
      }
    }

    try {
      const [voucher, ...yamatoLabels] = await Promise.all([
        fetchPdf("voucher"),
        ...itinerary.shipments.map((_, i) => fetchYamatoLabel(i)),
      ])
      setGeneratedDocs({
        bookingId: voucher.bookingId,
        voucherUrl: voucher.url,
        yamatoLabels,
      })
      setPhase("generated")
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : "Generation failed")
      setPhase("confirm")
    }
  }, [itinerary, settings, t])

  const setRepresentativeChecked = useCallback((checked: boolean) => {
    setVerifications((prev) => ({ ...prev, representative: checked }))
  }, [])

  const setLegVerification = useCallback(
    (legIndex: number, field: keyof LegVerification, checked: boolean) => {
      setVerifications((prev) => ({
        ...prev,
        legs: prev.legs.map((leg, i) =>
          i === legIndex ? { ...leg, [field]: checked } : leg,
        ),
      }))
    },
    [],
  )

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name)
    setError("")
    setItinerary(null)
    setPhase("parsing")

    const formData = new FormData()
    formData.append("file", file)

    try {
      const res = await fetch("/api/itinerary/parse", {
        method: "POST",
        body: formData,
      })
      const text = await res.text()
      let json: ParsedItinerary | { error?: string } | null = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        // non-JSON
      }
      if (!res.ok) {
        const msg = (json && "error" in json && json.error) || text || res.statusText
        setError(msg)
        setPhase("error")
        return
      }
      const parsed = json as ParsedItinerary
      if (!parsed?.guest || !Array.isArray(parsed.shipments)) {
        setError("Unexpected response shape from parser")
        setPhase("error")
        return
      }
      // Default rule B: suitcase count = traveler count, operator can edit per leg.
      const editable: EditableItinerary = {
        guest: parsed.guest,
        shipments: parsed.shipments.map((s) => ({
          ...s,
          suitcaseCount: parsed.guest.travelerCount || 1,
          specialNote: "",
        })),
      }
      setItinerary(editable)
      setVerifications(emptyVerifications(editable.shipments.length))
      setPhase("review")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
      setPhase("error")
    }
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) void handleFile(file)
    },
    [handleFile],
  )

  const updateSuitcaseCount = (index: number, value: number) => {
    if (!itinerary) return
    const next = Math.max(0, Math.floor(value))
    setItinerary({
      ...itinerary,
      shipments: itinerary.shipments.map((s, i) =>
        i === index ? { ...s, suitcaseCount: next } : s,
      ),
    })
  }

  const updateShipmentNote = (index: number, value: string) => {
    if (!itinerary) return
    setItinerary({
      ...itinerary,
      shipments: itinerary.shipments.map((s, i) =>
        i === index ? { ...s, specialNote: value } : s,
      ),
    })
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              {t.brand}
            </p>
            <h1 className="text-xl font-semibold text-foreground mt-0.5">{t.pageTitle}</h1>
          </div>
          <div className="flex items-center gap-4">
            <LocaleToggle locale={locale} onChange={setLocale} />
            {phase !== "idle" && (
              <button
                onClick={reset}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <RotateCcw className="w-4 h-4" strokeWidth={1.5} />
                {t.startOver}
              </button>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Settings className="w-4 h-4" strokeWidth={1.5} />
              {t.settings}
            </button>
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.5} />
              {t.signOut}
            </button>
          </div>
        </div>
      </header>

      {settingsOpen && (
        <SettingsModal
          t={t}
          initial={settings}
          onCancel={() => {
            if (settings) setSettingsOpen(false)
            // 未設定なら closing を許可しない (modal は強制)
          }}
          onSave={onSaveSettings}
          canCancel={!!settings}
        />
      )}

      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        {phase === "idle" && (
          <section className="space-y-6">
            <div className="space-y-2">
              <h2 className="text-base font-medium text-foreground">{t.uploadHeading}</h2>
              <p className="text-sm text-muted-foreground">{t.uploadHint}</p>
            </div>

            <label
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              className={`block rounded-2xl border-2 border-dashed transition-colors cursor-pointer p-12 text-center ${
                isDragging
                  ? "border-foreground bg-foreground/5"
                  : "border-border bg-white hover:border-foreground/40"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleFile(file)
                }}
              />
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                  <Upload className="w-5 h-5 text-foreground" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{t.dropzone}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t.formats}</p>
                </div>
              </div>
            </label>
          </section>
        )}

        {phase === "parsing" && (
          <section className="rounded-2xl border border-border bg-white p-10 flex flex-col items-center gap-4">
            <Loader2 className="w-6 h-6 text-foreground animate-spin" strokeWidth={1.5} />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-foreground">{t.reading}</p>
              <p className="text-xs text-muted-foreground">{fileName}</p>
            </div>
          </section>
        )}

        {phase === "error" && (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-6 flex items-start gap-4">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" strokeWidth={1.5} />
            <div className="space-y-2 flex-1">
              <p className="text-sm font-medium text-red-900">{t.errorTitle}</p>
              <p className="text-xs text-red-800 break-words">{error}</p>
              <button
                onClick={reset}
                className="text-sm text-red-900 underline underline-offset-2 hover:no-underline"
              >
                {t.tryAnother}
              </button>
            </div>
          </section>
        )}

        {phase === "review" && itinerary && (
          <ReviewView
            t={t}
            itinerary={itinerary}
            totalSuitcases={totalSuitcases}
            totalAmount={totalAmount}
            settings={settings}
            onOpenSettings={() => setSettingsOpen(true)}
            onUpdateSuitcaseCount={updateSuitcaseCount}
            onUpdateShipmentNote={updateShipmentNote}
            onContinue={goToConfirm}
          />
        )}

        {phase === "confirm" && itinerary && (
          <ConfirmView
            t={t}
            itinerary={itinerary}
            totalSuitcases={totalSuitcases}
            totalAmount={totalAmount}
            tourCompany={settings?.tourCompany || ""}
            verifications={verifications}
            addressChecks={addressChecks}
            generationError={generationError}
            onSetRepresentative={setRepresentativeChecked}
            onSetLegVerification={setLegVerification}
            onBack={backToReview}
            onGenerate={generateDocuments}
          />
        )}

        {phase === "generating" && (
          <section className="rounded-2xl border border-border bg-white p-10 flex flex-col items-center gap-4">
            <Loader2 className="w-6 h-6 text-foreground animate-spin" strokeWidth={1.5} />
            <p className="text-sm font-medium text-foreground">{t.generatingVouchers}</p>
          </section>
        )}

        {phase === "generated" && generatedDocs && (
          <GeneratedView t={t} docs={generatedDocs} onReset={reset} />
        )}
      </div>
    </main>
  )
}

function LocaleToggle({
  locale,
  onChange,
}: {
  locale: Locale
  onChange: (l: Locale) => void
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-border p-0.5 bg-white">
      <Languages className="w-3.5 h-3.5 text-muted-foreground ml-1.5 mr-0.5" strokeWidth={1.5} />
      {(["en", "ja"] as const).map((l) => (
        <button
          key={l}
          onClick={() => onChange(l)}
          className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
            locale === l
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {l === "en" ? "EN" : "JP"}
        </button>
      ))}
    </div>
  )
}

function ReviewView({
  t,
  itinerary,
  totalSuitcases,
  totalAmount,
  settings,
  onOpenSettings,
  onUpdateSuitcaseCount,
  onUpdateShipmentNote,
  onContinue,
}: {
  t: Messages
  itinerary: EditableItinerary
  totalSuitcases: number
  totalAmount: number
  settings: OperatorSettings | null
  onOpenSettings: () => void
  onUpdateSuitcaseCount: (index: number, value: number) => void
  onUpdateShipmentNote: (index: number, value: string) => void
  onContinue: () => void
}) {
  const { guest, shipments } = itinerary
  const canContinue = !!settings?.tourCompany && shipments.length > 0

  return (
    <div className="space-y-8">
      {/* Guest summary */}
      <section className="rounded-2xl border border-border bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              {t.guest}
            </p>
            <h2 className="text-xl font-semibold text-foreground">{guest.familyName}</h2>
            <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
              <Users className="w-4 h-4" strokeWidth={1.5} />
              {t.travelers(guest.travelerCount)}
            </p>
          </div>
        </div>

        {guest.travelers.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {guest.travelers.map((tr, i) => (
              <li
                key={i}
                className="text-sm text-foreground/80 px-3 py-2 rounded-lg bg-muted/40"
              >
                <span className="font-medium text-foreground">
                  {tr.title ? `${tr.title} ` : ""}
                  {tr.name}
                </span>
                {tr.type === "child" && tr.age !== undefined && (
                  <span className="text-xs text-muted-foreground"> · age {tr.age}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Tour Company (from settings) */}
        <div className="mt-6 pt-6 border-t border-border flex items-center justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" strokeWidth={1.5} />
              {t.tourCompany}
            </p>
            {settings?.tourCompany ? (
              <p className="text-base font-medium text-foreground">{settings.tourCompany}</p>
            ) : (
              <p className="text-sm text-amber-700">{t.settingsRequired}</p>
            )}
          </div>
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <Settings className="w-3.5 h-3.5" strokeWidth={1.5} />
            {t.settings}
          </button>
        </div>
      </section>

      {/* Shipments */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              {t.shipmentPlan}
            </p>
            <h2 className="text-xl font-semibold text-foreground mt-0.5">
              {t.legs(shipments.length)}
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">{t.ratePerSuitcase}</p>
        </div>

        {shipments.length === 0 ? (
          <div className="rounded-2xl border border-border bg-white p-6 text-sm text-muted-foreground text-center">
            {t.noLegs}
          </div>
        ) : (
          <ol className="space-y-3">
            {shipments.map((s, i) => (
              <ShipmentRow
                key={i}
                t={t}
                index={i}
                shipment={s}
                onUpdateSuitcaseCount={onUpdateSuitcaseCount}
                onUpdateShipmentNote={onUpdateShipmentNote}
              />
            ))}
          </ol>
        )}
      </section>

      {/* Totals + CTA */}
      <section className="rounded-2xl bg-foreground text-background p-6 flex items-center justify-between gap-6">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-background/60 font-medium">
            {t.total}
          </p>
          <p className="text-2xl font-semibold mt-1">¥{totalAmount.toLocaleString()}</p>
          <p className="text-xs text-background/60 mt-1">
            {t.totalSuitcases(totalSuitcases)} · {t.legs(shipments.length)}
          </p>
        </div>
        <Button
          disabled={!canContinue}
          onClick={onContinue}
          className="h-14 px-6 rounded-2xl bg-background text-foreground hover:bg-background/90 disabled:opacity-50"
        >
          {t.reviewAndConfirm}
          <ArrowRight className="w-4 h-4 ml-2" strokeWidth={1.5} />
        </Button>
      </section>
      {!canContinue && (
        <p className="text-xs text-muted-foreground text-right">{t.settingsRequired}</p>
      )}
    </div>
  )
}

function ShipmentRow({
  t,
  index,
  shipment,
  onUpdateSuitcaseCount,
  onUpdateShipmentNote,
}: {
  t: Messages
  index: number
  shipment: EditableShipment
  onUpdateSuitcaseCount: (index: number, value: number) => void
  onUpdateShipmentNote: (index: number, value: string) => void
}) {
  return (
    <li className="rounded-2xl border border-border bg-white p-5">
      <div className="flex items-start gap-4">
        <div className="w-7 h-7 rounded-full bg-foreground text-background text-xs font-medium flex items-center justify-center shrink-0">
          {index + 1}
        </div>

        <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-center">
          {/* From */}
          <div className="space-y-1 min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              {t.from}
            </p>
            <p className="text-base font-medium text-foreground truncate">{shipment.from.hotel}</p>
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              <MapPin className="w-3 h-3 mt-0.5 shrink-0" strokeWidth={1.5} />
              <span className="leading-snug">{shipment.from.city || shipment.from.address}</span>
            </p>
            <p className="text-xs text-foreground/80 flex items-center gap-1 pt-1">
              <Calendar className="w-3 h-3" strokeWidth={1.5} />
              {t.shipOn(shipment.shipmentDate)}
            </p>
          </div>

          {/* Arrow */}
          <ArrowRight
            className="w-5 h-5 text-muted-foreground hidden md:block"
            strokeWidth={1.5}
          />

          {/* To */}
          <div className="space-y-1 min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              {t.to}
            </p>
            <p className="text-base font-medium text-foreground truncate">{shipment.to.hotel}</p>
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              <MapPin className="w-3 h-3 mt-0.5 shrink-0" strokeWidth={1.5} />
              <span className="leading-snug">{shipment.to.city || shipment.to.address}</span>
            </p>
            <p className="text-xs text-foreground/80 flex items-center gap-1 pt-1">
              <Calendar className="w-3 h-3" strokeWidth={1.5} />
              {t.arriveOn(shipment.expectedArrival)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Users className="w-3.5 h-3.5" strokeWidth={1.5} />
          {t.recipientLabel}{" "}
          <span className="text-foreground/80 font-medium">{shipment.recipient}</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            <Package className="w-3.5 h-3.5" strokeWidth={1.5} />
            {t.suitcases}
          </label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={shipment.suitcaseCount}
            onChange={(e) => onUpdateSuitcaseCount(index, Number(e.target.value))}
            className="w-20 h-9 text-center"
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            ¥{(shipment.suitcaseCount * FLAT_RATE_YEN).toLocaleString()}
          </span>
        </div>
      </div>

      {/* 備考のみ */}
      <div className="mt-4 pt-4 border-t border-border space-y-1">
        <label className="text-xs text-muted-foreground">{t.notesLabel}</label>
        <Input
          type="text"
          placeholder={t.notesPlaceholder}
          value={shipment.specialNote}
          onChange={(e) => onUpdateShipmentNote(index, e.target.value)}
          className="h-9 text-sm"
        />
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// ConfirmView (検証フェーズ)
//
// パース結果を編集不可で表示し、各 leg ごとに3軸 (Names / Dates / Addresses)
// + 代表者の計 1 + N*3 個のチェックを操作員に強制する。
// 全部チェックされて初めて "Generate Vouchers" が enable。
// ---------------------------------------------------------------------------

function ConfirmView({
  t,
  itinerary,
  totalSuitcases,
  totalAmount,
  tourCompany,
  verifications,
  addressChecks,
  generationError,
  onSetRepresentative,
  onSetLegVerification,
  onBack,
  onGenerate,
}: {
  t: Messages
  itinerary: EditableItinerary
  totalSuitcases: number
  totalAmount: number
  tourCompany: string
  verifications: Verifications
  addressChecks: Record<string, AddressCheck>
  generationError: string
  onSetRepresentative: (checked: boolean) => void
  onSetLegVerification: (
    legIndex: number,
    field: keyof LegVerification,
    checked: boolean,
  ) => void
  onBack: () => void
  onGenerate: () => void
}) {
  const { guest, shipments } = itinerary
  const representative = guest.travelers.find((tr) => tr.type === "adult") || guest.travelers[0]
  const representativeLabel = representative
    ? `${representative.title ? representative.title + " " : ""}${representative.name}`
    : guest.familyName

  const totalChecks = 1 + shipments.length * 3
  const passedChecks =
    (verifications.representative ? 1 : 0) +
    verifications.legs.reduce(
      (sum, l) => sum + (l.names ? 1 : 0) + (l.dates ? 1 : 0) + (l.addresses ? 1 : 0),
      0,
    )
  const allVerified = passedChecks === totalChecks

  return (
    <div className="space-y-8">
      {/* Header bar with back + progress */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
          {t.backToEdit}
        </button>
        <p className="text-xs text-muted-foreground">
          <span className={allVerified ? "text-foreground font-medium" : ""}>
            {t.verifiedOf(passedChecks, totalChecks)}
          </span>
        </p>
      </div>

      {/* Representative */}
      <section className="rounded-2xl border border-border bg-white p-6 space-y-4">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
          {t.representative}
        </p>
        <div className="space-y-1">
          <p className="text-xl font-semibold text-foreground">{representativeLabel}</p>
          <p className="text-sm text-muted-foreground">
            {t.tourCompany}:{" "}
            <span className="text-foreground/80 font-medium">{tourCompany || "—"}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            {t.travelersLabel}{" "}
            <span className="text-foreground/80 font-medium">{guest.travelerCount}</span>
          </p>
        </div>
        <CheckRow
          checked={verifications.representative}
          onChange={onSetRepresentative}
          label={t.repCheckLabel}
        />
      </section>

      {/* Per-leg verification */}
      <section className="space-y-4">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
          {t.shipmentVerification}
        </p>
        <ol className="space-y-3">
          {shipments.map((s, i) => {
            const leg = verifications.legs[i] ?? { names: false, dates: false, addresses: false }
            const fromCheck = addressChecks[addressKey(s.from.hotel, s.from.address)]
            const toCheck = addressChecks[addressKey(s.to.hotel, s.to.address)]
            return (
              <li
                key={i}
                className="rounded-2xl border border-border bg-white p-5 space-y-4"
              >
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-foreground text-background text-xs font-medium flex items-center justify-center shrink-0">
                    {i + 1}
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {t.legOf(i + 1, shipments.length)}
                  </p>
                  <p className="text-xs text-muted-foreground ml-auto">
                    {t.recipientLabel}{" "}
                    <span className="text-foreground/80 font-medium">{s.recipient}</span> ·{" "}
                    {t.totalSuitcases(s.suitcaseCount)}
                  </p>
                </div>

                {/* Names */}
                <VerifyBlock
                  title={t.hotelNames}
                  okLabel={t.hotelNamesOk}
                  checked={leg.names}
                  onChange={(v) => onSetLegVerification(i, "names", v)}
                >
                  <p className="text-sm text-foreground">
                    <span className="text-muted-foreground">{t.fromShort}</span> {s.from.hotel}
                  </p>
                  <p className="text-sm text-foreground">
                    <span className="text-muted-foreground">{t.toShort}</span> {s.to.hotel}
                  </p>
                </VerifyBlock>

                {/* Dates */}
                <VerifyBlock
                  title={t.datesHeading}
                  okLabel={t.datesOk}
                  checked={leg.dates}
                  onChange={(v) => onSetLegVerification(i, "dates", v)}
                >
                  <p className="text-sm text-foreground">
                    <span className="text-muted-foreground">{t.shipOutLabel}</span>{" "}
                    {s.shipmentDate}
                  </p>
                  <p className="text-sm text-foreground">
                    <span className="text-muted-foreground">{t.arriveLabel}</span>{" "}
                    {s.expectedArrival}
                  </p>
                </VerifyBlock>

                {/* Addresses + AI verification status */}
                <VerifyBlock
                  title={t.addressesHeading}
                  okLabel={t.addressesOk}
                  checked={leg.addresses}
                  onChange={(v) => onSetLegVerification(i, "addresses", v)}
                  footer={
                    <>
                      <AddressCheckBadge
                        t={t}
                        label={s.from.hotel}
                        check={fromCheck}
                      />
                      <AddressCheckBadge
                        t={t}
                        label={s.to.hotel}
                        check={toCheck}
                      />
                    </>
                  }
                >
                  <p className="text-sm text-foreground leading-snug">
                    <span className="text-muted-foreground">{t.fromShort}</span>{" "}
                    {s.from.address || s.from.city}
                  </p>
                  <p className="text-sm text-foreground leading-snug">
                    <span className="text-muted-foreground">{t.toShort}</span>{" "}
                    {s.to.address || s.to.city}
                  </p>
                </VerifyBlock>
              </li>
            )
          })}
        </ol>
      </section>

      {/* Totals + Generate CTA */}
      <section className="rounded-2xl bg-foreground text-background p-6 flex items-center justify-between gap-6">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-background/60 font-medium">
            {t.total}
          </p>
          <p className="text-2xl font-semibold mt-1">¥{totalAmount.toLocaleString()}</p>
          <p className="text-xs text-background/60 mt-1">
            {t.totalSuitcases(totalSuitcases)} · {t.legs(shipments.length)}
          </p>
        </div>
        <Button
          disabled={!allVerified}
          onClick={onGenerate}
          className="h-14 px-6 rounded-2xl bg-background text-foreground hover:bg-background/90 disabled:opacity-30"
        >
          {t.generateVouchers}
          <ArrowRight className="w-4 h-4 ml-2" strokeWidth={1.5} />
        </Button>
      </section>
      {!allVerified && (
        <p className="text-xs text-muted-foreground text-right">{t.verifyAll}</p>
      )}
      {generationError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" strokeWidth={1.5} />
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-xs font-medium text-amber-900">{t.generationFailed}</p>
            <p className="text-[11px] text-amber-800 break-words">{generationError}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// AI 検証結果のバッジ — canonical address があれば常に表示。
// pending: spinner
// canonical 有り: ✓ + 「AIで取得した住所」 + canonical を新行に表示 + see source
// failed のみ: amber 警告
function AddressCheckBadge({
  t,
  label,
  check,
}: {
  t: Messages
  label: string
  check?: AddressCheck
}) {
  if (!check) return null
  if (check.status === "pending") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-0.5">
        <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
        <span className="truncate">
          {t.aiVerifying} <span className="text-foreground/60">— {label}</span>
        </span>
      </div>
    )
  }
  // canonical address があれば、verified / low_confidence 関わらず信頼してOK表示にする
  if (check.canonicalAddress) {
    const isPerfect = check.status === "verified"
    return (
      <div className="text-xs py-0.5 space-y-0.5">
        <div className="flex items-center gap-2">
          <CheckCircle2
            className={`w-3.5 h-3.5 shrink-0 ${isPerfect ? "text-foreground" : "text-foreground/70"}`}
            strokeWidth={1.5}
          />
          <span className="text-foreground font-medium">
            {isPerfect ? t.aiVerified : t.aiFoundAddress}
          </span>
          <span className="text-muted-foreground truncate">— {label}</span>
          {check.citationUrl && (
            <a
              href={check.citationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-0.5 text-foreground/80 hover:text-foreground underline underline-offset-2 shrink-0"
              title={check.sourceTitle}
            >
              {t.aiSource}
              <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
            </a>
          )}
        </div>
        <p className="text-foreground/80 pl-5.5 break-words" style={{ paddingLeft: 22 }}>
          {check.canonicalAddress}
        </p>
      </div>
    )
  }
  // failed / canonical 無し → amber 警告 (本当に何も見つからない時)
  return (
    <div className="flex items-center gap-2 text-xs py-0.5">
      <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" strokeWidth={1.5} />
      <span className="text-amber-700 font-medium">{t.aiCouldNotVerify}</span>
      <span className="text-muted-foreground truncate">— {label}</span>
      {check.citationUrl && (
        <a
          href={check.citationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-0.5 text-foreground/80 hover:text-foreground underline underline-offset-2 shrink-0"
          title={check.sourceTitle}
        >
          {t.aiSource}
          <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
        </a>
      )}
    </div>
  )
}

function VerifyBlock({
  title,
  okLabel,
  checked,
  onChange,
  children,
  footer,
}: {
  title: string
  okLabel: string
  checked: boolean
  onChange: (v: boolean) => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        checked ? "border-foreground/40 bg-foreground/5" : "border-border bg-slate-50"
      }`}
    >
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium mb-2">
        {title}
      </p>
      <div className="space-y-1">{children}</div>
      {footer && <div className="mt-3 space-y-1">{footer}</div>}
      <div className="mt-3 pt-3 border-t border-border">
        <CheckRow checked={checked} onChange={onChange} label={okLabel} />
      </div>
    </div>
  )
}

function CheckRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none group">
      <span
        className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
          checked
            ? "bg-foreground border-foreground text-background"
            : "bg-white border-muted-foreground/40 group-hover:border-foreground/60"
        }`}
      >
        {checked && <Check className="w-3.5 h-3.5" strokeWidth={2.5} />}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        className={`text-sm ${checked ? "text-foreground font-medium" : "text-muted-foreground"}`}
      >
        {label}
      </span>
    </label>
  )
}

// ---------------------------------------------------------------------------
// Settings Modal — オペレーター情報 (旅行会社 / 担当者 / 連絡先) を localStorage に保存
// ---------------------------------------------------------------------------

function SettingsModal({
  t,
  initial,
  onSave,
  onCancel,
  canCancel,
}: {
  t: Messages
  initial: OperatorSettings | null
  onSave: (s: OperatorSettings) => void
  onCancel: () => void
  canCancel: boolean
}) {
  const [tourCompany, setTourCompany] = useState(initial?.tourCompany || "")
  const [contactName, setContactName] = useState(initial?.contactName || "")
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone || "")

  const canSave = tourCompany.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">{t.settingsTitle}</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">{t.settingsHint}</p>
          </div>
          {canCancel && (
            <button
              onClick={onCancel}
              className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" strokeWidth={1.5} />
            </button>
          )}
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t.settingsTourCompany}</label>
            <Input
              type="text"
              autoFocus
              placeholder={t.settingsTourCompanyPlaceholder}
              value={tourCompany}
              onChange={(e) => setTourCompany(e.target.value)}
              className="h-10"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t.settingsContactName}</label>
            <Input
              type="text"
              placeholder={t.settingsContactNamePlaceholder}
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="h-10"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t.settingsContactPhone}</label>
            <Input
              type="tel"
              placeholder={t.settingsContactPhonePlaceholder}
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              className="h-10"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          {canCancel && (
            <Button variant="outline" onClick={onCancel} className="h-10 px-4">
              {t.settingsCancel}
            </Button>
          )}
          <Button
            onClick={() => {
              if (!canSave) return
              onSave({
                tourCompany: tourCompany.trim(),
                contactName: contactName.trim(),
                contactPhone: contactPhone.trim(),
              })
            }}
            disabled={!canSave}
            className="h-10 px-4"
          >
            {t.settingsSave}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GeneratedView — 生成された PDF のダウンロード画面
// ---------------------------------------------------------------------------

function GeneratedView({
  t,
  docs,
  onReset,
}: {
  t: Messages
  docs: GeneratedDocs
  onReset: () => void
}) {
  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-border bg-white p-8 flex items-start gap-4">
        <div className="w-10 h-10 rounded-full bg-foreground/5 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-5 h-5 text-foreground" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold text-foreground">{t.docsReady}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t.bookingId} <span className="text-foreground/80 font-medium">{docs.bookingId}</span>
          </p>
        </div>
      </section>

      <section>
        <DocCard
          title={t.voucherCardTitle}
          subtitle={t.voucherCardSub}
          href={docs.voucherUrl}
          downloadName={`bondex-voucher-${docs.bookingId}.pdf`}
          downloadLabel={t.download}
          previewLabel={t.preview}
        />
      </section>

      {/* Yamato 送り状 (Ship&co API) */}
      {docs.yamatoLabels.length > 0 && (
        <section className="space-y-3">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
            {t.yamatoLabelsHeading}
          </p>
          {docs.yamatoLabels.map((y) => (
            <div
              key={y.legIndex}
              className="rounded-2xl border border-border bg-white p-4 flex items-start gap-3"
            >
              <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4 text-foreground" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t.yamatoLegLabel(y.legIndex + 1)}: {y.legLabel}
                </p>
                {y.status === "ok" ? (
                  <>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t.yamatoTracking}:{" "}
                      <span className="text-foreground/80 font-medium">
                        {y.trackingNumbers.join(", ") || "—"}
                      </span>
                    </p>
                    {y.labelUrl && (
                      <a
                        href={y.labelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-foreground hover:text-foreground/80 underline underline-offset-2 mt-2"
                      >
                        <Download className="w-3.5 h-3.5" strokeWidth={1.5} />
                        {t.download}
                      </a>
                    )}
                  </>
                ) : y.status === "deferred" ? (
                  <div className="mt-1">
                    <p className="text-xs text-sky-700 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
                      {y.issuableFrom ? t.yamatoDeferred(y.issuableFrom) : t.yamatoLabelFailed}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                      {t.yamatoDeferredNote}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-amber-700 mt-1 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
                    {t.yamatoLabelFailed}
                    {y.error && <span className="text-muted-foreground">— {y.error}</span>}
                  </p>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="flex items-center justify-end">
        <button
          onClick={onReset}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <RotateCcw className="w-4 h-4" strokeWidth={1.5} />
          {t.newBooking}
        </button>
      </div>
    </div>
  )
}

function DocCard({
  title,
  subtitle,
  href,
  downloadName,
  downloadLabel,
  previewLabel,
}: {
  title: string
  subtitle: string
  href: string
  downloadName: string
  downloadLabel: string
  previewLabel: string
}) {
  return (
    <div className="rounded-2xl border border-border bg-white overflow-hidden flex flex-col">
      <div className="p-6 flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5 text-foreground" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-medium text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{subtitle}</p>
        </div>
      </div>

      {/* インラインプレビュー (iframe) */}
      <div className="mx-6 mb-4 rounded-xl border border-border bg-slate-100 overflow-hidden">
        <iframe
          src={href}
          title={previewLabel}
          className="w-full h-72 border-0"
        />
      </div>

      <div className="px-6 pb-6">
        <a
          href={href}
          download={downloadName}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 w-full h-11 px-4 rounded-xl bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
        >
          <Download className="w-4 h-4" strokeWidth={1.5} />
          {downloadLabel}
        </a>
      </div>
    </div>
  )
}
