import { notFound } from "next/navigation"
import { headers } from "next/headers"
import { TrackingStepper, carrierTrackUrl } from "@/components/tracking-stepper"

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
  guestLanguage: string
  carrier: string
  legs: LegStatus[]
}

// ─── 表示言語 ───────────────────────────────────────────────
// 旅行者の言語 (バウチャーと同じ guestLanguage) を既定にし、?lang= で切替できる。
// ゲスト向けページなので日本語も含め 6 言語対応 (ホテル/運営が日本語で見る場合用)。
type Lang = "en" | "ja" | "zh" | "it" | "fr" | "es"
const LANGS: Lang[] = ["en", "ja", "zh", "it", "fr", "es"]
const LANG_LABEL: Record<Lang, string> = { en: "EN", ja: "日本語", zh: "中文", it: "IT", fr: "FR", es: "ES" }
function resolveLang(raw: string | undefined, fallback: string): Lang {
  const v = (raw || fallback || "en").toLowerCase()
  return (LANGS as string[]).includes(v) ? (v as Lang) : "en"
}

type StatusKey = "pending" | "issued" | "picked_up" | "in_transit" | "delivered" | "failed" | "cancelled"

const STATUS_COLOR: Record<StatusKey, string> = {
  pending: "bg-slate-100 text-slate-700",
  issued: "bg-blue-100 text-blue-800",
  picked_up: "bg-amber-100 text-amber-800",
  in_transit: "bg-indigo-100 text-indigo-800",
  delivered: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-zinc-200 text-zinc-700",
}
const STATUS_EMOJI: Record<StatusKey, string> = {
  pending: "⏳", issued: "📋", picked_up: "📦", in_transit: "🚚", delivered: "✅", failed: "⚠️", cancelled: "✖",
}

interface L10n {
  title: string
  intro: string
  leg: string
  dropOff: string
  pickUp: string
  tracking: (carrier: string, n: number) => string
  refreshed: string
  recipient: string
  updated: string
  needHelp: string
  contact: string
  privacy: string
  status: Record<StatusKey, string>
  steps: [string, string, string, string] // issued / picked_up / in_transit / delivered
}

