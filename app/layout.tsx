import React from "react"
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import Script from 'next/script'
import { ConsentBanner } from '@/components/consent-banner'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

// GA4 測定ID (BondEx専用プロパティ)。値は非機密のため直書きで問題ない
const GA_MEASUREMENT_ID = 'G-M2LR1SYV92'

const SITE_URL = 'https://bondex.express'
const SITE_TITLE = 'BondEx | 荷物配送を、旅行商品の一部に。'
const SITE_DESC =
  'BondEx（ボンデックス）は、訪日旅行代理店・ランドオペレーター向けの荷物配送手配代行サービスです。旅程データからバウチャー・送り状・追跡情報・月次請求までまとめて対応します。'

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
    images: [{ url: '/og-image.jpg', width: 1200, height: 630, alt: 'BondEx' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESC,
    images: ['/og-image.jpg'],
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
