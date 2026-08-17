import { NextRequest, NextResponse } from "next/server"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { buildMonthlyInvoice } from "@/lib/invoice-build"
import { sendMail } from "@/lib/mailer"

export const runtime = "nodejs"
export const maxDuration = 120

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
    .select("name, contact_email, payment_method, status")
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
    const built = await buildMonthlyInvoice(sb, ag.name, targetMonth)
    if (!built.ok || !built.buffer) {
      // 発送実績なしは正常なスキップ
      results.push({ agency: ag.name, sentTo: [], skipped: built.reason })
      continue
    }

    const attachments = [
      { filename: built.fileName!, contentBase64: built.buffer.toString("base64") },
    ]
    const bodyLines = [
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
    const subject = `【BondEx】${built.period} ご請求書（${built.invoiceNumber}）`

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
}
