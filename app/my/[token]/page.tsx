import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { B2cMyBooking } from "@/components/b2c/my-booking"
import { loadMyBooking } from "@/lib/b2c/my-booking"
import { b2cMyBookingEnabled } from "@/lib/b2c/flags"
import { SUPPORT_EMAIL } from "@/lib/contact-links"

// 旅行者の予約の確認ページ（秘密のリンク）。検索エンジンに載せず、他のサイトに URL（秘密の token）を渡さない。
export const metadata: Metadata = {
  title: "BondEx — My booking",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
}
export const dynamic = "force-dynamic"

export default async function MyBookingPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { token } = await params
  const { lang } = await searchParams
  if (!b2cMyBookingEnabled()) notFound()
  const view = await loadMyBooking(token)
  if (!view) notFound()
  const initialLang = lang === "ja" || lang === "en" ? lang : view.language
  return <B2cMyBooking token={token} view={view} initialLang={initialLang} supportEmail={SUPPORT_EMAIL} />
}
