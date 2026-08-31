import { NextRequest, NextResponse } from "next/server"
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { buildMonthlyInvoice } from "@/lib/invoice-build"
import { sendMail } from "@/lib/mailer"

export const runtime = "nodejs"
// 代理店数に比例して伸びる (1社あたり PDF 生成+メール1〜2通 ≒ 3〜6秒)。20社で120秒に達するため300に (2026-08-31)。
export const maxDuration = 300

/**
 * 月次請求書の自動生成＋送付 (前月分)。毎月1日に GitHub Actions から叩く。
 *
 * 対象: payment_method='invoice' かつ status='active' の代理店で、前月に
 *       発送実績がある先。カード払い (payment_method='card') は集荷完了ごとに
 *       Stripe で個別課金するため対象外。
 *
 * ── 送付先の安全ゲート ──────────────────────────────────────
 *   既定: BondEx 運用 (ALERT_EMAIL) にのみ PDF を送る = 中身を確認して手動転送。
 *   INVOICE_AUTOSEND=true: 代理店の contact_email へも直接自動送信する。
 * 運用初期は既定 (運用が確認) で回し、慣れたらフラグを立てて完全自動化する。
 *
 * 認証は他 cron と同じ CRON_SECRET。
 */

const BONDEX_OPS_EMAIL = process.env.ALERT_EMAIL || "support@bondex.express"

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

    const autosend = process.env.INVOICE_AUTOSEND === "true"

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
      // 代理店の言語設定で出し分け (英語登録の会社には英語で・谷口さん指示)。
      // 添付の適格請求書PDFは日本の税書類のため日本語のまま。
      const en = (ag as { locale?: string | null }).locale === "en"
      const bodyLines = en
        ? [
            `Dear ${ag.name},`,
            "",
            `Please find attached your invoice for ${built.period} (${built.invoiceNumber}).`,
            `Items: ${built.itemCount} / Amount due (tax incl.): ¥${(built.totalYen ?? 0).toLocaleString()}`,
            `Payment due: ${built.dueDate}`,
            "",
            "See the attached PDF for details (a Japanese qualified invoice).",
            "Questions? Contact support@bondex.express.",
            "",
            "— BondEx / JOJO Inc. | support@bondex.express",
          ]
        : [
            `${ag.name} 御中`,
            "",
            `${built.period} のご請求書 (${built.invoiceNumber}) をお送りいたします。`,
            `件数: ${built.itemCount}件 / ご請求金額(税込): ¥${(built.totalYen ?? 0).toLocaleString()}`,
            `お支払期限: ${built.dueDate}`,
            "",
            "詳細は添付の PDF をご確認ください。",
            "ご不明な点は support@bondex.express までお問い合わせください。",
            "",
            "— BondEx ／ 株式会社JOJO ｜ support@bondex.express",
          ]
      const subject = en
        ? `[BondEx] Invoice for ${built.period} (${built.invoiceNumber})`
        : `【BondEx】${built.period} ご請求書（${built.invoiceNumber}）`

      const sentTo: string[] = []
      const errs: string[] = []

      // 運用控えは常に送る (既定はこれのみ)
      {
        const r = await sendMail({
          to: BONDEX_OPS_EMAIL,
          subject: `[控え] ${subject} — ${ag.name}`,
          text: bodyLines.join("\n"),
          attachments,
          replyTo: "support@bondex.express",
        })
        if (r.sent) sentTo.push(BONDEX_OPS_EMAIL)
        else errs.push(`ops: ${r.error}`)
      }

      // AUTOSEND 時のみ代理店へ直接送付
      if (autosend && built.agencyEmail) {
        const r = await sendMail({
          to: built.agencyEmail,
          subject,
          text: bodyLines.join("\n"),
          attachments,
          replyTo: "support@bondex.express",
        })
        if (r.sent) sentTo.push(built.agencyEmail)
        else errs.push(`agency: ${r.error}`)
      }

      // 少なくとも1通送れたら送付済みとして記録する (0通 = 全滅なら記録せず次回再試行)
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
      autosend,
      agenciesChecked: agencies?.length ?? 0,
      invoiced,
      results,
    })

  } finally {
    await releaseCronLock("monthly-invoices")
  }
}
