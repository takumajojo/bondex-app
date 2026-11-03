"use client"

// 区間ごとの「佐川への集荷依頼」パネル (2026-11-03 Biz-Logi 導入 Phase 1-a)。
// 手動 (佐川指定 Excel) と Biz-Logi API の依頼を同じ記録で扱い、1区間に有効な依頼は1件まで。
// Biz-Logi は「送信内容を確認 (無課金の確認機能)」→「Excel で依頼していないことを確認」→「送信」の順。
// 結果不明のときは再送ボタンを出さない。佐川へ確認した結果を記録してもらう。

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { CHANNEL_LABEL_JA, STATE_LABEL_JA, STALE_SENDING_MS, type PickupRequestRow, type PickupRequestState, type ResolveAction } from "@/lib/pickup-request/state"

const ACTOR_KEY = "bondex_operator_name"

export function useOperatorName(): [string, (v: string) => void] {
  const [name, setName] = useState("")
  useEffect(() => {
    try {
      setName(localStorage.getItem(ACTOR_KEY) ?? "")
    } catch {
      /* 保存できない環境でも入力は使える */
    }
  }, [])
  const update = (v: string) => {
    setName(v)
    try {
      localStorage.setItem(ACTOR_KEY, v)
    } catch {
      /* noop */
    }
  }
  return [name, update]
}

export function OperatorNameInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
      担当者名
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 40))}
        placeholder="例: 谷口"
        className="w-28 rounded border border-border px-2 py-1 text-[12px] text-foreground"
      />
    </label>
  )
}

interface PanelData {
  requests: PickupRequestRow[]
  live: PickupRequestRow | null
  /** sql/062 未適用 (従来の「集荷手配済み」チェックで運用中) */
  legacy?: boolean
  bizlogi: { available: true; environment: "test" | "production"; live: boolean } | { available: false; reason: string }
}

interface Preview {
  ok: boolean
  errors?: string[]
  warnings?: string[]
  fingerprint?: string
  cutoffAt?: string | null
  environment?: string
  origin?: { name: string; postalCode: string; address: string; tel: string }
  destination?: { name: string; postalCode: string; address: string; tel: string }
  detail?: { haisoKosu: number; userManageNumber: string; shippingDate: string; shiteiDate?: string; kiji?: string[] }
}

