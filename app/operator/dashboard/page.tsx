"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Loader2,
  Package,
  Filter,
  RotateCcw,
  ExternalLink,
  FileText,
  Download,
  RefreshCw,
  AlertTriangle,
  Building2,
  Mail,
  Search,
  Pencil,
  Trash2,
  X,
  Clock,
  Truck,
  CreditCard,
  MoreHorizontal,
} from "lucide-react"
import {
  applicableRoutes,
  hotelContactStatus,
  HOTEL_ROUTE_LABEL,
  type NoteTarget,
  type HotelRoute,
} from "@/lib/hotel-notification"
import { labelMailStatus, labelMailApplies, todayJst, type LabelMailUrgency } from "@/lib/label-delivery"

type ShipmentStatus =
  | "requested"
  | "pending"
  | "issued"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "failed"
  | "cancelled"

interface Shipment {
  id: string
  booking_id: string
  leg_index: number
  agency: string
  representative: string
  traveler_count: number
  shipment_date: string
  expected_arrival: string | null
  from_hotel: string
  from_city: string | null
  from_prefecture: string | null
  from_hotel_ja: string | null
  to_hotel: string
  to_city: string | null
  to_prefecture: string | null
  to_hotel_ja: string | null
  /** 送り状(紙)の郵送先・差出人 (lib/label-delivery.ts)。 */
  label_to: string | null
  label_split: boolean | null
  label_sender: string | null
  /** 送り状(紙)を郵送した日時。null の間は送付アラートの対象。 */
  label_sent_at: string | null
  /** 依頼時に選んだ投函期限。null = 旧予約 (アラート対象外)。 */
  label_mail_due: string | null
  recipient: string
  suitcase_count: number
  amount_yen: number
  yamato_tracking: string[] | null
  yamato_label_url: string | null
  status: ShipmentStatus
  error_message: string | null
  tour_number: string | null
  notes: string | null
  note_target: string | null
  pickup_hotel_notified_at: string | null
  guest_hotel_notified_at: string | null
  drive_url: string | null
  created_at: string
  charged_at: string | null
  charge_error: string | null
  charge_amount_yen: number | null
  count_change_log?: CountChange[] | null
  booking_type?: string | null
}

interface CountChange {
  at: string
  from: number
  to: number
  reason: string
  note: string | null
  cancelled: boolean
  old_amount: number
  new_amount: number
  was_charged: boolean
}

const REASON_LABEL: Record<string, string> = {
  mismatch: "個数相違",
  not_collected: "集荷不可",
  customer_change: "お客様都合",
  other: "その他",
}

// 今日 (ローカル日付) を YYYY-MM-DD で。shipment_date / expected_arrival と同じ粒度で比較する。
function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// 遅延判定 — 日付とステータスから導出（新しいデータは不要）。
//   集荷遅れ: 発送日を過ぎても未集荷 (requested / pending / issued のまま)
//   配送遅れ: 到着予定日を過ぎても未配達 (picked_up / in_transit のまま)
/**
 * 送り状(紙)の郵送アラート。発送日の5営業日前を過ぎたら「送ってください」を出し続ける。
 * 「郵送済み」にするまで消えない = 作業の取りこぼしを構造的に防ぐ。
 */
function labelMailUrgency(s: {
  shipment_date: string
  label_sent_at: string | null
  label_mail_due: string | null
}): LabelMailUrgency {
  return labelMailStatus({
    shipmentDate: s.shipment_date,
    sentAt: s.label_sent_at,
    today: todayJst(),
    dueDate: s.label_mail_due,
  }).urgency
}

function isLabelMailPending(s: {
  shipment_date: string
  label_sent_at: string | null
  label_mail_due: string | null
  status: ShipmentStatus
}): boolean {
  // 集荷済み以降は送り状が役目を果たしているので対象外
  if (!labelMailApplies(s.status)) return false
  const u = labelMailUrgency(s)
  return u === "due" || u === "urgent" || u === "overdue"
}

/** 郵送期限のバッジ。郵送済みにするまで消えない。 */
function LabelMailBadge({
  shipment,
  onSent,
  busy,
}: {
  shipment: {
    shipment_date: string
    label_sent_at: string | null
    label_mail_due: string | null
    status: ShipmentStatus
  }
  onSent: () => void
  busy: boolean
}) {
  if (!labelMailApplies(shipment.status)) return null
  const st = labelMailStatus({
    shipmentDate: shipment.shipment_date,
    sentAt: shipment.label_sent_at,
    today: todayJst(),
    dueDate: shipment.label_mail_due,
  })
  if (st.urgency === "sent") {
    return (
      <p className="mt-1.5 text-[10px] text-emerald-700">
        送り状 郵送済み（{(shipment.label_sent_at || "").slice(0, 10)}）
      </p>
    )
  }
  if (st.urgency === "ok") {
    // 期限なし = この機能より前の旧予約。無視してよい (谷口さん 2026-08-28)
    if (!st.deadline) return null
    return (
      <p className="mt-1 text-[11px] font-medium text-foreground">
        {st.deadline} までに投函
        <span className="ml-1 text-[10px] font-normal text-muted-foreground">
          （あと{st.businessDaysLeft}営業日）
        </span>
      </p>
    )
  }
  const tone =
    st.urgency === "due"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-red-300 bg-red-50 text-red-900"
  const text =
    st.urgency === "due"
      ? `本日 ${st.deadline} までに投函`
      : st.urgency === "urgent"
        ? `早急手配 — 期限 ${st.deadline} を${Math.abs(st.businessDaysLeft ?? 0)}営業日超過`
        : `期限超過 — 発送日を過ぎています`
  return (
    <div className={`mt-1.5 rounded-md border px-1.5 py-1 ${tone}`}>
      <p className="text-[10px] font-bold leading-tight">{text}</p>
      <button
        type="button"
        onClick={onSent}
        disabled={busy}
        className="mt-1 rounded border border-current px-1.5 py-0.5 text-[9px] disabled:opacity-50"
      >
        郵送済みにする
      </button>
    </div>
  )
}

function deriveDelay(s: {
  shipment_date: string
  expected_arrival: string | null
  status: ShipmentStatus
}): "pickup" | "delivery" | null {
  if (s.status === "delivered" || s.status === "cancelled" || s.status === "failed") return null
  const today = todayYmd()
  if ((s.status === "picked_up" || s.status === "in_transit") && s.expected_arrival && s.expected_arrival < today) {
    return "delivery"
  }
  if ((s.status === "requested" || s.status === "pending" || s.status === "issued") && s.shipment_date < today) {
    return "pickup"
  }
  return null
}

// 未回収の課金失敗: charge_error があり、まだ課金成立していない (charged_at 未セット)。
function isChargeFailed(s: { charged_at: string | null; charge_error: string | null }): boolean {
  return !!s.charge_error && !s.charged_at
}

const STATUS_LABELS: Record<ShipmentStatus, { ja: string; cls: string }> = {
  requested: { ja: "依頼中 (代理店)", cls: "bg-violet-100 text-violet-800" },
  pending: { ja: "保留 (発行待ち)", cls: "bg-slate-100 text-slate-700" },
  issued: { ja: "発行済", cls: "bg-blue-100 text-blue-800" },
  picked_up: { ja: "集荷済", cls: "bg-amber-100 text-amber-800" },
  in_transit: { ja: "配達中", cls: "bg-indigo-100 text-indigo-800" },
  delivered: { ja: "配達完了", cls: "bg-emerald-100 text-emerald-800" },
  failed: { ja: "失敗", cls: "bg-red-100 text-red-800" },
  cancelled: { ja: "キャンセル", cls: "bg-zinc-200 text-zinc-700" },
}

const STATUS_OPTIONS: ShipmentStatus[] = [
  "requested",
  "pending",
  "issued",
  "picked_up",
  "in_transit",
  "delivered",
  "failed",
  "cancelled",
]

// note_target を実効値に正規化 (from/to/both 以外は既定 'to')。
function effectiveNoteTarget(raw: string | null): NoteTarget {
  return raw === "from" || raw === "to" || raw === "both" ? raw : "to"
}

// 一覧行の「ホテル連絡」チェック。受け取りまでに必須の電話/メール連絡が済んだかを
// 一覧から直接チェックできる (掲載対象ルートのみ表示)。クリックで完了/未完了を即トグル。
/** 区間の1地点を「都道府県 + 日本語ホテル名」で表示する。
 *  日本語名が未解決(旧データ)なら英語ホテル名にフォールバック。
 *  日本語名を表示できたときだけ、参照用に英語名を小さく併記する。 */
function LegEndpoint({
  prefecture,
  nameJa,
  nameEn,
}: {
  prefecture: string | null
  nameJa: string | null
  nameEn: string
}) {
  const name = nameJa?.trim() || nameEn
  const showEnSub = !!nameJa?.trim() && nameJa.trim() !== nameEn
  return (
    <div>
      <p className="text-foreground text-xs">
        {prefecture ? <span className="text-muted-foreground">{prefecture} </span> : null}
        {name}
      </p>
      {showEnSub ? <p className="text-[10px] text-muted-foreground">{nameEn}</p> : null}
    </div>
  )
}

