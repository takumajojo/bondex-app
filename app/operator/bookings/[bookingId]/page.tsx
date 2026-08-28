"use client"

// 予約の詳細ページ (運営用)。
// 一覧 (/operator/dashboard) は「何をすべきか」だけに絞ったため、
// 発行日・追跡番号・個数の変更履歴・発行/課金エラーの全文・送り状の郵送先の内訳など、
// 調査や説明に使う情報はすべてここに集約する (谷口さん 2026-08-28)。
// 操作 (ステータス変更・日付編集・個数修正) は一覧の「⋯」メニューから行う。
import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import {
  ArrowLeft,
  ExternalLink,
  FolderOpen,
  Loader2,
  RefreshCw,
} from "lucide-react"
import {
  labelMailStatus,
  labelMailApplies,
  todayJst,
  LABEL_TO_LABEL_JA,
  LABEL_SENDER_LABEL_JA,
  type LabelTo,
  type LabelSender,
} from "@/lib/label-delivery"
import type { ResidenceAddress } from "@/lib/residence"

type CountChange = {
  at: string
  from: number
  to: number
  reason: string
  note?: string
  cancelled?: boolean
}

type Row = {
  id: string
  booking_id: string
  leg_index: number
  agency: string
  representative: string
  recipient: string
  traveler_count: number
  booking_name: string | null
  tour_number: string | null
  group_name: string | null
  booking_type: string
  guest_language: string | null
  created_at: string
  shipment_date: string
  expected_arrival: string | null
  from_check_in: string | null
  to_check_out: string | null
  delivery_time: string | null
  from_prefecture: string | null
  from_hotel_ja: string | null
  from_hotel: string
  to_prefecture: string | null
  to_hotel_ja: string | null
  to_hotel: string
  suitcase_count: number
  amount_yen: number
  count_change_log: CountChange[] | null
  status: string
  error_message: string | null
  notes: string | null
  note_target: string | null
  yamato_tracking: string[] | null
  yamato_label_url: string | null
  drive_url: string | null
  charged_at: string | null
  charge_amount_yen: number | null
  charge_error: string | null
  label_to: string | null
  label_split: boolean | null
  label_sender: string | null
  label_sender_info: ResidenceAddress | null
  label_sent_at: string | null
  label_mail_due: string | null
  pickup_hotel_notified_at: string | null
  guest_hotel_notified_at: string | null
}

const STATUS_LABELS: Record<string, { ja: string; cls: string }> = {
  requested: { ja: "依頼中", cls: "bg-sky-100 text-sky-800" },
  pending: { ja: "発行待ち", cls: "bg-amber-100 text-amber-800" },
  issued: { ja: "発行済", cls: "bg-blue-100 text-blue-800" },
  picked_up: { ja: "集荷済", cls: "bg-violet-100 text-violet-800" },
  in_transit: { ja: "配達中", cls: "bg-indigo-100 text-indigo-800" },
  delivered: { ja: "配達完了", cls: "bg-emerald-100 text-emerald-800" },
  failed: { ja: "失敗", cls: "bg-red-100 text-red-700" },
  cancelled: { ja: "キャンセル", cls: "bg-gray-200 text-gray-600" },
}

const REASON_LABEL: Record<string, string> = {
  mismatch: "個数相違",
  not_collected: "集荷不可",
  customer_change: "お客様都合",
  other: "その他",
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{title}</p>
      {children}
    </div>
  )
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{k}</span>
      <span className="text-foreground">{v}</span>
    </div>
  )
}

