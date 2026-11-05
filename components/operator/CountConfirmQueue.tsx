"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * P1-B2 v3.5 Track D｜実個数確認・料金承認待ちキュー (Operator ダッシュボードのパネル)。
 * 既存画面を刷新せず、確認待ち案件を1箇所にまとめる。全ての更新はテスト済み API
 * /api/operator/confirm-pickup-count を通す。増額は代理店承認が必要なため Operator では確定できない。
 * 何もなければ null を返して画面を乱さない。
 */

interface QueueItem {
  shipmentId: string
  bookingRef: string
  agency: string | null
  fromHotel: string | null
  toHotel: string | null
  shipmentDate: string | null
  declared: number
  actual: number | null
  discrepancy: boolean
  amountYen: number | null
  recalcAmountYen: number | null
  approvedAmountYen: number | null
  countStatus: string
  priceStatus: string
  holdState: string
  hasOpenIssue: boolean
  approvalState: string | null
  updatedAt: string | null
}

const yen = (n: number | null | undefined) => (n == null ? "—" : `¥${n.toLocaleString("ja-JP")}`)

const PRICE_LABEL: Record<string, string> = {
  pending: "料金未確定",
  calculated: "料金計算済み",
  approved: "料金承認済み",
  requires_customer_approval: "代理店の増額承認待ち",
}
const HOLD_LABEL: Record<string, string> = { auto: "対象外", held: "保留中", released: "解除済み" }

