import { getSupabase } from "./supabase"
import { regenerateVoucherPdf } from "./voucher-regen"
import type { MailAttachment } from "./mailer"

/**
 * バウチャーPDF(How to ship ガイド同梱)を メール添付形式で取得する (best-effort)。
 * 2026-09-30〜: 佐川伝票が不要になったため、新規依頼・変更時はバウチャーPDFをメール添付する
 * (従来は Google Drive 共有)。生成できない場合は null を返し、呼び出し側は
 * 「添付なしで送信を続ける」= メール送信自体は止めない。
 */
export async function voucherAttachment(
  bookingId: string,
  opts?: { expectedAgency?: string },
): Promise<MailAttachment | null> {
  const sb = getSupabase()
  if (!sb) return null
  try {
    const outcome = await regenerateVoucherPdf(sb, bookingId, {
      expectedAgency: opts?.expectedAgency,
      includeHowto: true,
    })
    if (!outcome.ok) return null
    return { filename: outcome.fileName, contentBase64: Buffer.from(outcome.buf).toString("base64") }
  } catch (e) {
    console.error("[voucher-attachment] 生成失敗:", bookingId, e instanceof Error ? e.message : e)
    return null
  }
}
