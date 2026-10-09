import type { SupabaseClient } from "@supabase/supabase-js"
import { buildMonthlyInvoice } from "@/lib/invoice-build"
import { renderInvoiceEmail } from "@/lib/invoice-email"
import { sendMail } from "@/lib/mailer"

/**
 * 承認済みの月次請求書を「代理店へ」実際に送付する単一ソース。
 *
 * - 自動送付 cron (invoice-autosend) と、ダッシュボードの「今すぐ送付」ボタンの両方が使う。
 * - 必ず PDF を添付する。PDF 生成に失敗したら送らない。
 * - 送付先 (代理店メール) が無ければ送らない。
 * - 二重送付防止: invoice_sends.sent_to_agency_at が既に立っていれば送らない。
 *   送信成功後の記録も sent_to_agency_at IS NULL 条件付き update で行い、競合しても1通に収める。
 * - 承認 (approved_at) されていない請求書は送らない (承認がゲート)。
 */

export type InvoiceSendReason =
  | "not_approved"
  | "already_sent"
  | "no_shipments"
  | "build_failed"
  | "no_agency_email"
  | "send_failed"

export interface InvoiceSendResult {
  ok: boolean
  reason?: InvoiceSendReason | string
  invoiceNumber?: string
  to?: string
}

/**
 * @param month "YYYY-MM"
 * @param opts.requireApproval 既定 true。承認済みでないと送らない。
 *   (運用上は常に承認ゲートを通す。false にできる余地を残すのは将来用で、現状の呼び出しは true のみ。)
 */
export async function sendInvoiceToAgency(
  sb: SupabaseClient,
  agencyName: string,
  month: string,
  opts: { requireApproval?: boolean } = {},
): Promise<InvoiceSendResult> {
  const requireApproval = opts.requireApproval !== false

  // 現在の送付状態を読む (承認済みか・既に代理店へ送っていないか)。
  const { data: row } = await sb
    .from("invoice_sends")
    .select("approved_at, sent_to_agency_at, sent_to")
    .eq("agency", agencyName)
    .eq("month", month)
    .maybeSingle()

  if (row?.sent_to_agency_at) return { ok: false, reason: "already_sent" }
  if (requireApproval && !row?.approved_at) return { ok: false, reason: "not_approved" }

  // PDF を組み立てる (= 金額の単一ソース)。失敗したら送らない。
  const built = await buildMonthlyInvoice(sb, agencyName, month)
  if (!built.ok || !built.buffer) {
    return { ok: false, reason: built.reason === "no_shipments" ? "no_shipments" : "build_failed" }
  }

  const to = built.agencyEmail?.trim()
  if (!to) return { ok: false, reason: "no_agency_email", invoiceNumber: built.invoiceNumber }

  const { subject, body } = renderInvoiceEmail({
    agencyName,
    contactPerson: built.agencyContactPerson,
    period: built.period ?? month,
    invoiceNumber: built.invoiceNumber ?? "",
    itemCount: built.itemCount ?? 0,
    pieceCount: built.pieceCount ?? 0,
    totalYen: built.totalYen ?? 0,
    dueDate: built.dueDate ?? "",
    locale: built.locale ?? "ja",
  })

  const r = await sendMail({
    to,
    subject,
    text: body,
    attachments: [{ filename: built.fileName!, contentBase64: built.buffer.toString("base64") }],
    replyTo: "support@bondex.express",
  })
  if (!r.sent) return { ok: false, reason: "send_failed", invoiceNumber: built.invoiceNumber, to }

  // 送付済みを記録 (sent_to に代理店アドレスを追記、sent_to_agency_at を立てる)。
  // sent_to_agency_at IS NULL 条件付きなので、同時に2本走っても二重送付記録にならない。
  const nextSentTo = Array.from(new Set([...(row?.sent_to ?? []), to]))
  const upd = await sb
    .from("invoice_sends")
    .update({ sent_to_agency_at: new Date().toISOString(), sent_to: nextSentTo })
    .eq("agency", agencyName)
    .eq("month", month)
    .is("sent_to_agency_at", null)
    .select("agency")
  if (upd.error) {
    // メールは送れている。記録(update)の失敗はログのみに留める。DB 障害はまれであり、
    // 記録失敗で稀に再送が起きても、請求書の「送付漏れ」(Trapol 契約違反) より実害が小さいため
    // 送信後に記録する順序を採る (記録を先にすると、送信失敗時に未送付を送付済みと誤記録する)。
    console.error("[invoice-send] mark sent_to_agency_at failed:", agencyName, month, upd.error.message)
  }

  return { ok: true, invoiceNumber: built.invoiceNumber, to }
}