export default function CountConfirmQueue() {
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [inputs, setInputs] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/operator/count-confirm-queue")
      if (!res.ok) { setItems([]); return }
      const d = (await res.json()) as { items?: QueueItem[] }
      setItems(Array.isArray(d.items) ? d.items : [])
    } catch {
      setItems([])
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const post = useCallback(
    async (shipmentId: string, body: Record<string, unknown>, key: string) => {
      setBusy(key)
      try {
        await fetch("/api/operator/confirm-pickup-count", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: shipmentId, ...body }),
        })
        await load()
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  const recordCount = useCallback(
    (it: QueueItem) => {
      const raw = inputs[it.shipmentId]
      const n = Math.floor(Number(raw))
      if (!Number.isFinite(n) || n < 0 || n > 999) {
        window.alert("実個数は 0〜999 で入力してください")
        return
      }
      void post(it.shipmentId, { action: "record", actualCount: n, source: "operator_manual" }, `rec:${it.shipmentId}`)
    },
    [inputs, post],
  )

  const finalizeDecrease = useCallback(
    (it: QueueItem) => {
      // 減額/一致 (計算済み) の確定: 料金承認 → 保留解除。増額 (要代理店承認) はここに出ない。
      if (!window.confirm(`${it.bookingRef} の料金を ${yen(it.recalcAmountYen ?? it.amountYen)} で確定し、保留を解除します。よろしいですか？`)) return
      void (async () => {
        setBusy(`fin:${it.shipmentId}`)
        try {
          await fetch("/api/operator/confirm-pickup-count", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: it.shipmentId, action: "approve_price", decision: "approved" }),
          })
          await fetch("/api/operator/confirm-pickup-count", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: it.shipmentId, action: "release" }),
          })
          await load()
        } finally {
          setBusy(null)
        }
      })()
    },
    [load],
  )

  const releaseApproved = useCallback(
    (it: QueueItem) => {
      if (!window.confirm(`${it.bookingRef} は承認済みです。保留を解除して課金・請求を許可します。よろしいですか？`)) return
      void post(it.shipmentId, { action: "release" }, `rel:${it.shipmentId}`)
    },
    [post],
  )

  if (items === null || items.length === 0) return null

  return (
    <section className="rounded-2xl border border-border bg-white p-4 mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-bold text-foreground">📦 実個数確認・料金承認待ち（{items.length}件）</h2>
        <button onClick={() => void load()} className="text-xs text-muted-foreground hover:text-foreground">
          更新
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        実個数を記録すると料金を再計算します。減額・一致はここで確定できます。増額は代理店の承認が必要です（配送は止まりません）。
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left p-2 font-medium">予約 / 代理店</th>
              <th className="text-left p-2 font-medium">集荷元→先 / 集荷日</th>
              <th className="text-right p-2 font-medium">予約→実</th>
              <th className="text-right p-2 font-medium">料金 現行→再計算</th>
              <th className="text-left p-2 font-medium">状態</th>
              <th className="text-left p-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const needsAgency = it.priceStatus === "requires_customer_approval"
              const canFinalize = it.holdState === "held" && it.priceStatus === "calculated" && it.countStatus === "confirmed" && !it.hasOpenIssue
              const canRelease = it.holdState === "held" && it.priceStatus === "approved" && it.countStatus === "confirmed" && !it.hasOpenIssue
              return (
                <tr key={it.shipmentId} className="border-t border-border align-top hover:bg-muted/20">
                  <td className="p-2">
                    <div className="font-medium text-foreground">{it.bookingRef}</div>
                    <div className="text-xs text-muted-foreground">{it.agency ?? "—"}</div>
                  </td>
                  <td className="p-2 text-xs">
                    <div>{(it.fromHotel ?? "—") + " → " + (it.toHotel ?? "—")}</div>
                    <div className="text-muted-foreground">{it.shipmentDate ?? "—"}</div>
                  </td>
                  <td className="p-2 text-right">
                    <span className={it.discrepancy ? "font-bold text-[#C8102E]" : ""}>
                      {it.declared}
                      {" → "}
                      {it.actual ?? "未確認"}
                    </span>
                  </td>
                  <td className="p-2 text-right text-xs">
                    {yen(it.amountYen)}
                    {it.recalcAmountYen != null && it.recalcAmountYen !== it.amountYen ? ` → ${yen(it.recalcAmountYen)}` : ""}
                    <div className="text-muted-foreground">（税抜）</div>
                  </td>
                  <td className="p-2 text-xs">
                    <span className="inline-block px-2 py-0.5 rounded-md bg-muted/60">{HOLD_LABEL[it.holdState] ?? it.holdState}</span>{" "}
                    <span className="inline-block px-2 py-0.5 rounded-md bg-muted/60">{PRICE_LABEL[it.priceStatus] ?? it.priceStatus}</span>
                    {it.hasOpenIssue ? <div className="mt-1 text-[#C8102E]">未解決の集荷問題あり</div> : null}
                    {needsAgency ? (
                      <div className="mt-1 text-amber-700">
                        {it.approvalState === "approved" ? "代理店が承認済み" : "代理店の承認待ち"}
                      </div>
                    ) : null}
                  </td>
                  <td className="p-2">
                    {it.countStatus === "unconfirmed" || it.actual == null ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={999}
                          value={inputs[it.shipmentId] ?? ""}
                          onChange={(e) => setInputs((p) => ({ ...p, [it.shipmentId]: e.target.value }))}
                          placeholder="実個数"
                          className="w-20 rounded-md border border-border px-2 py-1 text-sm"
                        />
                        <button
                          onClick={() => recordCount(it)}
                          disabled={busy === `rec:${it.shipmentId}`}
                          className="rounded-md bg-[#C8102E] px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                        >
                          記録
                        </button>
                      </div>
                    ) : canFinalize ? (
                      <button
                        onClick={() => finalizeDecrease(it)}
                        disabled={busy === `fin:${it.shipmentId}`}
                        className="rounded-md bg-foreground px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                      >
                        料金確定して解除
                      </button>
                    ) : canRelease ? (
                      <button
                        onClick={() => releaseApproved(it)}
                        disabled={busy === `rel:${it.shipmentId}`}
                        className="rounded-md bg-foreground px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                      >
                        承認済み→解除
                      </button>
                    ) : needsAgency ? (
                      <span className="text-xs text-muted-foreground">代理店承認を待機</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
