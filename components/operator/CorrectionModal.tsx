"use client"

// 予約の訂正モーダル (運営用・設計案A)。
// 発送(集荷)日・到着予定・個数・代表者・受取人・代理店を1画面で訂正する。
// ホテルの変更は既存の HotelChangeModal が担当するためここには含めない。
//
// 保存先: POST /api/operator/shipment/[id]/correct (即時反映・監査記録・下流判定)。
// 代理店は予約(booking_id)の全区間へ反映、その他はこの区間のみ。

import { useState } from "react"
import { Loader2, X } from "lucide-react"
import {
  formatChangeDeadlineJst,
  isChangeDeadlinePassed,
  isChangeDeadlineNear,
} from "@/lib/change-deadline"

export type CorrectionTarget = {
  shipmentId: string
  legLabel: string
  bookingId: string
  shipmentDate: string
  expectedArrival: string | null
  suitcaseCount: number
  representative: string
  recipient: string
  agency: string
  status: string
  carrier: string
  changeDeadlineAt: string | null
}

export default function CorrectionModal({
  target,
  agencies,
  onClose,
  onDone,
}: {
  target: CorrectionTarget
  agencies: string[]
  onClose: () => void
  onDone: () => void
}) {
  const [shipmentDate, setShipmentDate] = useState(target.shipmentDate || "")
  const [expectedArrival, setExpectedArrival] = useState(target.expectedArrival || "")
  const [suitcaseCount, setSuitcaseCount] = useState(String(target.suitcaseCount ?? 1))
  const [representative, setRepresentative] = useState(target.representative || "")
  const [recipient, setRecipient] = useState(target.recipient || "")
  const [agency, setAgency] = useState(target.agency || "")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")
  const [done, setDone] = useState<{ changed: string[]; downstreamLabel: string | null } | null>(null)

  const shipped = ["picked_up", "in_transit", "delivered"].includes(target.status)
  const over = isChangeDeadlinePassed(target.changeDeadlineAt)
  const near = isChangeDeadlineNear(target.changeDeadlineAt)

  const submit = async () => {
    setSaving(true)
    setErr("")
    try {
      const res = await fetch(`/api/operator/shipment/${target.shipmentId}/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipmentDate,
          expectedArrival,
          suitcaseCount: Number(suitcaseCount),
          representative,
          recipient,
          agency,
          reason: reason.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "更新に失敗しました")
      setDone({ changed: data.changed || [], downstreamLabel: data.downstreamLabel || null })
    } catch (e) {
      setErr(e instanceof Error ? e.message : "更新に失敗しました")
    }
    setSaving(false)
  }

  const field = "w-full rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm"
  const label = "block text-[11px] font-semibold text-muted-foreground mb-1"

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold text-foreground">
            予約を訂正　<span className="font-mono text-muted-foreground">{target.legLabel}</span>
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" strokeWidth={1.6} />
          </button>
        </div>

        {done ? (
          <div className="px-5 py-4 space-y-3">
            <p className="text-sm font-semibold text-emerald-700">訂正を反映しました。</p>
            {done.changed.length > 0 ? (
              <ul className="space-y-1 rounded-lg bg-slate-50 border border-border p-3 text-xs text-foreground">
                {done.changed.map((c, i) => (
                  <li key={i}>・{c}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">変更点はありませんでした。</p>
            )}
            {done.downstreamLabel && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                ⚠️ {done.downstreamLabel}
              </p>
            )}
            <div className="flex justify-end">
              <button
                onClick={onDone}
                className="rounded-lg bg-[#C8102E] px-3 py-1.5 text-xs font-semibold text-white"
              >
                閉じる
              </button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-3">
            <p
              className={`text-[11px] ${over ? "text-red-700 font-semibold" : near ? "text-amber-700 font-semibold" : "text-muted-foreground"}`}
            >
              変更締切: {formatChangeDeadlineJst(target.changeDeadlineAt)}
              {over && "（締切超過・運営権限で反映されます）"}
              {!over && near && "（残り48時間以内）"}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>発送(集荷)日</label>
                <input
                  type="date"
                  value={shipmentDate}
                  onChange={(e) => setShipmentDate(e.target.value)}
                  disabled={shipped}
                  className={`${field} disabled:bg-slate-100`}
                />
              </div>
              <div>
                <label className={label}>到着予定日</label>
                <input
                  type="date"
                  value={expectedArrival}
                  onChange={(e) => setExpectedArrival(e.target.value)}
                  className={field}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>個数</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={suitcaseCount}
                  onChange={(e) => setSuitcaseCount(e.target.value)}
                  disabled={shipped}
                  className={`${field} disabled:bg-slate-100`}
                />
              </div>
              <div>
                <label className={label}>代理店（全区間に反映）</label>
                {agencies.length > 0 ? (
                  <select value={agency} onChange={(e) => setAgency(e.target.value)} className={field}>
                    {!agencies.includes(agency) && agency && <option value={agency}>{agency}（未登録）</option>}
                    {agencies.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={agency} disabled className={`${field} disabled:bg-slate-100`} />
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>代表者</label>
                <input
                  value={representative}
                  onChange={(e) => setRepresentative(e.target.value)}
                  className={field}
                />
              </div>
              <div>
                <label className={label}>受取人</label>
                <input value={recipient} onChange={(e) => setRecipient(e.target.value)} className={field} />
              </div>
            </div>

            <div>
              <label className={label}>メモ／理由（任意・監査に残ります）</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="例) お客様都合で集荷日を1日後ろ倒し"
                className={field}
              />
            </div>

            {shipped && (
              <p className="text-[11px] text-amber-700">
                集荷済み以降のため、発送日・個数は変更できません（実物と食い違うため）。
              </p>
            )}
            {err && <p className="text-xs text-red-700">{err}</p>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/40"
              >
                取消
              </button>
              <button
                onClick={() => void submit()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#C8102E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />}
                訂正を反映
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
