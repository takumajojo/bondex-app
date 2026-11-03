"use client"

// 配送依頼のホテル変更モーダル (2026-09-14 谷口さん)。
// - Google Places ピッカーで place_id / 和名 / 英名 / 市区 / 都道府県 を取得 (手入力のみ不可)
// - 変更前後を並べて確認、日程が据え置きであることを明示的に確認させる
// - ゲート: 物理(発行済/集荷済=ブロック) / 準物理(郵送済=旧伝票破棄タスク) / ポリシー(締切超過=理由必須)
// - 保存は POST /api/operator/shipment/[id]/hotel-change (RPCで単一トランザクション)

import { useCallback, useState } from "react"
import { Loader2, X, AlertTriangle, ArrowRight } from "lucide-react"
import { formatChangeDeadlineJst, isChangeDeadlinePassed, isChangeDeadlineNear } from "@/lib/change-deadline"
import HotelPlacePicker, { type PickedHotel } from "@/components/operator/HotelPlacePicker"

type Side = "guest" | "pickup"

export interface HotelChangeTarget {
  shipmentId: string
  side: Side
  bookingId: string
  legLabel: string
  // 現在のホテル
  currentHotel: string
  currentHotelJa: string | null
  currentPlaceId: string | null
  // 据え置き確認用
  shipmentDate: string
  expectedArrival: string | null
  fromCheckIn: string | null
  toCheckOut: string | null
  // ゲート判定用
  changeDeadlineAt: string | null
  labelSentAt: string | null
}

export default function HotelChangeModal({
  target,
  onClose,
  onDone,
}: {
  target: HotelChangeTarget
  onClose: () => void
  onDone: () => void
}) {
  const sideJa = target.side === "guest" ? "お届け先" : "発送元"
  const overDeadline = isChangeDeadlinePassed(target.changeDeadlineAt)
  const near = isChangeDeadlineNear(target.changeDeadlineAt)
  const oldSlip = !!target.labelSentAt

  const [newHotel, setNewHotel] = useState("") // 英名
  const [newHotelJa, setNewHotelJa] = useState("") // 和名
  const [newPlaceId, setNewPlaceId] = useState("")
  const [newCity, setNewCity] = useState("")
  const [newPrefecture, setNewPrefecture] = useState("")

  const [dateConfirmed, setDateConfirmed] = useState(false)
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const onPicked = useCallback((h: PickedHotel) => {
    setNewPlaceId(h.placeId)
    setNewHotelJa(h.nameJa)
    setNewHotel(h.name)
    setNewCity(h.city)
    setNewPrefecture(h.prefecture)
  }, [])

  const canSubmit =
    !!newHotel.trim() &&
    !!newHotelJa.trim() &&
    !!newPlaceId.trim() &&
    dateConfirmed &&
    (!overDeadline || !!reason.trim()) &&
    !submitting

  const submit = async () => {
    setSubmitting(true)
    setError("")
    try {
      const res = await fetch(`/api/operator/shipment/${encodeURIComponent(target.shipmentId)}/hotel-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          side: target.side,
          newHotel: newHotel.trim(),
          newHotelJa: newHotelJa.trim(),
          newPlaceId: newPlaceId.trim(),
          newCity: newCity.trim() || null,
          newPrefecture: newPrefecture.trim() || null,
          reason: reason.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || data.error || "変更に失敗しました")
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : "変更に失敗しました")
    }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/40 p-3 overflow-y-auto" onClick={onClose}>
      <div
        className="w-full max-w-lg my-4 rounded-2xl bg-white shadow-xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-white px-4 py-3 rounded-t-2xl">
          <div>
            <p className="text-sm font-semibold text-foreground">{sideJa}ホテルの変更</p>
            <p className="text-[11px] text-muted-foreground font-mono">{target.legLabel}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" strokeWidth={1.6} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          {/* 変更締切 */}
          <div className={`rounded-lg border px-3 py-2 text-xs ${overDeadline ? "border-red-300 bg-red-50 text-red-800" : near ? "border-amber-300 bg-amber-50 text-amber-800" : "border-border bg-slate-50 text-foreground"}`}>
            変更締切: <span className="font-semibold">{formatChangeDeadlineJst(target.changeDeadlineAt)}</span>
            {overDeadline && <span className="ml-1 font-bold">（締切超過）</span>}
            {!overDeadline && near && <span className="ml-1 font-bold">（残り48時間以内）</span>}
          </div>

          {/* 準物理ゲート告知 */}
          {oldSlip && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 flex gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" strokeWidth={1.8} />
              送り状(紙)が郵送済みです。変更すると「旧伝票破棄の連絡タスク」が生成されます。
            </div>
          )}

          {/* Places ピッカー */}
          <HotelPlacePicker label={`新しい${sideJa}ホテルを検索（Google Places）`} onPicked={onPicked} onError={setError} />

          {/* 取得結果 (英名・和名 必須・編集可) */}
          <div className="grid grid-cols-1 gap-2">
            <div>
              <label className="text-[11px] text-muted-foreground">英名（必須）</label>
              <input value={newHotel} onChange={(e) => setNewHotel(e.target.value)} placeholder="Daiwa Roynet Hotel …" className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">和名（必須）</label>
              <input value={newHotelJa} onChange={(e) => setNewHotelJa(e.target.value)} placeholder="ダイワロイネットホテル…" className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
            </div>
            <p className={`text-[10px] ${newPlaceId ? "text-emerald-700" : "text-red-600"}`}>
              {newPlaceId ? `place_id 取得済み（${newCity || "-"} / ${newPrefecture || "-"}）` : "※ Google Places から選択して place_id を取得してください（手入力のみでは保存不可）"}
            </p>
          </div>

          {/* 変更前後 */}
          {newHotelJa && (
            <div className="rounded-lg border border-border bg-slate-50 px-3 py-2 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground line-through">{target.currentHotelJa || target.currentHotel}</span>
                <ArrowRight className="w-3.5 h-3.5 text-foreground" strokeWidth={1.8} />
                <span className="font-semibold text-foreground">{newHotelJa}</span>
              </div>
            </div>
          )}

          {/* 日程据え置き確認 */}
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-[11px] font-semibold text-foreground mb-1">日程は据え置きです（変更されません）</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              <span>発送日: <span className="text-foreground">{target.shipmentDate}</span></span>
              <span>到着予定: <span className="text-foreground">{target.expectedArrival || "—"}</span></span>
              <span>チェックイン: <span className="text-foreground">{target.fromCheckIn || "—"}</span></span>
              <span>チェックアウト: <span className="text-foreground">{target.toCheckOut || "—"}</span></span>
            </div>
            <label className="mt-2 flex items-center gap-2 text-[11px] text-foreground cursor-pointer">
              <input type="checkbox" checked={dateConfirmed} onChange={(e) => setDateConfirmed(e.target.checked)} />
              日程が据え置きであることを確認しました
            </label>
          </div>

          {/* 締切超過: 理由必須 */}
          {overDeadline && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2">
              <p className="text-[11px] font-bold text-red-800 mb-1">変更締切を過ぎています。理由の入力が必須です。</p>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="変更理由（必須）" className="w-full rounded-lg border border-red-300 px-3 py-2 text-sm" />
            </div>
          )}

          {error && <p className="text-[11px] text-red-700">{error}</p>}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-white px-4 py-3 rounded-b-2xl">
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-xs">キャンセル</button>
          <button
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1 rounded-lg bg-[#C8102E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#a60d26] disabled:opacity-40"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.8} /> : null}
            {overDeadline ? "締切超過で変更する" : "変更を保存"}
          </button>
        </div>
      </div>
    </div>
  )
}
