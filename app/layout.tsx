import React from "react"
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import Script from 'next/script'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

// GA4 測定ID (BondEx専用プロパティ)。値は非機密のため直書きで問題ない
const GA_MEASUREMENT_ID = 'G-M2LR1SYV92'

export const metadata: Metadata = {
  title: 'BondEx | 荷物配送を、旅行商品の一部に。',
  description:
    'BondEx（ボンデックス）は、訪日旅行代理店・ランドオペレーター向けの荷物配送手配代行サービスです。旅程データからバウチャー・送り状・追跡情報・月次請求までまとめて対応します。',
  icons: {
    // BondEx ロゴの頭文字モノグラム — 再生成: python3 scripts/generate-favicons.py
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
    ],
    apple: '/apple-icon.png',
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
    <html lang="en">
      <body className={`font-sans antialiased`}>
        {children}
        <Analytics />
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>
      </body>
    </html>
  )
}
