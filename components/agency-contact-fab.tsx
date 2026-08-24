"use client"

import { useState } from "react"
import { MessageCircle, X, Mail } from "lucide-react"
import { useAgencyLocale } from "@/lib/agency-i18n"
import { LINE_URL, WHATSAPP_URL, SUPPORT_EMAIL } from "@/lib/contact-links"

// 代理店ポータル用の即問い合わせボタン(右下フローティング)。
// LINE / WhatsApp のチャットに直接飛べる。WhatsApp は env 未設定なら非表示。
const T = {
  ja: {
    open: "お問い合わせ",
    heading: "お問い合わせ",
    lead: "チャットでお気軽にどうぞ。",
    line: "LINE で問い合わせ",
    whatsapp: "WhatsApp で問い合わせ",
    email: "メールで問い合わせ",
    close: "閉じる",
  },
  en: {
    open: "Contact us",
    heading: "Contact us",
    lead: "Reach us on chat anytime.",
    line: "Chat on LINE",
    whatsapp: "Chat on WhatsApp",
    email: "Contact by email",
    close: "Close",
  },
} as const

export function AgencyContactFab() {
  const { locale } = useAgencyLocale()
  const t = T[locale]
  const [open, setOpen] = useState(false)

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {open && (
        <div className="w-72 rounded-2xl border border-border bg-card shadow-xl p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">{t.heading}</p>
              <p className="text-[12px] text-muted-foreground mt-0.5">{t.lead}</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label={t.close}
              className="p-1 -m-1 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>

          <a
            href={LINE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-xl bg-[#06C755] text-white px-3 py-2.5 text-sm font-medium hover:opacity-90"
          >
            <MessageCircle className="w-4 h-4" strokeWidth={2} />
            {t.line}
          </a>

          {WHATSAPP_URL && (
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-xl bg-[#25D366] text-white px-3 py-2.5 text-sm font-medium hover:opacity-90"
            >
              <MessageCircle className="w-4 h-4" strokeWidth={2} />
              {t.whatsapp}
            </a>
          )}

          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted/40"
          >
            <Mail className="w-4 h-4" strokeWidth={1.8} />
            {t.email}
          </a>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full bg-foreground text-background px-4 py-3 text-sm font-semibold shadow-lg hover:opacity-90"
      >
        <MessageCircle className="w-5 h-5" strokeWidth={2} />
        <span className="hidden sm:inline">{t.open}</span>
      </button>
    </div>
  )
}
