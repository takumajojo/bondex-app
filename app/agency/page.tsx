"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Loader2,
  Package,
  LogOut,
  ExternalLink,
  FileDown,
  Printer,
  Receipt,
  Plus,
  FolderOpen,
  Info,
  BookOpen,
  FileSignature,
  X,
  Check,
  AlertTriangle,
} from "lucide-react"
import { getBrowserSupabase } from "@/lib/supabase-browser"
import { AgencyCardSetup } from "@/components/agency-card-setup"
import { useAgencyLocale, AgencyLocaleToggle } from "@/lib/agency-i18n"
import { TrackingStepper, carrierTrackUrl, TRACK_STEPS } from "@/components/tracking-stepper"
import { AgencyContactFab } from "@/components/agency-contact-fab"

interface Shipment {
  id: string
  booking_id: string
  tour_number: string | null
  drive_url: string | null
  leg_index: number
  agency: string
  representative: string
  traveler_count: number
  shipment_date: string
  expected_arrival: string | null
  from_hotel: string
  to_hotel: string
  recipient: string
  suitcase_count: number
  amount_yen: number
  yamato_tracking: string[] | null
  yamato_label_url: string | null
  status: string
  carrier: string | null
  charged_at: string | null
  booking_type?: string | null
  created_at: string
}

const STATUS_META: Record<string, { cls: string }> = {
  requested:  { cls: "bg-violet-100 text-violet-800" },
  pending:    { cls: "bg-slate-100 text-slate-700" },
  issued:     { cls: "bg-blue-100 text-blue-800" },
  picked_up:  { cls: "bg-amber-100 text-amber-800" },
  in_transit: { cls: "bg-indigo-100 text-indigo-800" },
  delivered:  { cls: "bg-emerald-100 text-emerald-800" },
  failed:     { cls: "bg-red-100 text-red-800" },
  cancelled:  { cls: "bg-zinc-200 text-zinc-700" },
}

