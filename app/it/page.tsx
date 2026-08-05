import type { Metadata } from "next"
import { Landing } from "@/components/landing/landing"

// イタリア語ランディング。/it で配信。同一のランディングページをイタリア語で表示する。
const SITE_TITLE_IT = "BondEx | Inoltro bagagli tra hotel in tutto il Giappone"
const SITE_DESC_IT =
  "BondEx è un servizio di coordinamento dell'inoltro bagagli per agenzie di viaggio incoming e tour operator locali, che sposta i bagagli tra gli hotel in tutto il Giappone. Dai dati del tuo itinerario emettiamo voucher per il viaggiatore ed etichette di spedizione, offriamo il tracciamento e gestiamo la fatturazione mensile unica o il pagamento con carta."

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
    images: [{ url: "/og-image.jpg", width: 1200, height: 630, alt: "BondEx" }],
  },
}

export default function Page() {
  return <Landing lang="it" />
}
