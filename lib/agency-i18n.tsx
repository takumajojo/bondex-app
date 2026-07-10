"use client"

import { useCallback, useEffect, useState } from "react"
import { Languages } from "lucide-react"

/**
 * 代理店ポータル (/agency, /agency/login, /agency/signup) 専用の言語切替。
 *
 *  - localStorage キー `bondex_agency_locale` に保存 (運営画面の `bondex_op_locale`
 *    とは分離。代理店ユーザーと BondEx 運営者は別ブラウザ・別ロケールのため)。
 *  - カスタムイベントで「同一ドキュメント内」の全 useAgencyLocale インスタンスを即同期。
 *    これにより、ページ側でトグルを切り替えると子コンポーネント (カード登録ウィジェット等)
 *    も同時に切り替わる。storage イベントは別タブ用。
 *  - 初回は保存値がなければブラウザ言語から推定 (日本語ブラウザ → ja / それ以外 → en)。
 *    SSR とのハイドレーション不整合を避けるため、推定は useEffect (クライアント) で行う。
 */

export type Locale = "en" | "ja"

const STORAGE_KEY = "bondex_agency_locale"
const CHANGE_EVENT = "bondex-agency-locale-change"

function readStored(): Locale | null {
  if (typeof window === "undefined") return null
  const v = window.localStorage.getItem(STORAGE_KEY)
  return v === "ja" || v === "en" ? v : null
}

function detectDefault(): Locale {
  if (typeof navigator === "undefined") return "en"
  return navigator.language?.toLowerCase().startsWith("ja") ? "ja" : "en"
}

export function useAgencyLocale() {
  // SSR と初回クライアントレンダーは "en" で一致させ、ハイドレーション後に確定させる
  const [locale, setLocaleState] = useState<Locale>("en")

  useEffect(() => {
    const resolve = () => setLocaleState(readStored() ?? detectDefault())
    resolve()
    window.addEventListener("storage", resolve) // 別タブでの変更
    window.addEventListener(CHANGE_EVENT, resolve) // 同一ドキュメント内での変更
    return () => {
      window.removeEventListener("storage", resolve)
      window.removeEventListener(CHANGE_EVENT, resolve)
    }
  }, [])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, l)
      window.dispatchEvent(new Event(CHANGE_EVENT))
    }
  }, [])

  return { locale, setLocale }
}

export function AgencyLocaleToggle({
  locale,
  onChange,
  className = "",
}: {
  locale: Locale
  onChange: (l: Locale) => void
  className?: string
}) {
  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-full border border-border p-0.5 bg-white ${className}`}
    >
      <Languages className="w-3.5 h-3.5 text-muted-foreground ml-1.5 mr-0.5" strokeWidth={1.5} />
      {(["en", "ja"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          aria-pressed={locale === l}
          className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
            locale === l
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {l === "en" ? "EN" : "JP"}
        </button>
      ))}
    </div>
  )
}
