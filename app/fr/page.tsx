import type { Metadata } from "next"
import { Landing } from "@/components/landing/landing"

// フランス語ランディング。/fr で配信。同一のランディングページをフランス語で表示する。
const SITE_TITLE_FR = "BondEx | Réexpédition de bagages entre hôtels au Japon"
const SITE_DESC_FR =
  "BondEx est un service de coordination de réexpédition de bagages pour les agences de voyage réceptives et les tour-opérateurs terrestres, qui achemine les bagages d'hôtel en hôtel à travers le Japon. À partir des données de votre itinéraire, nous émettons les bons voyageur et les étiquettes d'expédition, assurons le suivi et gérons la facturation mensuelle unique ou le paiement par carte."

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
    images: [{ url: "/og-image.jpg", width: 1200, height: 630, alt: "BondEx" }],
  },
}

export default function Page() {
  return <Landing lang="fr" />
}