const messages = {
  en: {
    portal: "Agency Portal",
    defaultTitle: "Shipment status",
    signOut: "Sign out",
    noAgencyLinked: "No agency is linked to this account. Please contact BondEx support",
    pendingTitle: "Your account is awaiting approval",
    pendingBody:
      "Thank you for registering. Voucher issuance becomes available once BondEx approves your account — usually within one business day.",
    suspendedTitle: "Your account is suspended",
    suspendedBody:
      "We have something to confirm about your account. Please contact BondEx support (support@bondex.express).",
    cardTitle: "Register a payment card",
    cardBody:
      "You've selected card payment. Registering a card in advance saves you from entering it at each issuance (payment is finalized at pickup).",
    emptyState: "No shipments yet",
    waybill: "Waybill",
    waybillDlTitle: "Download the label PDF (A5). Print at actual size (100%).",
    waybillPrint: "A5 print",
    waybillPrintTitle: "Opens the A5 print page (Chrome/Edge open the dialog with A5 preset).",
    voucher: "Voucher",
    invoice: "Invoice / Receipt",
    driveFolder: "Folder",
    preparing: "Preparing",
    waybillLater: "Shipping label: issued about a month before shipping",
    newBooking: "New request",
    signContract: "Sign contract",
    signBannerTitle: "Please sign the service agreement to start",
    signBannerBody: "Review the agreement and agree & sign on-screen (no email needed). Issuing unlocks once signed.",
    signBannerBtn: "Review & sign the agreement",
    howto: "How to use",
    farNote:
      "Requests with a ship date more than a month away: shipping labels can't be created yet, so we'll prepare everything and contact you once it's within a month.",
    downloading: "Preparing…",
    dlError: "Download failed. Please try again.",
    actPlaceholder: "Actions…",
    actDates: "Change dates",
    actCount: "Change pieces",
    actCancel: "Cancel this leg",
    lockedTitle: "This leg is already issued",
    lockedBody:
      "The shipping label has been issued, so it can't be changed here (the label and the actual shipment must match). Please contact BondEx via the Contact button — we'll handle it for you.",
    lockedClose: "Close",
    dcTitle: "Change dates",
    dcShip: "Ship date",
    dcArrive: "Arrival date",
    ccTitle: "Change pieces",
    ccPieces: "Pieces",
    ccFeeNote: "The fee is fixed at issuance: pieces × ¥5,000 (excl. tax).",
    ccGroupNote: "For group bookings, edit the luggage list on the group dashboard.",
    cxTitle: "Cancel this leg",
    cxBody: "This leg will be cancelled. No label has been issued and nothing will be charged.",
    cxWarn: "This can't be undone from the portal.",
    confirmHeading: "Please confirm",
    confirmFrom: "Before",
    confirmTo: "After",
    confirmNext: "Review →",
    confirmBack: "← Back",
    confirmApply: "Apply",
    confirmCancelLeg: "Cancel the leg",
    actDone: "Updated. BondEx has been notified.",
    actCancelDone: "The leg has been cancelled. BondEx has been notified.",
    actFailed: "Update failed. Please try again.",
    shipPrefix: "Ship",
    arrivePrefix: "Arrive",
    status: {
      requested: "Requested",
      pending: "Pending",
      issued: "Issued",
      picked_up: "Picked up",
      in_transit: "In transit",
      delivered: "Delivered",
      failed: "Failed",
      cancelled: "Cancelled",
    } as Record<string, string>,
    th: {
      issuedDate: "Issued",
      bookingId: "Booking no.",
      representative: "Representative",
      leg: "Leg",
      schedule: "Ship / Arrive",
      count: "Items",
      tracking: "Tracking",
      status: "Status",
      documents: "Documents",
    },
    dateLocale: "en-US",
  },
  ja: {
    portal: "Agency Portal",
    defaultTitle: "案件状況",
    signOut: "サインアウト",
    noAgencyLinked: "アカウントに代理店が紐付いていません。BondEx 管理者にご連絡ください",
    pendingTitle: "アカウントは承認待ちです",
    pendingBody:
      "ご登録ありがとうございます。BondEx による承認が完了するとバウチャー発行がご利用いただけます。通常 1 営業日以内にご連絡します。",
    suspendedTitle: "アカウントは停止されています",
    suspendedBody:
      "ご利用状況についてご確認事項があります。BondEx サポート（support@bondex.express）までご連絡ください。",
    cardTitle: "お支払い用カードのご登録",
    cardBody:
      "カード払いをご選択いただいています。事前にカードをご登録いただくと、発行のたびに入力する必要がなくなります（決済は集荷完了時に確定します）。",
    emptyState: "案件がまだありません",
    waybill: "送り状",
    waybillDlTitle: "送り状PDF（A5）をダウンロード。印刷は実際のサイズ(100%)推奨。",
    waybillPrint: "A5印刷",
    waybillPrintTitle: "A5印刷ページを開きます（Chrome/Edgeは印刷ダイアログがA5で開きます）。",
    voucher: "バウチャー",
    invoice: "請求書/領収書",
    driveFolder: "フォルダ",
    preparing: "準備中",
    waybillLater: "送り状は発送の約1ヶ月前に発行します",
    newBooking: "新規発行",
    signContract: "契約書に署名",
    signBannerTitle: "運用開始には契約書への署名が必要です",
    signBannerBody: "業務委託契約書をご確認のうえ、その場で同意・署名してください（メール不要）。署名後に発行がご利用いただけます。",
    signBannerBtn: "契約書を確認して署名する",
    howto: "ご利用ガイド",
    farNote:
      "発送日が1ヶ月以上先の依頼は、送り状がまだ作成できません。1ヶ月前になりましたら書類一式をご用意し、まとめてご連絡します。",
    downloading: "準備中…",
    dlError: "ダウンロードに失敗しました。もう一度お試しください。",
    actPlaceholder: "アクション…",
    actDates: "日程を変更",
    actCount: "個数を変更",
    actCancel: "この区間を取り消し",
    lockedTitle: "この区間は発行済みです",
    lockedBody:
      "送り状が発行済みのため、こちらから変更できません（送り状と実際のお荷物を一致させる必要があるため）。お手数ですが「お問い合わせ」ボタンから BondEx にご連絡ください。こちらで対応いたします。",
    lockedClose: "閉じる",
    dcTitle: "日程を変更",
    dcShip: "発送日",
    dcArrive: "到着日",
    ccTitle: "個数を変更",
    ccPieces: "個数",
    ccFeeNote: "料金は発行時に「個数 × ¥5,000（税抜）」で確定します。",
    ccGroupNote: "団体予約の個数は、団体ダッシュボードの荷物リストから変更してください。",
    cxTitle: "この区間を取り消し",
    cxBody: "この区間を取り消します。送り状は未発行のため、課金は発生しません。",
    cxWarn: "ポータルからは元に戻せません。",
    confirmHeading: "内容のご確認",
    confirmFrom: "変更前",
    confirmTo: "変更後",
    confirmNext: "確認へ →",
    confirmBack: "← 戻る",
    confirmApply: "確定する",
    confirmCancelLeg: "区間を取り消す",
    actDone: "変更しました。BondEx にも通知済みです。",
    actCancelDone: "区間を取り消しました。BondEx にも通知済みです。",
    actFailed: "変更に失敗しました。もう一度お試しください。",
    shipPrefix: "発送",
    arrivePrefix: "到着",
    status: {
      requested: "依頼中",
      pending: "保留",
      issued: "発行済",
      picked_up: "集荷済",
      in_transit: "配達中",
      delivered: "配達完了",
      failed: "失敗",
      cancelled: "キャンセル",
    } as Record<string, string>,
    th: {
      issuedDate: "発行日",
      bookingId: "予約番号",
      representative: "代表者",
      leg: "区間",
      schedule: "発送日 / 到着日",
      count: "点数",
      tracking: "追跡",
      status: "状況",
      documents: "書類",
    },
    dateLocale: "ja-JP",
  },
} as const

