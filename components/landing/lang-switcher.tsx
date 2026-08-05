"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Globe, ChevronDown, Check } from "lucide-react"
import type { Locale } from "@/lib/landing-messages"

// ─────────────────────────────────────────────────────────────
// 言語切替 (Language switcher) — コンパクトなドロップダウン。
//
// ヘッダーの横幅を圧迫しないよう、現在の言語だけをボタンに出し、
// クリックで全言語のメニューを開く。Phase 2 で ES/FR/ZH/IT を足すときは
// この LOCALES 配列に 1 行追加するだけ (何言語でもレイアウトが崩れない)。
// ─────────────────────────────────────────────────────────────
export type LangOption = { code: Locale; label: string; href: string }

export const LOCALES: LangOption[] = [
  { code: "ja", label: "日本語", href: "/" },
  { code: "en", label: "English", href: "/en" },
  { code: "es", label: "Español", href: "/es" },
  { code: "fr", label: "Français", href: "/fr" },
  { code: "zh", label: "中文", href: "/zh" },
  { code: "it", label: "Italiano", href: "/it" },
]

export function LangSwitcher({
  current,
  className = "",
  align = "right",
}: {
  current: Locale
  className?: string
  /** メニューの寄せ方向。ヘッダー右端では right、モバイル一覧では left。 */
  align?: "left" | "right"
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const currentLabel = LOCALES.find((l) => l.code === current)?.label ?? current

  // 外側クリック / Esc で閉じる
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Language / 言語"
        className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-md border border-[#E5E7EB] text-[13px] font-medium text-[#334155] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"
      >
        <Globe className="w-4 h-4 text-[#64748B]" strokeWidth={1.8} />
        <span className="leading-none">{currentLabel}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-[#94A3B8] transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute top-full mt-1.5 z-50 min-w-[150px] rounded-lg border border-[#E5E7EB] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.10)] py-1 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {LOCALES.map((l) => {
            const active = l.code === current
            return (
              <Link
                key={l.code}
                href={l.href}
                hrefLang={l.code}
                role="menuitem"
                aria-current={active ? "true" : undefined}
                onClick={() => setOpen(false)}
                className={`flex items-center justify-between gap-3 px-3 py-2 text-[13px] leading-none ${
                  active
                    ? "text-[#C8102E] font-semibold"
                    : "text-[#334155] hover:bg-[#F7F8FA] hover:text-[#0F172A]"
                }`}
              >
                {l.label}
                {active && <Check className="w-3.5 h-3.5" strokeWidth={2.5} />}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