export default function OperatorBookingDetailPage() {
  const params = useParams<{ bookingId: string }>()
  const bookingId = decodeURIComponent(params.bookingId || "")
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      // search は booking_id の部分一致 → 取得後に完全一致で絞る
      const res = await fetch(
        `/api/shipments?search=${encodeURIComponent(bookingId)}&limit=50`,
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "読み込みに失敗しました")
      const list = ((data.shipments || []) as Row[])
        .filter((r) => r.booking_id === bookingId)
        .sort((a, b) => a.leg_index - b.leg_index)
      setRows(list)
      if (list.length === 0) setError("この予約番号の区間が見つかりません")
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました")
    }
    setLoading(false)
  }, [bookingId])

  useEffect(() => {
    void load()
  }, [load])

  const markLabelSent = async (row: Row, sent: boolean) => {
    setBusyId(row.id)
    try {
      const res = await fetch("/api/shipments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, labelMailed: sent }),
      })
      if (!res.ok) throw new Error("更新に失敗しました")
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました")
    }
    setBusyId("")
  }

  const head = rows[0]
  const today = todayJst()

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
              BondEx Operator
            </p>
            <h1 className="text-lg font-semibold text-foreground font-mono">{bookingId}</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.6} />
              再読み込み
            </button>
            <a
              href="/operator/dashboard"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
              一覧へ
            </a>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.6} />
            読み込み中…
          </p>
        )}
        {error && !loading && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}

        {head && (
          <section className="rounded-2xl border border-border bg-white p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
              <KV k="代理店" v={head.agency || "—"} />
              <KV k="代表者" v={`${head.representative}（${head.traveler_count}名）`} />
              <KV k="受取人" v={head.recipient || "—"} />
              <KV k="依頼日" v={new Date(head.created_at).toLocaleString("ja-JP")} />
              {head.tour_number && <KV k="ツアー番号" v={<span className="font-mono">{head.tour_number}</span>} />}
              {head.booking_name && <KV k="貴社Ref" v={head.booking_name} />}
              {head.group_name && <KV k="団体名" v={head.group_name} />}
              <KV k="バウチャー言語" v={(head.guest_language || "en").toUpperCase()} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {head.booking_type === "group" && (
                <a
                  href={`/operator/groups/${encodeURIComponent(bookingId)}`}
                  className="inline-flex items-center gap-1 rounded bg-violet-100 px-2 py-1 text-[11px] font-semibold text-violet-800 hover:bg-violet-200"
                >
                  団体ダッシュボード →
                </a>
              )}
              {head.drive_url && (
                <a
                  href={head.drive_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-slate-200"
                >
                  <FolderOpen className="w-3 h-3" strokeWidth={1.6} />
                  Drive フォルダ
                  <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                </a>
              )}
              <span className="text-[11px] text-muted-foreground">
                操作（ステータス変更・日付編集・個数修正）は一覧の「⋯」メニューから
              </span>
            </div>
          </section>
        )}

        {rows.map((r) => {
          const st = STATUS_LABELS[r.status] ?? { ja: r.status, cls: "bg-gray-100 text-gray-700" }
          const mail = labelMailStatus({
            shipmentDate: r.shipment_date,
            sentAt: r.label_sent_at,
            today,
            dueDate: r.label_mail_due,
          })
          const mailApplies = labelMailApplies(r.status)
          return (
            <section key={r.id} className="rounded-2xl border border-border bg-white p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-foreground">
                  LEG {r.leg_index + 1} / {rows.length}
                  <span className="ml-3 font-normal text-muted-foreground">
                    {r.from_prefecture || ""} {r.from_hotel_ja || r.from_hotel} →{" "}
                    {r.to_prefecture || ""} {r.to_hotel_ja || r.to_hotel}
                  </span>
                </h2>
                <span className={`px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap ${st.cls}`}>
                  {st.ja}
                </span>
              </div>

              {/* 発行・課金のエラー全文 (一覧では出さない) */}
              {r.error_message && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-[11px] font-bold text-red-800 mb-1">発行エラー</p>
                  <p className="text-[11px] text-red-800 break-all whitespace-pre-wrap">{r.error_message}</p>
                </div>
              )}
              {r.charge_error && !r.charged_at && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-[11px] font-bold text-red-800 mb-1">課金エラー</p>
                  <p className="text-[11px] text-red-800 break-all whitespace-pre-wrap">{r.charge_error}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                <Section title="日程">
                  <div className="space-y-1">
                    <KV k="発送日" v={r.shipment_date} />
                    <KV k="到着予定" v={r.expected_arrival || "—"} />
                    <KV k="チェックイン" v={r.from_check_in || "—"} />
                    {r.to_check_out && <KV k="チェックアウト" v={r.to_check_out} />}
                    {r.delivery_time && <KV k="お届け時間帯" v={r.delivery_time} />}
                  </div>
                </Section>

                <Section title="荷物・金額">
                  <div className="space-y-1">
                    <KV k="点数" v={`${r.suitcase_count} 個`} />
                    <KV k="金額" v={`¥${r.amount_yen.toLocaleString()}`} />
                    <KV
                      k="決済"
                      v={
                        r.charged_at
                          ? `課金済 ¥${(r.charge_amount_yen ?? r.amount_yen).toLocaleString()}（${new Date(r.charged_at).toLocaleString("ja-JP")}）`
                          : r.charge_error
                            ? "課金失敗（上記エラー参照）"
                            : "未課金"
                      }
                    />
                  </div>
                  {r.count_change_log && r.count_change_log.length > 0 && (
                    <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2 space-y-1">
                      <p className="text-[10px] font-bold text-amber-800">個数の変更履歴</p>
                      {r.count_change_log.map((c, i) => (
                        <p key={i} className="text-[11px] text-amber-900">
                          {new Date(c.at).toLocaleString("ja-JP")}｜
                          {c.cancelled ? `${c.from}個 → キャンセル` : `${c.from} → ${c.to}個`}（
                          {REASON_LABEL[c.reason] ?? c.reason}
                          {c.note ? `：${c.note}` : ""}）
                        </p>
                      ))}
                    </div>
                  )}
                </Section>

                <Section title="追跡番号">
                  {r.yamato_tracking && r.yamato_tracking.length > 0 ? (
                    <div className="space-y-0.5">
                      {r.yamato_tracking.map((t) => (
                        <p key={t} className="text-xs font-mono text-foreground/90">{t}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">未発行</p>
                  )}
                  {r.yamato_label_url && (
                    <a
                      href={`/api/voucher/label?${new URLSearchParams({
                        url: r.yamato_label_url,
                        bookingId: r.booking_id,
                        ...(r.tour_number ? { tourNumber: r.tour_number } : {}),
                        representative: r.representative,
                        leg: `L${r.leg_index + 1}`,
                        paper: "a5",
                      }).toString()}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-foreground underline underline-offset-2"
                    >
                      送り状を印刷 (A5)
                      <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                    </a>
                  )}
                </Section>

                <Section title="送り状（紙）の郵送">
                  <div className="space-y-1">
                    <KV k="送付先" v={LABEL_TO_LABEL_JA[(r.label_to as LabelTo) || "agency"]} />
                    {r.label_to === "hotel" && rows.length > 1 && (
                      <KV k="分送" v={r.label_split ? "区間ごとに各ホテルへ" : "最初のホテルへ一括"} />
                    )}
                    <KV
                      k="差出人"
                      v={LABEL_SENDER_LABEL_JA[(r.label_sender as LabelSender) || "bondex"]}
                    />
                    {r.label_sender_info && (
                      <KV
                        k="差出人情報"
                        v={`${r.label_sender_info.name} ／ 〒${r.label_sender_info.zip} ${r.label_sender_info.prefecture}${r.label_sender_info.city}${r.label_sender_info.street} ${r.label_sender_info.building || ""} ／ ${r.label_sender_info.phone}`}
                      />
                    )}
                    {mailApplies ? (
                      r.label_sent_at ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-emerald-700">
                            郵送済み（{r.label_sent_at.slice(0, 10)}）
                          </span>
                          <button
                            onClick={() => void markLabelSent(r, false)}
                            disabled={busyId === r.id}
                            className="text-[10px] text-muted-foreground underline underline-offset-2 disabled:opacity-50"
                          >
                            取り消す
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-medium ${
                              mail.urgency === "ok" ? "text-foreground" : "text-red-700"
                            }`}
                          >
                            {mail.deadline
                              ? `投函期限 ${mail.deadline}${
                                  mail.urgency === "ok"
                                    ? `（あと${mail.businessDaysLeft}営業日）`
                                    : mail.urgency === "due"
                                      ? "（本日投函）"
                                      : "（早急手配）"
                                }`
                              : "期限指定なし（この機能より前の予約）"}
                          </span>
                          <button
                            onClick={() => void markLabelSent(r, true)}
                            disabled={busyId === r.id}
                            className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-muted/40 disabled:opacity-50"
                          >
                            郵送済みにする
                          </button>
                        </div>
                      )
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        （集荷済み以降のため郵送管理の対象外）
                      </p>
                    )}
                  </div>
                </Section>

                <Section title="ホテル連絡">
                  <div className="space-y-1">
                    <KV
                      k="発送元ホテル"
                      v={
                        r.pickup_hotel_notified_at
                          ? `連絡済み（${new Date(r.pickup_hotel_notified_at).toLocaleString("ja-JP")}）`
                          : "未連絡"
                      }
                    />
                    <KV
                      k="到着先ホテル"
                      v={
                        r.guest_hotel_notified_at
                          ? `連絡済み（${new Date(r.guest_hotel_notified_at).toLocaleString("ja-JP")}）`
                          : "未連絡"
                      }
                    />
                  </div>
                </Section>

                {(r.notes || r.note_target) && (
                  <Section title="ホテルへの申し送り">
                    <p className="text-xs text-foreground whitespace-pre-wrap">{r.notes || "—"}</p>
                    {r.note_target && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        掲載先:{" "}
                        {r.note_target === "from"
                          ? "発送元のみ"
                          : r.note_target === "to"
                            ? "お届け先のみ"
                            : "両方"}
                      </p>
                    )}
                  </Section>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </main>
  )
}
