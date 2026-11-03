import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { B2cBookingForm } from "@/components/b2c/booking-form"
import { resolveEntry } from "@/lib/b2c/booking-service"
import { b2cBookingEnabled } from "@/lib/b2c/flags"

// 限定公開の予約ページ。検索エンジンに載せない（Q07）。
export const metadata: Metadata = {
  title: "BondEx — Luggage delivery to your next hotel",
  robots: { index: false, follow: false, nocache: true },
}
export const dynamic = "force-dynamic"

export default async function B2cBookPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { token } = await params
  const { lang } = await searchParams
  if (!b2cBookingEnabled()) notFound()
  const entry = await resolveEntry(token)
  if (!entry) notFound()
  return <B2cBookingForm token={token} referrerName={lang === "ja" ? entry.referrerName : entry.referrerNameEn} initialLang={lang === "ja" ? "ja" : "en"} />
}
