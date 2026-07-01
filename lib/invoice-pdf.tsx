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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InvoiceLineItem {
  shipmentDate: string  // YYYY-MM-DD
  bookingRef: string    // BDX-XXX-L1
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
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function formatJpDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  return `${Number(m[1])}/${Number(m[2])}/${Number(m[3])}`
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
  logo: { width: 130, height: 65, marginBottom: 8 },
  title: {
    fontSize: 28,
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
    marginTop: 8,
    marginBottom: 20,
  },
  // Agency / billing block
  toBlock: {
    marginBottom: 18,
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
    padding: 16,
    marginBottom: 18,
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
    marginBottom: 6,
    marginTop: 6,
  },
  tableHead: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: C_FG,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
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
    marginTop: 24,
    padding: 16,
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
    marginBottom: 8,
  },
  bankNote: {
    fontSize: 8,
    color: C_MUTED,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: C_HAIRLINE,
  },
  // Formal greeting (請求書の上)
  greeting: {
    fontSize: 9.5,
    color: C_FG,
    lineHeight: 1.7,
    marginBottom: 14,
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

/**
 * "三菱UFJ銀行 田園調布駅前支店 普通 0145653 株式会社JOJO" 形式の文字列を
 * 銀行名 / 支店 / 預金種別+口座番号 / 名義 に分解して 4 セルで表示する.
 */
function parseBankInfo(raw: string): React.JSX.Element {
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
        <Text style={styles.bankFieldLabel}>銀行名</Text>
        <Text style={styles.bankFieldValue}>{bank}</Text>
      </View>
      <View style={[styles.bankCol, { width: 110 }]}>
        <Text style={styles.bankFieldLabel}>支店</Text>
        <Text style={styles.bankFieldValue}>{branch}</Text>
      </View>
      <View style={[styles.bankCol, { width: 140 }]}>
        <Text style={styles.bankFieldLabel}>口座</Text>
        <Text style={styles.bankFieldValue}>{type}　{num}</Text>
      </View>
      <View style={[styles.bankCol, { flex: 1 }]}>
        <Text style={styles.bankFieldLabel}>口座名義</Text>
        <Text style={styles.bankFieldValue}>{holder}</Text>
      </View>
    </View>
  )
}

export function InvoiceDocument({ data }: { data: InvoiceInput }) {
  const subtotal = data.items.reduce((sum, it) => sum + it.amountYen, 0)
  const taxRate = data.taxRate ?? 0.10
  const tax = Math.floor(subtotal * taxRate)
  const total = subtotal + tax
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
            <Text style={styles.title}>請 求 書</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.invoiceMeta}>
              INVOICE NO.
            </Text>
            <Text style={styles.invoiceNumber}>{data.invoiceNumber}</Text>
            <View style={{ height: 10 }} />
            <Text style={styles.invoiceMeta}>
              発行日: {data.issuedDate}{"\n"}
              対象期間: {data.period}
              {data.closingDate ? `\n締日: ${data.closingDate}` : ""}
              {"\n"}お支払期限: {data.dueDate}
            </Text>
          </View>
        </View>
        <View style={styles.topRule} />

        {/* Bill to */}
        <View style={styles.toBlock}>
          <Text style={styles.toLabel}>BILL TO</Text>
          <Text style={styles.toName}>{data.agency.name} 御中</Text>
          {data.agency.contactPerson && (
            <Text style={styles.toMeta}>ご担当: {data.agency.contactPerson} 様</Text>
          )}
          {data.agency.billingAddress && (
            <Text style={styles.toMeta}>{data.agency.billingAddress}</Text>
          )}
        </View>

        {/* Greeting */}
        <Text style={styles.greeting}>
          拝啓 平素は格別のお引き立てを賜り、誠にありがとうございます。{"\n"}
          下記の通りご請求申し上げます。ご査収のほど、よろしくお願い申し上げます。
        </Text>

        {/* Summary box */}
        <View style={styles.summaryBox}>
          <View style={styles.summaryCol}>
            <Text style={styles.summaryLabel}>SERVICE</Text>
            <Text style={styles.summaryValue}>BondEx Luggage Forwarding</Text>
            <View style={{ height: 8 }} />
            <Text style={styles.summaryLabel}>VOLUME</Text>
            <Text style={styles.summaryValue}>
              {data.items.length} 件 / {totalSuitcases} 個
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.summaryLabel}>ご請求金額 (税込)</Text>
            <Text style={styles.summaryTotal}>¥{total.toLocaleString()}</Text>
          </View>
        </View>

        {/* Line items */}
        <Text style={styles.tableHeading}>明細</Text>
        <View style={styles.tableHead}>
          <Text style={[styles.th, styles.col_date]}>発送日</Text>
          <Text style={[styles.th, styles.col_ref]}>予約番号</Text>
          <Text style={[styles.th, styles.col_route]}>区間</Text>
          <Text style={[styles.th, styles.col_rep]}>代表者</Text>
          <Text style={[styles.th, styles.col_qty]}>個数</Text>
          <Text style={[styles.th, styles.col_amt]}>金額 (税抜)</Text>
        </View>
        {data.items.map((it, i) => (
          <View key={i} style={styles.tableRow}>
            <Text style={[styles.td, styles.col_date]}>{formatJpDate(it.shipmentDate)}</Text>
            <Text style={[styles.td, styles.col_ref, { fontSize: 8 }]}>{it.bookingRef}</Text>
            <Text style={[styles.td, styles.col_route, { fontSize: 8.5 }]} wrap={false}>
              {it.fromHotel} → {it.toHotel}
            </Text>
            <Text style={[styles.td, styles.col_rep, { fontSize: 8.5 }]}>{it.representative}</Text>
            <Text style={[styles.td, styles.col_qty]}>{it.suitcaseCount}</Text>
            <Text style={[styles.td, styles.col_amt]}>
              ¥{it.amountYen.toLocaleString()}
            </Text>
          </View>
        ))}

        {/* Totals */}
        <View style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>小計</Text>
            <Text style={styles.totalValue}>¥{subtotal.toLocaleString()}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>
              消費税 ({Math.round(taxRate * 100)}%)
            </Text>
            <Text style={styles.totalValue}>¥{tax.toLocaleString()}</Text>
          </View>
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>合計</Text>
            <Text style={styles.grandTotalValue}>¥{total.toLocaleString()}</Text>
          </View>
        </View>

        {/* Bank info — 構造化表示 */}
        <View style={styles.bankBlock}>
          <View style={styles.bankHeader}>
            <Text style={styles.bankLabel}>お振込先 / BANK INFO</Text>
            <View style={{ flexDirection: "row" }}>
              <Text style={styles.bankDueLabel}>お支払期限</Text>
              <Text style={styles.bankDueValue}>{data.dueDate}</Text>
            </View>
          </View>
          {parseBankInfo(data.bondex.bankInfo)}
          <Text style={styles.bankNote}>
            ・お振込手数料は貴社にてご負担をお願い申し上げます。{"\n"}
            ・上記期限までにお手続きが難しい場合は、事前にご連絡ください。
          </Text>
        </View>

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
                適格請求書発行事業者登録番号: {data.bondex.registrationNumber}
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