const fmt = (iso: string | null | undefined) => {
  if (!iso) return "—"
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

const STATE_TONE: Record<PickupRequestState, string> = {
  sending: "bg-amber-100 text-amber-800",
  accepted: "bg-emerald-100 text-emerald-800",
  unknown: "bg-red-100 text-red-700",
  failed: "bg-slate-100 text-slate-700",
  needs_review: "bg-amber-100 text-amber-800",
  change_pending: "bg-blue-100 text-blue-800",
  cancelled: "bg-slate-100 text-slate-700",
  void: "bg-slate-100 text-slate-500",
}

export default function PickupRequestPanel({
  shipmentId,
  legLabel,
  actor,
  onChanged,
}: {
  shipmentId: string
  legLabel: string
  actor: string
  onChanged?: () => void
}) {
  const [data, setData] = useState<PanelData | null>(null)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState("")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [confirmNoManual, setConfirmNoManual] = useState(false)
  const [number, setNumber] = useState("")
  const [note, setNote] = useState("")
  const [showHistory, setShowHistory] = useState(false)

  const load = useCallback(async () => {
    setError("")
    try {
      const res = await fetch(`/api/operator/pickup-request?shipmentId=${encodeURIComponent(shipmentId)}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "読み込みに失敗しました")
      setData(d as PanelData)
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました")
    }
  }, [shipmentId])

  useEffect(() => {
    void load()
  }, [load])

  const needActor = () => {
    if (!actor.trim()) {
      setError("担当者名を入力してください")
      return true
    }
    return false
  }

  const post = async (key: string, body: Record<string, unknown>) => {
    if (busy) return null // 連打防止 (最終的な二重防止は DB)
    setBusy(key)
    setError("")
    setMessage("")
    try {
      const res = await fetch("/api/operator/pickup-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const d = await res.json().catch(() => ({}))
      return { res, d }
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信に失敗しました")
      return null
    } finally {
      setBusy("")
    }
  }

  const done = async (msg: string) => {
    setMessage(msg)
    setPreview(null)
    setConfirmNoManual(false)
    setNumber("")
    setNote("")
    await load()
    onChanged?.()
  }

  const markManual = async () => {
    if (needActor()) return
    const r = await post("manual", { action: "manual_mark", shipmentId, actor })
    if (!r) return
    if (!r.res.ok) return setError(r.d.error || "記録できませんでした")
    await done("手動 (Excel) で依頼済みとして記録しました")
  }

  const runPreview = async () => {
    const r = await post("preview", { action: "bizlogi_preview", shipmentId })
    if (!r) return
    if (!r.res.ok) return setError(r.d.error || "確認できませんでした")
    setPreview(r.d as Preview)
  }

  const send = async () => {
    if (needActor() || !preview?.fingerprint) return
    if (!confirmNoManual) return setError("佐川指定 Excel で依頼していないことを確認してください")
    const r = await post("send", { action: "bizlogi_send", shipmentId, fingerprint: preview.fingerprint, actor, confirmNoManual: true })
    if (!r) return
    const d = r.d as { outcome?: string; shippingNumber?: string; errors?: string[]; reason?: string; error?: string }
    if (d.outcome === "accepted") return done(`集荷依頼を受け付けました。問合番号 ${d.shippingNumber}`)
    if (d.outcome === "failed") {
      await load()
      return setError(`集荷依頼は受け付けられませんでした (佐川に登録なし・課金なし): ${(d.errors ?? []).join(" / ")}`)
    }
    if (d.outcome === "unknown") {
      await load()
      onChanged?.()
      return setError(`結果が分かりません。再送はしないでください。世田谷営業所に確認して結果を記録してください: ${d.reason}`)
    }
    setError(d.reason || d.error || "送信できませんでした")
  }

  const resolve = async (action: ResolveAction, msg: string, opts: { withNumber?: boolean } = {}) => {
    if (needActor() || !data?.live) return
    const r = await post(action, {
      action: "resolve",
      requestId: data.live.id,
      resolveAction: action,
      actor,
      shippingNumber: opts.withNumber ? number : undefined,
      note: note || undefined,
    })
    if (!r) return
    if (!r.res.ok) return setError(r.d.error || "記録できませんでした")
    await done(msg)
  }

  if (!data) {
    return (
      <div className="text-[11px] text-muted-foreground">
        {error ? <span className="text-red-700">{error}</span> : <Loader2 className="inline w-3 h-3 animate-spin" />}
      </div>
    )
  }

  if (data.legacy) {
    return <p className="text-[11px] text-muted-foreground">集荷依頼の記録は移行前です（従来の「集荷手配（佐川）済み」チェックで運用してください）。</p>
  }

  const live = data.live
  const stale = live?.state === "sending" && Date.now() - Date.parse(live.updated_at) > STALE_SENDING_MS
  const btn = "rounded-lg px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50"
  const primary = `${btn} bg-blue-600 text-white hover:bg-blue-700`
  const secondary = `${btn} border border-border bg-white text-foreground hover:bg-slate-50`
  const danger = `${btn} bg-red-600 text-white hover:bg-red-700`
  const B = ({ k, label, cls, onClick }: { k: string; label: string; cls: string; onClick: () => void }) => (
    <button onClick={onClick} disabled={!!busy} className={cls}>
      {busy === k ? <Loader2 className="inline w-3 h-3 animate-spin" /> : null} {label}
    </button>
  )

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">佐川への集荷依頼（{legLabel}）</span>
        {live ? (
          <>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STATE_TONE[live.state]}`}>{STATE_LABEL_JA[live.state]}</span>
            <span className="text-muted-foreground">{CHANNEL_LABEL_JA[live.channel]}</span>
            {live.shipping_number && <span className="font-mono">問合番号 {live.shipping_number}</span>}
            {live.environment === "test" && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-800">テスト環境</span>}
          </>
        ) : (
          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">未依頼</span>
        )}
      </div>
      {live?.error && <p className="text-[11px] text-red-700">{live.error}</p>}
      {live?.note && <p className="whitespace-pre-wrap text-[11px] text-muted-foreground">{live.note}</p>}

      {!live && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <B k="manual" label="佐川指定 Excel で依頼済みにする" cls={secondary} onClick={markManual} />
            {data.bizlogi.available ? (
              <B k="preview" label="Biz-Logi で依頼：送信内容を確認" cls={primary} onClick={runPreview} />
            ) : (
              <span className="text-[11px] text-muted-foreground">Biz-Logi は未設定（{data.bizlogi.reason}）</span>
            )}
          </div>
          {preview && (
            <div className="space-y-1.5 rounded-lg border border-blue-200 bg-white p-2.5">
              <p className="font-medium">
                送信内容の確認（{preview.environment === "production" ? "本番" : "テスト環境"}・確認機能＝課金なし）
              </p>
              {!preview.ok ? (
                <ul className="list-disc pl-5 text-red-700">
                  {(preview.errors ?? []).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              ) : (
                <>
                  <p>集荷先: {preview.origin?.name}　〒{preview.origin?.postalCode} {preview.origin?.address}</p>
                  <p>お届け先: {preview.destination?.name}　〒{preview.destination?.postalCode} {preview.destination?.address}（{preview.destination?.tel}）</p>
                  <p>
                    個数 {preview.detail?.haisoKosu}・集荷日 {preview.detail?.shippingDate}
                    {preview.detail?.shiteiDate ? `・配達指定日 ${preview.detail.shiteiDate}` : ""}・管理番号 {preview.detail?.userManageNumber}
                  </p>
                  {preview.cutoffAt && <p className="text-muted-foreground">締め: {fmt(preview.cutoffAt)}（集荷前日 20:00）</p>}
                  {(preview.warnings ?? []).length > 0 && <p className="text-amber-700">注意: {preview.warnings!.join(" / ")}</p>}
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={confirmNoManual} onChange={(e) => setConfirmNoManual(e.target.checked)} className="mt-0.5" />
                    <span>この区間は佐川指定 Excel（世田谷営業所への手動依頼）で依頼していません</span>
                  </label>
                  <B k="send" label="Biz-Logi で集荷依頼を送信（取消は API でできません）" cls={danger} onClick={send} />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {live && (live.state === "unknown" || stale || live.state === "needs_review") && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-red-700">
            {live.state === "needs_review"
              ? "佐川へ依頼済みかどうか不明です。世田谷営業所への依頼状況を確認して記録してください。"
              : "佐川で受け付けられたか不明です。再送しないでください。世田谷営業所（または SG システム）に確認して記録してください。"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder={live.channel === "bizlogi" ? "佐川の問合番号（必須）" : "佐川の問合番号（分かれば）"}
              className="w-44 rounded border border-border px-2 py-1 font-mono text-[12px]"
            />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="確認メモ（誰に確認したか等）" className="w-56 rounded border border-border px-2 py-1 text-[12px]" />
          </div>
          <div className="flex flex-wrap gap-2">
            <B k="confirm_accepted" label="佐川で依頼済みと確認" cls={primary} onClick={() => resolve("confirm_accepted", "依頼済みとして記録しました", { withNumber: true })} />
            <B k="confirm_none" label="佐川に依頼は無いと確認" cls={secondary} onClick={() => resolve("confirm_none", "依頼なしとして記録しました。改めて依頼できます")} />
          </div>
        </div>
      )}

      {live && live.state === "accepted" && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="連絡内容メモ" className="w-56 rounded border border-border px-2 py-1 text-[12px]" />
          <B k="start_change" label="世田谷へ変更・取消を連絡した" cls={secondary} onClick={() => resolve("start_change", "変更・取消の連絡中として記録しました。佐川の返信を受けたら完了を記録してください")} />
          {live.channel === "manual" && !live.shipping_number && (
            <B k="confirm_none" label="依頼済みの記録を取り消す（押し間違い）" cls={secondary} onClick={() => resolve("confirm_none", "記録を取り消しました")} />
          )}
        </div>
      )}

      {live && live.state === "change_pending" && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-blue-800">メールを送っただけでは完了にしません。佐川から反映確認の返信を受けたら記録してください。</p>
          <div className="flex flex-wrap items-center gap-2">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="返信の内容" className="w-56 rounded border border-border px-2 py-1 text-[12px]" />
            <B k="change_done" label="変更が反映された" cls={primary} onClick={() => resolve("change_done", "変更の反映を記録しました")} />
            <B k="cancel_done" label="取消が反映された" cls={secondary} onClick={() => resolve("cancel_done", "取消の反映を記録しました")} />
          </div>
        </div>
      )}

      {message && <p className="text-[11px] text-emerald-700">{message}</p>}
      {error && <p className="text-[11px] text-red-700">{error}</p>}

      {data.requests.length > 0 && (
        <div>
          <button onClick={() => setShowHistory((v) => !v)} className="text-[11px] text-blue-600 hover:underline">
            記録の履歴 {data.requests.length}件 {showHistory ? "▲" : "▼"}
          </button>
          {showHistory && (
            <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
              {data.requests.map((r) => (
                <li key={r.id}>
                  {fmt(r.created_at)} {CHANNEL_LABEL_JA[r.channel]}・{STATE_LABEL_JA[r.state]}
                  {r.shipping_number ? `・${r.shipping_number}` : ""}
                  {r.requested_by ? `・依頼 ${r.requested_by}` : ""}
                  {r.resolved_by ? `・確認 ${r.resolved_by}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
