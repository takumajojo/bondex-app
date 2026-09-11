/* eslint-disable @next/next/no-img-element */
import React from "react"
import path from "path"
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Font,
} from "@react-pdf/renderer"

// ---------------------------------------------------------------------------
// Fonts (voucher-pdf.tsx と同じ Noto Sans JP)
// ---------------------------------------------------------------------------

const FONT_DIR = path.join(process.cwd(), "public", "fonts")
const LOGO_PATH = path.join(process.cwd(), "public", "bondex-logo.png")

try {
  Font.register({
    family: "NotoSansJP",
    fonts: [
      { src: path.join(FONT_DIR, "NotoSansJP-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "NotoSansJP-Medium.ttf"), fontWeight: 500 },
    ],
  })
} catch {
  // フォント未配置時は Helvetica fallback
}

// 日本語に英語流のハイフネーションを効かせない (「ご査収-のほど」のような不自然な
// 行末ハイフン改行を防ぐ)。単語をそのまま1要素で返す。
Font.registerHyphenationCallback((word) => [word])

// NotoSansJP は Latin Extended-A (Ō 等のマクロン付き文字) を含まないため、
// voucher-pdf.tsx と同様にサニタイズしてから描画する。
function safeText(input?: string | null): string {
  if (!input) return ""
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InvoiceLineItem {
  shipmentDate: string  // YYYY-MM-DD
  bookingRef: string    // BDX-XXX-L1
  /** Travel agency's own tour/booking number. Preferred over bookingRef when
   *  present — this is what the agency actually reconciles against. */
  tourNumber?: string
  fromHotel: string
  toHotel: string
  representative: string
  suitcaseCount: number
  amountYen: number
}

export interface InvoiceInput {
  invoiceNumber: string    // INV-2026-07-001
  issuedDate: string       // 2026年7月1日
  period: string           // 2026年6月分
  closingDate?: string     // 2026年7月末日 (締日)
  dueDate: string          // 2026年8月20日 (支払期限)
  agency: {
    name: string
    contactPerson?: string
    billingAddress?: string
  }
  bondex: {
    companyName: string    // 株式会社JOJO
    address: string        // 〒158-0092 東京都世田谷区野毛1-9-12
    email: string
    bankInfo: string       // 三菱UFJ銀行 ◯◯支店 普通 1234567 カ）ジョジョ
    registrationNumber?: string  // 適格請求書発行事業者登録番号 (任意)
  }
  items: InvoiceLineItem[]
  taxRate?: number         // デフォルト 0.10 (10%)
  /**
   * true のとき items.amountYen を「税込」金額として扱う (内税表示)。
   * (旧仕様。BondEx の料金は 2026-08-28 に税抜へ改定したため本番では false を使う)
   * 合計 = 小計、消費税は内数として按分表示する。
   * false (既定) は従来どおり税抜 → 税を上乗せ (外税)。
   */
  taxInclusive?: boolean
  /**
   * 海外事業者など消費税の対象外のとき true。合計＝小計 (税を上乗せせず、税欄は「対象外」)。
   */
  taxExempt?: boolean
  /**
   * 表示言語。"en" のとき日本フォーマット (レイアウト・体裁) を保ったままラベル・文面を
   * 英語化する。既定 "ja"。金額・税の計算ロジックは locale に依存しない
   * (消費税の有無は taxExempt が単独で決める)。
   */
  locale?: "ja" | "en"
  /**
   * カード決済など「支払い済み」の場合に指定。指定時は本書を
   * 「請求書 兼 領収書」として扱い、振込先ブロックの代わりに
   * 領収 (お支払い済み) ブロックを表示する。
   */
  paid?: {
    method: string      // 例: "クレジットカード"
    date: string        // 例: "2026年8月5日"
    reference?: string  // 例: Stripe PaymentIntent ID
  }
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function formatJpDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  return `${Number(m[1])}/${Number(m[2])}/${Number(m[3])}`
}

/**
 * 区間 (発→着) を明細1行に収める。長い施設名は「…」で省略し、行折り返しによる
 * 行高の増大を防ぐ (代理店はツアー番号で照合するため詳細名は省略可)。
 */
function routeLabel(from?: string | null, to?: string | null): string {
  const MAX = 34
  const s = `${safeText(from)} → ${safeText(to)}`
  return s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const C_FG = "#0F0F0F"
const C_MUTED = "#7A7A7A"
const C_HAIRLINE = "#E5E5E5"
const C_BG_SOFT = "#F8F8F8"

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 50,
    paddingHorizontal: 44,
    fontFamily: "NotoSansJP",
    fontSize: 10,
    color: C_FG,
    backgroundColor: "#FFFFFF",
    lineHeight: 1.5,
  },
  // Header
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  headerLeft: { flexDirection: "column" },
  headerRight: { flexDirection: "column", alignItems: "flex-end" },
  // 実ロゴは 1255×254 (約4.94:1)。枠の縦横比を実寸に合わせて歪みを防ぐ。
  logo: { width: 108, height: 22, marginBottom: 8 },
  title: {
    fontSize: 21,
    fontWeight: 500,
    color: C_FG,
    letterSpacing: 1,
  },
  invoiceMeta: {
    fontSize: 9,
    color: C_MUTED,
    textAlign: "right",
    lineHeight: 1.6,
  },
  invoiceNumber: {
    fontSize: 11,
    color: C_FG,
    fontWeight: 500,
    marginTop: 2,
  },
  topRule: {
    height: 2,
    backgroundColor: C_FG,
    marginTop: 6,
    marginBottom: 14,
  },
  // Agency / billing block
  toBlock: {
    marginBottom: 12,
  },
  toLabel: {
    fontSize: 9,
    color: C_MUTED,
    letterSpacing: 2,
    marginBottom: 4,
  },
  toName: {
    fontSize: 16,
    fontWeight: 500,
    color: C_FG,
  },
  toMeta: {
    fontSize: 9,
    color: C_MUTED,
    marginTop: 4,
    lineHeight: 1.5,
  },
  // Summary box
  summaryBox: {
    backgroundColor: C_BG_SOFT,
    borderRadius: 6,
    padding: 12,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  summaryCol: { flexDirection: "column" },
  summaryLabel: {
    fontSize: 8,
    color: C_MUTED,
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 12,
    fontWeight: 500,
    color: C_FG,
  },
  summaryTotal: {
    fontSize: 22,
    fontWeight: 500,
    color: C_FG,
    letterSpacing: -0.3,
  },
  // Line items
  tableHeading: {
    fontSize: 9,
    color: C_MUTED,
    letterSpacing: 1.5,
  },
  itemsHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: 2,
    marginBottom: 4,
  },
  itemsCount: {
    fontSize: 9,
    color: C_MUTED,
  },
  tableHead: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: C_FG,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 3.5,
    borderBottomWidth: 0.5,
    borderBottomColor: C_HAIRLINE,
  },
  th: {
    fontSize: 8.5,
    fontWeight: 500,
    color: C_MUTED,
    letterSpacing: 0.5,
  },
  td: {
    fontSize: 9.5,
    color: C_FG,
  },
  // column widths
  col_date: { width: 60 },
  col_ref: { width: 90 },
  col_route: { flex: 1 },
  col_rep: { width: 90 },
  col_qty: { width: 32, textAlign: "right" as const },
  col_amt: { width: 70, textAlign: "right" as const },
  // Total block
  totalsBlock: {
    marginTop: 14,
    alignSelf: "flex-end",
    width: 260,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  totalLabel: {
    fontSize: 9.5,
    color: C_MUTED,
  },
  totalValue: {
    fontSize: 9.5,
    color: C_FG,
    fontWeight: 500,
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: C_FG,
    borderBottomWidth: 2,
    borderBottomColor: C_FG,
  },
  grandTotalLabel: {
    fontSize: 11,
    fontWeight: 500,
  },
  grandTotalValue: {
    fontSize: 16,
    fontWeight: 500,
  },
  // Bank info — 構造化テーブル風
  bankBlock: {
    marginTop: 10,
    padding: 10,
    backgroundColor: C_BG_SOFT,
    borderLeftWidth: 3,
    borderLeftColor: C_FG,
  },
  bankHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 10,
  },
  bankLabel: {
    fontSize: 8,
    color: C_MUTED,
    letterSpacing: 2,
  },
  bankDueLabel: {
    fontSize: 8,
    color: C_MUTED,
    letterSpacing: 1.5,
  },
  bankDueValue: {
    fontSize: 10,
    color: C_FG,
    fontWeight: 500,
    marginLeft: 6,
  },
  bankGrid: {
    flexDirection: "row",
  },
  bankCol: {
    flexDirection: "column",
    paddingRight: 12,
  },
  bankFieldLabel: {
    fontSize: 7.5,
    color: C_MUTED,
    letterSpacing: 1,
    marginBottom: 2,
  },
  bankFieldValue: {
    fontSize: 10,
    color: C_FG,
    fontWeight: 500,
    marginBottom: 3,
  },
  bankNote: {
    fontSize: 8,
    color: C_MUTED,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: C_HAIRLINE,
  },
  // 領収 (お支払い済み) ブロック
  paidBlock: {
    marginTop: 14,
    padding: 12,
    backgroundColor: "#F1F7F2",
    borderLeftWidth: 3,
    borderLeftColor: "#2E7D32",
  },
  paidStamp: {
    fontSize: 11,
    fontWeight: 500,
    color: "#2E7D32",
    letterSpacing: 1,
  },
  // Formal greeting (請求書の上)
  greeting: {
    fontSize: 9.5,
    color: C_FG,
    lineHeight: 1.5,
    marginBottom: 10,
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 22,
    left: 44,
    right: 44,
    borderTopWidth: 0.5,
    borderTopColor: C_HAIRLINE,
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerLeft: {},
  footerCompany: {
    fontSize: 9,
    fontWeight: 500,
    color: C_FG,
  },
  footerLine: {
    fontSize: 7.5,
    color: C_MUTED,
    lineHeight: 1.4,
  },
  footerPage: {
    fontSize: 7.5,
    color: C_MUTED,
  },
})

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// i18n — 日本フォーマットを保ったままラベル/文面のみ差し替える。
// ---------------------------------------------------------------------------

function invoiceLabels(en: boolean) {
  return {
    titlePlain: en ? "INVOICE" : "請 求 書",
    titlePaid: en ? "INVOICE & RECEIPT" : "請求書 兼 領収書",
    invoiceNo: "INVOICE NO.", // ラテン表記で共通
    issueDate: en ? "Issue date" : "発行日",
    period: en ? "Period" : "対象期間",
    paymentDate: en ? "Payment date" : "決済日",
    closingDate: en ? "Closing date" : "締日",
    paymentDue: en ? "Payment due" : "お支払期限",
    billTo: "BILL TO", // ラテン表記で共通
    honorific: en ? "" : " 御中", // 宛名の敬称 (英語は無し)
    attn: en ? "Attn: " : "ご担当: ",
    attnSuffix: en ? "" : " 様",
    greeting: en
      ? "Thank you for your continued business. Please find the details of our invoice below."
      : "平素は格別のお引き立てを賜り、誠にありがとうございます。下記の通りご請求申し上げます。",
    itemsHeading: en ? "Details · BondEx Luggage Forwarding" : "明細 ・ BondEx Luggage Forwarding",
    itemsCount: (n: number, s: number) => (en ? `${n} items / ${s} pcs` : `${n} 件 / ${s} 個`),
    thDate: en ? "Ship date" : "発送日",
    thRef: en ? "Tour no." : "ツアー番号",
    thRoute: en ? "Route" : "区間",
    thRep: en ? "Traveler" : "代表者",
    thQty: en ? "Qty" : "個数",
    thAmt: (inclusive: boolean) =>
      en ? (inclusive ? "Amount (incl. tax)" : "Amount (excl. tax)") : inclusive ? "金額 (税込)" : "金額 (税抜)",
    // Totals
    netExcl: en ? "Amount (excl. tax)" : "税抜金額",
    inclTax: (rate: number) => (en ? `incl. Consumption tax (${rate}%)` : `内 消費税 (${rate}%)`),
    totalIncl: en ? "Total (incl. tax)" : "合計 (税込)",
    subtotal: en ? "Subtotal" : "小計",
    consumptionTax: (rate: number, exempt: boolean) =>
      en
        ? exempt
          ? "Consumption tax"
          : `Consumption tax (${rate}%)`
        : exempt
          ? "消費税"
          : `消費税 (${rate}%)`,
    notApplicable: en ? "Not applicable" : "対象外",
    total: en ? "Total" : "合計",
    // Bank
    bankLabel: en ? "BANK DETAILS" : "お振込先 / BANK INFO",
    bankDueLabel: en ? "Payment due" : "お支払期限",
    bankFieldBank: en ? "Bank" : "銀行名",
    bankFieldBranch: en ? "Branch" : "支店",
    bankFieldAccount: en ? "Account" : "口座",
    bankFieldHolder: en ? "Account name" : "口座名義",
    bankNote: en
      ? "Bank transfer fees are to be borne by the payer. If payment by the due date is difficult, please contact us in advance."
      : "・お振込手数料は貴社にてご負担をお願い申し上げます。お支払期限までにお手続きが難しい場合は事前にご連絡ください。",
    // Paid
    paidLabel: en ? "PAYMENT / PAID" : "お支払い状況 / PAID",
    paidStamp: en ? "PAID" : "お支払い済み",
    paidMethod: en ? "Method" : "お支払い方法",
    paidOn: en ? "Paid on" : "決済日",
    paidRef: en ? "Reference" : "決済番号",
    paidNote: en
      ? "Received in full by credit card. This document serves as both a qualified invoice and a receipt."
      : "上記の金額を、クレジットカードにて領収いたしました。\n本書は適格請求書 兼 領収書としてご利用いただけます。",
    // Footer
    regNo: en ? "Qualified Invoice Issuer Reg. No." : "適格請求書発行事業者登録番号",
  }
}

/**
 * "三菱UFJ銀行 田園調布駅前支店 普通 0145653 株式会社JOJO" 形式の文字列を
 * 銀行名 / 支店 / 預金種別+口座番号 / 名義 に分解して 4 セルで表示する.
 */
function parseBankInfo(raw: string, L: ReturnType<typeof invoiceLabels>): React.JSX.Element {
  // スペース区切りで最大 5 要素 (銀行 支店 種別 番号 名義...)
  const parts = raw.split(/\s+/).filter(Boolean)
  const bank = parts[0] || ""
  const branch = parts[1] || ""
  const type = parts[2] || ""
  const num = parts[3] || ""
  const holder = parts.slice(4).join(" ") || ""

  return (
    <View style={styles.bankGrid}>
      <View style={[styles.bankCol, { width: 110 }]}>
        <Text style={styles.bankFieldLabel}>{L.bankFieldBank}</Text>
        <Text style={styles.bankFieldValue}>{bank}</Text>
      </View>
      <View style={[styles.bankCol, { width: 110 }]}>
        <Text style={styles.bankFieldLabel}>{L.bankFieldBranch}</Text>
        <Text style={styles.bankFieldValue}>{branch}</Text>
      </View>
      <View style={[styles.bankCol, { width: 140 }]}>
        <Text style={styles.bankFieldLabel}>{L.bankFieldAccount}</Text>
        <Text style={styles.bankFieldValue}>{type}　{num}</Text>
      </View>
      <View style={[styles.bankCol, { flex: 1 }]}>
        <Text style={styles.bankFieldLabel}>{L.bankFieldHolder}</Text>
        <Text style={styles.bankFieldValue}>{holder}</Text>
      </View>
    </View>
  )
}

export function InvoiceDocument({ data }: { data: InvoiceInput }) {
  const taxRate = data.taxRate ?? 0.10
  const taxInclusive = data.taxInclusive === true
  const taxExempt = data.taxExempt === true
  const paid = data.paid
  const en = data.locale === "en"
  const L = invoiceLabels(en)
  const ratePct = Math.round(taxRate * 100)
  // 明細金額の合計 (税込モードでは税込額、税抜モードでは税抜額)
  const lineSum = data.items.reduce((sum, it) => sum + it.amountYen, 0)
  // net=税抜相当 / tax=消費税 / total=請求総額。海外事業者(taxExempt)は税を上乗せしない。
  const net = taxExempt ? lineSum : taxInclusive ? Math.round(lineSum / (1 + taxRate)) : lineSum
  const tax = taxExempt ? 0 : taxInclusive ? lineSum - net : Math.floor(lineSum * taxRate)
  const total = taxExempt ? lineSum : taxInclusive ? lineSum : lineSum + tax
  const totalSuitcases = data.items.reduce((sum, it) => sum + it.suitcaseCount, 0)

  return (
    <Document
      title={`BondEx Invoice ${data.invoiceNumber}`}
      author={data.bondex.companyName}
      subject="Luggage Forwarding Invoice"
    >
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Image src={LOGO_PATH} style={styles.logo} />
            <Text style={paid ? [styles.title, { fontSize: 20 }] : styles.title}>
              {paid ? L.titlePaid : L.titlePlain}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.invoiceMeta}>
              {L.invoiceNo}
            </Text>
            <Text style={styles.invoiceNumber}>{data.invoiceNumber}</Text>
            <View style={{ height: 10 }} />
            <Text style={styles.invoiceMeta}>
              {L.issueDate}: {data.issuedDate}{"\n"}
              {L.period}: {data.period}
              {paid
                ? `\n${L.paymentDate}: ${paid.date}`
                : `${data.closingDate ? `\n${L.closingDate}: ${data.closingDate}` : ""}\n${L.paymentDue}: ${data.dueDate}`}
            </Text>
          </View>
        </View>
        <View style={styles.topRule} />

        {/* Bill to */}
        <View style={styles.toBlock}>
          <Text style={styles.toLabel}>{L.billTo}</Text>
          <Text style={styles.toName}>{data.agency.name}{L.honorific}</Text>
          {data.agency.contactPerson && (
            <Text style={styles.toMeta}>{L.attn}{data.agency.contactPerson}{L.attnSuffix}</Text>
          )}
          {data.agency.billingAddress && (
            <Text style={styles.toMeta}>{data.agency.billingAddress}</Text>
          )}
        </View>

        {/* Greeting (簡潔に1行。ご査収の一文は下部の注記に集約) */}
        <Text style={styles.greeting}>
          {L.greeting}
        </Text>

        {/* Line items (合計の重複表示だったサマリーボックスは廃止し、合計は末尾に集約) */}
        <View style={styles.itemsHeading}>
          <Text style={styles.tableHeading}>
            {L.itemsHeading}
          </Text>
          <Text style={styles.itemsCount}>
            {L.itemsCount(data.items.length, totalSuitcases)}
          </Text>
        </View>
        <View style={styles.tableHead}>
          <Text style={[styles.th, styles.col_date]}>{L.thDate}</Text>
          <Text style={[styles.th, styles.col_ref]}>{L.thRef}</Text>
          <Text style={[styles.th, styles.col_route]}>{L.thRoute}</Text>
          <Text style={[styles.th, styles.col_rep]}>{L.thRep}</Text>
          <Text style={[styles.th, styles.col_qty]}>{L.thQty}</Text>
          <Text style={[styles.th, styles.col_amt]}>{L.thAmt(taxInclusive)}</Text>
        </View>
        {data.items.map((it, i) => (
          <View key={i} style={styles.tableRow}>
            <Text style={[styles.td, styles.col_date]}>{formatJpDate(it.shipmentDate)}</Text>
            <Text style={[styles.td, styles.col_ref, { fontSize: 8 }]}>
              {it.tourNumber || it.bookingRef}
            </Text>
            <Text style={[styles.td, styles.col_route, { fontSize: 8 }]} wrap={false}>
              {routeLabel(it.fromHotel, it.toHotel)}
            </Text>
            <Text style={[styles.td, styles.col_rep, { fontSize: 8.5 }]}>{safeText(it.representative)}</Text>
            <Text style={[styles.td, styles.col_qty]}>{it.suitcaseCount}</Text>
            <Text style={[styles.td, styles.col_amt]}>
              ¥{it.amountYen.toLocaleString()}
            </Text>
          </View>
        ))}

        {/* Totals (小計/消費税/合計 は分割させない) */}
        <View style={styles.totalsBlock} wrap={false}>
          {taxInclusive ? (
            <>
              {/* 内税表示: 合計(税込) を主とし、消費税は内数として示す */}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{L.netExcl}</Text>
                <Text style={styles.totalValue}>¥{net.toLocaleString()}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>
                  {L.inclTax(ratePct)}
                </Text>
                <Text style={styles.totalValue}>¥{tax.toLocaleString()}</Text>
              </View>
              <View style={styles.grandTotalRow}>
                <Text style={styles.grandTotalLabel}>{L.totalIncl}</Text>
                <Text style={styles.grandTotalValue}>¥{total.toLocaleString()}</Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{L.subtotal}</Text>
                <Text style={styles.totalValue}>¥{net.toLocaleString()}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>
                  {L.consumptionTax(ratePct, taxExempt)}
                </Text>
                <Text style={styles.totalValue}>
                  {taxExempt ? L.notApplicable : `¥${tax.toLocaleString()}`}
                </Text>
              </View>
              <View style={styles.grandTotalRow}>
                <Text style={styles.grandTotalLabel}>{L.total}</Text>
                <Text style={styles.grandTotalValue}>¥{total.toLocaleString()}</Text>
              </View>
            </>
          )}
        </View>

        {/* お支払い状況: 支払い済み(カード)は領収ブロック、未払いは振込先ブロック */}
        {paid ? (
          <View style={styles.paidBlock} wrap={false}>
            <View style={styles.bankHeader}>
              <Text style={styles.bankLabel}>{L.paidLabel}</Text>
              <Text style={styles.paidStamp}>{L.paidStamp}</Text>
            </View>
            <View style={styles.bankGrid}>
              <View style={[styles.bankCol, { width: 150 }]}>
                <Text style={styles.bankFieldLabel}>{L.paidMethod}</Text>
                <Text style={styles.bankFieldValue}>{paid.method}</Text>
              </View>
              <View style={[styles.bankCol, { width: 130 }]}>
                <Text style={styles.bankFieldLabel}>{L.paidOn}</Text>
                <Text style={styles.bankFieldValue}>{paid.date}</Text>
              </View>
              {paid.reference ? (
                <View style={[styles.bankCol, { flex: 1 }]}>
                  <Text style={styles.bankFieldLabel}>{L.paidRef}</Text>
                  <Text style={[styles.bankFieldValue, { fontSize: 8 }]}>{paid.reference}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.bankNote}>
              {L.paidNote}
            </Text>
          </View>
        ) : (
          <View style={styles.bankBlock}>
            <View style={styles.bankHeader}>
              <Text style={styles.bankLabel}>{L.bankLabel}</Text>
              <View style={{ flexDirection: "row" }}>
                <Text style={styles.bankDueLabel}>{L.bankDueLabel}</Text>
                <Text style={styles.bankDueValue}>{data.dueDate}</Text>
              </View>
            </View>
            {parseBankInfo(data.bondex.bankInfo, L)}
            <Text style={styles.bankNote}>
              {L.bankNote}
            </Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <View style={styles.footerLeft}>
            <Text style={styles.footerCompany}>{data.bondex.companyName}</Text>
            <Text style={styles.footerLine}>{data.bondex.address}</Text>
            <Text style={styles.footerLine}>
              Email: {data.bondex.email}
            </Text>
            {data.bondex.registrationNumber && (
              <Text style={styles.footerLine}>
                {L.regNo}: {data.bondex.registrationNumber}
              </Text>
            )}
          </View>
          <Text
            style={styles.footerPage}
            render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}
