import { NextRequest, NextResponse } from "next/server"
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase"
import { buildMonthlyInvoice } from "@/lib/invoice-build"
import { renderInvoiceEmail } from "@/lib/invoice-email"
import { sendInvoiceToAgency } from "@/lib/invoice-send"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 月次請求書の「承認 → 代理店送付」操作 (BondEx 運用のみ — middleware で認証済み)。
 *
 * GET  ?agency=<name>&month=YYYY-MM
 *      請求書の内容 (件数/個数/金額/期限)、代理店あて文面プレビュー、現在の状態
 *      (確認依頼送信済み / 承認済み / 代理店送付済み) を返す。送信はしない。
 *
 * POST { agency, month, action: "approve" | "send" }
 *      approve … 金額を確認したうえでの承認。approved_at を立てる (翌営業日に自動送付対象になる)。
 *      send    … 承認済みのものを今すぐ代理店へ送る (自動送付を待たずに送りたいとき)。
 *
 * カード払い等でそもそも月次請求書を出さない代理店は buildMonthlyInvoice が no_shipments を返すので、
 * UI 側は「対象なし」を表示する。
 */

function badMonth(month: string): boolean {
  return !/^\d{4}-\d{2}$/.test(month)
}

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  }
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })

  const agency = req.nextUrl.searchParams.get("agency")?.trim() || ""
  const month = req.nextUrl.searchParams.get("month")?.trim() || ""
  if (!agency || badMonth(month)) {
    return NextResponse.json({ error: "agency and month (YYYY-MM) are required" }, { status: 400 })
  }

  const built = await buildMonthlyInvoice(sb, agency, month)
  if (!built.ok) {
    // 対象発送なしは正常 (請求書の対象外)。エラーではなく ok:false で返して UI で「対象なし」表示。
    const status = built.reason === "no_shipments" ? 200 : 500
    return NextResponse.json({ ok: false, reason: built.reason, agency, month }, { status })
  }

  const { data: row } = await sb
    .from("invoice_sends")
    .select("invoice_no, created_at, approved_at, approved_by, sent_to_agency_at, sent_to")
    .eq("agency", agency)
    .eq("month", month)
    .maybeSingle()

  const preview = renderInvoiceEmail({
    agencyName: agency,
    contactPerson: built.agencyContactPerson,
    period: built.period ?? month,
    invoiceNumber: built.invoiceNumber ?? "",
    itemCount: built.itemCount ?? 0,
    pieceCount: built.pieceCount ?? 0,
    totalYen: built.totalYen ?? 0,
    dueDate: built.dueDate ?? "",
    locale: built.locale ?? "ja",
  })

  return NextResponse.json({
    ok: true,
    agency,
    month,
    invoiceNumber: built.invoiceNumber,
    period: built.period,
    dueDate: built.dueDate,
    itemCount: built.itemCount,
    pieceCount: built.pieceCount,
    totalYen: built.totalYen,
    agencyEmail: built.agencyEmail,
    agencyContactPerson: built.agencyContactPerson,
    locale: built.locale,
    subject: preview.subject,
    body: preview.body,
    state: {
      confirmationSentAt: row?.created_at ?? null,
      approvedAt: row?.approved_at ?? null,
      approvedBy: row?.approved_by ?? null,
      sentToAgencyAt: row?.sent_to_agency_at ?? null,
      sentTo: row?.sent_to ?? [],
    },
  })
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
  }
  const sb = getSupabase()
  if (!sb) return NextResponse.json({ error: "Supabase client unavailable" }, { status: 500 })

  const body = (await req.json().catch(() => ({}))) as {
    agency?: string
    month?: string
    action?: string
  }
  const agency = body.agency?.trim() || ""
  const month = body.month?.trim() || ""
  const action = body.action?.trim() || ""
  if (!agency || badMonth(month)) {
    return NextResponse.json({ error: "agency and month (YYYY-MM) are required" }, { status: 400 })
  }

  if (action === "approve") {
    // 承認前に請求書を一度組み立て、請求書番号を得る (発送実績の有無もここで確定する)。
    const built = await buildMonthlyInvoice(sb, agency, month)
    if (!built.ok) {
      const status = built.reason === "no_shipments" ? 400 : 500
      return NextResponse.json({ ok: false, reason: built.reason }, { status })
    }

    const { data: row } = await sb
      .from("invoice_sends")
      .select("approved_at, sent_to_agency_at")
      .eq("agency", agency)
      .eq("month", month)
      .maybeSingle()

    if (row?.sent_to_agency_at) {
      return NextResponse.json({ ok: false, reason: "already_sent" }, { status: 409 })
    }
    if (row?.approved_at) {
      return NextResponse.json({ ok: true, alreadyApproved: true, approvedAt: row.approved_at })
    }

    const now = new Date().toISOString()
    if (row) {
      const upd = await sb
        .from("invoice_sends")
        .update({ approved_at: now, approved_by: "operator" })
        .eq("agency", agency)
        .eq("month", month)
        .is("sent_to_agency_at", null)
      if (upd.error) return NextResponse.json({ ok: false, error: upd.error.message }, { status: 500 })
    } else {
      // 確認依頼 cron より先に承認した場合などで行が無ければ作る。
      const ins = await sb.from("invoice_sends").insert({
        agency,
        month,
        invoice_no: built.invoiceNumber ?? null,
        sent_to: [],
        approved_at: now,
        approved_by: "operator",
      })
      if (ins.error) return NextResponse.json({ ok: false, error: ins.error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, approvedAt: now, invoiceNumber: built.invoiceNumber })
  }

  if (action === "send") {
    // 承認済みのものを今すぐ代理店へ送る (未承認なら not_approved で弾かれる)。
    const r = await sendInvoiceToAgency(sb, agency, month)
    const status = r.ok
      ? 200
      : r.reason === "not_approved" || r.reason === "already_sent"
        ? 409
        : r.reason === "no_agency_email" || r.reason === "no_shipments"
          ? 400
          : 500
    return NextResponse.json(r, { status })
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
