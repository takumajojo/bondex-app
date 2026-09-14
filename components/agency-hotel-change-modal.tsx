"use client"

// 代理店セルフのホテル変更モーダル (2026-09-14 谷口さん)。
// 運営の HotelChangeModal を代理店向けに移植したもの。相違点:
//  - 二言語 (ja/en)。代理店ポータルの locale に追従。
//  - 認証は Supabase JWT (Bearer)。Places 検索/詳細は /api/agency/places/*。
//  - 締切超過は override 不可 → ロック表示で BondEx へ誘導 (運営のみ理由入力で可)。
//  - 保存は POST /api/agency/shipment/[id]/hotel-change (未発行のみ・RPCで単一トランザクション)。

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Search, X, AlertTriangle, ArrowRight } from "lucide-react"
import { getBrowserSupabase } from "@/lib/supabase-browser"
import { formatChangeDeadlineJst, isChangeDeadlinePassed, isChangeDeadlineNear } from "@/lib/change-deadline"

type Side = "guest" | "pickup"

export interface AgencyHotelChangeTarget {
  shipmentId: string
  side: Side
  legLabel: string
  currentHotel: string
  currentHotelJa: string | null
  shipmentDate: string
  expectedArrival: string | null
  changeDeadlineAt: string | null
}

interface Candidate {
  placeId: string
  name: string
  address?: string
  city: string
  prefecture: string
}

const STR = {
  ja: {
    titleGuest: "お届け先ホテルの変更",
    titlePickup: "発送元ホテルの変更",
    deadline: "変更締切",
    over: "（締切超過）",
    near: "（残り48時間以内）",
    lockedTitle: "変更締切を過ぎています",
    lockedBody:
      "この区間は変更締切を過ぎているため、こちらから変更できません。お手数ですが「お問い合わせ」から BondEx までご連絡ください。こちらで対応いたします。",
    close: "閉じる",
    searchLabelGuest: "新しいお届け先ホテルを検索（Google Places）",
    searchLabelPickup: "新しい発送元ホテルを検索（Google Places）",
    searchPlaceholder: "ホテル名を入力（2文字以上）",
    nameEn: "英名（必須）",
    nameJa: "和名（必須）",
    gotPlace: (city: string, pref: string) => `place_id 取得済み（${city || "-"} / ${pref || "-"}）`,
    needPlace: "※ Google Places から選択して place_id を取得してください（手入力のみでは保存不可）",
    datesTitle: "日程は据え置きです（変更されません）",
    ship: "発送日",
    arrive: "到着予定",
    dateConfirm: "日程が据え置きであることを確認しました",
    cancel: "キャンセル",
    save: "変更を保存",
    saving: "保存中…",
    failed: "変更に失敗しました。もう一度お試しください。",
    searchFailed: "検索できませんでした。少し時間をおいてお試しください。",
  },
  en: {
    titleGuest: "Change delivery hotel",
    titlePickup: "Change pickup hotel",
    deadline: "Change deadline",
    over: " (past deadline)",
    near: " (within 48h)",
    lockedTitle: "The change deadline has passed",
    lockedBody:
      "This leg is past its change deadline and can't be changed here. Please contact BondEx from “Contact” and we'll take care of it.",
    close: "Close",
    searchLabelGuest: "Search the new delivery hotel (Google Places)",
    searchLabelPickup: "Search the new pickup hotel (Google Places)",
    searchPlaceholder: "Type a hotel name (2+ chars)",
    nameEn: "English name (required)",
    nameJa: "Japanese name (required)",
    gotPlace: (city: string, pref: string) => `place_id obtained (${city || "-"} / ${pref || "-"})`,
    needPlace: "Pick from Google Places to get a place_id (manual entry alone can't be saved).",
    datesTitle: "Dates stay the same (unchanged)",
    ship: "Ship date",
    arrive: "Arrival",
    dateConfirm: "I confirm the dates stay unchanged",
    cancel: "Cancel",
    save: "Save change",
    saving: "Saving…",
    failed: "Couldn't apply the change. Please try again.",
    searchFailed: "Search failed. Please try again shortly.",
  },
}