function HotelNotifyBadges({ shipment }: { shipment: Shipment }) {
  const routes = applicableRoutes(effectiveNoteTarget(shipment.note_target))
  const active = (["pickup", "guest"] as HotelRoute[]).filter((r) => routes[r])
  const [pickupAt, setPickupAt] = useState<string | null>(shipment.pickup_hotel_notified_at)
  const [guestAt, setGuestAt] = useState<string | null>(shipment.guest_hotel_notified_at)
  const [busy, setBusy] = useState<HotelRoute | null>(null)
  if (active.length === 0) return null

  const toggle = async (route: HotelRoute, next: boolean) => {
    setBusy(route)
    try {
      const b: Record<string, unknown> = { id: shipment.id }
      b[route === "pickup" ? "pickupHotelNotified" : "guestHotelNotified"] = next
      const res = await fetch("/api/shipments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error || "更新失敗")
      const at = next ? (d?.[route === "pickup" ? "pickupAt" : "guestAt"] ?? new Date().toISOString()) : null
      if (route === "pickup") setPickupAt(at)
      else setGuestAt(at)
    } catch (e) {
      alert(e instanceof Error ? e.message : "更新に失敗しました")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {active.map((r) => {
        const sent = Boolean(r === "pickup" ? pickupAt : guestAt)
          const cst = hotelContactStatus({
            shipmentDate: shipment.shipment_date,
            notifiedAt: r === "pickup" ? pickupAt : guestAt,
            today: todayYmd(),
          })
          // 期限の緊急度で色を決める (連絡漏れを一目で分かるように・2026-09-01)
          const tone = sent
            ? "bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200"
            : cst.urgency === "overdue" || cst.urgency === "urgent"
              ? "bg-red-100 text-red-800 border-red-300 hover:bg-red-200"
              : cst.urgency === "due"
                ? "bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200"
                : "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
          const deadlineLabel = sent
            ? ""
            : cst.urgency === "overdue"
              ? "期限超過"
              : cst.urgency === "urgent"
                ? `至急(期限${cst.deadline})`
                : cst.deadline
                  ? `${cst.deadline}まで`
                  : ""
          return (
            <button
              key={r}
              type="button"
              disabled={busy === r}
              onClick={() => void toggle(r, !sent)}
              title={
                sent
                  ? `${HOTEL_ROUTE_LABEL[r]}への連絡（電話/メール）: 完了。クリックで未完了に戻す`
                  : `${HOTEL_ROUTE_LABEL[r]}への連絡（電話/メール）: 未完了。連絡期限=発送2営業日前。完了したらクリック`
              }
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors disabled:opacity-50 ${tone}`}
            >
              <span aria-hidden>{busy === r ? "…" : sent ? "☑" : "☐"}</span>
              {HOTEL_ROUTE_LABEL[r]}連絡
              {deadlineLabel && <span className="font-normal opacity-90">・{deadlineLabel}</span>}
            </button>
          )
      })}
    </div>
  )
}

export default function DashboardPage() {
  const [items, setItems] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [configured, setConfigured] = useState(true)
  const [error, setError] = useState("")
  const [filterAgency, setFilterAgency] = useState("")
  const [filterStatus, setFilterStatus] = useState<"" | ShipmentStatus>("")
  // 検索 (予約番号 / 代表者 / 受取人 / ツアー番号) — 入力値と適用値を分離し
  // Enter / ボタンで適用 (1 文字ごとの API 叩きを防ぐ)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  // 編集 / 削除モーダル
  const [editTarget, setEditTarget] = useState<Shipment | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Shipment | null>(null)
  const [adjustTarget, setAdjustTarget] = useState<Shipment | null>(null)
  // ステータス変更は即時 select をやめ、確認モーダル経由に (誤操作防止・課金/通知の副作用を明示)
  const [statusTarget, setStatusTarget] = useState<Shipment | null>(null)
  // 行の「⋯」操作メニュー (開いている行の id)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  // 送り状の「郵送済み」更新中の区間 ID (二重クリック防止)
  const [labelBusyId, setLabelBusyId] = useState("")
  // 「状態の一望」用スナップショット (フィルタ非依存・全件)。要対応の集計と遅延の判定に使う。
  const [board, setBoard] = useState<Shipment[]>([])
  // 要対応の件数 (サーバー側 count・全件対象)。2026-08-31 監査対応:
  // 旧実装は最新500行のスナップショット集計で、総行数500超で件数が静かに狂った。
  const [boardCounts, setBoardCounts] = useState<Record<string, number> | null>(null)
  const [hotelCountUrgent, setHotelCountUrgent] = useState(0)
  const [pendingAgencies, setPendingAgencies] = useState(0)
  // 要対応タイルからのクライアント側フィルタ (サーバー側の status フィルタとは別レイヤ)。
  const [viewFilter, setViewFilter] = useState<
    | ""
    | "delay-pickup"
    | "delay-delivery"
    | "charge-failed"
    | "failed"
    | "pay-paid"
    | "pay-unpaid"
    // 送り状(紙)の郵送待ち
    | "label-mail"
    // ホテル連絡の期限待ち
    | "hotel-contact"
  >("")
  // 決済再試行の実行中 shipment id
  const [chargingId, setChargingId] = useState<string | null>(null)

  const loadBoard = useCallback(async () => {
    try {
      const res = await fetch("/api/operator/board-stats")
      const d = (await res.json()) as { counts?: Record<string, number>; hotelContactUrgent?: number }
      if (d.counts) setBoardCounts(d.counts)
      if (typeof d.hotelContactUrgent === "number") setHotelCountUrgent(d.hotelContactUrgent)
    } catch {
      /* best-effort — 要対応が出せなくても一覧は動く */
    }
  }, [])

  // タイルを選んだときだけ、そのカテゴリの行をサーバーから取得する
  // (クライアント側スナップショット絞り込みを廃止・全件から正確に抽出)。
  // ホテル連絡タイル: 期限が来ている区間だけを id で絞って一覧表示する。
  const loadHotelRows = useCallback(async () => {
    try {
      const idsRes = await fetch("/api/operator/hotel-contact-rows")
      const idsD = (await idsRes.json()) as { ids?: string[] }
      const ids = new Set(idsD.ids ?? [])
      const listRes = await fetch("/api/shipments?limit=500")
      const listD = (await listRes.json()) as { shipments?: Shipment[] }
      setBoard((listD.shipments ?? []).filter((s) => ids.has(s.id)))
    } catch {
      setBoard([])
    }
  }, [])

  const loadBoardRows = useCallback(async (view: string) => {
    try {
      const res = await fetch(`/api/shipments?view=${encodeURIComponent(view)}&limit=500`)
      const d = (await res.json()) as { shipments?: Shipment[] }
      setBoard(Array.isArray(d.shipments) ? d.shipments : [])
    } catch {
      setBoard([])
    }
  }, [])
  useEffect(() => {
    void loadBoard()
  }, [loadBoard])

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const sp = new URLSearchParams()
      if (filterAgency) sp.set("agency", filterAgency)
      if (filterStatus) sp.set("status", filterStatus)
      if (search) sp.set("search", search)
      const res = await fetch(`/api/shipments?${sp.toString()}`)
      const text = await res.text()
      if (!res.ok) {
        // API 側でエラー — 本文 (HTML or JSON) を出してデバッグしやすく
        throw new Error(`API ${res.status}: ${text.slice(0, 200)}`)
      }
      let data: { configured?: boolean; shipments?: Shipment[] }
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`)
      }
      setConfigured(Boolean(data.configured))
      setItems(Array.isArray(data.shipments) ? data.shipments : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [filterAgency, filterStatus, search])

  useEffect(() => {
    void load()
  }, [load])

  const handleStatusChange = async (id: string, status: ShipmentStatus) => {
    const before = items
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status } : it)))
    try {
      const res = await fetch("/api/shipments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      })
      if (!res.ok) throw new Error("Update failed")
      void loadBoard() // 要対応（遅延/失敗）の集計を最新化
    } catch (err) {
      setItems(before)
      setError(err instanceof Error ? err.message : "Update failed")
    }
  }

  // 送り状(紙)を郵送したことを記録する。これが入るまで要対応から消えない。
  const markLabelSent = async (it: Shipment) => {
    setLabelBusyId(it.id)
    const stamp = new Date().toISOString()
    const before = items
    setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, label_sent_at: stamp } : x)))
    try {
      const res = await fetch("/api/shipments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: it.id, labelMailed: true }),
      })
      if (!res.ok) throw new Error("更新に失敗しました")
      void loadBoard()
    } catch (err) {
      setItems(before)
      setError(err instanceof Error ? err.message : "更新に失敗しました")
    }
    setLabelBusyId("")
  }

  // 課金失敗の区間を手動で再試行する (chargeShipmentIfDue を operator 権限で叩く)。
  const retryCharge = useCallback(
    async (id: string) => {
      // 実カードへの課金アクションのため、ワンクリック実行を避けて確認を挟む
      if (!confirm("カード決済を今すぐ再試行します。よろしいですか？\n（課金済みの場合は二重課金されません）")) return
      setChargingId(id)
      try {
        const res = await fetch("/api/operator/charge-retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        })
        const d = (await res.json().catch(() => ({}))) as {
          error?: string
          result?: { charged?: boolean; skipped?: boolean; reason?: string; amountYen?: number; error?: string }
        }
        if (!res.ok) {
          alert(`再試行に失敗しました:\n${d.error || res.statusText}`)
          return
        }
        const r = d.result ?? {}
        if (r.charged) {
          alert(`カード決済に成功しました（¥${(r.amountYen ?? 0).toLocaleString()}）。`)
        } else if (r.skipped && r.reason === "disabled") {
          alert(
            "現在カード自動課金は OFF です（STRIPE_CHARGE_LIVE 未設定）。実際の課金は行われていません。",
          )
        } else if (r.skipped && r.reason === "already_charged") {
          alert("この区間は既に課金済みです。")
        } else if (r.skipped) {
          alert(`課金はスキップされました（理由: ${r.reason}）。`)
        } else if (r.error) {
          alert(`課金できませんでした:\n${r.error}`)
        } else {
          alert("処理は完了しましたが、課金は成立しませんでした。")
        }
        await load()
        void loadBoard()
      } catch (e) {
        alert(`通信エラー: ${e instanceof Error ? e.message : "network"}`)
      } finally {
        setChargingId(null)
      }
    },
    [load, loadBoard],
  )

  // 予約の書類 (バウチャー+送り状) を共有ドライブの予約番号フォルダに格納
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const syncDrive = useCallback(
    async (bookingId: string) => {
      setSyncingId(bookingId)
      try {
        const res = await fetch("/api/operator/drive-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          folderUrl?: string
          files?: string[]
          error?: string
          warning?: string
        }
        if (!res.ok) {
          alert(`Drive 格納に失敗しました:\n${data.error || res.statusText}`)
        } else {
          alert(
            `Drive に格納しました。\n\n格納ファイル:\n${(data.files || []).join("\n")}\n\nフォルダ:\n${data.folderUrl || ""}${data.warning ? `\n\n注意: ${data.warning}` : ""}`,
          )
          await load()
        }
      } catch (e) {
        alert(`Drive 格納エラー: ${e instanceof Error ? e.message : "network"}`)
      } finally {
        setSyncingId(null)
      }
    },
    [load],
  )

  // 代理店一覧は agencies マスタから直接取得 (shipments の有無に依らない)
  const [agencies, setAgencies] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    fetch("/api/agencies")
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !Array.isArray(d.agencies)) return
        const list = d.agencies as { name: string; status?: string }[]
        setAgencies(list.map((a) => a.name).filter(Boolean))
        setPendingAgencies(list.filter((a) => a.status === "pending").length)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // 請求書発行 — 当月デフォルト
  const [invoiceMonth, setInvoiceMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  })
  const [invoiceAgency, setInvoiceAgency] = useState("")
  const [invoiceBusy, setInvoiceBusy] = useState(false)
  const [invoiceError, setInvoiceError] = useState("")

  const onGenerateInvoice = async () => {
    if (!invoiceAgency || !invoiceMonth) return
    setInvoiceBusy(true)
    setInvoiceError("")
    try {
      const res = await fetch(
        `/api/invoices/generate?agency=${encodeURIComponent(invoiceAgency)}&month=${invoiceMonth}`,
      )
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `bondex-invoice-${invoiceAgency}-${invoiceMonth}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setInvoiceError(e instanceof Error ? e.message : "請求書発行失敗")
    } finally {
      setInvoiceBusy(false)
    }
  }

  const counts = useMemo(() => {
    const c: Record<ShipmentStatus, number> = {
      requested: 0,
      pending: 0,
      issued: 0,
      picked_up: 0,
      in_transit: 0,
      delivered: 0,
      failed: 0,
      cancelled: 0,
    }
    items.forEach((it) => {
      c[it.status]++
    })
    return c
  }, [items])

  // 要対応（あなたの判断待ち）— フィルタ非依存の全件スナップショットから集計する。
  // 件数はサーバー側 count (全件対象)。urgent の内訳だけは取得済みの行から補足表示する。
  const attention = useMemo(() => {
    const c = boardCounts ?? {}
    const pickup = c["delay-pickup"] ?? 0
    const delivery = c["delay-delivery"] ?? 0
    const chargeFailed = c["charge-failed"] ?? 0
    const failed = c["failed"] ?? 0
    const mail = c["label-mail"] ?? 0
    const hotel = c["hotel-contact"] ?? 0
    const mailUrgent = board.filter(
      (s) => isLabelMailPending(s) && labelMailUrgency(s) !== "due",
    ).length
    return {
      pickup,
      delivery,
      chargeFailed,
      failed,
      mail,
      mailUrgent,
      hotel,
      hotelUrgent: hotelCountUrgent,
      total: pendingAgencies + pickup + delivery + chargeFailed + failed + mail + hotel,
    }
  }, [boardCounts, board, pendingAgencies, hotelCountUrgent])

  // 要対応タイル選択中は、そのカテゴリの行をサーバーから取得済み (board)。
  // 決済ピル (pay-paid/pay-unpaid) だけは通常一覧のクライアント絞り込みのまま。
  useEffect(() => {
    const serverViews = ["delay-pickup", "delay-delivery", "charge-failed", "failed", "label-mail"]
    if (serverViews.includes(viewFilter)) void loadBoardRows(viewFilter)
    else if (viewFilter === "hotel-contact") void loadHotelRows()
  }, [viewFilter, loadBoardRows])

  const rows = useMemo(() => {
    if (!viewFilter) return items
    if (viewFilter === "pay-paid") return items.filter((s) => !!s.charged_at)
    if (viewFilter === "pay-unpaid") return items.filter((s) => !s.charged_at && !s.charge_error)
    return board
  }, [viewFilter, items, board])

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bondex-logo.png" alt="BondEx" className="h-10 w-auto object-contain" />
            <div className="border-l border-border pl-4">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
                BondEx Operator
              </p>
              <h1 className="text-xl font-semibold text-foreground mt-0.5">案件ダッシュボード</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href="/operator"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
              発行に戻る
            </Link>
            <Link
              href="/operator/agencies"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Building2 className="w-4 h-4" strokeWidth={1.5} />
              代理店管理
            </Link>
            <Link
              href="/operator/claims"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <AlertTriangle className="w-4 h-4" strokeWidth={1.5} />
              クレーム管理
            </Link>
            <Link
              href="/operator/inquiries"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Mail className="w-4 h-4" strokeWidth={1.5} />
              問い合わせ
            </Link>
            <button
              onClick={() => {
                void load()
                void loadBoard()
              }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw className="w-4 h-4" strokeWidth={1.5} />
              更新
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {!configured ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <p className="text-sm font-medium text-amber-900 mb-2">
              Supabase が未設定です
            </p>
            <p className="text-xs text-amber-800">
              <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> と{" "}
              <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> を Vercel に設定し、
              <code className="font-mono">sql/001_shipments.sql</code> を実行してください。
            </p>
          </div>
        ) : null}

        {/* 要対応（あなたの判断待ち）— 状態の一望。解消するまで残り続ける。 */}
        {attention.total > 0 && (
          <section className="rounded-2xl border border-red-200 bg-red-50/70 p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-red-600" strokeWidth={2} />
              <h2 className="text-sm font-semibold text-red-900">
                要対応 — あなたの判断待ち{" "}
                <span className="tabular-nums">{attention.total}</span>件
              </h2>
              {viewFilter && (
                <button
                  onClick={() => setViewFilter("")}
                  className="ml-auto inline-flex items-center gap-1 text-xs text-red-700 hover:text-red-900 underline underline-offset-2"
                >
                  <X className="w-3 h-3" strokeWidth={2} />
                  フィルタ解除
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {/* 送り状(紙)の郵送 — 届かないと旅行者が荷物を出せないため最優先で出す。 */}
              {attention.mail > 0 && (
                <button
                  onClick={() => setViewFilter(viewFilter === "label-mail" ? "" : "label-mail")}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    viewFilter === "label-mail"
                      ? "border-red-500 bg-red-100 ring-1 ring-red-400"
                      : attention.mailUrgent > 0
                        ? "border-red-300 bg-red-50 hover:border-red-500"
                        : "border-amber-300 bg-amber-50 hover:border-amber-500"
                  }`}
                >
                  <p
                    className={`text-2xl font-semibold tabular-nums ${
                      attention.mailUrgent > 0 ? "text-red-800" : "text-amber-800"
                    }`}
                  >
                    {attention.mail}
                  </p>
                  <p
                    className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${
                      attention.mailUrgent > 0 ? "text-red-800" : "text-amber-800"
                    }`}
                  >
                    <AlertTriangle className="w-3 h-3" strokeWidth={2} />
                    送り状を郵送
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {attention.mailUrgent > 0 ? `うち${attention.mailUrgent}件は早急手配` : "投函期限が来ています"}
                  </p>
                </button>
              )}
              {/* ホテル連絡 (発送2営業日前) — 送らないとホテルが荷物を受け入れられない */}
              {attention.hotel > 0 && (
                <button
                  onClick={() => setViewFilter(viewFilter === "hotel-contact" ? "" : "hotel-contact")}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    viewFilter === "hotel-contact"
                      ? "border-red-500 bg-red-100 ring-1 ring-red-400"
                      : attention.hotelUrgent > 0
                        ? "border-red-300 bg-red-50 hover:border-red-500"
                        : "border-amber-300 bg-amber-50 hover:border-amber-500"
                  }`}
                >
                  <p
                    className={`text-2xl font-semibold tabular-nums ${
                      attention.hotelUrgent > 0 ? "text-red-800" : "text-amber-800"
                    }`}
                  >
                    {attention.hotel}
                  </p>
                  <p
                    className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${
                      attention.hotelUrgent > 0 ? "text-red-800" : "text-amber-800"
                    }`}
                  >
                    <AlertTriangle className="w-3 h-3" strokeWidth={2} />
                    ホテルへ連絡
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {attention.hotelUrgent > 0 ? `うち${attention.hotelUrgent}件は至急` : "発送2営業日前"}
                  </p>
                </button>
              )}
              {pendingAgencies > 0 && (
                <Link
                  href="/operator/agencies"
                  className="rounded-xl border border-blue-200 bg-blue-50 p-3 hover:border-blue-400 transition-colors"
                >
                  <p className="text-2xl font-semibold tabular-nums text-blue-800">
                    {pendingAgencies}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-blue-800">
                    <Building2 className="w-3 h-3" strokeWidth={2} />
                    新規代理店 承認待ち
                  </p>
                </Link>
              )}
              {attention.delivery > 0 && (
                <button
                  onClick={() =>
                    setViewFilter(viewFilter === "delay-delivery" ? "" : "delay-delivery")
                  }
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    viewFilter === "delay-delivery"
                      ? "border-red-500 ring-1 ring-red-400 bg-red-100"
                      : "border-red-200 bg-red-50 hover:border-red-400"
                  }`}
                >
                  <p className="text-2xl font-semibold tabular-nums text-red-800">
                    {attention.delivery}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-red-800">
                    <Clock className="w-3 h-3" strokeWidth={2} />
                    配送遅れ（到着超過）
                  </p>
                </button>
              )}
              {attention.pickup > 0 && (
                <button
                  onClick={() =>
                    setViewFilter(viewFilter === "delay-pickup" ? "" : "delay-pickup")
                  }
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    viewFilter === "delay-pickup"
                      ? "border-amber-500 ring-1 ring-amber-400 bg-amber-100"
                      : "border-amber-200 bg-amber-50 hover:border-amber-400"
                  }`}
                >
                  <p className="text-2xl font-semibold tabular-nums text-amber-900">
                    {attention.pickup}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-900">
                    <Truck className="w-3 h-3" strokeWidth={2} />
                    集荷遅れ（発送超過）
                  </p>
                </button>
              )}
              {attention.chargeFailed > 0 && (
                <button
                  onClick={() =>
                    setViewFilter(viewFilter === "charge-failed" ? "" : "charge-failed")
                  }
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    viewFilter === "charge-failed"
                      ? "border-red-500 ring-1 ring-red-400 bg-red-100"
                      : "border-red-200 bg-red-50 hover:border-red-400"
                  }`}
                >
                  <p className="text-2xl font-semibold tabular-nums text-red-800">
                    {attention.chargeFailed}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-red-800">
                    <CreditCard className="w-3 h-3" strokeWidth={2} />
                    課金失敗（未回収）
                  </p>
                </button>
              )}
              {attention.failed > 0 && (
                <button
                  onClick={() => setViewFilter(viewFilter === "failed" ? "" : "failed")}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    viewFilter === "failed"
                      ? "border-amber-500 ring-1 ring-amber-400 bg-amber-100"
                      : "border-amber-200 bg-amber-50 hover:border-amber-400"
                  }`}
                >
                  <p className="text-2xl font-semibold tabular-nums text-amber-900">
                    {attention.failed}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-900">
                    <AlertTriangle className="w-3 h-3" strokeWidth={2} />
                    送り状 発行失敗
                  </p>
                </button>
              )}
            </div>
          </section>
        )}

        {/* Status summary */}
        <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {STATUS_OPTIONS.map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(filterStatus === st ? "" : st)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                filterStatus === st
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-white hover:border-foreground/40"
              }`}
            >
              <p className="text-[10px] uppercase tracking-widest opacity-70 mb-1">
                {STATUS_LABELS[st].ja}
              </p>
              <p className="text-xl font-semibold tabular-nums">{counts[st]}</p>
            </button>
          ))}
        </section>

        {/* 代理店ステータス（承認待ち＝あなたの判断待ちを最上部に） */}
        <AgencyStatusCard />

        {/* Ship&co 接続状況 (本番化=SHIPANDCO_LIVE の前チェック) */}
        <ShipandcoStatusCard />

        {/* Stripe カード登録モード (テスト=実カード拒否 / 本番=実カード可) */}
        <StripeStatusCard />

        {/* Contract generator */}
        <section className="rounded-2xl border border-border bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-foreground" strokeWidth={1.5} />
            <h3 className="text-sm font-medium text-foreground">代理店契約書 発行</h3>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={invoiceAgency}
              onChange={(e) => setInvoiceAgency(e.target.value)}
              className="h-9 px-3 rounded-lg border border-border bg-white text-sm"
            >
              <option value="">代理店を選択</option>
              {agencies.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <a
              href={invoiceAgency ? `/api/contracts/generate?agency=${encodeURIComponent(invoiceAgency)}` : "#"}
              onClick={(e) => { if (!invoiceAgency) e.preventDefault() }}
              className={`h-9 px-4 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 ${
                invoiceAgency
                  ? "bg-foreground text-background hover:bg-foreground/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              }`}
            >
              <Download className="w-3.5 h-3.5" strokeWidth={1.5} />
              契約書 PDF
            </a>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            業務委託契約書 (取次業) のテンプレ PDF。当社情報と代理店情報を自動補完
          </p>
        </section>

        {/* Invoice generator */}
        <section className="rounded-2xl border border-border bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-foreground" strokeWidth={1.5} />
            <h3 className="text-sm font-medium text-foreground">月次請求書発行</h3>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={invoiceAgency}
              onChange={(e) => setInvoiceAgency(e.target.value)}
              className="h-9 px-3 rounded-lg border border-border bg-white text-sm"
            >
              <option value="">代理店を選択</option>
              {agencies.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <input
              type="month"
              value={invoiceMonth}
              onChange={(e) => setInvoiceMonth(e.target.value)}
              className="h-9 px-3 rounded-lg border border-border bg-white text-sm"
            />
            <button
              onClick={onGenerateInvoice}
              disabled={!invoiceAgency || !invoiceMonth || invoiceBusy}
              className="h-9 px-4 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {invoiceBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
              ) : (
                <Download className="w-3.5 h-3.5" strokeWidth={1.5} />
              )}
              請求書 PDF
            </button>
            {invoiceError && (
              <span className="text-xs text-red-700">{invoiceError}</span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            該当月の成功した発行 (issued / 集荷済 / 配達中 / 完了) を集計します
          </p>
        </section>

        {/* Filters */}
        <section className="rounded-2xl border border-border bg-white p-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="w-4 h-4" strokeWidth={1.5} />
            フィルタ
          </div>
          <select
            value={filterAgency}
            onChange={(e) => setFilterAgency(e.target.value)}
            className="h-9 px-3 rounded-lg border border-border bg-white text-sm"
          >
            <option value="">すべての代理店</option>
            {agencies.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" strokeWidth={1.5} />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setSearch(searchInput.trim())
                }}
                placeholder="予約番号・氏名・ツアー番号"
                className="h-9 w-56 pl-8 pr-2 rounded-lg border border-border bg-white text-sm"
              />
            </div>
            <button
              onClick={() => setSearch(searchInput.trim())}
              className="h-9 px-3 rounded-lg bg-foreground text-background text-xs font-medium hover:bg-foreground/90"
            >
              検索
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">決済:</span>
            {(
              [
                ["pay-paid", "課金済"],
                ["charge-failed", "失敗"],
                ["pay-unpaid", "未課金"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setViewFilter(viewFilter === v ? "" : v)}
                className={`h-7 px-2.5 rounded-full text-xs border transition-colors ${
                  viewFilter === v
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-white text-muted-foreground hover:border-foreground/40"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {(filterAgency || filterStatus || search || viewFilter) && (
            <button
              onClick={() => {
                setFilterAgency("")
                setFilterStatus("")
                setSearch("")
                setSearchInput("")
                setViewFilter("")
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              クリア
            </button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            表示 {rows.length} 件
          </span>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            {error}
          </div>
        )}

        {/* Table */}
        <section className="rounded-2xl border border-border bg-white overflow-hidden">
          {loading ? (
            <div className="p-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" strokeWidth={1.5} />
              <span className="text-sm">読み込み中</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="p-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Package className="w-8 h-8" strokeWidth={1.5} />
              <span className="text-sm">該当する案件がありません</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-widest text-muted-foreground">
                  <tr>
                    {/* 一覧は「何をすべきか」が分かる最小限に絞る。詳細は予約番号クリックで
                        /operator/bookings/[id] へ (発行日・追跡番号・変更履歴・エラー全文はそちら)。 */}
                    <th className="text-left p-3 font-medium">発送日</th>
                    <th className="text-left p-3 font-medium">予約番号</th>
                    <th className="text-left p-3 font-medium">代理店</th>
                    <th className="text-left p-3 font-medium">代表者</th>
                    <th className="text-left p-3 font-medium">区間</th>
                    <th className="text-right p-3 font-medium">点数</th>
                    <th className="text-left p-3 font-medium">送り状</th>
                    <th className="text-left p-3 font-medium">ホテル連絡</th>
                    <th className="text-left p-3 font-medium">決済</th>
                    <th className="text-left p-3 font-medium">ステータス</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((it) => (
                    <tr key={it.id} className="border-t border-border hover:bg-muted/20">
                      <td className="p-3 align-top">
                        <p className="text-xs font-medium text-foreground">{it.shipment_date}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          到着 {it.expected_arrival || "—"}
                        </p>
                        {(() => {
                          const d = deriveDelay(it)
                          if (!d) return null
                          return (
                            <span className="mt-1 inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                              <Clock className="w-2.5 h-2.5" strokeWidth={2} />
                              {d === "delivery" ? "配送遅れ" : "集荷遅れ"}
                            </span>
                          )
                        })()}
                      </td>
                      <td className="p-3 align-top">
                        <p className="text-foreground font-medium">{it.agency || "—"}</p>
                      </td>
                      <td className="p-3 align-top">
                        <a
                          href={`/operator/bookings/${encodeURIComponent(it.booking_id)}`}
                          className="text-xs font-mono text-foreground underline underline-offset-2 hover:text-red-700"
                          title="予約の詳細 (全区間・追跡番号・変更履歴・エラー) を開く"
                        >
                          {it.booking_id}
                          <span className="text-muted-foreground">-L{it.leg_index + 1}</span>
                        </a>
                        {it.booking_type === "group" && (
                          <a
                            href={`/operator/groups/${encodeURIComponent(it.booking_id)}`}
                            className="mt-1 inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800 hover:bg-violet-200"
                            title="団体ダッシュボード（荷物ごとの状況）を開く"
                          >
                            団体 →
                          </a>
                        )}
                        {/* 発行・再試行などの操作は全て行右端の「⋯」メニューに集約 (行内アクション廃止)。 */}
                      </td>
                      <td className="p-3 align-top">
                        <p className="text-xs text-foreground">{it.representative}</p>
                      </td>
                      <td className="p-3 align-top max-w-[280px]">
                        <LegEndpoint prefecture={it.from_prefecture} nameJa={it.from_hotel_ja} nameEn={it.from_hotel} />
                        <p className="text-[10px] text-muted-foreground">↓</p>
                        <LegEndpoint prefecture={it.to_prefecture} nameJa={it.to_hotel_ja} nameEn={it.to_hotel} />
                      </td>
                      <td className="p-3 align-top text-right">
                        <p className="font-medium text-foreground tabular-nums">
                          {it.suitcase_count}
                        </p>
                        <p className="text-[10px] text-muted-foreground tabular-nums">
                          ¥{it.amount_yen.toLocaleString()}
                        </p>
                        {it.count_change_log && it.count_change_log.length > 0 && (
                          <p className="mt-0.5 text-[9px] text-amber-700" title="個数の変更履歴あり (詳細ページで確認)">
                            変更{it.count_change_log.length}件
                          </p>
                        )}
                      </td>
                      <td className="p-3 align-top max-w-[190px]">
                        {/* 1行目 = どこへ送るか / 2行目 = いつまでに送るか。封筒の準備がここで完結する */}
                        <p className="text-xs font-bold text-foreground">
                          {it.label_to === "hotel" ? "ホテル宛" : "会社宛"}
                          <span className="ml-1 font-normal text-[10px] text-muted-foreground">
                            {it.label_to === "hotel"
                              ? it.label_split
                                ? `${it.from_hotel_ja || it.from_hotel}`
                                : "最初のホテルへ一括"
                              : it.agency || "代理店"}
                          </span>
                        </p>
                        <LabelMailBadge shipment={it} onSent={() => void markLabelSent(it)} busy={labelBusyId === it.id} />
                        {it.yamato_label_url && (
                          <a
                            href={`/api/voucher/label?${new URLSearchParams({
                              url: it.yamato_label_url,
                              bookingId: it.booking_id,
                              ...(it.tour_number ? { tourNumber: it.tour_number } : {}),
                              representative: it.representative,
                              leg: `L${it.leg_index + 1}`,
                              paper: "a5",
                            }).toString()}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-[11px] text-foreground underline underline-offset-2"
                            title="送り状を正確なA5ページに載せ直して開きます（A5用紙に実寸100%）"
                          >
                            印刷 (A5)
                            <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                          </a>
                        )}
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          差出人:{" "}
                          {it.label_sender === "agency"
                            ? "代理店名義"
                            : it.label_sender === "other"
                              ? "他社名義"
                              : "BondEx"}
                        </p>
                      </td>
                      <td className="p-3 align-top">
                        <HotelNotifyBadges shipment={it} />
                      </td>
                      <td className="p-3 align-top">
                        {it.charged_at ? (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                            課金済 ¥{(it.charge_amount_yen ?? it.amount_yen).toLocaleString()}
                          </span>
                        ) : isChargeFailed(it) ? (
                          <div className="flex flex-col items-start gap-1">
                            <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
                              <CreditCard className="w-2.5 h-2.5" strokeWidth={2} />
                              課金失敗
                            </span>
                            {/* 再試行は「⋯」メニュー(決済を再試行…)に集約。ここは状態表示のみ。 */}
                            {it.charge_error && (
                              <p className="max-w-[160px] text-[10px] text-red-700 line-clamp-2">
                                {it.charge_error}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">未課金</span>
                        )}
                      </td>
                      <td className="p-3 align-top">
                        <div className="flex items-start gap-1.5">
                          {/* 即時変更の select を廃止し、バッジ表示＋メニュー経由の確認モーダルに */}
                          <span
                            className={`inline-block px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap ${STATUS_LABELS[it.status].cls}`}
                          >
                            {STATUS_LABELS[it.status].ja}
                          </span>
                          <div className="relative">
                            <button
                              onClick={() => setOpenMenuId(openMenuId === it.id ? null : it.id)}
                              className="p-1 rounded-md border border-border bg-white text-muted-foreground hover:text-foreground hover:border-foreground/40"
                              title="操作メニュー"
                            >
                              <MoreHorizontal className="w-4 h-4" strokeWidth={1.5} />
                            </button>
                            {openMenuId === it.id && (
                              <>
                                {/* 外側クリックで閉じる透明オーバーレイ */}
                                <div
                                  className="fixed inset-0 z-40"
                                  onClick={() => setOpenMenuId(null)}
                                />
                                <div className="absolute right-0 z-50 mt-1 w-52 rounded-xl border border-border bg-white shadow-lg py-1 text-left">
                                  {/* 発行 (代理店依頼の読み込み→発行)。行内リンクを廃し、操作は全てこのメニューに集約。 */}
                                  {it.status === "requested" && (
                                    <>
                                      <a
                                        href={`/operator?requestId=${encodeURIComponent(it.booking_id)}`}
                                        onClick={() => setOpenMenuId(null)}
                                        className="block px-3 py-2 text-xs font-semibold text-red-600 hover:bg-muted/40"
                                        title="代理店の発行依頼を発行画面に読み込み、レビューして発行します"
                                      >
                                        この依頼を発行…
                                      </a>
                                      <div className="my-1 border-t border-border" />
                                    </>
                                  )}
                                  {/* 決済の再試行 (課金失敗時のみ)。実カードへの課金のため実行時に確認を挟む。 */}
                                  {isChargeFailed(it) && !it.charged_at && (
                                    <button
                                      onClick={() => {
                                        setOpenMenuId(null)
                                        void retryCharge(it.id)
                                      }}
                                      disabled={chargingId === it.id}
                                      className="w-full px-3 py-2 text-left text-xs font-semibold text-blue-600 hover:bg-muted/40 disabled:opacity-50"
                                      title="カード決済を今すぐ再試行します（カード登録済みなら課金・未登録なら再度失敗します）"
                                    >
                                      {chargingId === it.id ? "決済を再試行中…" : "決済を再試行…"}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      setStatusTarget(it)
                                    }}
                                    className="w-full px-3 py-2 text-left text-xs text-foreground hover:bg-muted/40"
                                  >
                                    ステータスを変更…
                                  </button>
                                  <button
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      setEditTarget(it)
                                    }}
                                    className="w-full px-3 py-2 text-left text-xs text-foreground hover:bg-muted/40"
                                  >
                                    日付・備考を編集…
                                  </button>
                                  <button
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      setAdjustTarget(it)
                                    }}
                                    className="w-full px-3 py-2 text-left text-xs text-amber-800 hover:bg-muted/40"
                                  >
                                    個数を修正…
                                  </button>
                                  <div className="my-1 border-t border-border" />
                                  <a
                                    href={`/api/voucher/regenerate?booking_id=${encodeURIComponent(it.booking_id)}`}
                                    className="block px-3 py-2 text-xs text-foreground hover:bg-muted/40"
                                    onClick={() => setOpenMenuId(null)}
                                  >
                                    Voucher 再発行
                                  </a>
                                  {it.yamato_label_url && (
                                    <a
                                      href={`/api/voucher/labels?booking_id=${encodeURIComponent(it.booking_id)}`}
                                      className="block px-3 py-2 text-xs text-foreground hover:bg-muted/40"
                                      onClick={() => setOpenMenuId(null)}
                                    >
                                      送り状 一括DL
                                    </a>
                                  )}
                                  <button
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      void syncDrive(it.booking_id)
                                    }}
                                    disabled={syncingId === it.booking_id}
                                    className="w-full px-3 py-2 text-left text-xs text-foreground hover:bg-muted/40 disabled:opacity-50"
                                  >
                                    {syncingId === it.booking_id ? "Drive 格納中…" : "Drive へ格納"}
                                  </button>
                                  <div className="my-1 border-t border-border" />
                                  <button
                                    onClick={() => {
                                      setOpenMenuId(null)
                                      setDeleteTarget(it)
                                    }}
                                    className="w-full px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
                                  >
                                    予約を削除…
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                        {it.error_message && (
                          <a
                            href={`/operator/bookings/${encodeURIComponent(it.booking_id)}`}
                            className="mt-1 block text-[10px] text-red-700 underline underline-offset-2"
                            title="エラーの全文は詳細ページで確認できます"
                          >
                            エラー詳細 →
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {editTarget && (
        <EditShipmentModal
          shipment={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null)
            void load()
            void loadBoard()
          }}
        />
      )}
      {deleteTarget && (
        <DeleteBookingModal
          shipment={deleteTarget}
          legCount={
            (board.length ? board : items).filter(
              (x) => x.booking_id === deleteTarget.booking_id,
            ).length
          }
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null)
            void load()
            void loadBoard()
          }}
        />
      )}
      {adjustTarget && (
        <AdjustCountModal
          shipment={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onSaved={() => {
            setAdjustTarget(null)
            void load()
            void loadBoard()
          }}
        />
      )}
      {statusTarget && (
        <StatusChangeModal
          shipment={statusTarget}
          onClose={() => setStatusTarget(null)}
          onConfirm={async (st) => {
            await handleStatusChange(statusTarget.id, st)
            setStatusTarget(null)
          }}
        />
      )}
    </main>
  )
}

