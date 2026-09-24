"use client"

// 代理店ビュー（管理者専用・読み取り専用）— 2026-09-08 谷口さん指示。
//
// 「代理店が見ている画面（予約一覧・ステータス・追跡・書類）」を、運営(管理者)だけが
// 確認できるようにする。なりすまし(代理店セッションの発行)は一切しない:
//   - このページは /operator/ 配下 = middleware の運営認証で既定deny（管理者のみ到達可）
//   - データは運営権限の /api/shipments?agency=<名> から取得（代理店JWTを使わない）
//   - 書類は運営用エンドポイント (/api/voucher/regenerate, /api/voucher/labels) にリンク
//   - 一切の操作(作成・課金・変更)を持たない純閲覧。編集は通常の運営画面から行う。
import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft,
  Loader2,
  Package,
  Eye,
  ExternalLink,
  FileText,
  Printer,
  FolderOpen,
  RotateCcw,
} from "lucide-react"
import { TrackingStepper, carrierTrackUrl } from "@/components/tracking-stepper"
import { WAYBILL_UI_ENABLED } from "@/lib/waybill-issuance"

type Shipment = {
  id: string
  booking_id: string
  leg_index: number
  agency: string
  representative: string
  traveler_count: number
  tour_number: string | null
  booking_name: string | null
  group_name: string | null
  booking_type: string | null
  shipment_date: string
  expected_arrival: string | null
  from_prefecture: string | null
  from_hotel_ja: string | null
  from_hotel: string
  to_prefecture: string | null
  to_hotel_ja: string | null
  to_hotel: string
  recipient: string
  suitcase_count: number
  amount_yen: number
  status: string
  carrier: string | null
  yamato_tracking: string[] | null
  yamato_label_url: string | null
  drive_url: string | null
  charged_at: string | null
  created_at: string
}

// 運営向け日本語ステータス（一覧・詳細と同じ語彙）。
const STATUS_LABELS: Record<string, { ja: string; cls: string }> = {
  requested: { ja: "依頼中", cls: "bg-violet-100 text-violet-800" },
  pending: { ja: "保留", cls: "bg-amber-100 text-amber-800" },
  issued: { ja: "手配済", cls: "bg-blue-100 text-blue-800" },
  picked_up: { ja: "集荷済", cls: "bg-violet-100 text-violet-800" },
  in_transit: { ja: "配達中", cls: "bg-indigo-100 text-indigo-800" },
  delivered: { ja: "配達完了", cls: "bg-emerald-100 text-emerald-800" },
  failed: { ja: "失敗", cls: "bg-red-100 text-red-700" },
  cancelled: { ja: "キャンセル", cls: "bg-gray-200 text-gray-600" },
}

const TRACK_STEPS_JA: [string, string, string, string] = ["手配済", "集荷済", "配送中", "配達完了"]

type Booking = {
  bookingId: string
  head: Shipment
  legs: Shipment[]
}

