"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { getBrowserSupabase } from "@/lib/supabase-browser"
import { useAgencyLocale, AgencyLocaleToggle } from "@/lib/agency-i18n"

/**
 * P1-B2 v3.5 Track B｜代理店の増額承認画面。
 * 実集荷個数の確認で請求額が増えた案件だけを出し、代理店本人が承認/問い合わせできる。
 * 金額はサーバー保存値が正本 (画面はそれを表示し、承認時に照合用として送るだけ)。
 * 承認するまで課金・請求はしない。配送は承認待ちで止まらない。
 */

interface Approval {
  shipmentId: string
  bookingRef: string
  state: string
  declaredCount: number | null
  actualCount: number | null
  quotedNetYen: number | null
  quotedGrossYen: number | null
  recalcNetYen: number | null
  recalcGrossYen: number | null
  increaseNetYen: number | null
  increaseGrossYen: number | null
  quoteVersion: number
  expiresAt: string | null
  fromHotel: string | null
  toHotel: string | null
  shipmentDate: string | null
}

const messages = {
  ja: {
    title: "料金変更のご承認",
    intro: "実際の集荷個数の確認により、ご請求額が変わった予約です。承認いただくまで課金・請求はいたしません。配送はこのために止まりません。",
    none: "ご承認が必要な料金変更はありません。",
    booking: "予約番号",
    route: "区間",
    date: "集荷日",
    pieces: "個数（予約→実際）",
    quoted: "予約時料金",
    changed: "変更後料金",
    increase: "増額分",
    taxEx: "税抜",
    taxIn: "税込",
    expires: "ご承認期限",
    noExpire: "期限なし",
    approve: "変更後の料金を承認する",
    contact: "BondExに問い合わせる",
    approved: "承認済み",
    confirm: (ref: string, g: string) => `${ref} の変更後料金 ${g}（税込）を承認します。よろしいですか？`,
    done: "承認しました。ありがとうございます。",
    failed: "承認に失敗しました。時間をおいて再度お試しください。",
    sessionExpired: "セッションの有効期限が切れました。再度ログインしてください。",
    back: "ポータルへ戻る",
  },
  en: {
    title: "Approve price change",
    intro: "These bookings had an amount change after the actual piece count was confirmed. We will not charge or invoice until you approve. Your shipment is not held up by this.",
    none: "No price changes need your approval.",
    booking: "Booking",
    route: "Route",
    date: "Pickup date",
    pieces: "Pieces (reserved → actual)",
    quoted: "Reserved amount",
    changed: "New amount",
    increase: "Increase",
    taxEx: "excl. tax",
    taxIn: "incl. tax",
    expires: "Approve by",
    noExpire: "no deadline",
    approve: "Approve the new amount",
    contact: "Contact BondEx",
    approved: "Approved",
    confirm: (ref: string, g: string) => `Approve the new amount ${g} (incl. tax) for ${ref}?`,
    done: "Approved. Thank you.",
    failed: "Approval failed. Please try again later.",
    sessionExpired: "Your session expired. Please sign in again.",
    back: "Back to portal",
  },
} as const

const yen = (n: number | null | undefined) => (n == null ? "—" : `¥${n.toLocaleString("ja-JP")}`)

