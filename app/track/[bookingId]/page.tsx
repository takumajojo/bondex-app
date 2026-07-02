import { notFound } from "next/navigation"
import { headers } from "next/headers"

interface TrackingNumberStatus {
  number: string
  status: string | null
  location: string | null
  date: string | null
  checkedAt: string | null
}

interface LegStatus {
  legIndex: number
  shipmentDate: string
  expectedArrival: string | null
  fromHotel: string
  toHotel: string
  recipient: string
  status: string
  tracking: TrackingNumberStatus[]
  updatedAt: string
}

interface TrackData {
  bookingId: string
  legs: LegStatus[]
}

const STATUS_META: Record<string, { label: string; en: string; color: string; emoji: string }> = {
  pending:    { label: "発行待ち", en: "Pending issuance",    color: "bg-slate-100 text-slate-700", emoji: "⏳" },
  issued:     { label: "送り状発行済", en: "Label issued",     color: "bg-blue-100 text-blue-800",  emoji: "📋" },
  picked_up:  { label: "集荷済",   en: "Picked up",            color: "bg-amber-100 text-amber-800", emoji: "📦" },
  in_transit: { label: "配達中",   en: "In transit",           color: "bg-indigo-100 text-indigo-800", emoji: "🚚" },
  delivered:  { label: "配達完了", en: "Delivered",            color: "bg-emerald-100 text-emerald-800", emoji: "✅" },
  failed:     { label: "発行失敗", en: "Failed",               color: "bg-red-100 text-red-800",   emoji: "⚠️" },
  cancelled:  { label: "キャンセル", en: "Cancelled",          color: "bg-zinc-200 text-zinc-700", emoji: "✖" },
}

// 追跡番号 1 個あたりの進捗を表す 4 ステージ。"issued" (未集荷) を含めて、
// Ship&co からまだ応答がない (status === null) 場合もここに正しく位置づける
// ("未確認" という曖昧な別枠ではなく、「まだ発行済の段階」として扱う).
const PIECE_STEPS: Array<{ key: string; label: string }> = [
  { key: "issued", label: "発行済" },
  { key: "picked_up", label: "集荷済" },
  { key: "in_transit", label: "配送中" },
  { key: "delivered", label: "配達完了" },
]

/**
 * ドット・線・ドット…の並びで進捗を表す軽量ステッパー。
 * テキストの長さに左右されないので、長い場所情報が来ても崩れない
 * (場所・日時はこのコンポーネントの外側、別の行で表示する).
 */
