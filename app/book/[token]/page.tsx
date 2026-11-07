import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { B2cBookingForm } from "@/components/b2c/booking-form"
import { resolveEntryState } from "@/lib/b2c/booking-service"
import { b2cBookingEnabled } from "@/lib/b2c/flags"

// 限定公開の予約ページ。検索エンジンに載せない（Q07）。リンク元に URL（入口の token）を渡さない。
export const metadata: Metadata = {
  title: "BondEx — Luggage delivery to your next hotel",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
}
export const dynamic = "force-dynamic"

const ENDED = {
  en: { title: "This booking link is no longer active", body: "Please ask your travel agent for a new link. Existing bookings are not affected — you can still open them from the link in your confirmation email." },
  ja: { title: "この予約のリンクは使えなくなりました", body: "旅行会社に新しいリンクをご確認ください。既にご予約済みの方は、確認のメールのリンクから予約を確認できます（ご予約は取り消されていません）。" },
}

export default async function B2cBookPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { token } = await params
  const { lang } = await searchParams
  if (!b2cBookingEnabled()) notFound()
  const r = await resolveEntryState(token)
  // 期限切れ・停止は案内を出す（410 相当）。形が違う・DB に無い token は「見つからない」（どの token が有ったかを教えない）
  if (r.state === "expired" || r.state === "disabled") {
    const t = ENDED[lang === "ja" ? "ja" : "en"]
    return (
      <main className="mx-auto max-w-md space-y-3 p-6" data-entry-state={r.state === "expired" ? "expired" : "disabled"}>
        <p className="text-lg font-bold tracking-tight">BondEx</p>
        <h1 className="text-xl font-semibold">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.body}</p>
      </main>
    )
  }
  if (r.state !== "ok") notFound()
  const entry = r.entry
  return <B2cBookingForm token={token} referrerName={lang === "ja" ? entry.referrerName : entry.referrerNameEn} initialLang={lang === "ja" ? "ja" : "en"} />
}
