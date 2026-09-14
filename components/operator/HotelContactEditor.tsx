"use client"

// 予約詳細ページ内「ホテル連絡」の編集 (2026-09-13 谷口さん)。
// 発送元(pickup)/お届け先(guest) の各ルートについて、連絡方法・連絡先・メモ・
// 公式サイト由来の電話取得・今後のメール連絡設定・紹介メール送信・連絡済みトグルを扱う。
// 一覧(TODO)は最小限、編集はここに集約する方針。

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Phone, Mail, Globe, Check, Send } from "lucide-react"

type FutureEmailOk = "unknown" | "yes" | "no"

interface SavedRoute {
  method: "" | "phone" | "email"
  value: string
  memo: string
  officialWebsite: string
  officialPhone: string
  officialPhoneSource: string
  futureEmailOk: FutureEmailOk
  futureEmail: string
  introEmailSentAt: string | null
}

interface RouteCtx {
  route: "pickup" | "guest"
  label: string
  applies: boolean
  hotel: string
  hotelJa: string | null
  placeId: string | null
  deadline: string | null
  urgency: string
  businessDaysLeft: number | null
  notifiedAt: string | null
  saved: SavedRoute
  firstTime: boolean
  prior: SavedRoute | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const URGENCY_LABEL: Record<string, { text: string; cls: string }> = {
  overdue: { text: "期限超過", cls: "text-red-700" },
  urgent: { text: "早急", cls: "text-red-700" },
  due: { text: "本日締切", cls: "text-amber-700" },
  ok: { text: "", cls: "text-muted-foreground" },
  done: { text: "", cls: "text-muted-foreground" },
}

export default function HotelContactEditor({ shipmentId }: { shipmentId: string }) {
  const [routes, setRoutes] = useState<RouteCtx[] | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setError("")
    try {
      const res = await fetch(`/api/operator/hotel-contact?shipmentId=${encodeURIComponent(shipmentId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "読み込みに失敗しました")
      // 申し送り対象(applies)を先に、対象外は後ろに。両方編集はできる。
      setRoutes((data.routes as RouteCtx[]).slice().sort((a, b) => Number(b.applies) - Number(a.applies)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました")
    }
  }, [shipmentId])

  useEffect(() => {
    void load()
  }, [load])

  if (error) return <p className="text-[11px] text-red-700">{error}</p>
  if (!routes) return (
    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Loader2 className="w-3 h-3 animate-spin" strokeWidth={1.6} /> 読み込み中…
    </p>
  )
  if (routes.length === 0) return <p className="text-[11px] text-muted-foreground">このルートはホテル連絡の対象外です。</p>

  return (
    <div className="space-y-3">
      {routes.map((r) => (
        <RouteEditor key={r.route} shipmentId={shipmentId} ctx={r} onSaved={load} />
      ))}
    </div>
  )
}

function RouteEditor({
  shipmentId,
  ctx,
  onSaved,
}: {
  shipmentId: string
  ctx: RouteCtx
  onSaved: () => void
}) {
  // 保存済み優先、無ければ前回(引き継ぎ)を初期値に。
  const init = ctx.saved
  const carry = ctx.prior
  const [method, setMethod] = useState<"" | "phone" | "email">(init.method)
  const [value, setValue] = useState(init.value)
  const [memo, setMemo] = useState(init.memo)
  const [officialWebsite, setOfficialWebsite] = useState(init.officialWebsite || carry?.officialWebsite || "")
  const [officialPhone, setOfficialPhone] = useState(init.officialPhone || carry?.officialPhone || "")
  const [officialSource, setOfficialSource] = useState(init.officialPhoneSource || "")
  const [futureEmailOk, setFutureEmailOk] = useState<FutureEmailOk>(
    init.futureEmailOk !== "unknown" ? init.futureEmailOk : carry?.futureEmailOk ?? "unknown",
  )
  const [futureEmail, setFutureEmail] = useState(init.futureEmail || carry?.futureEmail || "")
  const [introSentAt, setIntroSentAt] = useState<string | null>(init.introEmailSentAt)
  const [notifiedAt, setNotifiedAt] = useState<string | null>(ctx.notifiedAt)

  const [saving, setSaving] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupNote, setLookupNote] = useState("")
  const [msg, setMsg] = useState("")

  const hotelName = ctx.hotelJa || ctx.hotel
  const urg = URGENCY_LABEL[ctx.urgency] ?? URGENCY_LABEL.ok

  const save = async () => {
    setSaving(true)
    setMsg("")
    try {
      const res = await fetch("/api/operator/hotel-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipmentId,
          route: ctx.route,
          patch: { method, value, memo, officialWebsite, officialPhone, officialPhoneSource: officialSource, futureEmailOk, futureEmail },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "保存に失敗しました")
      setMsg("保存しました")
      onSaved()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存に失敗しました")
    }
    setSaving(false)
  }

  const lookupPhone = async () => {
    setLookingUp(true)
    setLookupNote("")
    try {
      const res = await fetch(
        `/api/operator/hotel-lookup?shipmentId=${encodeURIComponent(shipmentId)}&route=${ctx.route}`,
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "取得に失敗しました")
      if (data.website) setOfficialWebsite(data.website)
      if (data.phone) {
        setOfficialPhone(data.phone)
        setOfficialSource(data.source || data.website || "")
        // 連絡方法が未設定/電話なら、取得番号を今回の連絡先にも反映
        if (method === "" || method === "phone") {
          setMethod("phone")
          if (!value) setValue(data.phone)
        }
      } else {
        setLookupNote(data.note || "公式サイトから電話番号を取得できませんでした。サイトを開いて手入力してください。")
      }
    } catch (e) {
      setLookupNote(e instanceof Error ? e.message : "取得に失敗しました")
    }
    setLookingUp(false)
  }

  const toggleNotified = async () => {
    const next = !notifiedAt
    setSaving(true)
    try {
      const res = await fetch("/api/shipments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          ctx.route === "pickup" ? { id: shipmentId, pickupHotelNotified: next } : { id: shipmentId, guestHotelNotified: next },
        ),
      })
      if (!res.ok) throw new Error("更新に失敗しました")
      setNotifiedAt(next ? new Date().toISOString() : null)
      onSaved()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "更新に失敗しました")
    }
    setSaving(false)
  }

  return (
    <div className="rounded-xl border border-border bg-white p-3">
      <div className="flex items-center flex-wrap gap-2">
        <span className="text-xs font-semibold text-foreground">{ctx.label}</span>
        <span className="text-xs text-foreground">・ {hotelName}</span>
        {ctx.firstTime && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">初めてのホテル</span>
        )}
        {!ctx.applies && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-muted-foreground">申し送り対象外</span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          締切 {ctx.deadline || "—"}
          {urg.text && <span className={`ml-1 font-semibold ${urg.cls}`}>{urg.text}</span>}
        </span>
      </div>

      {/* 公式情報 (公式サイトから電話取得) */}
      <div className="mt-2 flex items-center flex-wrap gap-2 rounded-lg bg-slate-50 border border-border px-2.5 py-2">
        <span className="text-[10px] text-muted-foreground">公式情報</span>
        {officialPhone ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground">
            <Phone className="w-3 h-3" strokeWidth={1.8} /> {officialPhone}
            <span className="text-[9px] font-normal text-muted-foreground">公式サイトより</span>
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">未取得</span>
        )}
        {officialWebsite && (
          <a
            href={officialWebsite}
            target="_blank"
            rel="noopener noreferrer"
            title={officialWebsite}
            className="inline-flex items-center gap-0.5 max-w-full text-[11px] text-blue-600 hover:underline break-all"
          >
            <Globe className="w-3 h-3 shrink-0" strokeWidth={1.6} />
            <span className="truncate">{officialWebsite.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
          </a>
        )}
        <button
          onClick={() => void lookupPhone()}
          disabled={lookingUp}
          className="ml-auto inline-flex items-center gap-1 rounded border border-border bg-white px-2 py-1 text-[10px] hover:bg-muted/40 disabled:opacity-50"
        >
          {lookingUp ? <Loader2 className="w-3 h-3 animate-spin" strokeWidth={1.6} /> : null}
          公式サイトから取得
        </button>
      </div>
      {lookupNote && <p className="mt-1 text-[10px] text-amber-700">{lookupNote}</p>}
      {officialPhone && (
        <button
          onClick={() => { setMethod("phone"); setValue(officialPhone) }}
          className="mt-1 text-[10px] text-blue-600 hover:underline"
        >
          ↑ この番号を今回の連絡先にする
        </button>
      )}

      {/* 今回の連絡方法 */}
      <div className="mt-2 flex items-center flex-wrap gap-2">
        <span className="text-[11px] text-muted-foreground">今回の連絡方法</span>
        <MethodPill active={method === "phone"} onClick={() => setMethod("phone")} icon={<Phone className="w-3 h-3" strokeWidth={1.8} />} label="電話" />
        <MethodPill active={method === "email"} onClick={() => setMethod("email")} icon={<Mail className="w-3 h-3" strokeWidth={1.8} />} label="メール" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={method === "email" ? "front@hotel.jp" : "03-1234-5678"}
          className="flex-1 min-w-[150px] rounded-lg border border-border px-2.5 py-1.5 text-xs"
        />
      </div>

      {/* メモ */}
      <input
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder="メモ（例：16時に折り返し／断られた: クローク満杯 …）"
        className="mt-2 w-full rounded-lg border border-border px-2.5 py-1.5 text-xs"
      />

      {/* 今後の連絡設定 (新規ホテルは電話後に確認) */}
      <div className={`mt-2 rounded-lg border p-2.5 ${ctx.firstTime ? "border-dashed border-amber-400 bg-amber-50/60" : "border-border bg-slate-50"}`}>
        <p className="text-[10px] font-bold text-amber-900">
          今後の連絡設定 {ctx.firstTime && "・ 新規ホテルは電話のときに確認"}
        </p>
        <div className="mt-1.5 flex items-center flex-wrap gap-2">
          <span className="text-[11px] text-foreground">今後の受け取り依頼をメールで受付可？</span>
          <MethodPill active={futureEmailOk === "yes"} onClick={() => setFutureEmailOk("yes")} label="OK" tone="green" />
          <MethodPill active={futureEmailOk === "no"} onClick={() => setFutureEmailOk("no")} label="不可" />
          <MethodPill active={futureEmailOk === "unknown"} onClick={() => setFutureEmailOk("unknown")} label="未確認" />
        </div>
        <div className="mt-1.5 flex items-center flex-wrap gap-2">
          <span className="text-[11px] text-foreground">担当者から聞いたメール</span>
          <input
            value={futureEmail}
            onChange={(e) => setFutureEmail(e.target.value)}
            placeholder="reservation@hotel.jp"
            className="flex-1 min-w-[170px] rounded-lg border border-border px-2.5 py-1.5 text-xs"
          />
        </div>
        <IntroEmailButton
          shipmentId={shipmentId}
          route={ctx.route}
          futureEmail={futureEmail}
          savedEmail={init.futureEmail}
          introSentAt={introSentAt}
          onSent={(at) => { setIntroSentAt(at); onSaved() }}
        />
      </div>

      {/* 連絡済み + 保存 */}
      <div className="mt-2.5 flex items-center flex-wrap gap-3">
        <button
          onClick={() => void toggleNotified()}
          disabled={saving}
          className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50 ${
            notifiedAt ? "bg-emerald-100 text-emerald-800" : "bg-white border border-border text-foreground hover:bg-muted/40"
          }`}
        >
          <Check className="w-3.5 h-3.5" strokeWidth={2} />
          {notifiedAt ? `連絡済み（${new Date(notifiedAt).toLocaleDateString("ja-JP")}）` : "連絡済みにする"}
        </button>
        <button
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-lg bg-[#C8102E] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#a60d26] disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.8} /> : null}
          保存
        </button>
        {msg && <span className="text-[11px] text-muted-foreground">{msg}</span>}
      </div>
    </div>
  )
}

function MethodPill({
  active,
  onClick,
  icon,
  label,
  tone = "ink",
}: {
  active: boolean
  onClick: () => void
  icon?: React.ReactNode
  label: string
  tone?: "ink" | "green"
}) {
  const activeCls = tone === "green" ? "bg-emerald-600 text-white" : "bg-slate-900 text-white"
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold ${
        active ? activeCls : "bg-white text-muted-foreground border border-border"
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function IntroEmailButton({
  shipmentId,
  route,
  futureEmail,
  savedEmail,
  introSentAt,
  onSent,
}: {
  shipmentId: string
  route: "pickup" | "guest"
  futureEmail: string
  savedEmail: string
  introSentAt: string | null
  onSent: (at: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [html, setHtml] = useState("")
  const [to, setTo] = useState("")
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState("")
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const canSend = EMAIL_RE.test(futureEmail)
  // 保存済みメールと画面のメールが一致していないと送信不可 (先に保存が必要)。
  const needsSave = futureEmail !== savedEmail

  const preview = async () => {
    setNote("")
    try {
      const res = await fetch(`/api/operator/hotel-intro-email?shipmentId=${encodeURIComponent(shipmentId)}&route=${route}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "プレビュー取得に失敗")
      setHtml(data.html || "")
      setTo(data.to || futureEmail)
      setOpen(true)
    } catch (e) {
      setNote(e instanceof Error ? e.message : "プレビュー取得に失敗")
    }
  }

  const send = async () => {
    setSending(true)
    setNote("")
    try {
      const res = await fetch("/api/operator/hotel-intro-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipmentId, route }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "送信に失敗")
      onSent(data.sentAt)
      setOpen(false)
      setNote(`送信しました（${data.to}）`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : "送信に失敗")
    }
    setSending(false)
  }

  return (
    <div className="mt-2">
      {introSentAt ? (
        <p className="text-[10px] text-emerald-700">紹介メール送信済み（{new Date(introSentAt).toLocaleString("ja-JP")}）</p>
      ) : (
        <button
          onClick={() => void preview()}
          disabled={!canSend}
          title={!canSend ? "先にメールアドレスを入力してください" : ""}
          className="inline-flex items-center gap-1 rounded-lg border border-[#C8102E]/40 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#C8102E] hover:bg-[#C8102E]/5 disabled:opacity-40"
        >
          <Send className="w-3.5 h-3.5" strokeWidth={1.8} />
          ホテルへ紹介メール
        </button>
      )}
      {note && <p className="mt-1 text-[10px] text-muted-foreground">{note}</p>}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-xl rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-foreground">ホテルへ紹介メールを送信</p>
            <p className="mt-1 text-[11px] text-muted-foreground">宛先：{to || "（未設定）"}</p>
            {needsSave && (
              <p className="mt-1 text-[11px] text-amber-700">
                ※ 画面のメールアドレスが未保存です。先に「保存」してから送ってください（送信は保存済みアドレス宛です）。
              </p>
            )}
            <iframe ref={iframeRef} srcDoc={html} title="preview" className="mt-2 h-80 w-full rounded-lg border border-border bg-slate-50" />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs">閉じる</button>
              <button
                onClick={() => void send()}
                disabled={sending || needsSave}
                className="inline-flex items-center gap-1 rounded-lg bg-[#C8102E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#a60d26] disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.8} /> : <Send className="w-3.5 h-3.5" strokeWidth={1.8} />}
                送信する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