export default function AgencyApprovalsPage() {
  const router = useRouter()
  const { locale, setLocale } = useAgencyLocale()
  const t = messages[locale]
  const [ready, setReady] = useState(false)
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const sb = getBrowserSupabase()
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
    if (!token) {
      setNotice(t.sessionExpired)
      return
    }
    const res = await fetch("/api/agency/price-approval", { headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 401) {
      setNotice(t.sessionExpired)
      return
    }
    if (!res.ok) return
    const d = (await res.json()) as { approvals?: Approval[] }
    setApprovals(Array.isArray(d.approvals) ? d.approvals : [])
  }, [t])

  useEffect(() => {
    void (async () => {
      const sb = getBrowserSupabase()
      const session = sb ? (await sb.auth.getSession()).data.session : null
      if (!session) {
        router.replace("/agency/login?next=/agency/approvals")
        return
      }
      setReady(true)
      await load()
    })()
  }, [router, load])

  const approve = useCallback(
    async (a: Approval) => {
      if (!window.confirm(t.confirm(a.bookingRef, yen(a.recalcGrossYen)))) return
      setBusy(a.shipmentId)
      try {
        const sb = getBrowserSupabase()
        const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined
        if (!token) {
          setNotice(t.sessionExpired)
          return
        }
        const res = await fetch("/api/agency/price-approval", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            shipmentId: a.shipmentId,
            quoteVersion: a.quoteVersion,
            decision: "approved",
            expectedRecalcNet: a.recalcNetYen, // サーバーが保存値と照合 (正本はサーバー側)
          }),
        })
        if (res.status === 401) {
          setNotice(t.sessionExpired)
          return
        }
        const d = (await res.json()) as { ok?: boolean }
        setNotice(d.ok ? t.done : t.failed)
        await load()
      } finally {
        setBusy(null)
      }
    },
    [t, load],
  )

  if (!ready) return null

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold" style={{ color: "#C8102E" }}>
              BondEx
            </span>
            <span className="text-sm text-muted-foreground">{t.title}</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/agency" className="text-sm text-muted-foreground hover:text-foreground">
              {t.back}
            </Link>
            <AgencyLocaleToggle locale={locale} onChange={setLocale} />
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4">
        <p className="text-sm text-muted-foreground">{t.intro}</p>
        {notice ? (
          <div className="rounded-lg border border-border bg-white px-4 py-3 text-sm text-foreground">{notice}</div>
        ) : null}

        {approvals.length === 0 ? (
          <div className="rounded-xl border border-border bg-white p-6 text-sm text-muted-foreground">{t.none}</div>
        ) : (
          approvals.map((a) => (
            <section key={a.shipmentId + ":" + a.quoteVersion} className="rounded-xl border border-border bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-foreground">
                  {t.booking}: {a.bookingRef}
                </div>
                {a.state === "approved" ? (
                  <span className="inline-block rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    {t.approved}
                  </span>
                ) : null}
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex justify-between sm:block">
                  <dt className="text-muted-foreground">{t.route}</dt>
                  <dd className="text-foreground">{(a.fromHotel ?? "—") + " → " + (a.toHotel ?? "—")}</dd>
                </div>
                <div className="flex justify-between sm:block">
                  <dt className="text-muted-foreground">{t.date}</dt>
                  <dd className="text-foreground">{a.shipmentDate ?? "—"}</dd>
                </div>
                <div className="flex justify-between sm:block">
                  <dt className="text-muted-foreground">{t.pieces}</dt>
                  <dd className="text-foreground">
                    {a.declaredCount} → {a.actualCount}
                  </dd>
                </div>
                <div className="flex justify-between sm:block">
                  <dt className="text-muted-foreground">{t.expires}</dt>
                  <dd className="text-foreground">{a.expiresAt ?? t.noExpire}</dd>
                </div>
              </dl>

              <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.quoted}</span>
                  <span>
                    {yen(a.quotedGrossYen)} <span className="text-xs text-muted-foreground">({t.taxIn})</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      / {yen(a.quotedNetYen)} ({t.taxEx})
                    </span>
                  </span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-muted-foreground">{t.changed}</span>
                  <span className="font-semibold">
                    {yen(a.recalcGrossYen)} <span className="text-xs font-normal text-muted-foreground">({t.taxIn})</span>{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      / {yen(a.recalcNetYen)} ({t.taxEx})
                    </span>
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-[#C8102E]">
                  <span>{t.increase}</span>
                  <span className="font-semibold">
                    +{yen(a.increaseGrossYen)} <span className="text-xs font-normal">({t.taxIn})</span>
                  </span>
                </div>
              </div>

              {a.state === "approval_pending" ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => void approve(a)}
                    disabled={busy === a.shipmentId}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    style={{ backgroundColor: "#C8102E" }}
                  >
                    {t.approve}
                  </button>
                  <a
                    href={`mailto:support@bondex.express?subject=${encodeURIComponent(a.bookingRef)}`}
                    className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted/40"
                  >
                    {t.contact}
                  </a>
                </div>
              ) : null}
            </section>
          ))
        )}
      </div>
    </main>
  )
}