const L: Record<Lang, L10n> = {
  en: {
    title: "Track Your Luggage",
    intro: "Your luggage forwarding is arranged by BondEx. Below is the live status of each leg. If anything looks wrong, please contact BondEx support.",
    leg: "Leg", dropOff: "Drop-off", pickUp: "Pick-up",
    tracking: (c, n) => `${c} tracking (${n} ${n === 1 ? "piece" : "pieces"})`,
    refreshed: "Status is refreshed hourly and may lag behind the carrier's own site by up to an hour.",
    recipient: "Recipient", updated: "Updated", needHelp: "Need help?",
    contact: "Contact BondEx support:",
    privacy: "This page is accessible by URL only. Please do not share it publicly.",
    status: { pending: "Pending", issued: "Label issued", picked_up: "Picked up", in_transit: "In transit", delivered: "Delivered", failed: "Failed", cancelled: "Cancelled" },
    steps: ["Issued", "Picked up", "In transit", "Delivered"],
  },
  ja: {
    title: "お荷物の追跡",
    intro: "お荷物の配送は BondEx が手配しています。各区間の最新状況は以下のとおりです。おかしな点があれば BondEx サポートまでご連絡ください。",
    leg: "区間", dropOff: "お預け", pickUp: "お受け取り",
    tracking: (c, n) => `${c} 追跡（${n}個）`,
    refreshed: "状況は1時間ごとに更新され、配送会社サイトより最大1時間ほど遅れる場合があります。",
    recipient: "お受け取り", updated: "更新", needHelp: "お困りですか？",
    contact: "BondEx サポート：",
    privacy: "このページは URL を知っている方のみ閲覧できます。公開での共有はお控えください。",
    status: { pending: "発行待ち", issued: "送り状発行済", picked_up: "集荷済", in_transit: "配送中", delivered: "配達完了", failed: "発行失敗", cancelled: "キャンセル" },
    steps: ["発行済", "集荷済", "配送中", "配達完了"],
  },
  zh: {
    title: "行李追踪",
    intro: "您的行李转运由 BondEx 安排。以下是各段的实时状态。如有异常，请联系 BondEx 客服。",
    leg: "段", dropOff: "寄存", pickUp: "领取",
    tracking: (c, n) => `${c} 追踪（${n} 件）`,
    refreshed: "状态每小时更新一次，可能比承运商官网晚最多一小时。",
    recipient: "收件", updated: "更新", needHelp: "需要帮助？",
    contact: "联系 BondEx 客服：",
    privacy: "本页面仅可通过网址访问，请勿公开分享。",
    status: { pending: "待出单", issued: "已出单", picked_up: "已揽收", in_transit: "运送中", delivered: "已送达", failed: "出单失败", cancelled: "已取消" },
    steps: ["已出单", "已揽收", "运送中", "已送达"],
  },
  it: {
    title: "Traccia i tuoi bagagli",
    intro: "L'inoltro dei bagagli è gestito da BondEx. Di seguito lo stato in tempo reale di ogni tratta. Se qualcosa non va, contatta l'assistenza BondEx.",
    leg: "Tratta", dropOff: "Consegna", pickUp: "Ritiro",
    tracking: (c, n) => `Tracciamento ${c} (${n} ${n === 1 ? "collo" : "colli"})`,
    refreshed: "Lo stato si aggiorna ogni ora e può essere in ritardo fino a un'ora rispetto al sito del corriere.",
    recipient: "Destinatario", updated: "Aggiornato", needHelp: "Serve aiuto?",
    contact: "Contatta l'assistenza BondEx:",
    privacy: "Questa pagina è accessibile solo tramite URL. Non condividerla pubblicamente.",
    status: { pending: "In attesa", issued: "Etichetta emessa", picked_up: "Ritirato", in_transit: "In transito", delivered: "Consegnato", failed: "Non riuscito", cancelled: "Annullato" },
    steps: ["Emessa", "Ritirato", "In transito", "Consegnato"],
  },
  fr: {
    title: "Suivez vos bagages",
    intro: "L'acheminement de vos bagages est organisé par BondEx. Voici le statut en direct de chaque étape. En cas de problème, contactez l'assistance BondEx.",
    leg: "Étape", dropOff: "Dépôt", pickUp: "Retrait",
    tracking: (c, n) => `Suivi ${c} (${n} ${n === 1 ? "colis" : "colis"})`,
    refreshed: "Le statut est actualisé toutes les heures et peut avoir jusqu'à une heure de retard sur le site du transporteur.",
    recipient: "Destinataire", updated: "Mis à jour", needHelp: "Besoin d'aide ?",
    contact: "Contactez l'assistance BondEx :",
    privacy: "Cette page n'est accessible que par son URL. Merci de ne pas la partager publiquement.",
    status: { pending: "En attente", issued: "Étiquette émise", picked_up: "Collecté", in_transit: "En transit", delivered: "Livré", failed: "Échec", cancelled: "Annulé" },
    steps: ["Émise", "Collecté", "En transit", "Livré"],
  },
  es: {
    title: "Rastrea tu equipaje",
    intro: "El envío de tu equipaje está gestionado por BondEx. A continuación, el estado en vivo de cada tramo. Si algo parece incorrecto, contacta con el soporte de BondEx.",
    leg: "Tramo", dropOff: "Entrega", pickUp: "Recogida",
    tracking: (c, n) => `Seguimiento ${c} (${n} ${n === 1 ? "bulto" : "bultos"})`,
    refreshed: "El estado se actualiza cada hora y puede retrasarse hasta una hora respecto al sitio del transportista.",
    recipient: "Destinatario", updated: "Actualizado", needHelp: "¿Necesitas ayuda?",
    contact: "Contacta con el soporte de BondEx:",
    privacy: "Esta página solo es accesible por su URL. Por favor, no la compartas públicamente.",
    status: { pending: "Pendiente", issued: "Etiqueta emitida", picked_up: "Recogido", in_transit: "En tránsito", delivered: "Entregado", failed: "Fallido", cancelled: "Cancelado" },
    steps: ["Emitida", "Recogido", "En tránsito", "Entregado"],
  },
}

