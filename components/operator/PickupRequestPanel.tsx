"use client"

// 区間ごとの「佐川への集荷依頼」パネル (2026-11-03 Biz-Logi 導入 Phase 1-a)。
// 手動 (佐川指定 Excel) と Biz-Logi API の依頼を同じ記録で扱い、1区間に有効な依頼は1件まで。
// Biz-Logi は「送信内容を確認 (無課金の確認機能)」→「Excel で依頼していないことを確認」→「送信」の順。
// 結果不明のときは再送ボタンを出さない。佐川へ確認した結果を記録してもらう。

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { CHANNEL_LABEL_JA, STATE_LABEL_JA, STALE_SENDING_MS, type PickupRequestRow, type PickupRequestState, type ResolveAction } from "@/lib/pickup-request/state"
import HotelPlacePicker from "@/components/operator/HotelPlacePicker"

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

interface ChangeRow {
  id: string
  kind: string
  large_lot: boolean
  side: "guest" | "pickup" | null
  new_hotel: string | null
  new_hotel_ja: string | null
  reason: string
  state: "requested" | "contacted" | "approved" | "rejected" | "applied" | "withdrawn"
  number_policy: "kept" | "changed" | null
  new_shipping_number: string | null
  old_shipping_number: string | null
  old_hotel: string | null
  contact_note: string | null
  answer_note: string | null
  requested_by: string
  created_at: string
}

const CHANGE_STATE_LABEL: Record<ChangeRow["state"], string> = {
  requested: "変更希望を登録（世田谷へ未連絡）",
  contacted: "世田谷へ連絡済み（佐川の回答待ち）",
  approved: "佐川が承認（BondEx へ未反映）",
  rejected: "佐川が変更不可と回答",
  applied: "反映済み",
  withdrawn: "取り下げ",
}

interface PanelData {
  requests: PickupRequestRow[]
  live: PickupRequestRow | null
  changes?: ChangeRow[]
  eligibility?: { ok: true } | { ok: false; reason: string } | null
  /** sql/067 未適用 (従来の「集荷手配済み」チェックで運用中) */
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
  detail?: {
    haisoKosu: number
    userManageNumber: string
    shippingDate: string
    shiteiDate?: string
    shiteiTimeCode?: string
    kiji?: string[]
    otodokeNm?: string[]
    otodokeAdd?: string[]
    otodokeYubin?: string
    otodokeTel?: string
    irai?: { nm: string[]; add: string[]; yubin: string; tel: string }
    shukaIrai?: { shukaIraiShiteiDate?: string }
  }
  /** 予約の登録内容 (正本)。送る内容と並べて出す */
  registered?: {
    legRef: string
    fromHotel: string
    fromHotelJa: string | null
    toHotel: string
    toHotelJa: string | null
    guestName: string
    pickupDate: string
    deliveryDate: string | null
    deliveryTime: string | null
    suitcaseCount: number | null
    tourNumber: string | null
    originCheckIn: string | null
    destCheckIn: string | null
    destCheckOut: string | null
  }
  /** Google の場所 (整える前の名称・住所)。個人宅は placeName が null */
  sources?: Record<"origin" | "destination", { registeredName: string; registeredNameJa: string | null; placeName: string | null; placeAddress: string | null }>
  /** 運営が明示的に確認しないと送れない項目 */
  confirmations?: Array<{ code: string; message: string }>
}

/** 送る前に運営が項目ごとに確かめる欄 (すべて確かめるまで送信ボタンを押せない)。 */
const CHECK_ITEMS = [
  { key: "origin", label: "集荷ホテル (登録名と送る名称・住所が同じホテル)" },
  { key: "destination", label: "お届けホテル (登録名と送る名称・住所が同じホテル)" },
  { key: "dates", label: "集荷日・配達日・時間帯" },
  { key: "pieces", label: "個数・宛名の旅行者名" },
] as const

