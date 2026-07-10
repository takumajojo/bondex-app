"use client"

import { Suspense, useState, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2, Search } from "lucide-react"

/**
 * 追跡 索引ページ (/track)。
 * 予約番号 (BDX-YYMMDD-NNN) を入力すると /track/[bookingId] へ遷移する。
 * バウチャー/How to ship の QR は個別の /track/[id] を直接指すが、
 * 番号を手入力したいゲスト向けにこの入口を用意し、フッターのリンク切れも解消する。
 */
function TrackLookup() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [value, setValue] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const notFound = searchParams.get("nf") === "1"

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const id = value.trim().toUpperCase()
    if (!id) return
    setSubmitting(true)
    router.push(`/track/${encodeURIComponent(id)}`)
  }

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bondex-logo.png" alt="BondEx" className="mx-auto h-12 w-auto object-contain mb-6" />
          <h1 className="text-[22px] font-bold text-[#0F172A]">
            荷物の配送状況を確認
          </h1>
          <p className="text-[13px] text-[#64748B] mt-1">Track your luggage delivery</p>
        </div>

        <form
          onSubmit={onSubmit}
          method="post"
          className="bg-white rounded-2xl border border-[#E5E7EB] p-6 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_10px_28px_rgba(15,23,42,0.06)]"
        >
          <div className="space-y-1.5">
            <label htmlFor="booking-id" className="text-[12px] font-medium text-[#334155]">
              予約番号 / Booking number
            </label>
            <input
              id="booking-id"
              type="text"
              inputMode="text"
              autoComplete="off"
              placeholder="BDX-260710-123"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full h-12 rounded-xl border border-[#CBD5E1] px-4 text-[15px] font-mono tracking-wide text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#C8102E]/40 focus:border-[#C8102E]"
              required
            />
            <p className="text-[11px] text-[#94A3B8]">
              バウチャーまたは How to ship ガイドに記載の番号(BDX で始まる)を入力してください。
            </p>
          </div>

          {notFound && (
            <p className="text-[12px] text-red-600" role="alert">
              その予約番号の配送情報が見つかりませんでした。番号をご確認ください。
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !value.trim()}
            className="w-full h-12 rounded-xl bg-[#C8102E] text-white text-[14px] font-bold flex items-center justify-center gap-2 hover:bg-[#A00D25] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
            ) : (
              <>
                <Search className="w-4 h-4" strokeWidth={2} />
                配送状況を見る
              </>
            )}
          </button>
        </form>

        <p className="text-center mt-6 text-[12px] text-[#94A3B8]">
          お困りの場合は{" "}
          <a href="mailto:support@bondex.express" className="text-[#C8102E] font-medium underline underline-offset-2">
            support@bondex.express
          </a>{" "}
          までご連絡ください。
        </p>
      </div>
    </main>
  )
}

export default function TrackIndexPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50 text-[#94A3B8] text-sm">
          Loading…
        </div>
      }
    >
      <TrackLookup />
    </Suspense>
  )
}