async function authedPost(path: string, payload: unknown): Promise<{ status: number; ok: boolean; data: any }> {
  const sb = getBrowserSupabase()
  const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
  if (!token) return { status: 401, ok: false, data: {} }
  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok, data }
}

export default function AgencyHotelChangeModal({
  target,
  locale,
  onClose,
  onApply,
  onDone,
}: {
  target: AgencyHotelChangeTarget
  locale: "ja" | "en"
  onClose: () => void
  onApply: (body: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>
  onDone: (msg: string) => void
}) {
  const t = STR[locale]
  const title = target.side === "guest" ? t.titleGuest : t.titlePickup
  const searchLabel = target.side === "guest" ? t.searchLabelGuest : t.searchLabelPickup
  const overDeadline = isChangeDeadlinePassed(target.changeDeadlineAt)
  const near = isChangeDeadlineNear(target.changeDeadlineAt)

  const [q, setQ] = useState("")
  const [cands, setCands] = useState<Candidate[]>([])
  const [searching, setSearching] = useState(false)
  const [resolving, setResolving] = useState(false)

  const [newHotel, setNewHotel] = useState("") // 英名
  const [newHotelJa, setNewHotelJa] = useState("") // 和名
  const [newPlaceId, setNewPlaceId] = useState("")
  const [newCity, setNewCity] = useState("")
  const [newPrefecture, setNewPrefecture] = useState("")

  const [dateConfirmed, setDateConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Google Places 候補検索 (debounce・代理店JWT)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const query = q.trim()
    if (query.length < 2) {
      setCands([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      setError("")
      try {
        const r = await authedPost("/api/agency/places/search", { query, lang: "ja" })
        setCands(r.ok ? ((r.data.candidates as Candidate[]) ?? []) : [])
        if (!r.ok) setError(t.searchFailed)
      } catch {
        setCands([])
        setError(t.searchFailed)
      }
      setSearching(false)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q, t.searchFailed])

  const pick = useCallback(
    async (c: Candidate) => {
      setResolving(true)
      setError("")
      // 候補から市区・都道府県・place_id・和名を暫定セット
      setNewPlaceId(c.placeId)
      setNewHotelJa(c.name)
      setNewCity(c.city || "")
      setNewPrefecture(c.prefecture || "")
      setNewHotel(c.name)
      setCands([])
      setQ("")
      // 和名/英名を place_id から確定
      try {
        const r = await authedPost("/api/agency/places/details", { placeId: c.placeId })
        if (r.ok) {
          if (r.data.nameJa) setNewHotelJa(r.data.nameJa as string)
          setNewHotel((r.data.nameEn as string) || (r.data.nameJa as string) || c.name)
        }
      } catch {
        /* 候補の名前でフォールバック */
      }
      setResolving(false)
    },
    [],
  )

  const canSubmit =
    !!newHotel.trim() && !!newHotelJa.trim() && !!newPlaceId.trim() && dateConfirmed && !submitting

  const submit = async () => {
    setSubmitting(true)
    setError("")
    const r = await onApply({
      side: target.side,
      newHotel: newHotel.trim(),
      newHotelJa: newHotelJa.trim(),
      newPlaceId: newPlaceId.trim(),
      newCity: newCity.trim() || null,
      newPrefecture: newPrefecture.trim() || null,
    })
    if (r.ok) {
      onDone(title)
    } else {
      setError(r.error || t.failed)
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/40 p-3 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg my-4 rounded-2xl bg-white shadow-xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-white px-4 py-3 rounded-t-2xl">
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-[11px] text-muted-foreground font-mono">{target.legLabel}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" strokeWidth={1.6} />
          </button>
        </div>

        {overDeadline ? (
          // 締切超過 → ロック表示 (代理店は override 不可)
          <div className="px-4 py-4 space-y-4">
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
              {t.deadline}: <span className="font-semibold">{formatChangeDeadlineJst(target.changeDeadlineAt)}</span>
              <span className="font-bold">{t.over}</span>
            </div>
            <p className="text-sm text-foreground leading-relaxed">{t.lockedBody}</p>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="h-10 px-4 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90"
              >
                {t.close}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 space-y-3">
              {/* 変更締切 */}
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  near ? "border-amber-300 bg-amber-50 text-amber-800" : "border-border bg-slate-50 text-foreground"
                }`}
              >
                {t.deadline}: <span className="font-semibold">{formatChangeDeadlineJst(target.changeDeadlineAt)}</span>
                {near && <span className="ml-1 font-bold">{t.near}</span>}
              </div>

              {/* Places ピッカー */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground">{searchLabel}</label>
                <div className="mt-1 relative">
                  <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" strokeWidth={1.6} />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t.searchPlaceholder}
                    className="w-full rounded-lg border border-border pl-8 pr-3 py-2 text-sm"
                  />
                  {(searching || resolving) && (
                    <Loader2 className="w-4 h-4 absolute right-2.5 top-2.5 animate-spin text-muted-foreground" strokeWidth={1.6} />
                  )}
                </div>
                {cands.length > 0 && (
                  <div className="mt-1 rounded-lg border border-border bg-white shadow-sm max-h-52 overflow-y-auto">
                    {cands.map((c) => (
                      <button
                        key={c.placeId}
                        onClick={() => void pick(c)}
                        className="block w-full text-left px-3 py-2 text-xs hover:bg-slate-50 border-b border-slate-100 last:border-0"
                      >
                        <div className="font-medium text-foreground">{c.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {[c.prefecture, c.city].filter(Boolean).join(" ") || c.address || ""}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 取得結果 (英名・和名 必須・編集可) */}
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <label className="text-[11px] text-muted-foreground">{t.nameEn}</label>
                  <input
                    value={newHotel}
                    onChange={(e) => setNewHotel(e.target.value)}
                    placeholder="Daiwa Roynet Hotel …"
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{t.nameJa}</label>
                  <input
                    value={newHotelJa}
                    onChange={(e) => setNewHotelJa(e.target.value)}
                    placeholder="ダイワロイネットホテル…"
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </div>
                <p className={`text-[10px] ${newPlaceId ? "text-emerald-700" : "text-red-600"}`}>
                  {newPlaceId ? t.gotPlace(newCity, newPrefecture) : t.needPlace}
                </p>
              </div>

              {/* 変更前後 */}
              {newHotelJa && (
                <div className="rounded-lg border border-border bg-slate-50 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-muted-foreground line-through">
                      {target.currentHotelJa || target.currentHotel}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-foreground" strokeWidth={1.8} />
                    <span className="font-semibold text-foreground">{newHotelJa}</span>
                  </div>
                </div>
              )}

              {/* 日程据え置き確認 */}
              <div className="rounded-lg border border-border px-3 py-2">
                <p className="text-[11px] font-semibold text-foreground mb-1">{t.datesTitle}</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>
                    {t.ship}: <span className="text-foreground">{target.shipmentDate}</span>
                  </span>
                  <span>
                    {t.arrive}: <span className="text-foreground">{target.expectedArrival || "—"}</span>
                  </span>
                </div>
                <label className="mt-2 flex items-center gap-2 text-[11px] text-foreground cursor-pointer">
                  <input type="checkbox" checked={dateConfirmed} onChange={(e) => setDateConfirmed(e.target.checked)} />
                  {t.dateConfirm}
                </label>
              </div>

              {error && <p className="text-[11px] text-red-700">{error}</p>}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-white px-4 py-3 rounded-b-2xl">
              <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-xs">
                {t.cancel}
              </button>
              <button
                onClick={() => void submit()}
                disabled={!canSubmit}
                className="inline-flex items-center gap-1 rounded-lg bg-[#C8102E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#a60d26] disabled:opacity-40"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.8} /> : null}
                {submitting ? t.saving : t.save}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