const ymdLabel = (v?: string | null) => (v ? (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v.slice(0, 10)) : "—")

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
  // 確認画面の項目ごとの確認と、運営の明示の確認 (confirmations)。新しい確認をするたびに外す
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [number, setNumber] = useState("")
  const [note, setNote] = useState("")
  const [usage, setUsage] = useState<string>("")
  const [showHistory, setShowHistory] = useState(false)
  // 佐川の宛名欄 (25文字×2行) に収まらないときに運営が入れる佐川向けの名称 (自動では切り詰めない)
  const [showNames, setShowNames] = useState(false)
  const [ovOrigin, setOvOrigin] = useState("")
  const [ovDest, setOvDest] = useState("")
  const [ovGuest, setOvGuest] = useState("")
  const overrides = { originName: ovOrigin, destinationName: ovDest, guestName: ovGuest }

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
    const r = await post("preview", { action: "bizlogi_preview", shipmentId, overrides })
    if (!r) return
    if (!r.res.ok) return setError(r.d.error || "確認できませんでした")
    const pv = r.d as Preview
    setPreview(pv)
    setConfirmNoManual(false)
    setChecked({})
    // 宛名が収まらないエラーなら、佐川向けの名称の入力欄を開く
    if (!pv.ok && (pv.errors ?? []).some((e) => /宛名|Nm1/.test(e))) setShowNames(true)
  }

  const allChecked =
    !!preview?.ok &&
    CHECK_ITEMS.every((c) => checked[c.key]) &&
    (preview.confirmations ?? []).every((c) => checked[`ack:${c.code}`])

  const send = async () => {
    if (needActor() || !preview?.fingerprint) return
    if (!confirmNoManual) return setError("佐川指定 Excel で依頼していないことを確認してください")
    if (!allChecked) return setError("登録内容と送信内容を、項目ごとに確認してください")
    const acknowledged = (preview.confirmations ?? []).map((c) => c.code)
    const r = await post("send", { action: "bizlogi_send", shipmentId, fingerprint: preview.fingerprint, actor, confirmNoManual: true, overrides, acknowledged })
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
            {data.eligibility && !data.eligibility.ok ? (
              <span className="text-[11px] text-amber-800">手動手配のみ：{data.eligibility.reason}</span>
            ) : data.bizlogi.available ? (
              <B k="preview" label="Biz-Logi で依頼：送信内容を確認" cls={primary} onClick={runPreview} />
            ) : (
              <span className="text-[11px] text-muted-foreground">Biz-Logi は未設定（{data.bizlogi.reason}）</span>
            )}
          </div>
          {data.bizlogi.available && data.eligibility?.ok !== false && (
            <div>
              <button onClick={() => setShowNames((v) => !v)} className="text-[11px] text-blue-600 hover:underline">
                佐川の宛名を指定（ホテル名・旅行者名が長く収まらない場合）{showNames ? " ▲" : " ▼"}
              </button>
              {showNames && (
                <div className="mt-1 space-y-1 rounded-lg border border-slate-200 bg-white p-2">
                  <p className="text-[11px] text-muted-foreground">
                    佐川の宛名は「ホテル名 気付」「旅行者名 様」を各25文字までで送ります。自動では切り詰めません。
                    収まらない場合だけ、佐川の現場で分かる名称を入力してください（この依頼にだけ使い、記録に残します）。入力後に「送信内容を確認」をやり直してください。
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input value={ovOrigin} onChange={(e) => setOvOrigin(e.target.value)} placeholder="発送元ホテル名（佐川向け・22文字まで）" className="w-64 rounded border border-border px-2 py-1 text-[12px]" />
                    <input value={ovDest} onChange={(e) => setOvDest(e.target.value)} placeholder="到着ホテル名（佐川向け・22文字まで）" className="w-64 rounded border border-border px-2 py-1 text-[12px]" />
                    <input value={ovGuest} onChange={(e) => setOvGuest(e.target.value)} placeholder="旅行者名（佐川向け・24文字まで）" className="w-56 rounded border border-border px-2 py-1 text-[12px]" />
                  </div>
                </div>
              )}
            </div>
          )}
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
                  <SendComparison preview={preview} />
                  {(preview.confirmations ?? []).length > 0 && (
                    <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-2">
                      {(preview.confirmations ?? []).map((c) => (
                        <label key={c.code} className="flex items-start gap-2 text-amber-800">
                          <input type="checkbox" checked={!!checked[`ack:${c.code}`]} onChange={(e) => setChecked((v) => ({ ...v, [`ack:${c.code}`]: e.target.checked }))} className="mt-0.5" />
                          <span>{c.message}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">登録内容と送信内容を見比べて、項目ごとに確認してください（違いがあれば送らずに予約を直してください。システムは推測で直しません）</p>
                    {CHECK_ITEMS.map((c) => (
                      <label key={c.key} className="flex items-start gap-2">
                        <input type="checkbox" checked={!!checked[c.key]} onChange={(e) => setChecked((v) => ({ ...v, [c.key]: e.target.checked }))} className="mt-0.5" />
                        <span>{c.label}</span>
                      </label>
                    ))}
                  </div>
                  {preview.cutoffAt && <p className="text-muted-foreground">締め: {fmt(preview.cutoffAt)}（集荷前日 20:00）</p>}
                  {(preview.warnings ?? []).length > 0 && <p className="text-amber-700">注意: {preview.warnings!.join(" / ")}</p>}
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={confirmNoManual} onChange={(e) => setConfirmNoManual(e.target.checked)} className="mt-0.5" />
                    <span>この区間は佐川指定 Excel（世田谷営業所への手動依頼）で依頼していません</span>
                  </label>
                  {allChecked && confirmNoManual ? (
                    <B k="send" label="Biz-Logi で集荷依頼を送信（取消は API でできません）" cls={danger} onClick={send} />
                  ) : (
                    <p className="text-[11px] text-muted-foreground">すべての確認にチェックすると、送信ボタンが出ます</p>
                  )}
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
              : "佐川で受け付けられたか不明です。再送しないでください。世田谷営業所（または SG システム）に確認して記録してください。締め（集荷前日 20:00）までに確認できないときも再依頼はせず、翌朝の始業後に確認します（SOP：結果不明時の対応）。"}
          </p>
          {live.channel === "bizlogi" && live.assigned_number && (
            <p className="text-[11px]">
              送った問合番号（BondEx で採番）：<span className="font-mono font-semibold">{live.assigned_number}</span>
              <span className="text-muted-foreground">　この番号で世田谷営業所・SG・佐川の追跡に確かめてください</span>
            </p>
          )}
          {live.channel === "bizlogi" && live.state === "unknown" && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!!busy}
                onClick={async () => {
                  const r = await post("usage", { action: "usage_check", requestId: live.id })
                  if (!r) return
                  if (!r.res.ok) {
                    setError(String((r.d as { error?: string }).error ?? "照合できませんでした"))
                    return
                  }
                  const d = r.d as { date: string; sagawaCount: number; localAccepted: number; localUnknown: number; message: string }
                  setUsage(`${d.date}：佐川の発行数 ${d.sagawaCount} / BondEx 受付済み ${d.localAccepted} / 結果不明 ${d.localUnknown} — ${d.message}`)
                }}
                className={secondary}
              >
                利用実績で照合（読み取りだけ）
              </button>
              {usage && <span className="text-[11px] text-foreground">{usage}</span>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder={live.channel === "bizlogi" ? (live.assigned_number ? `送った番号 ${live.assigned_number}（空欄ならこの番号で記録）` : "佐川の問合番号（必須）") : "佐川の問合番号（分かれば）"}
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
          <span className="text-[11px] text-muted-foreground">変更・取消は下の「変更申請」から登録します（区間の情報は佐川の回答の後に反映）。</span>
          {live.channel === "manual" && !live.shipping_number && (
            <B k="confirm_none" label="依頼済みの記録を取り消す（押し間違い）" cls={secondary} onClick={() => resolve("confirm_none", "記録を取り消しました")} />
          )}
        </div>
      )}

      {live && live.state === "change_pending" && (
        <p className="text-[11px] text-blue-800">世田谷へ変更・取消を連絡中です。佐川から回答を受けたら、下の「変更申請」に記録してください。</p>
      )}

      {live && (live.state === "accepted" || live.state === "change_pending") && (
        <AfterAcceptChange
          shipmentId={shipmentId}
          changes={data.changes ?? []}
          liveState={live.state}
          actor={actor}
          busy={busy}
          post={post}
          onDone={done}
          onError={setError}
        />
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

// 集荷依頼の受付後の変更 (ホテル・問い合わせ番号)。佐川の回答 (承認) を記録するまで区間のホテル情報は変えない。
const CHANGE_KIND_LABEL: Record<string, string> = {
  dates: "日程",
  count: "個数",
  representative: "代表者名",
  cancel: "取消",
  number: "問い合わせ番号の振り直し",
  rearrange: "個別再手配",
}

function changeSummary(c: ChangeRow): string {
  if (c.side) return `${c.side === "guest" ? "到着" : "発送元"}ホテル → ${c.new_hotel_ja || c.new_hotel}`
  return `${CHANGE_KIND_LABEL[c.kind] ?? c.kind}${c.large_lot ? "（20個以上：世田谷へ事前確認）" : ""}`
}

function AfterAcceptChange({
  shipmentId,
  changes,
  liveState,
  actor,
  busy,
  post,
  onDone,
  onError,
}: {
  shipmentId: string
  changes: ChangeRow[]
  liveState: string
  actor: string
  busy: string
  post: (key: string, body: Record<string, unknown>) => Promise<{ res: Response; d: Record<string, unknown> } | null>
  onDone: (msg: string) => Promise<void>
  onError: (msg: string) => void
}) {
  const open = changes.find((c) => ["requested", "contacted", "approved"].includes(c.state))
  const [show, setShow] = useState(false)
  // 申請の種類: ホテル (到着先 / 発送元)・問い合わせ番号の振り直し・日程・個数・代表者名・取消・個別再手配
  const [side, setSide] = useState<"guest" | "pickup" | "none" | "dates" | "count" | "representative" | "cancel" | "rearrange">("guest")
  const [shipDate, setShipDate] = useState("")
  const [arrDate, setArrDate] = useState("")
  const [pieces, setPieces] = useState("")
  const [repName, setRepName] = useState("")
  const [hotel, setHotel] = useState("")
  const [hotelJa, setHotelJa] = useState("")
  const [placeId, setPlaceId] = useState("")
  const [pref, setPref] = useState("")
  const [city, setCity] = useState("")
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [policy, setPolicy] = useState<"kept" | "changed">("kept")
  const [newNumber, setNewNumber] = useState("")
  const btn = "rounded-lg px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50"
  const run = async (key: string, body: Record<string, unknown>, msg: string) => {
    if (!actor.trim()) return onError("担当者名を入力してください")
    const r = await post(key, { ...body, actor })
    if (!r) return
    if (!r.res.ok) return onError(String(r.d.error || "記録できませんでした"))
    setNote("")
    await onDone(msg)
  }
  const input = "rounded border border-border px-2 py-1 text-[12px]"
  return (
    <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-2.5">
      <p className="font-medium">受付後の変更申請（ホテル・日程・個数・代表者名・取消・番号）</p>
      <p className="text-[11px] text-muted-foreground">
        受付後は API で変更できず、区間の情報も直接は変えられません（DB が止めます）。変更申請を登録 → 世田谷営業所へ連絡 → 佐川の回答（承認／不可）を記録 → 承認なら BondEx に反映、の順です。回答の前は区間の情報は変わりません。
      </p>
      {open ? (
        <div className="space-y-1.5">
          <p className="text-[12px]">
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800">{CHANGE_STATE_LABEL[open.state]}</span>{" "}
            {changeSummary(open)}
            <span className="text-muted-foreground">（理由：{open.reason}・登録 {open.requested_by}）</span>
          </p>
          {open.state === "requested" && (
            <div className="flex flex-wrap items-center gap-2">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="世田谷へ連絡した内容（必須）" className={`${input} w-64`} />
              <button disabled={!!busy || liveState !== "accepted"} className={`${btn} bg-blue-600 text-white`} onClick={() => run("change_step", { action: "change_step", changeId: open.id, step: "contact", note }, "世田谷へ連絡済みとして記録しました")}>
                世田谷へ連絡した
              </button>
              <button disabled={!!busy} className={`${btn} border border-border bg-white`} onClick={() => run("change_step", { action: "change_step", changeId: open.id, step: "withdraw", note }, "変更希望を取り下げました")}>
                取り下げ
              </button>
            </div>
          )}
          {open.state === "contacted" && (
            <div className="space-y-1">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="佐川の回答の内容（必須）" className={`${input} w-72`} />
              <div className="flex flex-wrap items-center gap-3 text-[11px]">
                <label className="inline-flex items-center gap-1"><input type="radio" checked={policy === "kept"} onChange={() => setPolicy("kept")} />問い合わせ番号は維持</label>
                <label className="inline-flex items-center gap-1"><input type="radio" checked={policy === "changed"} onChange={() => setPolicy("changed")} />振り直し</label>
                {policy === "changed" && <input value={newNumber} onChange={(e) => setNewNumber(e.target.value)} placeholder="新しい問い合わせ番号" className={`${input} w-40 font-mono`} />}
              </div>
              <div className="flex flex-wrap gap-2">
                <button disabled={!!busy} className={`${btn} bg-blue-600 text-white`} onClick={() => run("change_step", { action: "change_step", changeId: open.id, step: "approve", note, numberPolicy: policy, newNumber: policy === "changed" ? newNumber : undefined }, "佐川の承認を記録しました。内容を確認して BondEx へ反映してください")}>
                  佐川が承認した
                </button>
                <button disabled={!!busy} className={`${btn} border border-border bg-white`} onClick={() => run("change_step", { action: "change_step", changeId: open.id, step: "reject", note }, "佐川の回答（変更不可）を記録しました。区間の情報は変わりません")}>
                  佐川が変更不可と回答
                </button>
              </div>
            </div>
          )}
          {open.state === "approved" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px]">佐川の回答：{open.answer_note}・番号 {open.number_policy === "changed" ? `振り直し → ${open.new_shipping_number}` : "維持"}</span>
              <button disabled={!!busy} className={`${btn} bg-emerald-600 text-white`} onClick={() => run("change_apply", { action: "change_apply", changeId: open.id }, "BondEx へ反映しました（変更履歴を保存）")}>
                BondEx へ反映する
              </button>
            </div>
          )}
        </div>
      ) : liveState === "accepted" ? (
        <div>
          <button onClick={() => setShow((v) => !v)} className="text-[11px] text-blue-600 hover:underline">
            変更申請を登録する（ホテル・日程・個数・代表者名・取消） {show ? "▲" : "▼"}
          </button>
          {show && (
            <div className="mt-1 space-y-1">
              <select value={side} onChange={(e) => setSide(e.target.value as typeof side)} className={input}>
                <option value="guest">到着先ホテルを変える</option>
                <option value="pickup">発送元（集荷先）ホテルを変える</option>
                <option value="dates">日程（集荷日・お届け日）を変える</option>
                <option value="count">個数を変える</option>
                <option value="representative">代表者名を変える</option>
                <option value="cancel">取り消す（佐川の取消確認の後に区間を取消）</option>
                <option value="rearrange">個別に再手配する（今の依頼を取消・手動で依頼し直し）</option>
                <option value="none">ホテルは変えない（問い合わせ番号の振り直しだけ）</option>
              </select>
              {side === "dates" && (
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  集荷日 <input type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} className={input} />
                  お届け日 <input type="date" value={arrDate} onChange={(e) => setArrDate(e.target.value)} className={input} />
                </div>
              )}
              {(side === "count" || side === "rearrange") && (
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  新しい個数 <input type="number" min={1} max={99} value={pieces} onChange={(e) => setPieces(e.target.value)} className={`${input} w-20`} />
                  {Number(pieces) >= 20 && <span className="text-amber-700">20個以上：世田谷へ事前に確認してください（Biz-Logi では再送しません）</span>}
                </div>
              )}
              {side === "representative" && (
                <input value={repName} onChange={(e) => setRepName(e.target.value)} placeholder="新しい代表者名" className={`${input} w-56`} />
              )}
              {(side === "guest" || side === "pickup") && (
                <div className="space-y-1">
                  {/* place_id・市区・都道府県は候補の選択からだけ入る (手入力不可)。名前は選択後に直せる */}
                  <HotelPlacePicker
                    label={`新しい${side === "guest" ? "到着先" : "発送元（集荷先）"}ホテルを検索（Google Places）`}
                    onPicked={(h) => {
                      setHotel(h.name)
                      setHotelJa(h.nameJa)
                      setPlaceId(h.placeId)
                      setPref(h.prefecture)
                      setCity(h.city)
                    }}
                    onError={(m) => m && onError(m)}
                  />
                  {placeId ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input value={hotel} onChange={(e) => setHotel(e.target.value)} placeholder="英名（必須）" className={`${input} w-56`} />
                      <input value={hotelJa} onChange={(e) => setHotelJa(e.target.value)} placeholder="和名" className={`${input} w-48`} />
                      <span className="text-[10px] text-emerald-700">候補から選択済み（{pref || "-"} / {city || "-"}）</span>
                    </div>
                  ) : (
                    <p className="text-[10px] text-red-600">※ ホテル名で検索し、候補から選んでください</p>
                  )}
                </div>
              )}
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="変更の理由（必須）" className={`${input} w-72`} />
              <button
                disabled={
                  !!busy ||
                  ((side === "guest" || side === "pickup") && (!placeId || !hotel.trim())) ||
                  (side === "dates" && !shipDate && !arrDate) ||
                  ((side === "count" || side === "rearrange") && !pieces) ||
                  (side === "representative" && !repName.trim())
                }
                className={`${btn} bg-blue-600 text-white`}
                onClick={() =>
                  run(
                    "change_create",
                    side === "guest" || side === "pickup" || side === "none"
                      ? {
                          action: "change_create",
                          shipmentId,
                          side: side === "none" ? null : side,
                          newHotel: hotel,
                          newHotelJa: hotelJa,
                          newPlaceId: placeId,
                          newPrefecture: pref,
                          newCity: city,
                          reason,
                        }
                      : {
                          action: "change_create",
                          shipmentId,
                          kind: side,
                          fields:
                            side === "dates"
                              ? { ...(shipDate ? { shipment_date: shipDate } : {}), ...(arrDate ? { expected_arrival: arrDate } : {}) }
                              : side === "count" || side === "rearrange"
                                ? { suitcase_count: Number(pieces) }
                                : side === "representative"
                                  ? { representative: repName.trim() }
                                  : {},
                          reason,
                        },
                    "変更希望を登録しました。世田谷へ連絡したら記録してください（区間の情報はまだ変わりません）",
                  )
                }
              >
                変更申請を登録
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">別の変更・取消を世田谷へ連絡中です。</p>
      )}
      {changes.filter((c) => c !== open).length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-muted-foreground">
          {changes
            .filter((c) => c !== open)
            .map((c) => (
              <li key={c.id}>
                {new Date(c.created_at).toLocaleDateString("ja-JP")} {CHANGE_STATE_LABEL[c.state]}・
                {c.side ? `${c.old_hotel ?? ""} → ${c.new_hotel_ja || c.new_hotel}` : changeSummary(c)}
                {c.number_policy === "changed" ? `・番号 ${c.old_shipping_number ?? "-"} → ${c.new_shipping_number}` : c.number_policy === "kept" ? "・番号維持" : ""}
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

/** 予約の登録内容 (正本) と、佐川へ送る電文を項目ごとに並べる (2026-11-04 監査: 運営が目で確かめられるように)。 */
function SendComparison({ preview }: { preview: Preview }) {
  const reg = preview.registered
  const d = preview.detail
  const src = preview.sources
  const slotLabel: Record<string, string> = { "00": "指定なし", "01": "午前中", "12": "12-14時", "14": "14-16時", "16": "16-18時", "18": "18-20時", "04": "18-21時", "19": "19-21時" }
  const rows: Array<[string, string, string]> = [
    ["集荷ホテル", [reg?.fromHotel, reg?.fromHotelJa].filter(Boolean).join(" / "), `${src?.origin.placeName ?? "（個人宅）"}${src?.origin.placeAddress ? `\nGoogle の住所: ${src.origin.placeAddress}` : ""}`],
    ["集荷先の宛名・住所", "—", `${(d?.irai?.nm ?? []).join(" / ")}\n〒${d?.irai?.yubin ?? ""} ${(d?.irai?.add ?? []).join(" ")}\n電話 ${d?.irai?.tel ?? ""}（BondEx の荷物連絡先）`],
    ["お届けホテル", [reg?.toHotel, reg?.toHotelJa].filter(Boolean).join(" / "), `${src?.destination.placeName ?? "（個人宅）"}${src?.destination.placeAddress ? `\nGoogle の住所: ${src.destination.placeAddress}` : ""}`],
    ["お届け先の宛名・住所", "—", `${(d?.otodokeNm ?? []).join(" / ")}\n〒${d?.otodokeYubin ?? ""} ${(d?.otodokeAdd ?? []).join(" ")}\n電話 ${d?.otodokeTel ?? ""}`],
    ["旅行者名", reg?.guestName ?? "—", (d?.otodokeNm ?? [])[1] ?? "—"],
    ["集荷日", ymdLabel(reg?.pickupDate), `${ymdLabel(d?.shippingDate)}（集荷指定日 ${ymdLabel(d?.shukaIrai?.shukaIraiShiteiDate)}）`],
    ["配達日", ymdLabel(reg?.deliveryDate), ymdLabel(d?.shiteiDate)],
    ["配達時間帯", reg?.deliveryTime ?? "指定なし", d?.shiteiTimeCode ? (slotLabel[d.shiteiTimeCode] ?? d.shiteiTimeCode) : "指定なし"],
    ["個数", String(reg?.suitcaseCount ?? "—"), String(d?.haisoKosu ?? "—")],
    ["区間・管理番号", reg?.legRef ?? "—", d?.userManageNumber ?? "—"],
    ["記事", reg?.tourNumber ? `ツアー ${reg.tourNumber}` : "—", (d?.kiji ?? []).join(" / ")],
    ["宿泊 (参考)", `集荷元チェックイン ${ymdLabel(reg?.originCheckIn)}・お届け先チェックイン ${ymdLabel(reg?.destCheckIn)}・チェックアウト ${ymdLabel(reg?.destCheckOut)}`, "（送らない）"],
  ]
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr className="bg-slate-50 text-left">
          <th className="border border-slate-200 px-1.5 py-1">項目</th>
          <th className="border border-slate-200 px-1.5 py-1">予約の登録内容</th>
          <th className="border border-slate-200 px-1.5 py-1">佐川へ送る内容</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, a, b]) => (
          <tr key={k} className="align-top">
            <td className="whitespace-nowrap border border-slate-200 px-1.5 py-1 font-medium">{k}</td>
            <td className="whitespace-pre-line border border-slate-200 px-1.5 py-1">{a}</td>
            <td className="whitespace-pre-line border border-slate-200 px-1.5 py-1">{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
