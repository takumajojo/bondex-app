"use client"

import { useEffect, useState } from "react"

const STORAGE_KEY = "bondex_analytics_consent" // "granted" | "denied"

declare global {
  interface Window {
    // gtag は layout.tsx の beforeInteractive スクリプトで定義済み
    gtag?: (...args: unknown[]) => void
  }
}

/**
 * 解析 Cookie の同意バナー (GA Consent Mode 連動)。
 * 既定は「拒否」(layout.tsx で consent default = denied)。
 *  - 過去に承認済み → マウント時に analytics_storage を granted に更新し、バナー非表示
 *  - 未選択 → バナー表示。承認で granted、拒否で denied を保存
 * プライバシー重視の既定 (opt-in) にしているため、承認されるまで GA は
 * cookieless の consent-denied ping のみ送る。
 */
export function ConsentBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let stored: string | null = null
    try {
      stored = localStorage.getItem(STORAGE_KEY)
    } catch {
      // localStorage 不可 (プライベートブラウズ等) → バナーは出さず既定 denied のまま
      return
    }
    if (stored === "granted") {
      window.gtag?.("consent", "update", { analytics_storage: "granted" })
    } else if (stored !== "denied") {
      setVisible(true)
    }
  }, [])

  const choose = (granted: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, granted ? "granted" : "denied")
    } catch {
      /* 保存不可でも UI は閉じる */
    }
    if (granted) {
      window.gtag?.("consent", "update", { analytics_storage: "granted" })
    }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-label="Cookie の利用について"
      className="fixed inset-x-0 bottom-0 z-[60] px-4 pb-4 sm:px-6 sm:pb-6"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.16)] sm:flex sm:items-center sm:gap-6">
        <p className="text-[13px] leading-relaxed text-[#334155]">
          本サイトはサービス改善のため、Google アナリティクスによる利用状況の計測を行っています。
          同意いただける場合のみ計測用 Cookie を使用します。
          詳しくは{" "}
          <a
            href="/legal/privacy"
            className="font-medium text-[#C8102E] underline underline-offset-2"
          >
            プライバシーポリシー
          </a>
          をご覧ください。
        </p>
        <div className="mt-4 flex shrink-0 gap-2 sm:mt-0">
          <button
            type="button"
            onClick={() => choose(false)}
            className="h-10 flex-1 rounded-xl border border-[#CBD5E1] px-4 text-[13px] font-medium text-[#475569] hover:bg-[#F8FAFC] sm:flex-none"
          >
            拒否する
          </button>
          <button
            type="button"
            onClick={() => choose(true)}
            className="h-10 flex-1 rounded-xl bg-[#0F172A] px-5 text-[13px] font-bold text-white hover:bg-[#1E293B] sm:flex-none"
          >
            同意する
          </button>
        </div>
      </div>
    </div>
  )
}
