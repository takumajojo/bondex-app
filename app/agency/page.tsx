"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Loader2,
  Package,
  LogOut,
  ExternalLink,
  FileDown,
  Receipt,
} from "lucide-react"
import { getBrowserSupabase } from "@/lib/supabase-browser"
import { AgencyCardSetup } from "@/components/agency-card-setup"
import { useAgencyLocale, AgencyLocaleToggle } from "@/lib/agency-i18n"

interface Shipment {
  id: string
  booking_id: string
  tour_number: string | null
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
  created_at: string
}

const STATUS_META: Record<string, { cls: string }> = {
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
    voucher: "Voucher",
    downloading: "Preparing…",
    dlError: "Download failed. Please try again.",
    shipPrefix: "Ship",
    arrivePrefix: "Arrive",
    status: {
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
    voucher: "バウチャー",
    downloading: "準備中…",
    dlError: "ダウンロードに失敗しました。もう一度お試しください。",
    shipPrefix: "発送",
    arrivePrefix: "到着",
    status: {
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
  const [paymentMethod, setPaymentMethod] = useState<string>("invoice")
  const [cardOnFile, setCardOnFile] = useState<boolean>(false)
  const [cardDismissed, setCardDismissed] = useState<boolean>(false)
  const [voucherBusy, setVoucherBusy] = useState<string | null>(null) // booking_id being fetched
  const [dlError, setDlError] = useState("")

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
      .select("name, status, payment_method, card_on_file")
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

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      issued: 0, picked_up: 0, in_transit: 0, delivered: 0,
    }
    shipments.forEach((it) => { c[it.status] = (c[it.status] || 0) + 1 })
    return c
  }, [shipments])

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bondex-logo.png" alt="BondEx" className="h-10 w-auto object-contain" />
            <div className="border-l border-border pl-4">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
                {t.portal}
              </p>
              <h1 className="text-xl font-semibold text-foreground mt-0.5">
                {agencyName || t.defaultTitle}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <AgencyLocaleToggle locale={locale} onChange={setLocale} />
            {userEmail && (
              <span className="text-xs text-muted-foreground hidden sm:inline">{userEmail}</span>
            )}
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.5} />
              {t.signOut}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
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
              <table className="w-full text-sm">
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
                          <span className="text-[11px] font-mono">{it.yamato_tracking[0]}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_META[it.status]?.cls || "bg-zinc-100"}`}>
                          {t.status[it.status] || it.status}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-col items-start gap-1.5">
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
                            <a
                              href={it.yamato_label_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              <Receipt className="w-3.5 h-3.5" strokeWidth={1.5} />
                              {t.waybill}
                              <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                            </a>
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
    </main>
  )
}
