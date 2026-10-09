import { NextRequest, NextResponse } from "next/server"
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { sendInvoiceToAgency } from "@/lib/invoice-send"
import { isBusinessDay } from "@/lib/business-days"

export const runtime = "nodejs"
export const maxDuration = 300

/**
 * 承認済み月次請求書の「代理店への自動送付」。営業日ごとに GitHub Actions から叩く。
 *
 * 運用 (2026-10-09 谷口さん指示・案A):
 *   月初1営業日 … monthly-invoices が確認依頼を送る → 谷口さんが金額を確認して「承認」。
 *   翌営業日(第2営業日) … このジョブが承認済み・未送付の請求書を代理店へ自動送付する。
 *
 * 送付対象: invoice_sends で approved_at があり sent_to_agency_at が無い行のうち、
 *   approved_at が「今日(JST)の開始」より前のもの。
 *   → 承認した当日には送らず、必ず翌営業日以降に送る (承認=第1営業日 なら送付=第2営業日)。
 *   さらに、代理店が今も payment_method='invoice' / status='active' / billing_exempt でないことを確認する。
 *
 * 認証は他 cron と同じ CRON_SECRET。土日祝は即 return (営業日のみ送付)。
 */

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 })
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const lock = await acquireCronLock("invoice-autosend")
  if (!lock.ok) {
    return NextResponse.json({ ok: true, skipped: "already running" })
  }
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
    }
    const sb = getSupabase()
    if (!sb) return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })

    // 今日(JST)。UTC+9 にずらした値の暦日で営業日判定する。
    const nowJst = new Date(Date.now() + 9 * 3600 * 1000)
    const forceRun = req.nextUrl.searchParams.get("force") === "1" // 検証用 (営業日チェックを飛ばす)
    if (!forceRun && !isBusinessDay(nowJst)) {
      return NextResponse.json({ ok: true, skipped: "not a business day" })
    }

    // 「今日(JST)の開始」の実時刻(UTC)。approved_at がこれより前 = 前営業日以前に承認済み。
    const startOfTodayJstUtcMs =
      Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate()) - 9 * 3600 * 1000
    const startOfTodayIso = new Date(startOfTodayJstUtcMs).toISOString()

    // 承認済み・未送付・前営業日以前に承認、の請求書を引く。
    const { data: pending, error } = await sb
      .from("invoice_sends")
      .select("agency, month, invoice_no, approved_at")
      .not("approved_at", "is", null)
      .is("sent_to_agency_at", null)
      .lt("approved_at", startOfTodayIso)
      .order("approved_at", { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // 送付対象の代理店が今も請求書払い・稼働中か確認するためのマスタ (name → 可否)。
    const { data: agencies } = await sb
      .from("agencies")
      .select("name, payment_method, status, billing_exempt")
    const sendable = new Map<string, boolean>()
    for (const a of agencies ?? []) {
      sendable.set(
        a.name,
        a.payment_method === "invoice" && a.status === "active" && a.billing_exempt !== true,
      )
    }

    const results: Array<{
      agency: string
      month: string
      sent?: boolean
      to?: string
      invoiceNumber?: string
      skipped?: string
      error?: string
    }> = []

    for (const row of pending ?? []) {
      if (!sendable.get(row.agency)) {
        results.push({ agency: row.agency, month: row.month, skipped: "agency not invoice/active" })
        continue
      }
      const r = await sendInvoiceToAgency(sb, row.agency, row.month)
      if (r.ok) {
        results.push({ agency: row.agency, month: row.month, sent: true, to: r.to, invoiceNumber: r.invoiceNumber })
      } else if (r.reason === "already_sent") {
        results.push({ agency: row.agency, month: row.month, skipped: "already sent" })
      } else {
        // no_agency_email / build_failed / send_failed など: 送れずに残す (次営業日に再試行)。
        results.push({ agency: row.agency, month: row.month, error: r.reason, invoiceNumber: r.invoiceNumber })
      }
    }

    const sentCount = results.filter((r) => r.sent).length
    return NextResponse.json({
      ok: true,
      dateJst: `${nowJst.getUTCFullYear()}-${String(nowJst.getUTCMonth() + 1).padStart(2, "0")}-${String(nowJst.getUTCDate()).padStart(2, "0")}`,
      candidates: pending?.length ?? 0,
      sent: sentCount,
      results,
    })
  } finally {
    await releaseCronLock("invoice-autosend")
  }
}
