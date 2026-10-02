import type { Metadata } from "next"
import { Landing } from "@/components/landing/landing"

// イタリア語ランディング。/it で配信。同一のランディングページをイタリア語で表示する。
const SITE_TITLE_IT = "Trasferimento bagagli tra hotel in Giappone per agenzie e DMC | BondEx"
const SITE_DESC_IT =
  "BondEx organizza il trasferimento dei bagagli tra hotel in tutto il Giappone per agenzie di viaggio, DMC e operatori incoming. Invia l'itinerario: ritiro, etichette, tracciamento e fatturazione mensile sono gestiti da noi, senza moduli per l'hotel."

// hreflang 相互リンク。全 6 言語 + x-default を列挙する。
const LANGUAGE_ALTERNATES = {
  ja: "/",
  en: "/en",
  es: "/es",
  fr: "/fr",
  zh: "/zh",
  it: "/it",
  "x-default": "/",
}

export const metadata: Metadata = {
  title: SITE_TITLE_IT,
  description: SITE_DESC_IT,
  alternates: {
    canonical: "/it",
    languages: LANGUAGE_ALTERNATES,
  },
  openGraph: {
    type: "website",
    url: "https://bondex.express/it",
    siteName: "BondEx",
    title: SITE_TITLE_IT,
    description: SITE_DESC_IT,
    locale: "it_IT",
    images: [{ url: "/og-image.jpg?v=2", width: 1200, height: 630, alt: "BondEx" }],
  },
}

export default function Page() {
  return <Landing lang="it" />
}