// 配送キャリアの表示名と追跡リンク (キャリア中立)。
const CARRIER_NAME: Record<string, { ja: string; en: string }> = {
  sagawa: { ja: "佐川急便", en: "Sagawa" },
  yamato: { ja: "ヤマト運輸", en: "Yamato" },
}
function carrierName(carrier: string, lang: Lang): string {
  const c = CARRIER_NAME[carrier] ?? CARRIER_NAME.sagawa
  return lang === "ja" ? c.ja : c.en
}
async function fetchTrack(bookingId: string): Promise<TrackData | null> {
  const h = await headers()
  const host = h.get("host") || "localhost:3000"
  const proto = h.get("x-forwarded-proto") || "https"
  const res = await fetch(`${proto}://${host}/api/track/${encodeURIComponent(bookingId)}`, { cache: "no-store" })
  if (!res.ok) return null
  return (await res.json()) as TrackData
}

function formatDate(ymd: string | null): string {
  if (!ymd) return "—"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`
}

export default async function TrackPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>
  searchParams: Promise<{ lang?: string }>
}) {
  const { bookingId } = await params
  const { lang: langParam } = await searchParams
  const data = await fetchTrack(bookingId)
  if (!data) notFound()

  const lang = resolveLang(langParam, data.guestLanguage)
  const tr = L[lang]
  const cName = carrierName(data.carrier, lang)

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-border">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bondex-logo.png" alt="BondEx" className="h-12 w-auto object-contain shrink-0" />
            <div className="border-l border-border pl-3 sm:pl-4 min-w-0">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">{tr.title}</p>
              <h1 className="text-lg font-semibold text-foreground mt-0.5 truncate">{data.bookingId}</h1>
            </div>
          </div>
          {/* 言語切替 */}
          <div className="flex flex-wrap gap-1 justify-end shrink-0">
            {LANGS.map((l) => (
              <a
                key={l}
                href={`?lang=${l}`}
                className={`px-2 py-1 rounded text-[11px] font-medium ${l === lang ? "bg-[#C8102E] text-white" : "text-muted-foreground hover:bg-slate-100"}`}
              >
                {LANG_LABEL[l]}
              </a>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="rounded-2xl border border-border bg-white p-6">
          <p className="text-sm text-muted-foreground leading-relaxed">{tr.intro}</p>
        </div>

        {data.legs.map((leg) => {
          const sk = (leg.status in STATUS_COLOR ? leg.status : "issued") as StatusKey
          return (
            <section key={leg.legIndex} className="rounded-2xl border border-border bg-white overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/40">
                <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium">{tr.leg} {leg.legIndex + 1}</p>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${STATUS_COLOR[sk]}`}>
                  <span>{STATUS_EMOJI[sk]}</span>
                  {tr.status[sk]}
                </span>
              </div>

              <div className="p-6 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-center">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{tr.dropOff}</p>
                    <p className="text-base font-semibold text-foreground">{leg.fromHotel}</p>
                    <p className="text-xs text-muted-foreground mt-1">{formatDate(leg.shipmentDate)}</p>
                  </div>
                  <div className="text-2xl text-muted-foreground text-center">→</div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{tr.pickUp}</p>
                    <p className="text-base font-semibold text-foreground">{leg.toHotel}</p>
                    <p className="text-xs text-muted-foreground mt-1">{formatDate(leg.expectedArrival)}</p>
                  </div>
                </div>

                {leg.tracking.length > 0 && (
                  <div className="pt-4 border-t border-border">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
                      {tr.tracking(cName, leg.tracking.length)}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {leg.tracking.map((t) => (
                        <div key={t.number} className="rounded-lg border border-border p-3">
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <span className="font-mono text-[11px] text-foreground truncate">{t.number}</span>
                            <a
                              href={carrierTrackUrl(data.carrier, t.number)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                            >
                              {cName} ↗
                            </a>
                          </div>
                          <TrackingStepper status={t.status} steps={tr.steps} />
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
                                  <span>{new Date(t.date).toLocaleString(lang === "ja" ? "ja-JP" : "en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground/70 mt-3">{tr.refreshed}</p>
                  </div>
                )}

                <div className="pt-4 border-t border-border flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate">{tr.recipient}: {leg.recipient}</span>
                  <span className="shrink-0">{tr.updated}: {new Date(leg.updatedAt).toLocaleString(lang === "ja" ? "ja-JP" : "en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
                </div>
              </div>
            </section>
          )
        })}

        <div className="rounded-2xl border border-border bg-white p-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-2">{tr.needHelp}</p>
          <p>{tr.contact} <span className="font-mono">support@bondex.express</span></p>
          <p className="text-xs mt-3 text-muted-foreground/80">{tr.privacy}</p>
        </div>
      </div>
    </main>
  )
}