export default function AgencyDashboard() {
  const router = useRouter()
  const { locale, setLocale } = useAgencyLocale()
  const t = messages[locale]
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [agencyName, setAgencyName] = useState("")
  const [userEmail, setUserEmail] = useState("")
  // error: Supabase 由来の生メッセージ (英語) / noAgency: 代理店未紐付けを識別子で保持し
  // レンダー時に翻訳する (ロケール切替で文言も追従させるため)
  const [error, setError] = useState("")
  const [noAgency, setNoAgency] = useState<{ detail?: string } | null>(null)
  const [agencyStatus, setAgencyStatus] = useState<string>("active")
  const [contractStatus, setContractStatus] = useState<string>("unsigned")
  const [paymentMethod, setPaymentMethod] = useState<string>("invoice")
  const [cardOnFile, setCardOnFile] = useState<boolean>(false)
  const [cardDismissed, setCardDismissed] = useState<boolean>(false)
  const [voucherBusy, setVoucherBusy] = useState<string | null>(null) // booking_id being fetched
  const [labelBusy, setLabelBusy] = useState<string | null>(null) // shipment id being fetched (送り状DL)
  const [invoiceBusy, setInvoiceBusy] = useState<string | null>(null) // shipment_id being fetched
  const [dlError, setDlError] = useState("")

  // 一覧のアクション (プルダウンから選択): 日程変更 / 個数変更 / 取り消し。
  // 未発行(requested/pending)のみ直接変更可。発行済みは locked モーダルで案内。
  const [actionTarget, setActionTarget] = useState<{
    shipment: Shipment
    action: "dates" | "count" | "cancel" | "locked"
  } | null>(null)
  const [actNote, setActNote] = useState("")

  const patchShipment = useCallback(
    async (id: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> => {
      try {
        const sb = getBrowserSupabase()
        const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
        if (!token) return { ok: false, error: messages[locale].dlError }
        const res = await fetch(`/api/agency/shipment/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) return { ok: false, error: d.error }
        return { ok: true }
      } catch {
        return { ok: false, error: "network" }
      }
    },
    [locale],
  )

  const load = useCallback(async () => {
    const sb = getBrowserSupabase()
    if (!sb) {
      setError("Supabase not configured")
      setLoading(false)
      return
    }
    // 1. セッション確認
    const { data: session } = await sb.auth.getSession()
    if (!session.session) {
      router.replace("/agency/login?next=/agency")
      return
    }
    setUserEmail(session.session.user.email || "")

    // 2. 自分の agency を取得 (status / 決済方法 / カード有無も)
    const { data: agency, error: aErr } = await sb
      .from("agencies")
      .select("name, status, payment_method, card_on_file, contract_status")
      .maybeSingle()
    if (aErr) {
      setNoAgency({ detail: aErr.message })
      setLoading(false)
      return
    }
    if (!agency) {
      setNoAgency({})
      setLoading(false)
      return
    }
    setAgencyName(agency.name)
    setAgencyStatus((agency as { status?: string }).status || "active")
    setContractStatus((agency as { contract_status?: string }).contract_status || "unsigned")
    setPaymentMethod((agency as { payment_method?: string }).payment_method || "invoice")
    setCardOnFile(Boolean((agency as { card_on_file?: boolean }).card_on_file))

    // 3. shipments を取得 (RLS で自社のみフィルタ済み)
    const { data, error: sErr } = await sb
      .from("shipments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200)
    if (sErr) {
      setError(sErr.message)
      setLoading(false)
      return
    }
    setShipments((data as Shipment[]) || [])
    setLoading(false)
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  const onLogout = async () => {
    const sb = getBrowserSupabase()
    if (sb) await sb.auth.signOut()
    router.replace("/agency/login")
  }

  // バウチャー再発行: 代理店 JWT を Authorization ヘッダに載せて自社限定エンドポイントを叩く。
  // <a href> ではヘッダを付けられない (Supabase セッションは Cookie でなく localStorage)
  // ため、fetch → blob → クライアント側でダウンロードを発火させる。
  const downloadVoucher = useCallback(async (bookingId: string) => {
    setDlError("")
    setVoucherBusy(bookingId)
    try {
      const sb = getBrowserSupabase()
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
      if (!token) {
        setDlError(messages[locale].dlError)
        return
      }
      const res = await fetch(`/api/agency/voucher?booking_id=${encodeURIComponent(bookingId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setDlError(messages[locale].dlError)
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get("Content-Disposition") || ""
      const m = cd.match(/filename="?([^"]+)"?/)
      const fileName = m?.[1] || `${bookingId}_voucher.pdf`
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setDlError(messages[locale].dlError)
    } finally {
      setVoucherBusy(null)
    }
  }, [locale])

  // 送り状(A5 PDF)を自社限定エンドポイントから DL。全ブラウザ/プリンターで確実な主導線。
  // ファイル名は API 側で旅程番号込みに整形される。
  const downloadLabel = useCallback(async (bookingId: string, legIndex: number) => {
    setDlError("")
    const key = `${bookingId}-${legIndex}`
    setLabelBusy(key)
    try {
      const sb = getBrowserSupabase()
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
      if (!token) { setDlError(messages[locale].dlError); return }
      const res = await fetch(
        `/api/agency/label?booking_id=${encodeURIComponent(bookingId)}&leg_index=${legIndex}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok) { setDlError(messages[locale].dlError); return }
      const blob = await res.blob()
      const cd = res.headers.get("Content-Disposition") || ""
      const m = cd.match(/filename="?([^"]+)"?/)
      const fileName = m?.[1] || `BondEx_${bookingId}_L${legIndex + 1}_Label.pdf`
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setDlError(messages[locale].dlError)
    } finally {
      setLabelBusy(null)
    }
  }, [locale])

  // カード決済済み区間の「請求書 兼 領収書」DL。voucher と同じ JWT→blob 方式。
  const downloadInvoice = useCallback(async (shipmentId: string) => {
    setDlError("")
    setInvoiceBusy(shipmentId)
    try {
      const sb = getBrowserSupabase()
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
      if (!token) {
        setDlError(messages[locale].dlError)
        return
      }
      const res = await fetch(`/api/agency/invoice?shipment_id=${encodeURIComponent(shipmentId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setDlError(messages[locale].dlError)
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get("Content-Disposition") || ""
      const m = cd.match(/filename="?([^"]+)"?/)
      const fileName = m?.[1] || `bondex-receipt-${shipmentId}.pdf`
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setDlError(messages[locale].dlError)
    } finally {
      setInvoiceBusy(null)
    }
  }, [locale])

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      issued: 0, picked_up: 0, in_transit: 0, delivered: 0,
    }
    shipments.forEach((it) => { c[it.status] = (c[it.status] || 0) + 1 })
    return c
  }, [shipments])

  // 発送日が 1ヶ月以上先の「依頼中」がある = 送り状はまだ作れない → まとめ連絡の案内を出す
  const hasFarRequested = useMemo(() => {
    const cutoff = Date.now() + 30 * 86_400_000
    return shipments.some(
      (it) =>
        it.status === "requested" &&
        it.shipment_date &&
        new Date(`${it.shipment_date}T00:00:00`).getTime() > cutoff,
    )
  }, [shipments])

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bondex-logo.png" alt="BondEx" className="h-9 sm:h-10 w-auto object-contain shrink-0" />
            <div className="border-l border-border pl-3 sm:pl-4 min-w-0">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium hidden sm:block">
                {t.portal}
              </p>
              <h1 className="text-base sm:text-xl font-semibold text-foreground sm:mt-0.5 truncate">
                {agencyName || t.defaultTitle}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            {!error && !noAgency && agencyStatus === "active" && contractStatus === "signed" && (
              <Link
                href="/agency/new"
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#C8102E] text-white text-sm font-semibold hover:bg-[#A00D25]"
              >
                <Plus className="w-4 h-4" strokeWidth={2.2} />
                {t.newBooking}
              </Link>
            )}
            {!error && !noAgency && agencyStatus === "active" && contractStatus !== "signed" && (
              <Link
                href="/agency/contract"
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#C8102E] text-white text-sm font-semibold hover:bg-[#A00D25]"
              >
                <FileSignature className="w-4 h-4" strokeWidth={2.2} />
                {t.signContract}
              </Link>
            )}
            {/* お客様お渡し用ガイド。認証不要の /api/howto (静的PDF) を別タブで開く。
                ゲスト向け資料なので日本語版は無く、既定は EN。他言語 (zh/it/fr/es) は
                予約完了画面からその予約のバウチャー言語で出力する。 */}
            <a
              href="/api/howto?lang=en"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-sm text-foreground hover:bg-slate-50"
              title={t.howto}
            >
              <BookOpen className="w-4 h-4" strokeWidth={1.6} />
              {/* スマホでは幅が足りないのでアイコンのみ (ヘッダーの折返し防止) */}
              <span className="hidden sm:inline">{t.howto}</span>
            </a>
            <AgencyLocaleToggle locale={locale} onChange={setLocale} />
            {userEmail && (
              <span className="text-xs text-muted-foreground hidden sm:inline">{userEmail}</span>
            )}
            <button
              onClick={onLogout}
              title={t.signOut}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground shrink-0"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.5} />
              <span className="hidden sm:inline">{t.signOut}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {!error && !noAgency && agencyStatus === "active" && contractStatus !== "signed" && (
          <div className="rounded-xl border border-[#C8102E]/30 bg-[#C8102E]/5 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-3">
              <FileSignature className="w-5 h-5 text-[#C8102E] mt-0.5 shrink-0" strokeWidth={1.8} />
              <div>
                <p className="text-sm font-semibold text-foreground">{t.signBannerTitle}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{t.signBannerBody}</p>
              </div>
            </div>
            <Link
              href="/agency/contract"
              className="shrink-0 inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg bg-[#C8102E] text-white text-sm font-semibold hover:bg-[#A00D25]"
            >
              <FileSignature className="w-4 h-4" strokeWidth={2.2} />
              {t.signBannerBtn}
            </Link>
          </div>
        )}
        {(error || noAgency) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {noAgency
              ? `${t.noAgencyLinked}${noAgency.detail ? ` (${noAgency.detail})` : ""}`
              : error}
          </div>
        )}

        {/* 承認待ち: BondEx が承認するまで発行不可 */}
        {!error && !noAgency && agencyStatus === "pending" && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">{t.pendingTitle}</p>
            <p className="text-[13px] text-amber-800 mt-1 leading-relaxed">{t.pendingBody}</p>
          </div>
        )}
        {!error && !noAgency && agencyStatus === "suspended" && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-900">{t.suspendedTitle}</p>
            <p className="text-[13px] text-red-800 mt-1 leading-relaxed">{t.suspendedBody}</p>
          </div>
        )}

        {/* カード払い かつ カード未登録 → 登録を推奨 (登録済み/請求書払いには出さない) */}
        {!error && !noAgency && paymentMethod === "card" && !cardOnFile && !cardDismissed && (
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{t.cardTitle}</p>
                <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">{t.cardBody}</p>
              </div>
            </div>
            <AgencyCardSetup
              onDone={() => setCardOnFile(true)}
              onCancel={() => setCardDismissed(true)}
            />
          </div>
        )}

        {/* 発送1ヶ月以上先の依頼がある: まとめ連絡の案内 */}
        {!error && !noAgency && hasFarRequested && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" strokeWidth={1.6} />
            <p className="text-[12px] text-amber-900 leading-relaxed">{t.farNote}</p>
          </div>
        )}

        {/* Status summary */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(["issued","picked_up","in_transit","delivered"] as const).map((st) => (
            <div key={st} className="rounded-xl border border-border bg-white p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                {t.status[st]}
              </p>
              <p className="text-2xl font-semibold tabular-nums">{counts[st]}</p>
            </div>
          ))}
        </section>

        {dlError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            {dlError}
          </div>
        )}

        {actNote && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
            {actNote}
            <button onClick={() => setActNote("")} className="ml-auto text-emerald-700 hover:text-emerald-900">
              <X className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          </div>
        )}

        <section className="rounded-2xl border border-border bg-white overflow-hidden">
          {loading ? (
            <div className="p-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" strokeWidth={1.5} />
            </div>
          ) : shipments.length === 0 ? (
            <div className="p-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Package className="w-8 h-8" strokeWidth={1.5} />
              <span className="text-sm">{t.emptyState}</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="text-left p-3 font-medium">{t.th.issuedDate}</th>
                    <th className="text-left p-3 font-medium">{t.th.bookingId}</th>
                    <th className="text-left p-3 font-medium">{t.th.representative}</th>
                    <th className="text-left p-3 font-medium">{t.th.leg}</th>
                    <th className="text-left p-3 font-medium">{t.th.schedule}</th>
                    <th className="text-right p-3 font-medium">{t.th.count}</th>
                    <th className="text-left p-3 font-medium">{t.th.tracking}</th>
                    <th className="text-left p-3 font-medium">{t.th.status}</th>
                    <th className="text-left p-3 font-medium">{t.th.documents}</th>
                  </tr>
                </thead>
                <tbody>
                  {shipments.map((it) => (
                    <tr key={it.id} className="border-t border-border hover:bg-muted/20">
                      <td className="p-3">
                        {new Date(it.created_at).toLocaleDateString(t.dateLocale)}
                      </td>
                      <td className="p-3">
                        {it.tour_number ? (
                          <div className="leading-tight">
                            <span className="text-sm text-foreground">{it.tour_number}</span>
                            <span className="block font-mono text-[10px] text-muted-foreground mt-0.5">
                              {it.booking_id}-L{it.leg_index + 1}
                            </span>
                          </div>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">
                            {it.booking_id}-L{it.leg_index + 1}
                          </span>
                        )}
                        {it.booking_type === "group" && (
                          <a
                            href={`/agency/groups/${encodeURIComponent(it.booking_id)}`}
                            className="mt-1 inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800 hover:bg-violet-200"
                          >
                            {locale === "ja" ? "団体 →" : "Group →"}
                          </a>
                        )}
                      </td>
                      <td className="p-3">{it.representative}</td>
                      <td className="p-3 text-xs">
                        {it.from_hotel}
                        <br />
                        <span className="text-muted-foreground">↓</span>
                        <br />
                        {it.to_hotel}
                      </td>
                      <td className="p-3 text-xs whitespace-nowrap">
                        <div>
                          <span className="text-muted-foreground">{t.shipPrefix}</span> {it.shipment_date || "—"}
                        </div>
                        <div>
                          <span className="text-muted-foreground">{t.arrivePrefix}</span> {it.expected_arrival || "—"}
                        </div>
                      </td>
                      <td className="p-3 text-right tabular-nums">{it.suitcase_count}</td>
                      <td className="p-3">
                        {it.yamato_tracking && it.yamato_tracking.length > 0 ? (
                          <a
                            href={carrierTrackUrl(it.carrier ?? "sagawa", it.yamato_tracking[0])}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-mono text-[#C8102E] hover:underline"
                          >
                            {it.yamato_tracking[0]}
                            <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_META[it.status]?.cls || "bg-zinc-100"}`}>
                          {t.status[it.status] || it.status}
                        </span>
                        {(TRACK_STEPS as readonly string[]).includes(it.status) && (
                          <div className="mt-2 w-44 max-w-full">
                            <TrackingStepper
                              status={it.status}
                              steps={[t.status.issued, t.status.picked_up, t.status.in_transit, t.status.delivered] as [string, string, string, string]}
                              compact
                            />
                          </div>
                        )}
                        {/* アクション: プルダウンで選択 → 必ず確認画面を挟んで適用 */}
                        {it.status !== "cancelled" && it.status !== "delivered" && (
                          <select
                            value=""
                            onChange={(e) => {
                              const v = e.target.value as "dates" | "count" | "cancel" | ""
                              e.target.value = ""
                              if (!v) return
                              const editable = it.status === "requested" || it.status === "pending"
                              setActNote("")
                              if (!editable) {
                                setActionTarget({ shipment: it, action: "locked" })
                                return
                              }
                              setActionTarget({ shipment: it, action: v })
                            }}
                            className="mt-2 h-8 w-40 max-w-full rounded-lg border border-border bg-white px-2 text-xs text-muted-foreground hover:border-foreground/40"
                          >
                            <option value="">{t.actPlaceholder}</option>
                            <option value="dates">{t.actDates}</option>
                            {it.booking_type !== "group" && <option value="count">{t.actCount}</option>}
                            <option value="cancel">{t.actCancel}</option>
                          </select>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-col items-start gap-1.5">
                          {it.drive_url && (
                            <a
                              href={it.drive_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-[#C8102E] font-medium hover:underline"
                              title={t.driveFolder}
                            >
                              <FolderOpen className="w-3.5 h-3.5" strokeWidth={1.6} />
                              {t.driveFolder}
                              <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                            </a>
                          )}
                          {/* バウチャーは Ship&co 不要 = 依頼直後 (requested) でも常にDL可能 */}
                          <button
                            type="button"
                            onClick={() => downloadVoucher(it.booking_id)}
                            disabled={voucherBusy === it.booking_id}
                            className="inline-flex items-center gap-1 text-xs text-foreground hover:text-[#C8102E] disabled:opacity-50"
                            title={`${t.voucher} (${it.booking_id})`}
                          >
                            {voucherBusy === it.booking_id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
                            ) : (
                              <FileDown className="w-3.5 h-3.5" strokeWidth={1.5} />
                            )}
                            {voucherBusy === it.booking_id ? t.downloading : t.voucher}
                          </button>
                          {it.yamato_label_url && (
                            <div className="inline-flex items-center gap-3">
                              {/* 主導線: 送り状PDF(A5)をDL。全ブラウザ/プリンターで確実。印刷は実寸(100%)推奨。 */}
                              <button
                                type="button"
                                onClick={() => downloadLabel(it.booking_id, it.leg_index)}
                                disabled={labelBusy === `${it.booking_id}-${it.leg_index}`}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-[#C8102E] hover:text-[#a60d26] disabled:opacity-50"
                                title={t.waybillDlTitle}
                              >
                                {labelBusy === `${it.booking_id}-${it.leg_index}` ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
                                ) : (
                                  <Receipt className="w-3.5 h-3.5" strokeWidth={1.5} />
                                )}
                                {t.waybill}
                              </button>
                              {/* 補助: Chrome/Edge向け A5自動印刷 */}
                              <a
                                href={`/agency/print-label?booking_id=${encodeURIComponent(it.booking_id)}&leg_index=${it.leg_index}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                                title={t.waybillPrintTitle}
                              >
                                <Printer className="w-3 h-3" strokeWidth={1.5} />
                                {t.waybillPrint}
                              </a>
                            </div>
                          )}
                          {/* カード決済済みなら請求書 兼 領収書を DL 可能 */}
                          {it.charged_at && (
                            <button
                              type="button"
                              onClick={() => downloadInvoice(it.id)}
                              disabled={invoiceBusy === it.id}
                              className="inline-flex items-center gap-1 text-xs text-foreground hover:text-[#C8102E] disabled:opacity-50"
                              title={`${t.invoice} (${it.booking_id}-L${it.leg_index + 1})`}
                            >
                              {invoiceBusy === it.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
                              ) : (
                                <FileDown className="w-3.5 h-3.5" strokeWidth={1.5} />
                              )}
                              {invoiceBusy === it.id ? t.downloading : t.invoice}
                            </button>
                          )}
                          {it.status === "requested" && (
                            <span className="text-[11px] text-muted-foreground">{t.waybillLater}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      {actionTarget && (
        <AgencyActionModal
          t={t}
          target={actionTarget}
          onClose={() => setActionTarget(null)}
          onApply={(body) => patchShipment(actionTarget.shipment.id, body)}
          onDone={(msg) => {
            setActionTarget(null)
            setActNote(msg)
            void load()
          }}
        />
      )}
      <AgencyContactFab />
    </main>
  )
}

// ---------------------------------------------------------------------------
// 一覧アクションのモーダル — 日程変更/個数変更は「入力 → 確認画面 → 適用」の2段階、
// 取り消しは確認画面のみ、発行済み(locked)は案内のみ。誤操作防止 (谷口さん指示)。
// ---------------------------------------------------------------------------
function AgencyActionModal({
  t,
  target,
  onClose,
  onApply,
  onDone,
}: {
  t: (typeof messages)[keyof typeof messages]
  target: { shipment: Shipment; action: "dates" | "count" | "cancel" | "locked" }
  onClose: () => void
  onApply: (body: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>
  onDone: (msg: string) => void
}) {
  const { shipment: s, action } = target
  const [phase, setPhase] = useState<"edit" | "confirm">(
    action === "cancel" || action === "locked" ? "confirm" : "edit",
  )
  const [ship, setShip] = useState(s.shipment_date)
  const [arr, setArr] = useState(s.expected_arrival || s.shipment_date)
  const [count, setCount] = useState(s.suitcase_count)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  const legRef = `${s.booking_id}-L${s.leg_index + 1}`
  const route = `${s.from_hotel} → ${s.to_hotel}`
  const DATE_OK = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
  const addDays = (ymd: string, days: number) => {
    const d = new Date(`${ymd}T00:00:00Z`)
    if (isNaN(d.getTime())) return ymd
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }
  // 発送日を動かしたら到着日もオフセット維持で連動 (据え置き防止)
  const onShipChange = (v: string) => {
    if (DATE_OK(v) && DATE_OK(ship) && DATE_OK(arr)) {
      const delta = Math.round((Date.parse(`${v}T00:00:00Z`) - Date.parse(`${ship}T00:00:00Z`)) / 86_400_000)
      setArr(addDays(arr, delta))
    }
    setShip(v)
  }

  const datesChanged = ship !== s.shipment_date || arr !== (s.expected_arrival || s.shipment_date)
  const countChanged = count !== s.suitcase_count
  const invalid =
    action === "dates"
      ? !DATE_OK(ship) || !DATE_OK(arr) || arr < ship || !datesChanged
      : action === "count"
        ? count < 1 || count > 50 || !countChanged
        : false

  const apply = async () => {
    setBusy(true)
    setErr("")
    const body: Record<string, unknown> =
      action === "cancel"
        ? { cancel: true }
        : action === "dates"
          ? { shipmentDate: ship, expectedArrival: arr }
          : { suitcaseCount: count }
    const r = await onApply(body)
    if (r.ok) {
      onDone(action === "cancel" ? t.actCancelDone : t.actDone)
    } else {
      setErr(r.error || t.actFailed)
      setBusy(false)
    }
  }

  const title =
    action === "dates" ? t.dcTitle : action === "count" ? t.ccTitle : action === "cancel" ? t.cxTitle : t.lockedTitle

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              {legRef} ・ {route}
            </p>
          </div>
          <button onClick={onClose} className="p-1 -m-1 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        {action === "locked" ? (
          <>
            <p className="text-sm text-foreground leading-relaxed">{t.lockedBody}</p>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="h-10 px-4 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90"
              >
                {t.lockedClose}
              </button>
            </div>
          </>
        ) : action === "cancel" ? (
          <>
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-1">
              <p className="text-sm text-red-900">{t.cxBody}</p>
              <p className="text-xs font-medium text-red-800 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2} />
                {t.cxWarn}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-slate-50/60 p-3 text-sm">
              <p className="text-foreground">{route}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t.dcShip}: {s.shipment_date} ・ {t.ccPieces}: {s.suitcase_count}
              </p>
            </div>
            {err && <p className="text-xs text-red-700">{err}</p>}
            <div className="flex items-center justify-end gap-2">
              <button onClick={onClose} className="h-10 px-4 rounded-lg border border-border bg-white text-sm hover:bg-muted/40">
                {t.confirmBack}
              </button>
              <button
                onClick={() => void apply()}
                disabled={busy}
                className="h-10 px-4 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />}
                {t.confirmCancelLeg}
              </button>
            </div>
          </>
        ) : phase === "edit" ? (
          <>
            {action === "dates" ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">{t.dcShip}</label>
                  <input
                    type="date"
                    value={ship}
                    onChange={(e) => onShipChange(e.target.value)}
                    className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">{t.dcArrive}</label>
                  <input
                    type="date"
                    value={arr}
                    min={ship || undefined}
                    onChange={(e) => setArr(e.target.value)}
                    className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">{t.ccPieces}</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={count}
                    onChange={(e) => setCount(Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1))))}
                    className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-center"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">{t.ccFeeNote}</p>
              </div>
            )}
            {err && <p className="text-xs text-red-700">{err}</p>}
            <div className="flex items-center justify-end gap-2">
              <button onClick={onClose} className="h-10 px-4 rounded-lg border border-border bg-white text-sm hover:bg-muted/40">
                {t.lockedClose}
              </button>
              <button
                onClick={() => setPhase("confirm")}
                disabled={invalid}
                className="h-10 px-4 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50"
              >
                {t.confirmNext}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs font-medium text-muted-foreground">{t.confirmHeading}</p>
            <div className="rounded-xl border border-border overflow-hidden text-sm">
              <div className="grid grid-cols-2 divide-x divide-border">
                <div className="p-3 bg-slate-50/60">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{t.confirmFrom}</p>
                  {action === "dates" ? (
                    <>
                      <p className="text-foreground">{s.shipment_date}</p>
                      <p className="text-xs text-muted-foreground">→ {s.expected_arrival || s.shipment_date}</p>
                    </>
                  ) : (
                    <p className="text-foreground tabular-nums">{s.suitcase_count}</p>
                  )}
                </div>
                <div className="p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{t.confirmTo}</p>
                  {action === "dates" ? (
                    <>
                      <p className="font-medium text-foreground">{ship}</p>
                      <p className="text-xs text-muted-foreground">→ {arr}</p>
                    </>
                  ) : (
                    <p className="font-medium text-foreground tabular-nums">{count}</p>
                  )}
                </div>
              </div>
            </div>
            {action === "count" && <p className="text-[11px] text-muted-foreground">{t.ccFeeNote}</p>}
            {err && <p className="text-xs text-red-700">{err}</p>}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setPhase("edit")}
                className="h-10 px-4 rounded-lg border border-border bg-white text-sm hover:bg-muted/40"
              >
                {t.confirmBack}
              </button>
              <button
                onClick={() => void apply()}
                disabled={busy}
                className="h-10 px-4 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />}
                {t.confirmApply}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
