"use client"

// 運営画面のホテル検索 (Google Places)。HotelChangeModal と受付後の変更 (PickupRequestPanel) で共用。
// - /api/places?q= (lodging) で候補 → 選ぶと /api/places?place_id= で和名・市区・都道府県、&lang=en で英名を取る
// - place_id は候補の選択からだけ得る (手入力はさせない)

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Search } from "lucide-react"

export interface PickedHotel {
  placeId: string
  name: string // 英名
  nameJa: string // 和名
  city: string
  prefecture: string
}

interface Prediction {
  place_id: string
  name: string
  secondary: string
}

export default function HotelPlacePicker({
  label,
  onPicked,
  onError,
}: {
  label: string
  onPicked: (h: PickedHotel) => void
  onError: (msg: string) => void
}) {
  const [q, setQ] = useState("")
  const [preds, setPreds] = useState<Prediction[]>([])
  const [searching, setSearching] = useState(false)
  const [resolving, setResolving] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Google Places オートコンプリート (debounce)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const query = q.trim()
    if (query.length < 2) {
      setPreds([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/places?q=${encodeURIComponent(query)}&types=lodging`)
        const data = await res.json()
        setPreds((data.predictions as Prediction[]) ?? [])
      } catch {
        setPreds([])
      }
      setSearching(false)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q])

  const pick = useCallback(
    async (p: Prediction) => {
      setResolving(true)
      onError("")
      try {
        // 和名 + 市区 + 都道府県 + place_id (ja)
        const jaRes = await fetch(`/api/places?place_id=${encodeURIComponent(p.place_id)}`)
        const ja = await jaRes.json()
        if (!jaRes.ok) throw new Error(ja.error || "詳細取得に失敗")
        // 英名 (en)
        let en = ja.name || p.name
        try {
          const enRes = await fetch(`/api/places?place_id=${encodeURIComponent(p.place_id)}&lang=en`)
          const enData = await enRes.json()
          en = enData.name || en
        } catch {
          // 英名が取れなければ和名で代用 (保存前に編集できる)
        }
        onPicked({
          placeId: ja.id || p.place_id,
          name: en,
          nameJa: ja.name || p.name,
          city: ja.city || "",
          prefecture: ja.province || "",
        })
        setPreds([])
        setQ("")
      } catch (e) {
        onError(e instanceof Error ? e.message : "詳細取得に失敗")
      }
      setResolving(false)
    },
    [onPicked, onError],
  )

  return (
    <div>
      <label className="text-[11px] font-semibold text-muted-foreground">{label}</label>
      <div className="mt-1 relative">
        <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" strokeWidth={1.6} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ホテル名を入力（2文字以上）"
          className="w-full rounded-lg border border-border pl-8 pr-3 py-2 text-sm"
        />
        {(searching || resolving) && <Loader2 className="w-4 h-4 absolute right-2.5 top-2.5 animate-spin text-muted-foreground" strokeWidth={1.6} />}
      </div>
      {preds.length > 0 && (
        <div className="mt-1 rounded-lg border border-border bg-white shadow-sm max-h-52 overflow-y-auto">
          {preds.map((p) => (
            <button
              key={p.place_id}
              type="button"
              onClick={() => void pick(p)}
              className="block w-full text-left px-3 py-2 text-xs hover:bg-slate-50 border-b border-slate-100 last:border-0"
            >
              <div className="font-medium text-foreground">{p.name}</div>
              {p.secondary && <div className="text-[10px] text-muted-foreground">{p.secondary}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
