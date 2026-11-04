import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { B2cPayPage } from "@/components/b2c/pay-page"
import { b2cMyBookingEnabled } from "@/lib/b2c/flags"

// 旅行者の支払のページ（秘密のリンク・Stage 5）。検索エンジンに載せず、他のサイトに URL（秘密の token）を渡さない。
export const metadata: Metadata = {
  title: "BondEx — Payment",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
}
export const dynamic = "force-dynamic"

export default async function PayPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { token } = await params
  const { lang } = await searchParams
  if (!b2cMyBookingEnabled()) notFound()
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) notFound()
  return <B2cPayPage token={token} initialLang={lang === "ja" || lang === "en" ? lang : null} />
}
