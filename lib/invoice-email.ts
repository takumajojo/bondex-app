/**
 * 代理店あて「月次請求書」メールの件名・本文を組み立てる単一ソース。
 *
 * 数値 (件数・個数・金額・期限・期間) はすべて buildMonthlyInvoice (= PDF と同じ単一ソース)
 * から渡ってきた値をそのまま使う。ここで再計算しない — 本文の数字と添付 PDF の数字が
 * 食い違わないようにするため (2026-10-09 谷口さん要件)。
 *
 * 宛名は会社名ベース (担当者名は勝手に作らない)。contactPerson が登録されていれば添える。
 */

export interface InvoiceEmailInput {
  agencyName: string
  contactPerson?: string | null
  period: string // 例: "2026年9月分" / "September 2026" (buildMonthlyInvoice の整形済み文字列)
  invoiceNumber: string
  itemCount: number // 件数 (区間数)
  pieceCount: number // 個数 (スーツケース合計)
  totalYen: number // 請求総額 (税込・円)
  dueDate: string // 例: "2026年10月31日" / "Oct 31, 2026" (整形済み)
  locale: "ja" | "en"
}

/** 3桁区切りの金額文字列 ("32,868")。 */
function yen(n: number): string {
  return (n ?? 0).toLocaleString("en-US")
}

export function renderInvoiceEmail(input: InvoiceEmailInput): { subject: string; body: string } {
  const { agencyName, contactPerson, period, invoiceNumber, itemCount, pieceCount, totalYen, dueDate, locale } =
    input

  if (locale === "en") {
    const greeting = contactPerson ? `Dear ${contactPerson},` : `Dear ${agencyName},`
    const subject = `[BondEx] Invoice for ${period} (${invoiceNumber})`
    const body = [
      greeting,
      "",
      `Please find attached your invoice for ${period} (${invoiceNumber}).`,
      `Items: ${itemCount} (${pieceCount} pieces) / Amount due (tax incl.): JPY ${yen(totalYen)}`,
      `Payment due: ${dueDate}`,
      "",
      "See the attached PDF for details (a qualified invoice under Japanese consumption tax law).",
      "Questions? Contact support@bondex.express.",
      "",
      "— BondEx / JOJO Inc. | support@bondex.express",
    ].join("\n")
    return { subject, body }
  }

  const greeting = contactPerson ? `${agencyName}\n${contactPerson} 様` : `${agencyName} 御中`
  const subject = `【BondEx】${period} ご請求書（${invoiceNumber}）`
  const body = [
    greeting,
    "",
    `${period} のご請求書 (${invoiceNumber}) をお送りいたします。`,
    `件数: ${itemCount}件（${pieceCount}個） / ご請求金額(税込): ${yen(totalYen)}円`,
    `お支払期限: ${dueDate}`,
    "",
    "詳細は添付の PDF をご確認ください。",
    "ご不明な点は support@bondex.express までお問い合わせください。",
    "",
    "— BondEx ／ 株式会社JOJO ｜ support@bondex.express",
  ].join("\n")
  return { subject, body }
}
