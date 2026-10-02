import type { Metadata } from "next"
import { Landing } from "@/components/landing/landing"

// フランス語ランディング。/fr で配信。同一のランディングページをフランス語で表示する。
const SITE_TITLE_FR = "Transfert de bagages entre hôtels au Japon pour agences et réceptifs | BondEx"
const SITE_DESC_FR =
  "BondEx organise le transfert de bagages entre hôtels dans tout le Japon pour les agences de voyages, réceptifs (DMC) et tour-opérateurs. Envoyez l'itinéraire : enlèvement, étiquettes, suivi et facturation mensuelle sont pris en charge, sans formalités pour l'hôtel."

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
  title: SITE_TITLE_FR,
  description: SITE_DESC_FR,
  alternates: {
    canonical: "/fr",
    languages: LANGUAGE_ALTERNATES,
  },
  openGraph: {
    type: "website",
    url: "https://bondex.express/fr",
    siteName: "BondEx",
    title: SITE_TITLE_FR,
    description: SITE_DESC_FR,
    locale: "fr_FR",
    images: [{ url: "/og-image.jpg?v=2", width: 1200, height: 630, alt: "BondEx" }],
  },
}

export default function Page() {
  return <Landing lang="fr" />
}