function ViewAsAgency() {
  const params = useSearchParams()
  const agency = (params.get("agency") || "").trim()
  const [rows, setRows] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [expired, setExpired] = useState(false)

  const load = useCallback(async () => {
    if (!agency) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError("")
    setExpired(false)
    try {
      const res = await fetch(
        `/api/shipments?agency=${encodeURIComponent(agency)}&limit=200`,
      )
      if (res.status === 401) {
        setExpired(true)
        setLoading(false)
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "読み込みに失敗しました")
      setRows((data.shipments || []) as Shipment[])
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました")
    }
    setLoading(false)
  }, [agency])

  useEffect(() => {
    void load()
  }, [load])

  // 予約番号ごとに区間をまとめる（代理店ポータルと同じ「予約単位」の見え方）。
  const bookings = useMemo<Booking[]>(() => {
    const byId = new Map<string, Shipment[]>()
    for (const r of rows) {
      const arr = byId.get(r.booking_id) || []
      arr.push(r)
      byId.set(r.booking_id, arr)
    }
    const list: Booking[] = []
    for (const [bookingId, legs] of byId) {
      legs.sort((a, b) => a.leg_index - b.leg_index)
      list.push({ bookingId, head: legs[0], legs })
    }
    // 新しい予約が上（依頼日の降順）。
    list.sort((a, b) => (b.head.created_at || "").localeCompare(a.head.created_at || ""))
    return list
  }, [rows])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of rows) c[r.status] = (c[r.status] || 0) + 1
    return c
  }, [rows])

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
              BondEx Operator ・ 代理店ビュー
            </p>
            <h1 className="text-lg font-semibold text-foreground">{agency || "（代理店未指定）"}</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.6} />
              再読み込み
            </button>
            <Link
              href="/operator/agencies"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
              代理店管理へ
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* 読み取り専用であることを明示（誤操作・誤解の防止） */}
        <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3">
          <Eye className="w-4 h-4 mt-0.5 shrink-0 text-sky-700" strokeWidth={1.8} />
          <p className="text-[12px] leading-relaxed text-sky-900">
            これは<strong>管理者だけが見られる読み取り専用ビュー</strong>です。代理店に代わっての作成・変更・課金はできません
            （代理店が見ている予約一覧・ステータス・追跡・書類を確認するためのものです）。編集は通常の運営画面から行ってください。
          </p>
        </div>

        {!agency && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            代理店が指定されていません。
            <Link href="/operator/agencies" className="ml-1 underline underline-offset-2">
              代理店管理
            </Link>
            から「画面を見る」を選んでください。
          </div>
        )}

        {expired && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-center gap-3 flex-wrap">
            <span>運営セッションが切れました。再度サインインしてください。</span>
            <Link
              href={`/operator/login?next=${encodeURIComponent(`/operator/agencies/view?agency=${agency}`)}`}
              className="rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
            >
              サインイン
            </Link>
          </div>
        )}

        {error && !expired && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
        )}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.6} />
            読み込み中…
          </p>
        ) : agency && !error && !expired ? (
          <>
            {/* ステータス集計（代理店ポータルと同じ4区分） */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(["issued", "picked_up", "in_transit", "delivered"] as const).map((st) => (
                <div key={st} className="rounded-xl border border-border bg-white p-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                    {STATUS_LABELS[st].ja}
                  </p>
                  <p className="text-2xl font-semibold tabular-nums">{counts[st] || 0}</p>
                </div>
              ))}
            </section>

            {bookings.length === 0 ? (
              <div className="rounded-2xl border border-border bg-white p-16 flex flex-col items-center gap-3 text-muted-foreground">
                <Package className="w-8 h-8" strokeWidth={1.5} />
                <span className="text-sm">この代理店の予約はまだありません</span>
              </div>
            ) : (
              <section className="space-y-3">
                {bookings.map((b) => (
                  <article key={b.bookingId} className="rounded-2xl border border-border bg-white p-5">
                    {/* 予約ヘッダー */}
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-foreground">{b.bookingId}</span>
                          {b.head.booking_type === "group" && (
                            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">
                              団体
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {b.head.representative}（{b.head.traveler_count}名）
                          {b.head.tour_number ? ` ・ ツアー ${b.head.tour_number}` : ""}
                          {b.head.booking_name ? ` ・ 貴社Ref ${b.head.booking_name}` : ""}
                        </p>
                      </div>
                      {/* 予約単位の書類（運営用エンドポイント＝管理者権限で開く） */}
                      <div className="flex flex-wrap items-center gap-2">
                        <a
                          href={`/api/voucher/regenerate?booking_id=${encodeURIComponent(b.bookingId)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-slate-50"
                        >
                          <FileText className="w-3 h-3" strokeWidth={1.6} />
                          バウチャー
                        </a>
                        {WAYBILL_UI_ENABLED && (
                        <a
                          href={`/api/voucher/labels?booking_id=${encodeURIComponent(b.bookingId)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-slate-50"
                        >
                          <Printer className="w-3 h-3" strokeWidth={1.6} />
                          送り状
                        </a>
                        )}
                        {b.head.drive_url && (
                          <a
                            href={b.head.drive_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-slate-50"
                          >
                            <FolderOpen className="w-3 h-3" strokeWidth={1.6} />
                            Drive
                            <ExternalLink className="w-2.5 h-2.5" strokeWidth={1.5} />
                          </a>
                        )}
                      </div>
                    </div>

                    {/* 区間ごとのステータス・追跡 */}
                    <div className="space-y-3">
                      {b.legs.map((r) => {
                        const st = STATUS_LABELS[r.status] ?? { ja: r.status, cls: "bg-gray-100 text-gray-700" }
                        const carrier = r.carrier || "sagawa"
                        return (
                          <div key={r.id} className="rounded-xl border border-border/70 bg-slate-50/50 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs text-foreground">
                                <span className="text-muted-foreground">LEG {r.leg_index + 1}／{b.legs.length}</span>
                                {"　"}
                                {r.from_prefecture || ""} {r.from_hotel_ja || r.from_hotel}
                                {" → "}
                                {r.to_prefecture || ""} {r.to_hotel_ja || r.to_hotel}
                              </p>
                              <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap ${st.cls}`}>
                                {st.ja}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              発送 {r.shipment_date} ・ 到着予定 {r.expected_arrival || "—"} ・ {r.suitcase_count}個
                            </p>

                            {/* 追跡（手配済み以降のみステッパー＋番号） */}
                            {r.status !== "requested" && r.status !== "pending" && r.status !== "cancelled" && (
                              <div className="mt-2 max-w-md">
                                <TrackingStepper status={r.status} steps={TRACK_STEPS_JA} compact />
                                {r.yamato_tracking && r.yamato_tracking.length > 0 && (
                                  <div className="mt-1 space-y-0.5">
                                    {r.yamato_tracking.map((num) => (
                                      <a
                                        key={num}
                                        href={carrierTrackUrl(carrier, num)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-[11px] font-mono text-foreground/90 underline underline-offset-2 hover:text-red-700"
                                      >
                                        {num}
                                        <ExternalLink className="w-2.5 h-2.5" strokeWidth={1.5} />
                                      </a>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </article>
                ))}
              </section>
            )}
          </>
        ) : null}
      </div>
    </main>
  )
}

export default function OperatorAgencyViewPage() {
  return (
    <Suspense fallback={null}>
      <ViewAsAgency />
    </Suspense>
  )
}
