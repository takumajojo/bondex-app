"use client"

import Link from "next/link"
import type { Locale } from "@/lib/landing-messages"

// ─────────────────────────────────────────────────────────────
// 言語切替 (Language switcher)
//
// Phase 1: 日本語 (/) と English (/en) のみ。
// Phase 2 で ES/FR/ZH/IT を足すときは、この LOCALES 配列に
// { code, label, href } を 1 行追加するだけで拡張できる。
// ─────────────────────────────────────────────────────────────
export type LangOption = { code: Locale; label: string; href: string }

export const LOCALES: LangOption[] = [
  { code: "ja", label: "日本語", href: "/" },
  { code: "en", label: "English", href: "/en" },
]

export function LangSwitcher({
  current,
  className = "",
}: {
  current: Locale
  className?: string
}) {
  return (
    <div
      className={`inline-flex items-center rounded-md border border-[#E5E7EB] overflow-hidden ${className}`}
      role="group"
      aria-label="Language / 言語"
    >
      {LOCALES.map((l, i) => {
        const active = l.code === current
        return (
          <Link
            key={l.code}
            href={l.href}
            hrefLang={l.code}
            aria-current={active ? "true" : undefined}
            className={`px-2.5 py-1 text-[12px] font-medium leading-none transition-colors ${
              i > 0 ? "border-l border-[#E5E7EB]" : ""
            } ${
              active
                ? "bg-[#C8102E] text-white"
                : "text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9]"
            }`}
          >
            {l.label}
          </Link>
        )
      })}
    </div>
  )
}
