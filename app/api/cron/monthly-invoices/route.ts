import { NextRequest, NextResponse } from "next/server"
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { buildMonthlyInvoice } from "@/lib/invoice-build"
import { renderInvoiceEmail } from "@/lib/invoice-email"
import { sendMail } from "@/lib/mailer"

export const runtime = "nodejs"
// 代理店数に比例して伸びる (1社あたり PDF 生成+メール1〜2通 ≒ 3〜6秒)。20社で120秒に達するため300に (2026-08-31)。
export const maxDuration = 300

/**
 * 月次請求書の自動生成＋確認依頼 (前月分)。毎月1日に GitHub Actions から叩く。
 *
 * 対象: payment_method='invoice' かつ status='active' の代理店で、前月に
 *       発送実績がある先。カード払い (payment_method='card') は集荷完了ごとに
 *       Stripe で個別課金するため対象外。
 *
 * ── 代理店へはここでは送らない (承認制) ──────────────────────
 *   このジョブは PDF を生成し、谷口さんへ「請求書 確認依頼 (要承認)」として送るだけ。
 *   谷口さんが金額を確認してダッシュボードで「承認」すると、翌営業日(第2営業日)に
 *   別ジョブ cron/invoice-autosend が代理店へ自動送付する (2026-10-09 谷口さん指示)。
 *   → 「月初1営業日に請求書を確認・承認 → 第2営業日に送付」の運用。承認しない限り送られない。
 *
 * 認証は他 cron と同じ CRON_SECRET。
 */

const BONDEX_OPS_EMAIL = process.env.ALERT_EMAIL || "support@bondex.express"
const SITE_URL = process.env.APP_BASE_URL?.replace(/\/+$/, "") || "https://bondex.express"

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 })
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // 二重起動ロック (GitHub Actions の誤判定リトライ対策・2026-08-31 監査対応)。
  const lock = await acquireCronLock("monthly-invoices")
  if (!lock.ok) {
    return NextResponse.json({ ok: true, skipped: "already running" })
  }
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
    }
    const sb = getSupabase()
    if (!sb) {
      return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })
    }

    // 前月 (JST 基準) を YYYY-MM で求める。?month=YYYY-MM で明示指定も可 (再送・検証用)。
    const override = req.nextUrl.searchParams.get("month")?.trim()
    let targetMonth: string
    if (override && /^\d{4}-\d{2}$/.test(override)) {
      targetMonth = override
    } else {
      const nowJst = new Date(Date.now() + 9 * 3600 * 1000)
      const prev = new Date(Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth() - 1, 1))
      targetMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`
    }

    // 対象代理店: 請求書払い & 稼働中。テスト代理店 (billing_exempt) は請求しない。
    const { data: agencies, error } = await sb
      .from("agencies")
      .select("name, contact_email, payment_method, status, locale")
      .eq("payment_method", "invoice")
      .eq("status", "active")
      .neq("billing_exempt", true)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const results: Array<{
      agency: string
      itemCount?: number
      totalYen?: number
      invoiceNumber?: string
      sentTo: string[]
      skipped?: string
      error?: string
    }> = []

    for (const ag of agencies ?? []) {
      // 送付済みマーカー (2026-08-31 監査対応): 途中タイムアウト → GH Actions の再実行で
      // 先頭から回り直しても、送付済みの代理店に請求書メールを二重送付しない。
      const already = await sb
        .from("invoice_sends")
        .select("invoice_no")
        .eq("agency", ag.name)
        .eq("month", targetMonth)
        .maybeSingle()
      if (already.data) {
        results.push({ agency: ag.name, sentTo: [], skipped: `sent already (${already.data.invoice_no ?? "recorded"})` })
        continue
      }

      const built = await buildMonthlyInvoice(sb, ag.name, targetMonth)
      if (!built.ok || !built.buffer) {
        // 発送実績なしは正常なスキップ
        results.push({ agency: ag.name, sentTo: [], skipped: built.reason })
        continue
      }

      const attachments = [
        { filename: built.fileName!, contentBase64: built.buffer.toString("base64") },
      ]
      // 代理店あての文面プレビュー (実際に第2営業日へ送られるのと同じ単一ソース・件数/個数入り)。
      const preview = renderInvoiceEmail({
        agencyName: ag.name,
        contactPerson: built.agencyContactPerson,
        period: built.period ?? targetMonth,
        invoiceNumber: built.invoiceNumber ?? "",
        itemCount: built.itemCount ?? 0,
        pieceCount: built.pieceCount ?? 0,
        totalYen: built.totalYen ?? 0,
        dueDate: built.dueDate ?? "",
        locale: built.locale ?? "ja",
      })

      const sentTo: string[] = []
      const errs: string[] = []

      // 谷口さんへ「請求書 確認依頼 (要承認)」として送る。代理店へはここでは送らない。
      // 金額を確認し、ダッシュボードで「承認」すると翌営業日に invoice-autosend が代理店へ送付する。
      {
        const r = await sendMail({
          to: BONDEX_OPS_EMAIL,
          subject: `【請求書 確認依頼・要承認】${built.period} ${ag.name}（${built.invoiceNumber}）`,
          text: [
            `${ag.name} の ${built.period} 請求書です。金額をご確認ください。`,
            "",
            `件数: ${built.itemCount}件（${built.pieceCount}個）`,
            `ご請求金額(税込): ${(built.totalYen ?? 0).toLocaleString("en-US")}円`,
            `お支払期限: ${built.dueDate}`,
            `代理店送付先: ${built.agencyEmail ?? "(メールアドレス未登録 — 要登録)"}`,
            "",
            "── ご対応 ─────────────────────────────",
            "添付 PDF の金額をご確認のうえ、問題なければダッシュボードで「承認」してください。",
            "承認すると翌営業日(第2営業日)に、下記の文面で代理店へ自動送付されます。",
            "承認されない限り代理店へは送られません。",
            `ダッシュボード: ${SITE_URL}/operator/dashboard`,
            "",
            "──────── 以下、承認後に代理店へ送られる文面 ────────",
            "",
            `件名: ${preview.subject}`,
            "",
            preview.body,
          ].join("\n"),
          attachments,
          replyTo: "support@bondex.express",
        })
        if (r.sent) sentTo.push(BONDEX_OPS_EMAIL)
        else errs.push(`ops: ${r.error}`)
      }

      // 確認依頼を送れたら記録する (二重送付防止。送れなければ記録せず次回再試行)
      if (sentTo.length > 0) {
        const mark = await sb.from("invoice_sends").insert({
          agency: ag.name,
          month: targetMonth,
          invoice_no: built.invoiceNumber ?? null,
          sent_to: sentTo,
        })
        if (mark.error) console.error("[monthly-invoices] send marker failed:", mark.error.message)
      }

      results.push({
        agency: ag.name,
        itemCount: built.itemCount,
        totalYen: built.totalYen,
        invoiceNumber: built.invoiceNumber,
        sentTo,
        error: errs.length ? errs.join("; ") : undefined,
      })
    }

    const invoiced = results.filter((r) => r.invoiceNumber).length
    return NextResponse.json({
      month: targetMonth,
      agenciesChecked: agencies?.length ?? 0,
      invoiced,
      results,
    })

  } finally {
    await releaseCronLock("monthly-invoices")
  }
}
