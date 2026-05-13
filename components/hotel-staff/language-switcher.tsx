"use client"

import { useI18n } from "./i18n"

export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n()

  return (
    <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs">
      <button
        onClick={() => setLocale("en")}
        className={`px-2.5 py-1.5 transition-colors ${
          locale === "en"
            ? "bg-foreground text-background font-medium"
            : "bg-card text-muted-foreground hover:bg-muted"
        }`}
      >
        EN
      </button>
      <button
        onClick={() => setLocale("ja")}
        className={`px-2.5 py-1.5 transition-colors ${
          locale === "ja"
            ? "bg-foreground text-background font-medium"
            : "bg-card text-muted-foreground hover:bg-muted"
        }`}
      >
        {"日本語"}
      </button>
    </div>
  )
}
