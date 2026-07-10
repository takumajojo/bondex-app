"use client"

import { useEffect, useState } from "react"
import { CreditCard } from "lucide-react"

/**
 * 発行画面 (operator) 用のカード未登録リマインダー。
 *
 * 発行対象の代理店 (tourCompany 名で一致) が「カード払い かつ カード未登録」のときだけ
 * 非ブロッキングの注意を表示する。請求書払い・カード登録済みの代理店には何も出さない
 * (= 臨機応変な出し分け)。BondEx はカードを代理入力できないため、案内文にとどめる。
 *
 * 自己完結 (該当しなければ null)。発行フロー本体には手を入れない。
 */
export function OperatorCardReminder({ tourCompany }: { tourCompany: string }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    let cancelled = false
    const name = tourCompany.trim()
    if (!name) return
    void (async () => {
      try {
        const res = await fetch("/api/agencies")
        if (!res.ok) return
        const data = await res.json()
        const list: Array<{ name: string; payment_method?: string; card_on_file?: boolean }> =
          data.agencies || []
        const match = list.find((a) => a.name === name)
        if (!cancelled && match && match.payment_method === "card" && !match.card_on_file) {
          setShow(true)
        }
      } catch {
        /* 取得失敗時は何も出さない */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tourCompany])

  if (!show) return null

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
      <CreditCard className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" strokeWidth={1.8} />
      <div>
        <p className="text-sm font-semibold text-amber-900">
          この代理店はカード払いですが、カードが未登録です
        </p>
        <p className="text-[13px] text-amber-800 mt-1 leading-relaxed">
          このまま発行はできますが、決済（集荷完了時に確定）のため、代理店ポータルでの
          カード登録をご案内ください。登録が済むとこの表示は出なくなります。
        </p>
      </div>
    </div>
  )
}
