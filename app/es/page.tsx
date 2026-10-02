import type { Metadata } from "next"
import { Landing } from "@/components/landing/landing"

// スペイン語ランディング。/es で配信。同一のランディングページをスペイン語で表示する。
const SITE_TITLE_ES = "Envío de equipaje entre hoteles en Japón para agencias y receptivos | BondEx"
const SITE_DESC_ES =
  "BondEx organiza el envío de equipaje entre hoteles en todo Japón para agencias de viajes, receptivos (DMC) y operadores. Envíe el itinerario y nos ocupamos de la recogida, las etiquetas, el seguimiento y la facturación mensual, sin papeleo para el hotel."

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
  title: SITE_TITLE_ES,
  description: SITE_DESC_ES,
  alternates: {
    canonical: "/es",
    languages: LANGUAGE_ALTERNATES,
  },
  openGraph: {
    type: "website",
    url: "https://bondex.express/es",
    siteName: "BondEx",
    title: SITE_TITLE_ES,
    description: SITE_DESC_ES,
    locale: "es_ES",
    images: [{ url: "/og-image.jpg?v=2", width: 1200, height: 630, alt: "BondEx" }],
  },
}

export default function Page() {
  return <Landing lang="es" />
}
