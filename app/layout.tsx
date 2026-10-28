import React from "react"
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import Script from 'next/script'
import { ConsentBanner } from '@/components/consent-banner'
import { HubSpotTracking } from '@/components/hubspot-tracking'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

// GA4 測定ID (BondEx専用プロパティ)。値は非機密のため直書きで問題ない
const GA_MEASUREMENT_ID = 'G-M2LR1SYV92'

const SITE_URL = 'https://bondex.express'
const SITE_TITLE = 'BondEx（ボンデックス）｜旅行会社・DMC向け 訪日旅行のホテル間荷物配送手配'
const SITE_DESC =
  '旅行会社・DMC・ランドオペレーター向けの荷物配送手配代行。旅程を送るだけで、ホテル間配送の集荷・送り状・追跡・月次請求まで BondEx が対応。ホテルへの伝票依頼は不要で、手ぶら観光を旅行商品に組み込めます。'

// 構造化データ (JSON-LD) — 同名多数 (塗料 Bondex 等) の中で「訪日旅行者向け
// 手荷物ホテル間配送の取次サービス (株式会社JOJO)」という固有エンティティを
// 検索エンジン/AIに明確化する。三宮 JOJO Nail で構造化データがエンティティ確立に
// 効いた勝ちパターンを Web サービスへ適用。参照する logo は 200 を確認済み
// (404衛生ルール)。連絡先は稼働中の support@bondex.express のみ。
const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'BondEx',
      alternateName: ['ボンデックス', 'BondEx Japan'],
      legalName: '株式会社JOJO',
      url: SITE_URL,
      logo: `${SITE_URL}/bondex-logo.png`,
      image: `${SITE_URL}/og-image.jpg`,
      description:
        'BondEx（ボンデックス）は、株式会社JOJO（東京・世田谷）が運営する、旅行会社・DMC・ランドオペレーター向けの訪日旅行ホテル間荷物配送の手配代行サービス。',
      // 同名他社 (Web3 の Bondex / 福祉の株式会社Bondex / 塗料・接着機の BONDEX / ヘアケアのボンデックス) との区別を明示
      disambiguatingDescription:
        '訪日旅行のホテル間荷物配送を旅行会社向けに手配する日本のサービス (運営: 株式会社JOJO)。暗号資産・Web3 の Bondex (BDXN)、障がい福祉事業の株式会社Bondex、塗料・接着機の BONDEX、ヘアケア製品のボンデックスとは無関係。',
      slogan: '旅程を送るだけで、ホテル間の荷物配送まで手配完了。',
      foundingDate: '2026-08',
      founder: { '@type': 'Person', name: '谷口 琢真', alternateName: 'Takuma Taniguchi' },
      address: {
        '@type': 'PostalAddress',
        streetAddress: '野毛1-9-12',
        addressLocality: '世田谷区',
        addressRegion: '東京都',
        postalCode: '158-0092',
        addressCountry: 'JP',
      },
      areaServed: { '@type': 'Country', name: 'Japan' },
      email: 'support@bondex.express',
      // 「BondEx＝旅行会社向け荷物配送」のエンティティを補強
      knowsAbout: [
        '旅行会社向け 荷物配送手配',
        'DMC',
        'ランドオペレーター',
        'luggage forwarding Japan',
        'hotel-to-hotel luggage forwarding',
        '荷物配送',
        'ホテル間配送',
        '手荷物配送',
        '手ぶら観光',
        '訪日旅行',
        'ラゲッジ配送',
        '配送追跡',
      ],
      parentOrganization: {
        '@type': 'Organization',
        '@id': 'https://www.jojotokyo.com/#organization',
        name: '株式会社JOJO',
        alternateName: 'JOJO Co., Ltd.',
        url: 'https://www.jojotokyo.com',
        foundingDate: '2015-10',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '野毛1-9-12',
          addressLocality: '世田谷区',
          addressRegion: '東京都',
          postalCode: '158-0092',
          addressCountry: 'JP',
        },
      },
      sameAs: ['https://www.jojotokyo.com'],
      contactPoint: {
        '@type': 'ContactPoint',
        email: 'support@bondex.express',
        contactType: 'customer support',
        availableLanguage: ['Japanese', 'English', 'Spanish', 'French', 'Chinese', 'Italian'],
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: 'BondEx',
      url: SITE_URL,
      publisher: { '@id': `${SITE_URL}/#organization` },
      inLanguage: ['ja', 'en', 'es', 'fr', 'zh', 'it'],
      about: { '@id': `${SITE_URL}/#organization` },
    },
    {
      '@type': 'Service',
      '@id': `${SITE_URL}/#service`,
      name: 'BondEx — Luggage Forwarding in Japan for Travel Agencies and DMCs',
      serviceType: 'Hotel-to-hotel luggage forwarding and delivery coordination',
      keywords: 'BondEx, ボンデックス, 旅行会社 荷物配送, DMC, ランドオペレーター, ホテル間配送, 手荷物配送, 手ぶら観光, 訪日旅行 荷物配送, luggage forwarding Japan, hotel to hotel luggage forwarding, travel agency luggage forwarding Japan, 送り状発行, 配送追跡',
      provider: { '@id': `${SITE_URL}/#organization` },
      areaServed: { '@type': 'Country', name: 'Japan' },
      audience: {
        '@type': 'Audience',
        audienceType: 'Travel agencies, DMCs and land operators handling inbound travel to Japan (FIT and groups)',
      },
      availableLanguage: ['Japanese', 'English', 'Spanish', 'French', 'Chinese', 'Italian'],
      description:
        'BondEx arranges luggage forwarding between hotels across Japan for travel agencies, DMCs and land operators, for both individual (FIT) and group itineraries, so hotels are never asked to handle shipping paperwork. It issues traveler vouchers and shipping labels, provides tracking, and offers consolidated monthly invoicing or card payment, using major Japanese carriers (Sagawa / Yamato). Operated by JOJO Inc.',
    },
  ],
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESC,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'BondEx',
    title: SITE_TITLE,
    description: SITE_DESC,
    locale: 'ja_JP',
    images: [{ url: '/og-image.jpg?v=2', width: 1200, height: 630, alt: 'BondEx' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESC,
    images: ['/og-image.jpg?v=2'],
  },
  icons: {
    // BondEx モノグラム (赤地 + 白B)。再生成: python3 scripts/generate-favicons.py
    // ?v= はブラウザのファビコンキャッシュを更新するためのバージョン。差し替え時に上げる。
    icon: [{ url: '/icon-light-32x32.png?v=2', type: 'image/png', sizes: '32x32' }],
    apple: '/apple-icon.png?v=2',
  },
  verification: {
    google: 'YyLHJbV0atoJ5ZBJmZ-HkygRp-IVkLwGVZzN3Dn6xwQ',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ja">
      <head>
        {/* 構造化データ (JSON-LD): 固有エンティティ (訪日向け手荷物配送の取次・株式会社JOJO) を明確化 */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
        {/*
          GA Consent Mode v2 — 既定は「拒否」。gtag.js の読み込み前に dataLayer と
          gtag() を定義し、analytics/ad 系の保存を既定で denied にする。
          ユーザーが同意バナーで承認すると ConsentBanner が granted に更新する。
          beforeInteractive で確実に gtag.js より先に走らせる。
        */}
        <Script id="ga-consent-default" strategy="beforeInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('consent', 'default', {
              ad_storage: 'denied',
              ad_user_data: 'denied',
              ad_personalization: 'denied',
              analytics_storage: 'denied',
              wait_for_update: 500
            });
            gtag('js', new Date());
          `}
        </Script>
      </head>
      <body className={`font-sans antialiased`}>
        {children}
        <ConsentBanner />
        <HubSpotTracking />
        <Analytics />
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`gtag('config', '${GA_MEASUREMENT_ID}');`}
        </Script>
      </body>
    </html>
  )
}
