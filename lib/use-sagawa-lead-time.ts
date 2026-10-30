"use client"

import { useEffect, useMemo, useRef, useState } from "react"

/**
 * 予約入力画面 (代理店 /agency/new・運営 /operator) 用: 佐川の最短お届け日を /api/lead-time で照会する。
 *
 * キー = 発送元|お届け先|発送日 (ホテル=place_id / 個人宅=7桁の郵便番号)。行きと帰りは別キー
 * (方向で日数が違うルートがあるため)。同じキーは1回しか照会しない。
 * 照会失敗・不明は { days: null } = 「確認できませんでした」(従来どおり発送翌日以降を許可)。
 */

export type LeadTimeResult = {
  days: number | null
  earliestArrival?: string
  /** 沖縄県発着 = 飛脚航空便のルール (lib/sagawa-lead-time OKINAWA_AIR_DAYS) で出した日数 */
  air?: boolean
  loading?: boolean
}

/** 発送元/お届け先の照会用 ID。個人宅は郵便番号 (7桁) / ホテルは place_id。取れなければ ""。 */
export function leadEndpointId(placeId: string | null | undefined, residenceZip?: string | null): string {
  if (residenceZip !== undefined && residenceZip !== null) {
    const z = residenceZip.replace(/\D/g, "")
    return /^\d{7}$/.test(z) ? z : ""
  }
  return (placeId ?? "").trim()
}

/** 照会キー。どれか欠けていれば null (照会しない)。 */
export function leadKey(from: string, to: string, shipmentDate: string): string | null {
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(shipmentDate)) return null
  return `${from}|${to}|${shipmentDate}`
}

export function useSagawaLeadTimes(
  keys: Array<string | null>,
  getHeaders?: () => Promise<Record<string, string>>,
): Record<string, LeadTimeResult> {
  const [cache, setCache] = useState<Record<string, LeadTimeResult>>({})
  const requested = useRef<Set<string>>(new Set())
  const headersRef = useRef(getHeaders)
  headersRef.current = getHeaders
  const joined = useMemo(
    () => Array.from(new Set(keys.filter((k): k is string => !!k))).sort().join(","),
    [keys],
  )

  useEffect(() => {
    const todo = (joined ? joined.split(",") : []).filter((k) => !requested.current.has(k))
    if (todo.length === 0) return
    // 入力途中 (日付を打っている最中など) に毎回照会しないよう少し待つ
    const timer = setTimeout(() => {
      for (const k of todo) {
        requested.current.add(k)
        setCache((prev) => ({ ...prev, [k]: { days: null, loading: true } }))
        const [from, to, shipmentDate] = k.split("|")
        void (async () => {
          let result: LeadTimeResult = { days: null }
          try {
            const qs = new URLSearchParams({ from, to, shipmentDate })
            const headers = headersRef.current ? await headersRef.current() : {}
            const res = await fetch(`/api/lead-time?${qs}`, { headers })
            if (res.ok) {
              const d = (await res.json()) as { days: number | null; earliestArrival?: string; source?: string }
              result = { days: d.days ?? null, earliestArrival: d.earliestArrival, air: d.source === "okinawa_air" }
            }
          } catch {
            // 通信失敗は「不明」扱い (予約は止めない)
          }
          setCache((prev) => ({ ...prev, [k]: result }))
        })()
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [joined])

  return cache
}