// ---------------------------------------------------------------------------
// 編集モーダル — 変更できるのは配送実務のフィールドのみ。
// ホテル・氏名の変更は送り状と食い違う事故のもとになるため、
// 「削除して新規発行」に誘導する (モーダル内に明記)。
// ---------------------------------------------------------------------------
function EditShipmentModal({
  shipment,
  onClose,
  onSaved,
}: {
  shipment: Shipment
  onClose: () => void
  onSaved: () => void
}) {
  const [shipmentDate, setShipmentDate] = useState(shipment.shipment_date || "")
  const [expectedArrival, setExpectedArrival] = useState(shipment.expected_arrival || "")
  const [notes, setNotes] = useState(shipment.notes || "")
  const [driveUrl, setDriveUrl] = useState(shipment.drive_url || "")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  const driveChanged = driveUrl.trim() !== (shipment.drive_url || "")
  const driveInvalid = Boolean(driveUrl.trim()) && !/^https:\/\/(drive|docs)\.google\.com\//.test(driveUrl.trim())

  const dateChanged =
    shipmentDate !== shipment.shipment_date ||
    expectedArrival !== (shipment.expected_arrival || "")
  const invalidRange = Boolean(shipmentDate && expectedArrival && shipmentDate > expectedArrival)

  const onSave = async () => {
    if (invalidRange || driveInvalid) return
    setBusy(true)
    setErr("")
    try {
      const res = await fetch("/api/shipments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: shipment.id,
          shipmentDate,
          expectedArrival,
          notes,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `保存失敗 (${res.status})`)
      // Drive URL は予約単位 (booking_id で全区間に反映) — 変更時のみ別 PATCH
      if (driveChanged) {
        const r2 = await fetch("/api/shipments", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId: shipment.booking_id, driveUrl: driveUrl.trim() || null }),
        })
        const d2 = await r2.json().catch(() => null)
        if (!r2.ok) throw new Error(d2?.error || `Drive 保存失敗 (${r2.status})`)
      }
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失敗")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">区間の編集</h2>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              {shipment.booking_id}-L{shipment.leg_index + 1} ・ {shipment.from_hotel} → {shipment.to_hotel}
            </p>
          </div>
          <button onClick={onClose} className="p-1 -m-1 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">発送日 (集荷)</label>
            <input
              type="date"
              value={shipmentDate}
              onChange={(e) => setShipmentDate(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">到着日</label>
            <input
              type="date"
              value={expectedArrival}
              onChange={(e) => setExpectedArrival(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
            />
          </div>
          <div className="space-y-1 col-span-2">
            <label className="text-[11px] text-muted-foreground">備考 (ホテル向け特記)</label>
            <input
              type="text"
              value={notes}
              maxLength={500}
              onChange={(e) => setNotes(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
            />
          </div>
          <div className="space-y-1 col-span-2">
            <label className="text-[11px] text-muted-foreground">
              Drive フォルダ URL (予約単位・代理店に表示)
            </label>
            <input
              type="url"
              value={driveUrl}
              onChange={(e) => setDriveUrl(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/…"
              className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              予約番号フォルダ（バウチャー・配送伝票を格納）の共有リンク。全区間に反映します。
              共有設定（閲覧可）は Google 側でご設定ください。
            </p>
          </div>
        </div>

        {invalidRange && (
          <p className="text-xs text-red-700">到着日は発送日以降にしてください。</p>
        )}
        {driveInvalid && (
          <p className="text-xs text-red-700">Drive の URL は https://drive.google.com/… 形式でご入力ください。</p>
        )}

        {/* 事故防止の注意 — 何が自動で変わり、何が変わらないかを明示する */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1">
          <p className="text-[11px] font-medium text-amber-900">保存しても自動では変わらないもの</p>
          <p className="text-[11px] text-amber-800 leading-relaxed">
            発行済みのバウチャー PDF と配送伝票（送り状）は自動更新されません。
            {dateChanged ? "日付を変更した場合は、Voucher を再発行して差し替え、送り状は Ship&co で作り直してください。" : ""}
            ホテル・氏名を変更したい場合は、この予約を削除して新規発行してください (送り状との食い違い防止)。
          </p>
          <p className="text-[11px] text-amber-800 leading-relaxed">
            個数の修正は一覧の「個数を修正」から行ってください（理由の記録と依頼元ランオペへの通知が必要なため、ここでは変更できません）。
          </p>
        </div>

        {err && <p className="text-xs text-red-700">{err}</p>}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-lg border border-border bg-white text-sm hover:bg-muted/40"
          >
            キャンセル
          </button>
          <button
            onClick={() => void onSave()}
            disabled={busy || invalidRange || driveInvalid}
            className="h-10 px-4 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />}
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ステータス変更モーダル — 一覧の即時 select を廃止し、変更内容と副作用
// (課金処理・配達完了メール) を確認してから適用する (誤操作防止・谷口さん要望)。
// ---------------------------------------------------------------------------
function StatusChangeModal({
  shipment,
  onClose,
  onConfirm,
}: {
  shipment: Shipment
  onClose: () => void
  onConfirm: (st: ShipmentStatus) => Promise<void>
}) {
  const [next, setNext] = useState<ShipmentStatus>(shipment.status)
  const [busy, setBusy] = useState(false)

  const changed = next !== shipment.status
  // 副作用の予告 — 何が自動で起きるかを適用前に明示する
  const effects: string[] = []
  if (["picked_up", "in_transit", "delivered"].includes(next) && !shipment.charged_at) {
    effects.push("カード払いの代理店は課金処理が実行されます（課金ON時・未課金の場合）")
  }
  if (next === "delivered") {
    effects.push("代理店へ配達完了メールが自動送信されます")
  }
  if (next === "cancelled") {
    effects.push("発行済みの送り状は自動では無効になりません（集荷事故防止に破棄が必要）")
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">ステータスを変更</h2>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              {shipment.booking_id}-L{shipment.leg_index + 1} ・ {shipment.from_hotel} → {shipment.to_hotel}
            </p>
          </div>
          <button onClick={onClose} className="p-1 -m-1 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`inline-block px-2 py-1 rounded-md text-xs font-medium ${STATUS_LABELS[shipment.status].cls}`}
          >
            {STATUS_LABELS[shipment.status].ja}
          </span>
          <span className="text-muted-foreground text-sm">→</span>
          <select
            value={next}
            onChange={(e) => setNext(e.target.value as ShipmentStatus)}
            className="h-10 flex-1 rounded-md border border-border bg-white px-3 text-sm"
          >
            {STATUS_OPTIONS.map((st) => (
              <option key={st} value={st}>
                {STATUS_LABELS[st].ja}
              </option>
            ))}
          </select>
        </div>

        {changed && effects.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1">
            <p className="text-[11px] font-medium text-amber-900">適用すると自動で実行されるもの</p>
            {effects.map((e, i) => (
              <p key={i} className="text-[11px] text-amber-800 leading-relaxed">
                ・{e}
              </p>
            ))}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-lg border border-border bg-white text-sm hover:bg-muted/40"
          >
            キャンセル
          </button>
          <button
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm(next)
              } finally {
                setBusy(false)
              }
            }}
            disabled={busy || !changed}
            className="h-10 px-4 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />}
            変更を適用
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 個数修正モーダル — 集荷時の「受付個数 ≠ 実個数」を理由付きで修正する。
// 気軽な変更を防ぐため理由を必須にし、依頼元ランオペへ自動通知する。
// 0個（＝集荷不可）は区間キャンセル・請求なしとして扱う。
// ---------------------------------------------------------------------------
function AdjustCountModal({
  shipment,
  onClose,
  onSaved,
}: {
  shipment: Shipment
  onClose: () => void
  onSaved: () => void
}) {
  const PRICE = 5000
  const [reasonCode, setReasonCode] = useState<
    "mismatch" | "not_collected" | "customer_change" | "other"
  >("mismatch")
  const [newCount, setNewCount] = useState<number>(shipment.suitcase_count)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  const cancel = reasonCode === "not_collected" || Number(newCount) === 0
  const effCount = cancel ? 0 : Number(newCount)
  const newAmount = cancel ? 0 : effCount * PRICE
  const charged = !!shipment.charged_at
  const noteRequired = reasonCode === "other"
  const unchanged = !cancel && effCount === shipment.suitcase_count

  const onSubmit = async () => {
    setErr("")
    if (noteRequired && !note.trim()) {
      setErr("「その他」は理由の記述が必要です。")
      return
    }
    if (unchanged) {
      setErr("個数が変わっていません。")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/operator/adjust-count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: shipment.id, newCount: effCount, reasonCode, reasonNote: note.trim() }),
      })
      const d = (await res.json().catch(() => ({}))) as {
        error?: string
        cancelled?: boolean
        mailSent?: boolean
        agencyEmailKnown?: boolean
      }
      if (!res.ok) throw new Error(d.error || `保存失敗 (${res.status})`)
      const notice = !d.agencyEmailKnown
        ? "（ランオペのメール未登録のため通知は送られていません）"
        : d.mailSent
          ? "ランオペへ通知メールを送信しました。"
          : "（ランオペへの通知メール送信に失敗しました。設定をご確認ください）"
      alert((d.cancelled ? "区間をキャンセルしました。" : "個数を修正しました。") + "\n" + notice)
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失敗")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">個数を修正</h2>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              {shipment.booking_id}-L{shipment.leg_index + 1} ・ {shipment.from_hotel} → {shipment.to_hotel}
            </p>
          </div>
          <button onClick={onClose} className="p-1 -m-1 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">理由（必須）</label>
          <select
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value as typeof reasonCode)}
            className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
          >
            <option value="mismatch">個数相違（受付と実際が違った）</option>
            <option value="not_collected">集荷不可（お客様から預かれず＝区間キャンセル）</option>
            <option value="customer_change">お客様都合の変更</option>
            <option value="other">その他（下に記述）</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">受付個数</label>
            <div className="h-10 flex items-center px-3 rounded-md border border-border bg-muted/40 text-sm tabular-nums">
              {shipment.suitcase_count} 個
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">実際の個数</label>
            <input
              type="number"
              min={0}
              max={99}
              value={cancel ? 0 : newCount}
              disabled={reasonCode === "not_collected"}
              onChange={(e) => setNewCount(Math.max(0, Math.min(99, Math.floor(Number(e.target.value) || 0))))}
              className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-center disabled:bg-muted/40 disabled:text-muted-foreground"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">
            補足{noteRequired ? "（必須）" : "（任意）"}
          </label>
          <input
            type="text"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例: 集荷時にお客様が1個のみお持ちだった"
            className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
          />
        </div>

        {/* 反映プレビュー */}
        <div className="rounded-xl border border-border bg-muted/30 p-3 text-[12px] space-y-1">
          {cancel ? (
            <p className="text-foreground">
              → <span className="font-medium text-red-700">区間キャンセル</span>・ご請求なし
            </p>
          ) : (
            <p className="text-foreground">
              個数 {shipment.suitcase_count} → <span className="font-medium">{effCount}</span> 個 ／ ご請求{" "}
              ¥{shipment.amount_yen.toLocaleString()} →{" "}
              <span className="font-medium">¥{newAmount.toLocaleString()}</span>
            </p>
          )}
          <p className="text-muted-foreground">
            依頼元ランオペ（{shipment.agency}）へ自動で通知メールを送ります。
          </p>
          {charged && (
            <p className="flex items-start gap-1 text-amber-800">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" strokeWidth={2} />
              既に課金済みです。金額は自動修正されません — Stripe で
              {cancel ? "全額" : "差額"}返金が必要です（通知にも明記されます）。
            </p>
          )}
        </div>

        {err && <p className="text-xs text-red-700">{err}</p>}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-lg border border-border bg-white text-sm hover:bg-muted/40"
          >
            キャンセル
          </button>
          <button
            onClick={() => void onSubmit()}
            disabled={busy || unchanged}
            className="h-10 px-4 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />}
            修正して通知
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 削除モーダル — 予約単位 (全区間) の物理削除。誤操作防止のため
// 「送り状の破棄が必要」への同意チェックを必須にする。
// ---------------------------------------------------------------------------
function DeleteBookingModal({
  shipment,
  legCount,
  onClose,
  onDeleted,
}: {
  shipment: Shipment
  legCount: number
  onClose: () => void
  onDeleted: () => void
}) {
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")
  const hasLabel = Boolean(shipment.yamato_label_url || (shipment.yamato_tracking?.length ?? 0) > 0)

  const onDelete = async () => {
    setBusy(true)
    setErr("")
    try {
      const res = await fetch("/api/shipments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: shipment.booking_id, confirm: "DELETE" }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `削除失敗 (${res.status})`)
      onDeleted()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "削除失敗")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <Trash2 className="w-5 h-5 text-red-700" strokeWidth={1.5} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">予約を削除</h2>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="font-mono">{shipment.booking_id}</span> (全 {legCount} 区間) を
              ダッシュボードから完全に削除します。元に戻せません。
            </p>
          </div>
        </div>

        {hasLabel && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3">
            <p className="text-[11px] font-medium text-red-900 mb-1">
              この予約には発行済みの配送伝票（送り状）があります
            </p>
            <p className="text-[11px] text-red-800 leading-relaxed">
              削除しても送り状は無効になりません。集荷される事故を防ぐため、
              Ship&co の管理画面で該当の送り状を必ず破棄し、印刷済みの紙は回収・廃棄してください。
            </p>
          </div>
        )}

        <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            className="h-3.5 w-3.5 mt-0.5 rounded border-border"
          />
          {hasLabel
            ? "送り状の破棄が別途必要なことを理解した上で削除します"
            : "この予約を完全に削除することを確認しました"}
        </label>

        {err && <p className="text-xs text-red-700">{err}</p>}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-lg border border-border bg-white text-sm hover:bg-muted/40"
          >
            キャンセル
          </button>
          <button
            onClick={() => void onDelete()}
            disabled={!ack || busy}
            className="h-10 px-4 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />}
            削除する
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Ship&co 接続状況カード (本番化=SHIPANDCO_LIVE の前チェック・読み取り専用) ──
type CarrierRow = { id: string; type: string; name: string; state: string }

const CARRIER_LABEL = (type: string): string => {
  if (type === "sagawa") return "佐川急便"
  if (type.startsWith("yamato")) return "ヤマト運輸"
  return type || "不明"
}

function ShipandcoStatusCard() {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [carriers, setCarriers] = useState<CarrierRow[]>([])
  const [liveSwitch, setLiveSwitch] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr("")
    try {
      const res = await fetch("/api/operator/shipandco-carriers", { cache: "no-store" })
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean; error?: string; liveSwitch?: boolean; carriers?: CarrierRow[]
      }
      if (!res.ok || !d.ok) {
        setErr(d.error || `HTTP ${res.status}`)
        return
      }
      setCarriers(Array.isArray(d.carriers) ? d.carriers : [])
      setLiveSwitch(!!d.liveSwitch)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sagawa = carriers.find((c) => c.type === "sagawa")

  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-foreground" strokeWidth={1.5} />
          <h3 className="text-sm font-medium text-foreground">Ship&amp;co 接続状況</h3>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} strokeWidth={1.5} />
          再確認
        </button>
      </div>

      {/* 発行モード (SHIPANDCO_LIVE) */}
      <div
        className={`mb-3 rounded-lg px-3 py-2 text-[12px] font-medium ${
          liveSwitch ? "bg-red-50 text-red-800 border border-red-200" : "bg-slate-100 text-slate-700"
        }`}
      >
        {liveSwitch
          ? "発行モード: 本番（実ラベル・実集荷・課金あり）"
          : "発行モード: テスト（SAMPLE 透かし・集荷/課金なし）"}
      </div>

      {loading && (
        <p className="text-[12px] text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
          確認中…
        </p>
      )}

      {!loading && err && (
        <p className="text-[12px] text-amber-700 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" strokeWidth={1.6} />
          確認できませんでした（{err}）
        </p>
      )}

      {!loading && !err && (
        <>
          {carriers.length === 0 ? (
            <p className="text-[12px] text-amber-700">配送業者が接続されていません。</p>
          ) : (
            <ul className="space-y-1.5">
              {carriers.map((c) => (
                <li key={c.id || c.type} className="flex items-center justify-between text-[12px]">
                  <span className="text-foreground">
                    {CARRIER_LABEL(c.type)}
                    {c.name ? <span className="text-muted-foreground">（{c.name}）</span> : null}
                  </span>
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      c.state === "disabled"
                        ? "bg-slate-200 text-slate-600"
                        : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {c.state === "disabled" ? "無効" : "有効"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            佐川が「有効」なら、その実契約に対して発行されます。SAMPLE 透かしは発行モードが
            テストのときだけ付きます。本番化は Vercel の環境変数 SHIPANDCO_LIVE=true で切り替えます
            （切替後は実集荷・課金が発生します）。
            {sagawa && sagawa.state !== "disabled" ? "" : " ※佐川が「有効」で表示されていることをご確認ください。"}
          </p>
        </>
      )}
    </section>
  )
}

// ── Stripe カード登録モードカード (テスト=実カード拒否 / 本番=実カード可・読み取り専用) ──
type StripeMode = "live" | "test" | "unset" | "unknown"

const MODE_JA: Record<StripeMode, string> = {
  live: "本番（実カード可）",
  test: "テスト（実カードは拒否）",
  unset: "未設定",
  unknown: "不明",
}

function StripeStatusCard() {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [secretMode, setSecretMode] = useState<StripeMode>("unknown")
  const [publishableMode, setPublishableMode] = useState<StripeMode>("unknown")
  const [chargeLive, setChargeLive] = useState(false)
  const [mismatch, setMismatch] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr("")
    try {
      const res = await fetch("/api/operator/stripe-status", { cache: "no-store" })
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean; error?: string; secretMode?: StripeMode; publishableMode?: StripeMode
        chargeLive?: boolean; mismatch?: boolean
      }
      if (!res.ok || !d.ok) {
        setErr(d.error || `HTTP ${res.status}`)
        return
      }
      setSecretMode(d.secretMode ?? "unknown")
      setPublishableMode(d.publishableMode ?? "unknown")
      setChargeLive(!!d.chargeLive)
      setMismatch(!!d.mismatch)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const isLive = secretMode === "live" && publishableMode === "live"

  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-foreground" strokeWidth={1.5} />
          <h3 className="text-sm font-medium text-foreground">Stripe カード登録モード</h3>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} strokeWidth={1.5} />
          再確認
        </button>
      </div>

      <div
        className={`mb-3 rounded-lg px-3 py-2 text-[12px] font-medium ${
          isLive ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-amber-50 text-amber-800 border border-amber-200"
        }`}
      >
        {isLive
          ? "カード登録: 本番（新規代理店の実カードを登録できます）"
          : "カード登録: テスト（実カードは登録エラーになります）"}
      </div>

      {loading && (
        <p className="text-[12px] text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
          確認中…
        </p>
      )}

      {!loading && err && (
        <p className="text-[12px] text-amber-700 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" strokeWidth={1.6} />
          確認できませんでした（{err}）
        </p>
      )}

      {!loading && !err && (
        <>
          <ul className="space-y-1.5">
            <li className="flex items-center justify-between text-[12px]">
              <span className="text-foreground">秘密キー（STRIPE_SECRET_KEY）</span>
              <span className="text-muted-foreground">{MODE_JA[secretMode]}</span>
            </li>
            <li className="flex items-center justify-between text-[12px]">
              <span className="text-foreground">公開キー（PUBLISHABLE_KEY）</span>
              <span className="text-muted-foreground">{MODE_JA[publishableMode]}</span>
            </li>
            <li className="flex items-center justify-between text-[12px]">
              <span className="text-foreground">カード自動課金（CHARGE_LIVE）</span>
              <span className="text-muted-foreground">{chargeLive ? "ON（課金あり）" : "OFF（課金なし）"}</span>
            </li>
          </ul>
          {mismatch && (
            <p className="text-[11px] text-red-700 mt-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" strokeWidth={1.6} />
              秘密キーと公開キーのモードが不一致です（両方 test か両方 live に揃えてください）。
            </p>
          )}
          <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            カード登録の可否は Stripe キーの種別だけで決まります。本番化は Vercel で
            STRIPE_SECRET_KEY と NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY を本番キー（sk_live / pk_live）に
            差し替えて再デプロイ。カードへの実課金はさらに別スイッチ CHARGE_LIVE が必要です。
          </p>
        </>
      )}
    </section>
  )
}

// ── 代理店ステータスカード（承認待ち＝あなたの判断待ちを最上部に表示・承認/停止も可） ──
type AgencyRow = {
  id: string
  name: string
  status: string | null
  contract_status: string | null
  payment_method: string | null
  card_on_file: boolean | null
  billing_exempt: boolean | null
  contact_email: string | null
  created_at: string | null
}

/** 代理店1件の「現在の状況」と「誰の対応待ちか」を返す。 */
function agencySituation(a: AgencyRow): { label: string; who: string; cls: string; needsMe: boolean } {
  if (a.status === "suspended") {
    return { label: "停止中", who: "—", cls: "bg-red-100 text-red-800", needsMe: false }
  }
  if (a.status === "pending") {
    return { label: "承認待ち", who: "あなたの承認待ち", cls: "bg-amber-100 text-amber-800", needsMe: true }
  }
  // active
  if (a.contract_status !== "signed") {
    return { label: "契約署名待ち", who: "代理店の署名待ち", cls: "bg-sky-100 text-sky-800", needsMe: false }
  }
  return { label: "稼働中", who: "対応不要", cls: "bg-emerald-100 text-emerald-800", needsMe: false }
}

function AgencyStatusCard() {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [rows, setRows] = useState<AgencyRow[]>([])
  const [busyId, setBusyId] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setErr("")
    try {
      const res = await fetch("/api/agencies", { cache: "no-store" })
      const d = (await res.json().catch(() => ({}))) as { agencies?: AgencyRow[]; error?: string }
      if (!res.ok) {
        setErr(d.error || `HTTP ${res.status}`)
        return
      }
      setRows(Array.isArray(d.agencies) ? d.agencies : [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : "取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const setStatus = async (id: string, status: string) => {
    setBusyId(id)
    try {
      const res = await fetch("/api/agencies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      })
      if (res.ok) {
        setRows((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)))
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        setErr(d.error || "更新に失敗しました")
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "更新に失敗しました")
    } finally {
      setBusyId("")
    }
  }

  const pendingCount = rows.filter((a) => a.status === "pending").length

  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-foreground" strokeWidth={1.5} />
          <h3 className="text-sm font-medium text-foreground">代理店 ステータス</h3>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/operator/agencies" className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2">
            代理店管理へ
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} strokeWidth={1.5} />
            更新
          </button>
        </div>
      </div>

      {/* あなたの判断待ちバナー */}
      <div
        className={`mb-3 rounded-lg px-3 py-2 text-[12px] font-medium ${
          pendingCount > 0
            ? "bg-amber-50 text-amber-900 border border-amber-300"
            : "bg-slate-100 text-slate-600"
        }`}
      >
        {pendingCount > 0
          ? `あなたの承認待ち: ${pendingCount}件（下の「承認」で有効化してください）`
          : "承認待ちの代理店はありません（判断待ちなし）"}
      </div>

      {loading && (
        <p className="text-[12px] text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
          読み込み中…
        </p>
      )}

      {!loading && err && (
        <p className="text-[12px] text-amber-700 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" strokeWidth={1.6} />
          取得できませんでした（{err}）
        </p>
      )}

      {!loading && !err && rows.length === 0 && (
        <p className="text-[12px] text-muted-foreground">代理店がまだありません。</p>
      )}

      {!loading && !err && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                <th className="py-2 pr-3 font-medium">代理店</th>
                <th className="py-2 pr-3 font-medium">状況</th>
                <th className="py-2 pr-3 font-medium">対応待ち</th>
                <th className="py-2 pr-3 font-medium">契約</th>
                <th className="py-2 pr-3 font-medium">支払い</th>
                <th className="py-2 pr-0 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const s = agencySituation(a)
                const signed = a.contract_status === "signed"
                return (
                  <tr key={a.id} className={`border-b border-border/60 ${s.needsMe ? "bg-amber-50/40" : ""}`}>
                    <td className="py-2.5 pr-3">
                      <span className="font-medium text-foreground">{a.name}</span>
                      {a.billing_exempt && (
                        <span className="ml-1.5 inline-block rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                          テスト・非課金
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${s.cls}`}>
                        {s.label}
                      </span>
                    </td>
                    <td className={`py-2.5 pr-3 ${s.needsMe ? "text-amber-800 font-medium" : "text-muted-foreground"}`}>
                      {s.who}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={signed ? "text-emerald-700" : "text-muted-foreground"}>
                        {signed ? "署名済" : "未署名"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      {a.payment_method === "card"
                        ? `カード（${a.card_on_file ? "登録済" : "未登録"}）`
                        : "請求書"}
                    </td>
                    <td className="py-2.5 pr-0 text-right whitespace-nowrap">
                      {a.status === "pending" && (
                        <span className="inline-flex gap-1.5">
                          <button
                            type="button"
                            disabled={busyId === a.id}
                            onClick={() => void setStatus(a.id, "active")}
                            className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            承認
                          </button>
                          <button
                            type="button"
                            disabled={busyId === a.id}
                            onClick={() => void setStatus(a.id, "suspended")}
                            className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                          >
                            却下
                          </button>
                        </span>
                      )}
                      {a.status === "active" && (
                        <button
                          type="button"
                          disabled={busyId === a.id}
                          onClick={() => void setStatus(a.id, "suspended")}
                          className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          停止
                        </button>
                      )}
                      {a.status === "suspended" && (
                        <button
                          type="button"
                          disabled={busyId === a.id}
                          onClick={() => void setStatus(a.id, "active")}
                          className="rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
                        >
                          再開
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            「承認待ち」＝あなたの承認が必要です（承認で有効化）。「契約署名待ち」＝代理店側が契約書に署名するのを待っている状態（あなたの対応は不要）。「稼働中」＝署名まで完了し発行依頼を受けられます。
          </p>
        </div>
      )}
    </section>
  )
}
