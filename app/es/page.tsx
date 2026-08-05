import type { Metadata } from "next"
import { Landing } from "@/components/landing/landing"

// スペイン語ランディング。/es で配信。同一のランディングページをスペイン語で表示する。
const SITE_TITLE_ES = "BondEx | Reenvío de equipaje entre hoteles en Japón"
const SITE_DESC_ES =
  "BondEx es un servicio de coordinación de reenvío de equipaje para agencias de viajes receptivas y operadores terrestres, que traslada el equipaje entre hoteles por todo Japón. A partir de los datos de su itinerario emitimos vouchers para el viajero y etiquetas de envío, ofrecemos seguimiento y gestionamos la facturación mensual consolidada o el pago con tarjeta."

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
    images: [{ url: "/og-image.jpg", width: 1200, height: 630, alt: "BondEx" }],
  },
}

export default function Page() {
  return <Landing lang="es" />
}
