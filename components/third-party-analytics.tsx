"use client"

/**
 * 計測（Google Analytics・Vercel Analytics・HubSpot）の読み込み。
 *
 * 旅行者の秘密のリンク（/my/<token>・/my/<token>/pay・/my/<token>/frontdesk）と予約の入口（/book/<token>）では読み込まない。
 * 計測の仕組みはページの URL（秘密の token を含む）をそのまま送るため（GA は同意の前でも Cookie なしの計測で URL を送る）。
 * token を知る人は予約の中身を見て取消ができるので、外部のサービスに渡さない（Stage 6 の監査）。
 * それ以外のページの動きは今までと同じ。
 */
import { usePathname } from "next/navigation"
import Script from "next/script"
import { Analytics } from "@vercel/analytics/next"
import { HubSpotTracking } from "@/components/hubspot-tracking"

export function isSecretLinkPath(path: string | null | undefined): boolean {
  // /legal/traveler/ は秘密のリンクではないが、予約の画面・確認ページから開く旅行者向けの規約のページ。
  // 開いた元の URL（token を含む）が参照元として計測に渡らないよう、ここでも読み込まない（リンク側も rel="noreferrer"）。
  return !!path && (path.startsWith("/my/") || path.startsWith("/book/") || path.startsWith("/legal/traveler/"))
}

export function ThirdPartyAnalytics({ gaMeasurementId }: { gaMeasurementId: string }) {
  const path = usePathname()
  if (isSecretLinkPath(path)) return null
  return (
    <>
      <HubSpotTracking />
      <Analytics />
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`} strategy="afterInteractive" />
      <Script id="google-analytics" strategy="afterInteractive">
        {`gtag('config', '${gaMeasurementId}');`}
      </Script>
    </>
  )
}
