import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { loadMyBooking } from "@/lib/b2c/my-booking"
import { b2cMyBookingEnabled } from "@/lib/b2c/flags"
import { SUPPORT_EMAIL } from "@/lib/contact-links"

/**
 * ホテルのスタッフ向けの案内（B2C のバウチャーの代わり・Stage 4）。旅行者がフロントで見せる、または印刷する。
 * 送り状は佐川急便が持参する（docs/sagawa マスター 14）ので、BondEx の送り状は無い。スタッフ向けは日本語、旅行者向けに英語を添える。
 * 確定していない予約では「まだ預からないでください」と出す（確定前に荷物を預けさせない）。
 */
export const metadata: Metadata = {
  title: "BondEx — フロントの皆さまへ / For the front desk",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
}
export const dynamic = "force-dynamic"

function jaDay(ymd: string) {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("ja-JP", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric", weekday: "short" })
}
function enDay(ymd: string) {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" })
}

export default async function FrontDeskPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!b2cMyBookingEnabled()) notFound()
  const v = await loadMyBooking(token)
  if (!v) notFound()
  const active = ["confirmed", "picked_up", "in_transit"].includes(v.stage)
  return (
    <main className="mx-auto min-h-dvh max-w-xl bg-white px-5 py-8 text-black print:py-0" data-frontdesk={active ? "active" : "inactive"}>
      <p className="text-2xl font-bold tracking-tight">BondEx</p>
      {!active ? (
        <section className="mt-6 rounded-xl border-2 border-red-600 p-5">
          <h1 className="text-xl font-bold">この予約はまだ確定していない、または取り消されています。お荷物は預からないでください。</h1>
          <p className="mt-2 text-sm">This booking is not confirmed or has been cancelled. Please do not hand over your bags.</p>
        </section>
      ) : (
        <>
          <h1 className="mt-6 text-xl font-bold leading-snug">ホテルフロントご担当者様</h1>
          <p className="mt-3 leading-relaxed">
            こちらのお客様のお荷物は、BondEx の手配により <strong>佐川急便</strong> が集荷に伺います。
            送り状は佐川急便のドライバーが持参しますので、ホテル様での送り状の記入・印刷は不要です。
            集荷まで、フロントでお預かりをお願いいたします。
          </p>
          <dl className="mt-5 grid grid-cols-[7.5rem_1fr] gap-y-2 rounded-xl border-2 border-black p-4 text-base">
            <dt className="font-semibold">受付番号</dt><dd className="font-mono text-lg font-bold">{`B2C-${v.orderNumber}`}</dd>
            <dt className="font-semibold">お客様名</dt><dd>{v.guestName} 様</dd>
            <dt className="font-semibold">個数</dt><dd className="text-lg font-bold">{v.pieces} 個</dd>
            <dt className="font-semibold">集荷日</dt><dd>{jaDay(v.pickupDate)}（11:00 までにお預かり）</dd>
            <dt className="font-semibold">集荷するホテル</dt><dd>{v.origin.name}</dd>
            <dt className="font-semibold">お届け先</dt><dd>{v.dest.name}<br /><span className="text-sm">{v.dest.address}</span></dd>
            <dt className="font-semibold">お届け日</dt><dd>{jaDay(v.deliveryDate)}</dd>
          </dl>
          <p className="mt-4 text-sm leading-relaxed">個数が異なる場合や、ご不明な点は BondEx までご連絡ください：{SUPPORT_EMAIL}</p>
          <hr className="my-6" />
          <p className="text-sm leading-relaxed">
            For the guest: show this page at the front desk. Sagawa will pick up {v.pieces} bag(s) on {enDay(v.pickupDate)} and deliver them to {v.dest.nameEn || v.dest.name} on {enDay(v.deliveryDate)}. Keep valuables, cash and your passport with you.
          </p>
        </>
      )}
    </main>
  )
}