function TrackingStepper({ status }: { status: string | null }) {
  const idx = PIECE_STEPS.findIndex((s) => s.key === status)
  const activeIndex = idx === -1 ? 0 : idx // null/不明は "issued" 扱い

  return (
    <div>
      <div className="flex items-center">
        {PIECE_STEPS.map((step, i) => (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div
              className={`w-4 h-4 shrink-0 rounded-full border-2 flex items-center justify-center ${
                i <= activeIndex
                  ? "bg-emerald-500 border-emerald-500"
                  : "bg-white border-border"
              }`}
            >
              {i <= activeIndex && (
                <svg viewBox="0 0 10 10" className="w-2 h-2" fill="none">
                  <path
                    d="M2 5.2 L4.2 7.4 L8 3"
                    stroke="white"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
            {i < PIECE_STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-0.5 ${
                  i < activeIndex ? "bg-emerald-500" : "bg-border"
                }`}
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex mt-1">
        {PIECE_STEPS.map((step, i) => (
          <p
            key={step.key}
            className={`flex-1 text-[9px] leading-tight ${
              i === 0 ? "text-left" : i === PIECE_STEPS.length - 1 ? "text-right" : "text-center"
            } ${i === activeIndex ? "font-semibold text-foreground" : "text-muted-foreground"}`}
          >
            {step.label}
          </p>
        ))}
      </div>
    </div>
  )
}

async function fetchTrack(bookingId: string): Promise<TrackData | null> {
  const h = await headers()
  const host = h.get("host") || "localhost:3000"
  const proto = h.get("x-forwarded-proto") || "https"
  const base = `${proto}://${host}`
  const res = await fetch(`${base}/api/track/${encodeURIComponent(bookingId)}`, {
    cache: "no-store",
  })
  if (!res.ok) return null
  return (await res.json()) as TrackData
}

function formatDate(ymd: string | null): string {
  if (!ymd) return "—"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"]
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`
}

export default async function TrackPage({
  params,
}: {
  params: Promise<{ bookingId: string }>
}) {
  const { bookingId } = await params
  const data = await fetchTrack(bookingId)
  if (!data) notFound()

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-6 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bondex-logo.png" alt="BondEx" className="h-12 w-auto object-contain" />
          <div className="border-l border-border pl-4">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              Track Your Luggage
            </p>
            <h1 className="text-lg font-semibold text-foreground mt-0.5">
              {data.bookingId}
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div className="rounded-2xl border border-border bg-white p-6">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Welcome — your luggage forwarding is being arranged by BondEx.{" "}
            Below is the live status of each leg. If anything looks wrong,
            please contact BondEx support.
          </p>
        </div>

        {data.legs.map((leg) => {
          const meta = STATUS_META[leg.status] ?? STATUS_META.issued
          return (
            <section
              key={leg.legIndex}
              className="rounded-2xl border border-border bg-white overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/40">
                <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
                  Leg {leg.legIndex + 1}
                </p>
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${meta.color}`}
                >
                  <span>{meta.emoji}</span>
                  {meta.en} · {meta.label}
                </span>
              </div>

              <div className="p-6 space-y-5">
                {/* Journey */}
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-center">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                      Drop-off
                    </p>
                    <p className="text-base font-semibold text-foreground">
                      {leg.fromHotel}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(leg.shipmentDate)}
                    </p>
                  </div>
                  <div className="text-2xl text-muted-foreground text-center">→</div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                      Pick-up
                    </p>
                    <p className="text-base font-semibold text-foreground">
                      {leg.toHotel}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(leg.expectedArrival)}
                    </p>
                  </div>
                </div>

                {/* Tracking numbers — each with its own visual progress + location */}
                {leg.tracking.length > 0 && (
                  <div className="pt-4 border-t border-border">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
                      Yamato Tracking ({leg.tracking.length}{" "}
                      {leg.tracking.length === 1 ? "piece" : "pieces"})
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {leg.tracking.map((t) => (
                        <div key={t.number} className="rounded-lg border border-border p-3">
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <span className="font-mono text-[11px] text-foreground truncate">
                              {t.number}
                            </span>
                            <a
                              href={`https://toi.kuronekoyamato.co.jp/cgi-bin/tneko?init=on&number00=1&number01=${t.number}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                            >
                              Yamato ↗
                            </a>
                          </div>

                          <TrackingStepper status={t.status} />

                          {(t.location || t.date) && (
                            <div className="mt-3 pt-3 border-t border-border/60 space-y-1.5">
                              {t.location && (
                                <p className="text-[11px] text-muted-foreground flex gap-1.5">
                                  <span className="shrink-0">📍</span>
                                  <span className="break-words">{t.location}</span>
                                </p>
                              )}
                              {t.date && (
                                <p className="text-[11px] text-muted-foreground flex gap-1.5">
                                  <span className="shrink-0">🕐</span>
                                  <span>
                                    {new Date(t.date).toLocaleString("en-US", {
                                      dateStyle: "medium",
                                      timeStyle: "short",
                                    })}
                                  </span>
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground/70 mt-3">
                      Status is refreshed hourly and may lag behind Yamato&apos;s own site by
                      up to an hour.
                    </p>
                  </div>
                )}

                <div className="pt-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                  <span>Recipient: {leg.recipient}</span>
                  <span>
                    Updated:{" "}
                    {new Date(leg.updatedAt).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
              </div>
            </section>
          )
        })}

        <div className="rounded-2xl border border-border bg-white p-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-2">Need help?</p>
          <p>
            Contact BondEx support: <span className="font-mono">support@bondex.express</span>
          </p>
          <p className="text-xs mt-3 text-muted-foreground/80">
            This page is publicly accessible by URL only. Do not share publicly.
          </p>
        </div>
      </div>
    </main>
  )
}
