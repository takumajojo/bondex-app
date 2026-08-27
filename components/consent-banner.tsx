"use client"

import { useEffect, useState } from "react"

const STORAGE_KEY = "bondex_analytics_consent" // "granted" | "denied"

declare global {
  interface Window {
    // gtag は layout.tsx の beforeInteractive スクリプトで定義済み
    gtag?: (...args: unknown[]) => void
  }
}

// 同意バナーの多言語文言。表示中ページの言語 (URL 先頭セグメント) に合わせる。
// LP を /en /es /fr /zh /it で配信しているため、越境の第一印象で日本語バナーを
// 出さないようにする。プライバシーポリシーのリンク先は現状 /legal/privacy 共通。
type BannerText = { pre: string; link: string; post: string; accept: string; decline: string; aria: string }
const BANNER: Record<string, BannerText> = {
  ja: {
    pre: "本サイトはサービス改善のため、Google アナリティクスによる利用状況の計測を行っています。同意いただける場合のみ計測用 Cookie を使用します。詳しくは",
    link: "プライバシーポリシー",
    post: "をご覧ください。",
    accept: "同意する",
    decline: "拒否する",
    aria: "Cookie の利用について",
  },
  en: {
    pre: "We use Google Analytics to measure site usage and improve our service. Analytics cookies are used only with your consent. For details, see our ",
    link: "Privacy Policy",
    post: ".",
    accept: "Accept",
    decline: "Decline",
    aria: "Cookie notice",
  },
  es: {
    pre: "Usamos Google Analytics para medir el uso del sitio y mejorar el servicio. Las cookies de analítica se utilizan solo con su consentimiento. Para más información, consulte nuestra ",
    link: "Política de Privacidad",
    post: ".",
    accept: "Aceptar",
    decline: "Rechazar",
    aria: "Aviso de cookies",
  },
  fr: {
    pre: "Nous utilisons Google Analytics pour mesurer l'utilisation du site et améliorer notre service. Les cookies d'analyse ne sont utilisés qu'avec votre consentement. Pour en savoir plus, consultez notre ",
    link: "Politique de confidentialité",
    post: ".",
    accept: "Accepter",
    decline: "Refuser",
    aria: "Avis relatif aux cookies",
  },
  zh: {
    pre: "我们使用 Google Analytics 分析网站使用情况以改进服务。仅在您同意后才会使用分析 Cookie。详情请参阅我们的",
    link: "隐私政策",
    post: "。",
    accept: "同意",
    decline: "拒绝",
    aria: "Cookie 通知",
  },
  it: {
    pre: "Utilizziamo Google Analytics per misurare l'uso del sito e migliorare il servizio. I cookie analitici vengono usati solo con il tuo consenso. Per maggiori informazioni, consulta la nostra ",
    link: "Informativa sulla privacy",
    post: ".",
    accept: "Accetta",
    decline: "Rifiuta",
    aria: "Avviso sui cookie",
  },
}

function localeFromPath(): string {
  if (typeof window === "undefined") return "ja"
  const seg = window.location.pathname.split("/")[1]
  return ["en", "es", "fr", "zh", "it"].includes(seg) ? seg : "ja"
}

/**
 * 解析 Cookie の同意バナー (GA Consent Mode 連動)。
 * 既定は「拒否」(layout.tsx で consent default = denied)。
 *  - 過去に承認済み → マウント時に analytics_storage を granted に更新し、バナー非表示
 *  - 未選択 → バナー表示。承認で granted、拒否で denied を保存
 */
export function ConsentBanner() {
  const [visible, setVisible] = useState(false)
  const [loc, setLoc] = useState("ja")

  useEffect(() => {
    setLoc(localeFromPath())
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
      // 同意連動で読み込む他トラッカー (HubSpot 等) に通知 — 再読込なしで有効化。
      try {
        window.dispatchEvent(new Event("bondex-consent-granted"))
      } catch {
        /* 古い環境で Event 構築不可でも同意保存自体は成立 */
      }
    }
    setVisible(false)
  }

  if (!visible) return null

  const t = BANNER[loc] ?? BANNER.ja

  return (
    <div
      role="dialog"
      aria-label={t.aria}
      className="fixed inset-x-0 bottom-0 z-[60] px-4 pb-4 sm:px-6 sm:pb-6"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.16)] sm:flex sm:items-center sm:gap-6">
        <p className="text-[13px] leading-relaxed text-[#334155]">
          {t.pre}
          <a
            href="/legal/privacy"
            className="font-medium text-[#C8102E] underline underline-offset-2"
          >
            {t.link}
          </a>
          {t.post}
        </p>
        <div className="mt-4 flex shrink-0 gap-2 sm:mt-0">
          <button
            type="button"
            onClick={() => choose(false)}
            className="h-10 flex-1 rounded-xl border border-[#CBD5E1] px-4 text-[13px] font-medium text-[#475569] hover:bg-[#F8FAFC] sm:flex-none whitespace-nowrap"
          >
            {t.decline}
          </button>
          <button
            type="button"
            onClick={() => choose(true)}
            className="h-10 flex-1 rounded-xl bg-[#0F172A] px-5 text-[13px] font-bold text-white hover:bg-[#1E293B] sm:flex-none whitespace-nowrap"
          >
            {t.accept}
          </button>
        </div>
      </div>
    </div>
  )
}
